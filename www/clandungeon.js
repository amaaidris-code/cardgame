// ========================================
// زنزانة العصابة التعاونية (Clan Co-op Dungeon)
// ========================================
// حتى 4 لاعبين من العصابة يقاتلون سويًا في زنزانة.
// النظام Server-authoritative (مثل PvP لكن معمّم لعدة لاعبين).
// الدور يُثبَّت مرّة واحدة عبر سباق (أول من يضغط يكون أول من يلعب طوال الغارة).
// أي مهارة يمكن أن تستهدف الوحش أو أي لاعب من الفرقة.
// الجائزة تُقسَّم بالتساوي بين كل من دخل الزنزانة.

const ClanDungeon = (function(){

    let timer = null;
    let myRun = null;        // run_id الحالي الذي أنا فيه
    let myState = null;      // آخر حالة من clan_dungeon_get_state
    let curClanId = null;
    let selectedSkill = null;
    let selectedWeaponSkill = false; // هل المهارة المحددة من سلاحي
    let myWeapon = null;              // آخر سلاح مجهز (من get_my_active_weapon)
    let myPotions = [];               // الجرعات (من get_my_potions)
    let cdView = "player";            // player / weapon / companion (مثل PvE)
    let cdViewPinned = false;         // هل اختار اللاعب العرض يدويًا
    let pendingSteal = null;          // مهارة سرقة قيد الاختيار: { abilitySkillId, targetSkillId, targetName }
    let myFace = "";                  // صورة الشخصية النشطة (لأيقونة العودة من وضع المرافق)
    let turnTimerInterval = null;
    let turnDeadline = null;
    let skipInFlight = false;

    function getToken(){ return localStorage.getItem("player_token"); }
    function getPlayerId(){ return localStorage.getItem("player_id"); }
    function box(){ return document.getElementById("clandungeon-content"); }
    function isOpen(){ const s = document.getElementById("clandungeon-screen"); return s && s.classList.contains("active"); }
    function isMyCompTurn(){ return myTurn() && myState && myState.turn_sub === 1; }

    // ---------- بدون شخصية نشطة ----------
    // إذا حُذفت شخصية اللاعب يجب أن يختار أو يطلب شخصية جديدة قبل اللعب.
    function isNoActiveCharacterError(m){
        return typeof m === "string" && m.indexOf("ليس لديك شخصية") !== -1;
    }
    function forceChooseCharacter(msg){
        toast(msg || "لا تملك شخصية نشطة — اختر أو اطلب شخصية جديدة أولاً");
        if(typeof openScreen === "function" && typeof loadAvailableCharacters === "function"){
            openScreen("character-choice-screen");
            loadAvailableCharacters();
        }
    }

    // ---------- turn timer (متزامن مع turn_deadline من السيرفر) ----------
    // يعرض عدًّا تنازليًا للدور الحالي. عند انتهاء المهلة يطلب من السيرفر
    // تخطّي الدور (clan_dungeon_skip_turn) — الخادم هو من يتحقق فعليًا من
    // انتهاء المهلة، فلا ضرر من استدعائها أكثر من مرة أو من أكثر من لاعب.
    function stopTurnTimer(){
        if(turnTimerInterval){ clearInterval(turnTimerInterval); turnTimerInterval = null; }
        const el = document.getElementById("cd-turn-timer");
        if(el) el.textContent = "";
    }

    function updateTurnTimer(deadlineIso){
        if(deadlineIso === turnDeadline && turnTimerInterval) return;
        turnDeadline = deadlineIso || null;
        if(turnTimerInterval){ clearInterval(turnTimerInterval); turnTimerInterval = null; }
        const el = document.getElementById("cd-turn-timer");
        if(!turnDeadline){ if(el) el.textContent = ""; return; }
        const deadlineMs = new Date(turnDeadline).getTime();
        const tick = () => {
            if(!el || !isOpen()){ stopTurnTimer(); return; }
            const remainingMs = deadlineMs - Date.now();
            const sec = Math.max(0, Math.ceil(remainingMs / 1000));
            const m = Math.floor(sec / 60), s = sec % 60;
            el.textContent = "⏱️ " + m + ":" + (s < 10 ? "0" + s : s);
            if(remainingMs <= 0){
                // عند انتهاء المهلة نطلب التخطّي مرة واحدة ثم نوقف المؤقّت.
                // النبضة (refreshState) هي من تحدّث الحالة الفعلية؛ فإن بقي الدور
                // منتهيًا يُعيد updateTurnTimer تشغيل المؤقّت ويُعاد الطلب بوتيرة
                // النبضة بدلًا من إغراق السيرفر بطلب كل ثانية.
                requestSkipTurn();
                stopTurnTimer();
                return;
            }
        };
        tick();
        turnTimerInterval = setInterval(tick, 1000);
    }

    async function requestSkipTurn(){
        if(!myRun) return;
        if(skipInFlight) return;
        skipInFlight = true;
        try{
            await supabaseClient.rpc("clan_dungeon_skip_turn", { p_token: getToken(), p_run_id: myRun });
        }catch(e){
            // قد تفشل لأن لاعبًا آخر تخطّى أولاً أو المهلة لم تنتهِ فعليًا بعد
            // (فرق توقيت بسيط) — سنعيد المحاولة في النبضة التالية
        }finally{
            skipInFlight = false;
        }
        refreshState().catch(function(){});
        renderRun().catch(function(){});
    }

    // ---------- open / close ----------
    function open(){
        openScreen("clandungeon-screen");
        curClanId = null;
        myRun = null;
        myState = null;
        cdView = "player";
        cdViewPinned = false;
        load();
    }

    function stopPolling(){
        if(timer){ clearInterval(timer); timer = null; }
        stopTurnTimer();
        turnDeadline = null;
    }

    function toast(msg){
        const el = document.getElementById("clandungeon-toast");
        if(!el) return;
        el.textContent = msg;
        el.classList.remove("hidden");
        clearTimeout(el._t);
        el._t = setTimeout(function(){ el.classList.add("hidden"); }, 3000);
    }

    function escapeHtml(s){
        return String(s == null ? "" : s)
            .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
            .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
    }

    function userIds(){
        const p = (myState && myState.players) || [];
        return p.map(function(x){ return String(x.player_id); });
    }
    function isMemberOfRun(){
        return myRun ? userIds().indexOf(String(getPlayerId())) !== -1 : false;
    }

    // ---------- main load ----------
    async function load(){
        const b = box();
        if(!b) return;
        b.innerHTML = '<div class="chat-loading">جاري التحميل...</div>';
        try{
            const clan = await getMyClan();
            if(!clan){
                b.innerHTML = '<div class="chat-empty">⚠️ يجب أن تكون في عصابة لتشغيل الزنزانة التعاونية.</div>';
                return;
            }
            curClanId = clan.clan_id;

            // هل أنا في غارة حالية؟
            const my = await findMyRun();
            if(my){ myRun = my.run_id; startBattlePolling(); await renderRun(); }
            else{ myRun = null; await renderLobby(); }
        }catch(e){
            b.innerHTML = '<div class="chat-empty">⚠️ خطأ: ' + escapeHtml(e.message || e) + '</div>';
        }
    }

    async function getMyClan(){
        const { data, error } = await supabaseClient.rpc("clan_my_clan", { p_token: getToken() });
        if(error) throw error;
        if(!data || !data.length) return null;
        return data[0];
    }

    async function listRuns(){
        const { data, error } = await supabaseClient.rpc("clan_dungeon_list", { p_token: getToken(), p_clan_id: curClanId });
        if(error) throw error;
        return data || [];
    }

    async function findMyRun(){
        const runs = await listRuns();
        for(const r of runs){
            try{
                const { data, error } = await supabaseClient.rpc("clan_dungeon_get_state", { p_token: getToken(), p_run_id: r.run_id });
                if(!error && data){
                    myState = Array.isArray(data) ? data[0] : data;
                    return r;
                }
            }catch(e){ /* لست عضوًا في هذه الغارة */ }
        }
        return null;
    }

    // ---------- lobby ----------
    async function renderLobby(){
        const b = box();
        const runs = await listRuns().catch(function(){ return []; });
        let dungeons = [];
        try{
            const { data, error } = await supabaseClient.rpc("dungeon_list_public", { p_token: getToken() });
            if(!error) dungeons = data || [];
        }catch(e){}

        const runRows = runs.length ? runs.map(function(r, i){
                const inMine = r.run_id === myRun;
                return `
                <div class="cd-run-row">
                    <div class="cd-run-info">
                        <div class="cd-run-name">⚔️ ${escapeHtml(r.dungeon_name)}</div>
                        <div class="cd-run-status">${statusLabel(r.status)} • ${r.member_count}/4 لاعب</div>
                    </div>
                    <button class="cd-btn" onclick="ClanDungeon.${inMine ? "enterRun" : "tryJoin"}('${r.run_id}')">${inMine ? "دخول" : "انضمام"}</button>
                </div>`;
            }).join("") : '<div class="chat-empty">لا توجد غارات مفتوحة حاليًا.</div>';

        const dungeonOptions = dungeons.length ? dungeons.map(function(d){
                return `<option value="${d.id}">${escapeHtml(d.name)} — 🏅 ${d.gold_prize} ذهب</option>`;
            }).join("") : '';

        b.innerHTML = `
            <div id="clandungeon-toast" class="cd-toast hidden"></div>
            <div class="cd-title">اختر زنزانة وابدأ غارة تعاونية (حتى 4 لاعبين)</div>
            <div class="cd-create-box">
                <select id="cd-dungeon-select">${dungeonOptions || '<option value="">لا توجد زنزانات</option>'}</select>
                <button class="cd-btn cd-primary" onclick="ClanDungeon.createRun()">➕ إنشاء غارة</button>
            </div>
            <div class="friends-group-title">الغارات المفتوحة في العصابة</div>
            <div class="cd-runs-list">${runRows}</div>
            <div class="cd-hint">💡 أدخل أولاً بأي غارة، ثم اضغط "ابدأ السباق" — أول من يحصل على نصر مبكر يبدأ الدور في كل الغارة. بعدها انقر بسرعة على الزر الأحمر: أسرع ضغطة = دورك أولاً لكل الوحوش.</div>
        `;
    }

    function statusLabel(s){
        if(s === "lobby") return "🟡 قاعة انتظار";
        if(s === "race") return "🔴 سباق";
        if(s === "active") return "⚔️ في المعركة";
        if(s === "finished") return "🏆 انتهت";
        return s;
    }

    // ---------- run (lobby / race / battle / finished) ----------
    async function renderRun(){
        const b = box();
        if(!myState){
            try{
                const { data, error } = await supabaseClient.rpc("clan_dungeon_get_state", { p_token: getToken(), p_run_id: myRun });
                if(error){ b.innerHTML = '<div class="chat-empty">⚠️ ' + escapeHtml(error.message) + '</div>'; return; }
                myState = Array.isArray(data) ? data[0] : data;
                updateIcons();
                // Ensure companion icon reflects initial state after state load
                if (myState && myState.status === "active") {
                    // Force refresh after battle starts
                    setTimeout(updateIcons, 500);
                }
            }catch(e){ b.innerHTML = '<div class="chat-empty">⚠️ ' + escapeHtml(e.message||e) + '</div>'; return; }
        }
        const st = myState;
        if(st.status === "lobby") await renderLobbyRoom();
        else if(st.status === "race") await renderRace();
        else if(st.status === "active") await renderBattle();
        else if(st.status === "finished"){ stopSubChatPolling(); await renderResult(); }
        if(st.status === "lobby" || st.status === "race" || st.status === "active") startSubChatPolling();
    }

    // ---------- lobby room ----------
    async function renderLobbyRoom(){
        const b = box();
        const members = await getMemberNames();
        const players = myState.players || [];
const myReady = players.some(function(p){ return String(p.player_id)===String(getPlayerId()) && p.ready; });
        const present = players.filter(function(p){ return !!p.present; });
        const aliveCount = present.length;
        const allReady = aliveCount > 0 && present.every(function(p){ return !!p.ready; });
        const canStart = aliveCount === 1 || (aliveCount >= 2 && allReady);
        const readyCount = present.filter(function(p){ return !!p.ready; }).length;

        const rows = players.map(function(p){
            const nm = members[p.player_id] || "لاعب";
            const isMe = String(p.player_id)===String(getPlayerId());
            const presentMark = p.present ? "🟢" : "⚪";
            return `
                <div class="cd-party-row">
                    <div class="cd-party-avatar">${isMe ? "👤" : "🤝"}</div>
                    <div class="cd-party-meta">
                        <div class="cd-party-name">${presentMark} ${escapeHtml(nm)} ${isMe ? "(أنت)" : ""}</div>
                        <div class="cd-party-ready">${p.present ? (p.ready ? "✅ جاهز" : "⏳ ينتظر") : "غير متصل"}</div>
                    </div>
                </div>`;
        }).join("") || "";

        b.innerHTML = `
            <div id="clandungeon-toast" class="cd-toast hidden"></div>
            <div class="cd-title">قاعة انتظار الزنزانة ⚔️</div>
            <div class="cd-status-line">${aliveCount}/4 لاعب حاضر في الغارة</div>
            <div class="cd-party-list">${rows || '<div class="chat-empty">لا يوجد لاعبون</div>'}</div>
            <div class="cd-buttons">
                <button class="cd-btn ${myReady ? 'cd-ready' : 'cd-primary'}" onclick="ClanDungeon.toggleReady()">${myReady ? "✅ جاهز — إلغاء" : "اضغط لتكون جاهزًا"}</button>
                <button class="cd-btn ${canStart ? 'cd-primary' : ''}" onclick="ClanDungeon.startRace()" ${canStart ? "" : "disabled"}>🚀 ابدأ الغارة (${aliveCount}/4)</button>
                <button class="cd-btn cd-leave" onclick="ClanDungeon.leaveRun()">🚪 عودة إلى الغارات</button>
            </div>
            ${aliveCount >= 2 && !allReady
                ? `<div class="cd-hint">⏳ انتظر حتى يجاهز جميع الحاضرين لبدء السباق (جاهز ${readyCount}/${aliveCount}).</div>`
                : `<div class="cd-hint">💡 أنت وحدك؟ ابدأ مباشرة. أو اضغط جاهزًا حتى يجاهز الجميع ثم ابدأ الغارة.</div>`}
            ${subChatBlock()}
        `;
    }

    // ---------- race ----------
    function renderRace(){
        const b = box();
        if(raceTimer){ clearInterval(raceTimer); raceTimer = null; }
        racePressed = false;
        countdown = 3;
        b.innerHTML = `
            <div id="clandungeon-toast" class="cd-toast hidden"></div>
            <div class="cd-title">🔴 اضغط بسرعة! 🏁</div>
            <div class="cd-race-sub">أول من يضغط يكون أول من يلعب في كل الغارة</div>
            <button class="cd-race-button" onclick="ClanDungeon.pressRace()">👆 اضغط!</button>
            <div class="cd-race-count" id="cd-race-count">3</div>
            <div class="cd-race-tip">اضغط الزر الأحمر قبل انتهاء العدّ</div>
            <div class="cd-buttons">
                <button class="cd-btn cd-leave" onclick="ClanDungeon.leaveRun()">🚪 عودة إلى الغارات</button>
            </div>
            ${subChatBlock()}
        `;
        raceTimer = setInterval(stepRaceCountdown, 1000);
    }

    let raceTimer = null;
    let racePressed = false;
    let countdown = 3;

    function stepRaceCountdown(){
        if(!isOpen() || !myState || myState.status !== "race"){ if(raceTimer){ clearInterval(raceTimer); raceTimer=null; } return; }
        const el = document.getElementById("cd-race-count");
        if(!el){ return; }
        countdown--;
        el.textContent = Math.max(0, countdown);
        if(countdown <= 0){
            clearInterval(raceTimer); raceTimer = null;
            if(!racePressed){
                pressRace();
            } else {
                beginUp();
            }
        }
    }

    // ---------- race press ----------
    async function pressRace(){
        if(!myRun) return;
        if(racePressed) return;
        racePressed = true;
        try{
            await supabaseClient.rpc("clan_dungeon_race_press", { p_token: getToken(), p_run_id: myRun });
            const el = document.getElementById("cd-race-count");
            if(el){ el.textContent = "✓"; el.classList.add("cd-pressed"); }
            const btn = document.querySelector(".cd-race-button");
            if(btn){ btn.disabled = true; btn.textContent = "✓ ضغطت"; }
            beginUp();
        }catch(e){
            toast(e.message || e);
            racePressed = false;
        }
    }

    function beginUp(){
        // بعد أن يضغط اللاعب الأول (الأسرع) نبدأ الغارة بعد لحظة قصيرة جدًا
        // بحيث تُحسم السرعة المطلقة؛ غير ذلك يبدأ تلقائيًا عند انتهاء العدّ.
        setTimeout(function(){
            if(!isOpen()) return;
            if(!myState || myState.status !== "race") return;
            beginRun().catch(function(){});
        }, 2500);
    }

    async function beginRun(){
        try{
            await supabaseClient.rpc("clan_dungeon_begin", { p_token: getToken(), p_run_id: myRun });
            await refreshState();
            await renderRun();
        }catch(e){ /* شخص آخر بدأ بالفعل */ }
    }

    // ---------- battle ----------
    async function renderBattle(){
        const b = box();
        const st = myState;
        const members = await getMemberNames();
        const players = (st.players || []).slice().sort(function(a,c){ return String(a.player_id)===String(getPlayerId()) ? -1 : 1; });
        const me = players.find(function(p){ return String(p.player_id)===String(getPlayerId()); });
        const myTurnNow = myTurn();
        const myCompTurn = isMyCompTurn();

        let myChar = null;
        try{
            const oc = await supabaseClient.rpc("get_my_active_character", { p_token: getToken() });
            if(oc && oc.data && oc.data[0]) myChar = oc.data[0];
        }catch(e){}
        const myPhoto = (myChar && (myChar.identity_image || myChar.skill_card_image)) ? (myChar.identity_image || myChar.skill_card_image) : "";
        const myName = (myChar && myChar.name) ? myChar.name : "أنت";
        myFace = myPhoto;

        // في عرض المرافق: البطاقة تعرض صورة/اسم المرافق بدل الشخصية
        const compVisible = cdView === "companion" && st.my_comp_alive && (st.my_comp_hp || 0) > 0;
        const faceImg = (compVisible && st.my_comp_image) ? st.my_comp_image : myPhoto;
        const faceName = compVisible ? (st.my_comp_name || "مرافق") : myName;
        // والـ HP المنفصل للمرافق بدل HP الشخصية
        const faceHp = compVisible ? (st.my_comp_hp || 0) : me.hp;
        const faceMaxHp = compVisible ? (st.my_comp_max_hp || 1) : me.max_hp;

        const monsterHpPct = st.monster_max_hp ? Math.max(0, Math.min(100, (st.monster_hp / st.monster_max_hp) * 100)) : 0;
        const myHpPct = faceMaxHp ? Math.max(0, Math.min(100,(faceHp/faceMaxHp)*100)) : 0;
        const fallbackImg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="100%" height="100%" fill="#1a1a22" rx="8"/><text x="50%" y="55%" font-size="20" text-anchor="middle" fill="#fff">👹</text></svg>')}`;

        // HP منفصل للمرافق يُعرض أسفل بطاقة اللاعب دائمًا عندما يمتلك المرافق
        const compAliveNow = st.my_comp_alive && (st.my_comp_hp || 0) > 0;
        const compHpPct = (st.my_comp_max_hp || 0) ? Math.max(0, Math.min(100, ((st.my_comp_hp || 0) / st.my_comp_max_hp) * 100)) : 0;
        const compHpBlock = (st.my_comp_max_hp && st.my_comp_max_hp > 0) ? `
            <div class="cd-arena-comp ${compAliveNow ? '' : 'cd-comp-dead'}">
                <span class="cd-arena-comp-name">🐾 ${escapeHtml(st.my_comp_name || "مرافق")}</span>
                <div class="hp-bar cd-comp-hp-wrap"><div class="hp-fill cd-comp-hp" style="width:${compHpPct}%"></div></div>
                <span class="cd-arena-comp-hp">${compAliveNow ? ((st.my_comp_hp || 0) + "/" + st.my_comp_max_hp) : "☠️ سقط"}</span>
            </div>` : "";

        const sidePlayers = players.map(function(p){
            const nm = members[p.player_id] || "لاعب";
            const isMe = String(p.player_id)===String(getPlayerId());
            const pct = p.max_hp ? Math.max(0,Math.min(100,(p.hp/p.max_hp)*100)) : 0;
            return `<div class="cd-player-side ${isMe?'cd-me':''} ${p.alive?'':'cd-dead'}">
                <span class="cd-player-side-role">${isMe?'👤':'🤝'}</span>
                <span class="cd-player-side-name">${escapeHtml(nm)}</span>
                <span class="cd-player-side-hp">${p.hp}/${p.max_hp}</span>
                <div class="hp-bar cd-player-side-bar"><div class="hp-fill" style="width:${pct}%"></div></div>
            </div>`;
        }).join("");

        const turnLabel = turnText(st, members);
        const monsterLabel = `الوحش ${st.monster_index + 1} / ${st.total_monsters}`;
        const hasDeadline = st.turn_phase === "player" && st.turn_player_id && st.turn_deadline;

        if(!cdViewPinned) cdView = isMyCompTurn() ? "companion" : "player";

        b.innerHTML = `
            <div id="clandungeon-toast" class="cd-toast hidden"></div>
            <div class="cd-turn-banner ${myTurnNow?'cd-turn-mine':''}">
                <span class="cd-exit" onclick="ClanDungeon.leaveRun()" title="خروج / حذف الغارة">🚪</span>
                <span class="cd-turn-label">${turnLabel}</span>
                ${hasDeadline ? `<span id="cd-turn-timer" class="cd-turn-timer"></span>` : ""}
            </div>
            <div class="cd-players-side" id="cd-players-side">${sidePlayers}</div>
            <div class="battle-arena cd-arena">
                <div class="battle-card enemy-card">
                    <img class="battle-image" src="${escapeHtml(st.monster_image || '')}" alt="" onerror="this.onerror=null;this.src='${fallbackImg}'">
                    <h3>${escapeHtml(st.monster_name || "وحش")}<span class="cd-wave"> ${monsterLabel}</span></h3>
                    <div class="hp-bar"><div class="hp-fill cd-monster-hp" style="width:${monsterHpPct}%"></div></div>
                    <p>❤️ <span>${st.monster_hp} / ${st.monster_max_hp}</span></p>
                    <div class="used-skills" id="cd-enemy-used-skills"></div>
                </div>
                <div class="battle-middle">
                    <div class="vs-divider"><span class="vs-line vs-line-left"></span><span class="vs-text">VS</span><span class="vs-line vs-line-right"></span></div>
                </div>
                <div class="battle-card player-card">
                    <img class="battle-image" src="${escapeHtml(faceImg)}" alt="" onerror="this.onerror=null;this.src='${fallbackImg}'">
                    <h3>${escapeHtml(faceName)}</h3>
                    <button class="weapon-view-icon" id="cd-weapon-icon" style="display:none;" onclick="ClanDungeon.cdToggleView('weapon')" title="تبديل عرض الشخصية/السلاح">⚔️</button>
                    <button class="companion-view-icon" id="cd-companion-icon" style="display:none;" onclick="ClanDungeon.cdToggleView('companion')" title="تبديل عرض الشخصية/المرافق">🐾</button>
                    <div class="hp-bar"><div class="hp-fill cd-player-hp" style="width:${myHpPct}%"></div></div>
                    <p>❤️ <span>${faceHp} / ${faceMaxHp}</span></p>
                    ${compHpBlock}
                    <div class="used-skills" id="cd-player-used-skills"></div>
                    <div class="potion-bar" id="cd-potions"></div>
                    <div class="skills-container">
                        <div class="skills-pages" id="cd-player-skills-pages"></div>
                        <div class="skill-dots" id="cd-skill-dots"></div>
                    </div>
                </div>
            </div>
            <div id="cd-targets" class="cd-targets"></div>
            ${subChatBlock()}`;

        await loadWeapon();

        // بدّئ/حدّث مؤقّت الدور (يعمل فقط في دور لاعب بموعد انتهاء)
        if(st.turn_phase === "player" && st.turn_player_id && st.turn_deadline){
            updateTurnTimer(st.turn_deadline);
        }else{
            stopTurnTimer();
        }

        if(myTurnNow){
            loadSkills();
        } else {
            // ليس دوري: نعرض فقط حالة الانتظار
            const sk = document.getElementById("cd-player-skills-pages");
            if(sk){
                if(st.turn_phase === "monster"){
                    sk.innerHTML = '<div class="cd-waiting">👹 الوحش يتصرف...</div>';
                    // نحرّك الوحش تلقائيًا (server-authoritative، أي لاعب يستطيع تفعيله)
                    ensureMonsterAct();
                } else {
                    sk.innerHTML = '<div class="cd-waiting">⏳ دور لاعب آخر...</div>';
                }
            }
            const dots = document.getElementById("cd-skill-dots");
            if(dots) dots.innerHTML = "";
            selectedSkill = null;
        }

        updateIcons();
        renderPotionBar();
    }

    // ---------- turn text ----------
    function turnText(st, members){
        if(st.status === "finished") return "🏆 انتهت المعركة";
        if(st.status === "lobby") return "🟡 في القاعة";
        if(st.status === "race") return "🔴 سباق";
        if(st.turn_phase === "monster") return "👹 دور الوحش...";
        if(st.turn_phase === "player"){
            if(st.turn_player_id){
                if(String(st.turn_player_id)===String(getPlayerId())) return (st.my_comp_turn ? "🐾 دور مرافقك الآن! اختر مهارته" : "⬇️ دورك! اختر مهارة واضغط هدفًا");
                return "⏳ دور: " + escapeHtml(members[st.turn_player_id] || "لاعب");
            }
        }
        return "⚔️ معركة...";
    }

    // ---------- monster act auto-advance ----------
    let monsterActing = false;
    function ensureMonsterAct(){
        if(monsterActing) return;
        monsterActing = true;
        setTimeout(function(){
            monsterActing = false;
            if(!myState || myState.turn_phase !== "monster" || !isOpen()) return;
            actMonster().catch(function(){});
        }, 1200);
    }

    async function actMonster(){
        try{
            await supabaseClient.rpc("clan_dungeon_monster_act", { p_token: getToken(), p_run_id: myRun });
            await refreshState();
            await renderRun();
        }catch(e){
            await refreshState();
            await renderRun();
        }
    }

    // ---------- skills ----------
    let monsterSkills = [];
    async function loadSkills(){
        const st = myState;
        const compTurn = isMyCompTurn();
        let rows = [];
        monsterSkills = [];
        try{
            const { data, error } = await supabaseClient.rpc("clan_dungeon_list_skills", { p_token: getToken(), p_run_id: myRun });
            if(!error) rows = (data || []);
        }catch(e){ rows = []; }
        monsterSkills = rows.filter(function(s){ return s.fighter_kind === "monster"; });
        const pagesEl = document.getElementById("cd-player-skills-pages");
        if(!pagesEl) return;
        const myTurnNow = myTurn();

        if(cdView === "weapon"){
            renderWeaponSkills(pagesEl, myTurnNow);
            return;
        }

        const skills = rows.filter(function(s){
            if(cdView === "companion") return s.fighter_kind === "companion";
            return compTurn ? s.fighter_kind === "companion" : s.fighter_kind === "player";
        });
        if(!skills.length){
            pagesEl.innerHTML = '<div class="cd-waiting">لا توجد مهارات.</div>';
            return;
        }
        selectedSkill = null;
        renderTargets();

        const locked = !myTurnNow;
        const pages = chunkSkills(skills, 4);
        let currentIndex = Number(pagesEl.dataset.activePage || 0);
        currentIndex = Math.max(0, Math.min(currentIndex, pages.length - 1));
        pagesEl.innerHTML = "";
        pages.forEach(function(chunk, i){
            const div = document.createElement("div");
            div.className = "skills-page" + (i === currentIndex ? " active" : "");
            chunk.forEach(function(s){
                const sid = s.skill_id || s.id;
                const stealAbility = s.effect && ["steal","copy","control","shadow","delay_cooldown"].indexOf(s.effect) !== -1;
                const btn = document.createElement("button");
                btn.dataset.skill = sid;
                btn.innerHTML = `<span class="cd-skill-emoji">${skillEmoji(s)}</span><span class="cd-skill-name">${escapeHtml(s.name)}</span>${s.cooldown ? `<em class="cd-skill-cd">CD ${s.cooldown}</em>` : ""}`;
                btn.disabled = locked || (stealAbility && !myTurnNow);
                btn.onclick = function(){ if(stealAbility){ ClanDungeon.openStealPicker(sid); } else { ClanDungeon.pickSkill(sid); } };
                div.appendChild(btn);
            });
            pagesEl.appendChild(div);
        });
        pagesEl.dataset.activePage = String(currentIndex);

        const dotsEl = document.getElementById("cd-skill-dots");
        if(dotsEl){
            if(pages.length <= 1){
                dotsEl.style.display = "none";
            } else {
                dotsEl.style.display = "";
                dotsEl.innerHTML = "";
                pages.forEach(function(_, i){
                    const dot = document.createElement("span");
                    if(i === currentIndex) dot.classList.add("active");
                    dot.onclick = function(){
                        pagesEl.dataset.activePage = String(i);
                        Array.prototype.forEach.call(pagesEl.children, function(pg, idx){ pg.classList.toggle("active", idx === i); });
                        Array.prototype.forEach.call(dotsEl.children, function(d, idx){ d.classList.toggle("active", idx === i); });
                    };
                    dotsEl.appendChild(dot);
                });
            }
        }
    }

    function renderWeaponSkills(pagesEl, myTurnNow){
        selectedSkill = null;
        renderTargets();
        const sks = (myWeapon && Array.isArray(myWeapon.skills)) ? myWeapon.skills : [];
        const broken = myWeapon && (myWeapon.durability_current || 0) <= 0;
        const locked = broken || !myTurnNow;
        const dotsEl = document.getElementById("cd-skill-dots");
        if(!sks.length){
            pagesEl.innerHTML = '<div class="cd-waiting">لا مهارات للسلاح</div>';
            if(dotsEl) dotsEl.style.display = "none";
            return;
        }
        const pages = chunkSkills(sks, 4);
        let ci = Number(pagesEl.dataset.activePage || 0);
        ci = Math.max(0, Math.min(ci, pages.length - 1));
        pagesEl.innerHTML = "";
        pages.forEach(function(chunk, i){
            const div = document.createElement("div");
            div.className = "skills-page" + (i === ci ? " active" : "");
            chunk.forEach(function(s){
                const id = s.id || s.skill_id;
                const btn = document.createElement("button");
                btn.dataset.skill = id;
                btn.disabled = locked;
                btn.style.setProperty("--wcolor", s.color && /^#[0-9A-Fa-f]{6}$/.test(s.color) ? s.color : "#ffffff");
                btn.innerHTML = `<span class="cd-skill-emoji">⚔️</span><span class="cd-skill-name">${escapeHtml(s.name || 'مهارة')}</span>`;
                btn.onclick = function(){ ClanDungeon.pickWeaponSkill(id); };
                div.appendChild(btn);
            });
            pagesEl.appendChild(div);
        });
        pagesEl.dataset.activePage = String(ci);
        if(dotsEl){
            if(pages.length <= 1){
                dotsEl.style.display = "none";
            } else {
                dotsEl.style.display = "";
                dotsEl.innerHTML = "";
                pages.forEach(function(_, i){
                    const d = document.createElement("span");
                    if(i === ci) d.classList.add("active");
                    d.onclick = function(){
                        pagesEl.dataset.activePage = String(i);
                        Array.prototype.forEach.call(pagesEl.children, function(pg, idx){ pg.classList.toggle("active", idx === i); });
                        Array.prototype.forEach.call(dotsEl.children, function(dot, idx){ dot.classList.toggle("active", idx === i); });
                    };
                    dotsEl.appendChild(d);
                });
            }
        }
    }

    function clearSkills(){
        const el = document.getElementById("cd-player-skills-pages");
        if(el && !myTurn()) el.innerHTML = "";
    }

    function openStealPicker(abilitySkillId){
        if(!myTurn()){ toast("ليس دورك الآن"); return; }
        if(!monsterSkills.length){ toast("لا توجد مهارات من الوحش لسرقتها"); return; }
        const targets = document.getElementById("cd-targets");
        if(targets) targets.innerHTML = "";
        selectedSkill = null;
        selectedWeaponSkill = false;
        const ov = document.createElement("div");
        ov.className = "cd-steal-overlay";
        ov.innerHTML = `
            <div class="cd-steal-panel">
                <div class="cd-steal-title">🎯 اختر مهارة من الوحش لسَرقتها/نسخها</div>
                <div class="cd-steal-list">
                    ${monsterSkills.map(function(s){
                        const msid = s.skill_id || s.id;
                        return `<button class="cd-steal-opt" onclick="ClanDungeon.selectStealSkill('${abilitySkillId}','${msid}')"><span class="cd-skill-emoji">${skillEmoji(s)}</span> ${escapeHtml(s.name)}</button>`;
                    }).join("")}
                </div>
                <button class="cd-btn cd-leave" onclick="this.closest('.cd-steal-overlay').remove()">إلغاء</button>
            </div>`;
        const host = document.getElementById("clandungeon-content");
        if(host) host.appendChild(ov);
    }

    // بعد اختيار المهارة المسروقة: نطلب اختيار الهدف (على من نستخدمها)
    function selectStealSkill(abilitySkillId, targetSkillId){
        const trg = monsterSkills.find(function(s){ return String(s.skill_id || s.id) === String(targetSkillId); });
        pendingSteal = { abilitySkillId: abilitySkillId, targetSkillId: targetSkillId, targetName: trg ? trg.name : "" };
        removeStealOverlay();
        renderStealTargets();
    }

    function removeStealTargetsMenu(){
        const ov = document.querySelector("#clandungeon-content .cd-steal-targets");
        if(ov) ov.remove();
    }

    function renderStealTargets(){
        const st = myState;
        removeStealTargetsMenu();
        const players = (st && st.players) || [];
        const me = getPlayerId();
        let list = "";
        // الوحش
        list += `<button class="cd-steal-opt cd-target-monster" onclick="ClanDungeon.useStealOn('monster',null)"><span class="cd-skill-emoji">👹</span> ${escapeHtml(st.monster_name || "الوحش")}</button>`;
        players.forEach(function(p){
            if(!p.alive) return;
            const isMe = String(p.player_id)===String(me);
            const pLabel = isMe ? "👤 نفسك" : "🤝 لاعب";
            list += `<button class="cd-steal-opt" onclick="ClanDungeon.useStealOn('player','${p.player_id}')"><span class="cd-skill-emoji">👤</span> ${pLabel}</button>`;
            const compAlive = p.comp_alive && (p.comp_hp || 0) > 0;
            if(compAlive){
                const cFace = p.comp_image
                    ? `<img src="${escapeHtml(p.comp_image)}" alt="" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;">`
                    : "🐾";
                list += `<button class="cd-steal-opt" onclick="ClanDungeon.useStealOn('comp','${p.player_id}')"><span class="cd-skill-emoji">${cFace}</span> مرافق</button>`;
            }
        });
        const ov = document.createElement("div");
        ov.className = "cd-steal-overlay cd-steal-targets";
        ov.innerHTML = `
            <div class="cd-steal-panel">
                <div class="cd-steal-title">🎯 على مَن تستخدم المهارة المسروقة؟</div>
                <div class="cd-steal-list">${list}</div>
                <button class="cd-btn cd-leave" onclick="ClanDungeon.cancelSteal()">إلغاء</button>
            </div>`;
        const host = document.getElementById("clandungeon-content");
        if(host) host.appendChild(ov);
    }

    function cancelSteal(){
        pendingSteal = null;
        removeStealTargetsMenu();
    }

    async function useStealOn(targetKind, targetId){
        if(!pendingSteal) return;
        const ps = pendingSteal;
        pendingSteal = null;
        removeStealTargetsMenu();
        await castSteal(ps.abilitySkillId, ps.targetSkillId, targetKind, targetId);
    }

    async function castSteal(abilitySkillId, targetSkillId, targetKind, targetId){
        if(isMyCompTurn()){ toast("استخدم مهارة مرافقك أولًا"); return; }
        const targetPlayerId = (targetKind === "player" || targetKind === "comp") ? targetId : null;
        const targetComp = (targetKind === "comp");
        const trgName = pendingStealName(abilitySkillId, targetSkillId);
        try{
            const { error } = await supabaseClient.rpc("clan_dungeon_steal_or_copy_skill", {
                p_token: getToken(), p_run_id: myRun,
                p_ability_skill_id: abilitySkillId, p_target_skill_id: targetSkillId,
                p_target_player_id: targetPlayerId, p_target_comp: targetComp
            });
            if(error) throw error;
            removeStealOverlay();
            removeStealTargetsMenu();
            toast(trgName ? `⚡ سرقت/نسخت مهارة «${escapeHtml(trgName)}»!` : "⚡ تم تنفيذ مهارة السرقة/النسخ");
            await refreshState();
            await renderRun();
            if(isMyCompTurn()){
                toast("🐾 الآن دور مرافقك! اختر مهارته واضغط هدفًا");
            }
            if(myState && myState.turn_phase === "monster") await actMonster();
        }catch(e){
            const msg = (e && e.message) ? e.message : "تعذّر تنفيذ السرقة (خطأ في الخادم)";
            toast(msg);
            removeStealOverlay();
            removeStealTargetsMenu();
            await refreshState();
            await renderRun();
        }
    }

    function pendingStealName(abilitySkillId, targetSkillId){
        if(monsterSkills && monsterSkills.length){
            const t = monsterSkills.find(function(s){ return String(s.skill_id || s.id) === String(targetSkillId); });
            if(t) return t.name;
        }
        return "";
    }

    function removeStealOverlay(){
        const ov = document.querySelector(".cd-steal-overlay");
        if(ov) ov.remove();
    }

    function myTurn(){
        const st = myState;
        if(!st || st.turn_phase !== "player") return false;
        return !!st.turn_player_id && String(st.turn_player_id) === String(getPlayerId());
    }

    function skillEmoji(s){
        const t = s.color || "";
        if(t === "gold" || t === "yellow") return "✨";
        if(t === "red") return "🔥";
        if(t === "blue" || t === "cyan") return "💧";
        if(t === "green") return "🌿";
        if(t === "purple") return "🌀";
        if(t === "pink") return "🌸";
        if(t === "white") return "❄️";
        if(t === "dark" || t === "black") return "🌑";
        if(t === "orange") return "☀️";
        return "⚔️";
    }

    // ---------- weapon & potions (نفس أسلوب شاشات PvE/PvP) ----------
    async function loadWeapon(){
        try{
            const { data, error } = await supabaseClient.rpc("get_my_active_weapon", { p_token: getToken() });
            if(error){ myWeapon = null; updateIcons(); return; }
            myWeapon = (Array.isArray(data) && data.length) ? data[0] : null;
        }catch(e){ myWeapon = null; }
        updateIcons();
    }

    function updateIcons(){
        const wIcon = document.getElementById("cd-weapon-icon");
        if(wIcon){
            wIcon.style.display = myWeapon ? "" : "none";
            wIcon.innerHTML = (myWeapon && myWeapon.image)
                ? `<img src="${escapeHtml(myWeapon.image)}" alt="">`
                : (myWeapon ? "⚔️" : "");
            wIcon.classList.toggle("active", cdView === "weapon");
        }
        const cIcon = document.getElementById("cd-companion-icon");
        if(cIcon){
            const hasComp = !!(myState && myState.my_comp_alive && (myState.my_comp_hp || 0) > 0);
            cIcon.style.display = hasComp ? "" : "none";
            // في وضع المرافق تُظهر الأيقونة صورة الشخصية (للرجوع إليها)،
            // وإلا تُظهر صورة المرافق (للدخول إلى وضعه) — لا يتكرر أيقونتان.
            if(cdView === "companion"){
                cIcon.innerHTML = myFace ? `<img src="${escapeHtml(myFace)}" alt="">` : "👤";
                cIcon.title = "العودة إلى الشخصية";
            }else{
                cIcon.innerHTML = (hasComp && myState.my_comp_image)
                    ? `<img src="${escapeHtml(myState.my_comp_image)}" alt="">`
                    : "🐾";
                cIcon.title = "تبديل عرض الشخصية/المرافق";
            }
            cIcon.classList.toggle("active", cdView === "companion");
        }
    }

    function cdToggleView(next){
        if(cdView === next){
            cdView = isMyCompTurn() ? "companion" : "player";
        }else{
            cdView = next;
        }
        cdViewPinned = true;
        // إعادة رسم المعركة بالكامل حتى تتبدل بطاقة اللاعب (صورة + HP + مهارات) للأيقونة المختارة
        renderRun();
    }

    async function renderPotionBar(){
        const el = document.getElementById("cd-potions");
        if(!el) return;
        const st = myState;
        const myTurnNow = myTurn();
        try{
            const { data, error } = await supabaseClient.rpc("get_my_potions", { p_token: getToken() });
            if(error){ myPotions = []; el.innerHTML = ""; return; }
            myPotions = (Array.isArray(data) ? data : []).filter(function(p){ return (p.quantity || 0) > 0; });
        }catch(e){ myPotions = []; el.innerHTML = ""; return; }
        if(!myPotions.length){ el.innerHTML = '<div class="cd-actions-hint">🧪 لا تُوجد جرعات لديك</div>'; return; }
        el.innerHTML = `<div class="potion-bar">${myPotions.map(function(p){
            const borderColor = (p.glow_color && /^#[0-9A-Fa-f]{6}$/.test(p.glow_color)) ? p.glow_color : "#22c55e";
            const img = p.image ? `<img src="${escapeHtml(p.image)}" alt="">` : `<span style="font-size:18px;">🧪</span>`;
            return `<button class="potion-btn" style="--pcolor:${borderColor};" ${myTurnNow?"":"disabled"} onclick="ClanDungeon.useCdPotion('${p.potion_id}')" title="${escapeHtml(p.name || 'جرعة')}">${img}<span class="potion-qty">${p.quantity}</span></button>`;
        }).join("")}</div>`;
    }

    async function useCdPotion(potionId){
        if(!myTurn()){ toast("ليس دورك الآن"); return; }
        try{
            const { error } = await supabaseClient.rpc("clan_dungeon_use_potion", { p_token: getToken(), p_run_id: myRun, p_potion_id: potionId });
            if(error) throw error;
            await refreshState();
            await renderRun();
        }catch(e){ toast(e.message || e); await refreshState(); }
    }

    // ---------- targeting ----------
    function pickSkill(skillId){
        selectedSkill = skillId;
        selectedWeaponSkill = false;
        renderTargets();
        const btns = document.querySelectorAll(".cd-skill-btn");
        btns.forEach(function(b){ b.classList.toggle("cd-selected", b.dataset.skill === skillId); });
    }

    function pickWeaponSkill(skillId){
        selectedSkill = skillId;
        selectedWeaponSkill = true;
        renderTargets();
    }

    function removeTargetsMenu(){
        const ov = document.querySelector("#clandungeon-content .cd-targets-menu");
        if(ov) ov.remove();
    }

    function clearTargetsMenu(){
        removeTargetsMenu();
        selectedSkill = null;
        selectedWeaponSkill = false;
        const btns = document.querySelectorAll(".cd-skill-btn");
        btns.forEach(function(b){ b.classList.remove("cd-selected"); });
    }

    function renderTargets(){
        const st = myState;
        if(!selectedSkill){ selectedWeaponSkill = false; return; }
        removeTargetsMenu();
        const players = (st && st.players) || [];
        const me = getPlayerId();
        let list = "";
        // الوحش
        list += `<button class="cd-steal-opt cd-target-monster" onclick="ClanDungeon.useOnMonster()"><span class="cd-skill-emoji">👹</span> ${escapeHtml(st.monster_name || "الوحش")}</button>`;
        // اللاعبون ومرافقوهم
        players.forEach(function(p){
            if(!p.alive) return;
            const isMe = String(p.player_id)===String(me);
            const pLabel = isMe ? "👤 نفسك" : "🤝 لاعب";
            list += `<button class="cd-steal-opt" onclick="ClanDungeon.useOnPlayer('${p.player_id}')"><span class="cd-skill-emoji">👤</span> ${pLabel}</button>`;
            const compAlive = p.comp_alive && (p.comp_hp || 0) > 0;
            if(compAlive){
                const cFace = p.comp_image
                    ? `<img src="${escapeHtml(p.comp_image)}" alt="" style="width:22px;height:22px;border-radius:50%;vertical-align:middle;">`
                    : "🐾";
                list += `<button class="cd-steal-opt" onclick="ClanDungeon.useOnComp('${p.player_id}')"><span class="cd-skill-emoji">${cFace}</span> مرافق</button>`;
            }
        });
        const ov = document.createElement("div");
        ov.className = "cd-steal-overlay cd-targets-menu";
        ov.innerHTML = `
            <div class="cd-steal-panel">
                <div class="cd-steal-title">🎯 اختر الهدف:</div>
                <div class="cd-steal-list">${list}</div>
                <button class="cd-btn cd-leave" onclick="ClanDungeon.clearTargetsMenu()">إلغاء</button>
            </div>`;
        const host = document.getElementById("clandungeon-content");
        if(host) host.appendChild(ov);
    }

    async function useOnMonster(){
        if(!selectedSkill) return;
        const skillId = selectedSkill;
        const isWeapon = selectedWeaponSkill;
        selectedSkill = null;
        removeTargetsMenu();
        await doUse(skillId, null, isWeapon);
    }

    async function useOnPlayer(targetId){
        if(!selectedSkill) return;
        const skillId = selectedSkill;
        const isWeapon = selectedWeaponSkill;
        selectedSkill = null;
        removeTargetsMenu();
        await doUse(skillId, targetId, isWeapon);
    }

    async function useOnComp(targetId){
        if(!selectedSkill) return;
        const skillId = selectedSkill;
        const isWeapon = selectedWeaponSkill;
        selectedSkill = null;
        removeTargetsMenu();
        try{
            const { error } = await supabaseClient.rpc("clan_dungeon_cast_on_companion", {
                p_token: getToken(), p_run_id: myRun, p_skill_id: skillId,
                p_target_player_id: targetId
            });
            if(error) throw error;
        }catch(e){
            toast(e.message || e);
        }
        await refreshState();
        await renderRun();
    }

    async function doUse(skillId, targetPlayerId, isWeapon){
        const weaponFlag = (isWeapon === undefined) ? selectedWeaponSkill : isWeapon;
        try{
            let err = null;
            if(weaponFlag){
                const res = await supabaseClient.rpc("clan_dungeon_use_weapon_skill", {
                    p_token: getToken(), p_run_id: myRun, p_skill_id: skillId,
                    p_target_player_id: targetPlayerId
                });
                if(res.error) err = res.error;
            } else if(isMyCompTurn()){
                const res = await supabaseClient.rpc("clan_dungeon_use_companion_skill", {
                    p_token: getToken(), p_run_id: myRun, p_skill_id: skillId,
                    p_target_player_id: targetPlayerId
                });
                if(res.error) err = res.error;
            } else {
                const res = await supabaseClient.rpc("clan_dungeon_use_skill", {
                    p_token: getToken(), p_run_id: myRun, p_skill_id: skillId,
                    p_target_player_id: targetPlayerId
                });
                if(res.error) err = res.error;
            }
            if(err) throw err;
            selectedWeaponSkill = false;
            await refreshState();
            await renderRun();
            // الوحش يتصرف بعد دوري إذا كان دوره
            if(myState && myState.turn_phase === "monster"){
                await actMonster();
            }
        }catch(e){
            toast(e.message || e);
            await refreshState();
        }
    }

    // ---------- result ----------
    async function renderResult(){
        const b = box();
        const st = myState;
        const allDead = (st.players || []).every(function(p){ return !p.alive; });
        const victory = (!allDead) && st.players && st.players.some(function(p){ return p.alive; });
        b.innerHTML = `
            <div id="clandungeon-toast" class="cd-toast hidden"></div>
            <div class="cd-result ${victory ? 'cd-win' : 'cd-lose'}">
                ${allDead ? '💀 هزمتم... زنزانة أفضل المرة القادمة' : '🏆 انتصـار! قضت الفرقة على كل الوحوش'}
            </div>
            <div class="cd-reward-line">🏅 الجائزة تُقسَّم بالتساوي بين من دخلوا الزنزانة.</div>
            <button class="cd-btn cd-primary" onclick="ClanDungeon.claimReward()">🎁 استلام نصيبك من الذهب</button>
            <button class="cd-btn cd-leave" onclick="ClanDungeon.leaveRun()">إغلاق</button>
            <div class="cd-hint" id="cd-claim-result"></div>
        `;
    }

    async function claimReward(){
        try{
            const { data, error } = await supabaseClient.rpc("clan_dungeon_claim_reward", { p_token: getToken(), p_run_id: myRun });
            if(error) throw error;
            const el = document.getElementById("cd-claim-result");
            if(el){
                const d = data && data[0];
                el.innerHTML = d ? `✅ استلمت ${d.gold_share} ذهب! (${d.dungeon_name})` : "✅ تم الاستلام!";
            }
            await refreshState();
            myRun = null;
            await renderLobby();
        }catch(e){
            toast(e.message || e);
        }
    }

    // ---------- actions ----------
    async function toggleReady(){
        const cur = (myState.players || []).find(function(p){ return String(p.player_id)===String(getPlayerId()); });
        const ready = cur ? !cur.ready : false;
        try{
            await supabaseClient.rpc("clan_dungeon_ready", { p_token: getToken(), p_run_id: myRun, p_ready: ready });
            await refreshState();
            await renderRun();
        }catch(e){ toast(e.message || e); }
    }

    async function startRace(){
        try{
            const pToken = getToken();
            const { data, error } = await supabaseClient.rpc("clan_dungeon_start_race", { p_token: pToken, p_run_id: myRun });
            if(error) throw error;
            racePressed = false;
            await refreshState();
            await renderRun();
        }catch(e){
            if(isNoActiveCharacterError(e.message || e)){ forceChooseCharacter(); return; }
            toast(e.message || e);
        }
    }

    // ---------- sub-chat (رسائل الغارة) ----------
    let subChatTimer = null;
    let subChatBusy = false;

    function subChatBlock(){
        return `
            <div class="cd-subchat" id="cd-subchat">
                <div class="cd-subchat-msgs" id="cd-subchat-msgs"><div class="chat-empty">جارٍ التحميل…</div></div>
                <div class="cd-subchat-input">
                    <input id="cd-subchat-input" maxlength="500" placeholder="اكتب خطة الغارة…" onkeydown="if(event.key==='Enter')ClanDungeon.sendSubMessage()">
                    <button class="cd-btn cd-primary" onclick="ClanDungeon.sendSubMessage()">إرسال</button>
                </div>
            </div>`;
    }

    async function loadSubMessages(){
        const el = document.getElementById("cd-subchat-msgs");
        if(!el || !myRun) return;
        if(subChatBusy) return;
        subChatBusy = true;
        try{
            const { data, error } = await supabaseClient.rpc("clan_dungeon_get_messages", { p_token: getToken(), p_run_id: myRun, p_limit: 50 });
            if(error) throw error;
            const list = (data || []).map(function(m){
                const me = String(m.sender_id)===String(getPlayerId());
                return `<div class="cd-subchat-msg ${me ? 'cd-subchat-me' : ''}"><span class="cd-subchat-who">${me ? 'أنت' : escapeHtml(m.sender_username || '')}</span>&nbsp;${escapeHtml(m.message)}</div>`;
            }).join("");
            el.innerHTML = list || '<div class="chat-empty">لا رسائل بعد</div>';
            el.scrollTop = el.scrollHeight;
        }catch(e){ /* تجاهل أخطاء التحديث الدوري */ }
        finally { subChatBusy = false; }
    }

    function startSubChatPolling(){
        stopSubChatPolling();
        loadSubMessages();
        subChatTimer = setInterval(loadSubMessages, 3000);
    }

    function stopSubChatPolling(){
        if(subChatTimer){ clearInterval(subChatTimer); subChatTimer = null; }
    }

    async function sendSubMessage(){
        const inp = document.getElementById("cd-subchat-input");
        if(!inp || !myRun) return;
        const msg = inp.value;
        if(!msg.trim()) return;
        try{
            await supabaseClient.rpc("clan_dungeon_send_message", { p_token: getToken(), p_run_id: myRun, p_message: msg });
            inp.value = "";
            await loadSubMessages();
        }catch(e){ toast(e.message || e); }
    }

    async function tryJoin(runId){
        try{
            const { data, error } = await supabaseClient.rpc("clan_dungeon_join", { p_token: getToken(), p_run_id: runId });
            if(error) throw error;
            myRun = runId;
            await refreshState();
            startBattlePolling();
            await renderRun();
        }catch(e){
            if(isNoActiveCharacterError(e.message || e)){ forceChooseCharacter(); return; }
            toast(e.message || e);
        }
    }

    async function createRun(){
        const sel = document.getElementById("cd-dungeon-select");
        if(!sel || !sel.value){ toast("اختر زنزانة أولاً"); return; }
        try{
            const { data, error } = await supabaseClient.rpc("clan_dungeon_create", { p_token: getToken(), p_clan_id: curClanId, p_dungeon_id: sel.value });
            if(error) throw error;
            // الغارة تُضاف للقائمة المفتوحة، ويبقى اللاعب في القائمة حتى يضغط
            // الغارة ليدخل قاعة الانتظار (هو وأصدقاؤه).
            myRun = data[0].run_id;
            myState = null;
            await renderLobby();
        }catch(e){ toast(e.message || e); }
    }

    async function enterRun(){
        if(!myRun) return;
        myState = null;
        try{
            const { data, error } = await supabaseClient.rpc("clan_dungeon_join", { p_token: getToken(), p_run_id: myRun });
            if(error) throw error;
        }catch(e){
            if(isNoActiveCharacterError(e.message || e)){ forceChooseCharacter(); return; }
            toast(e.message || e);
            return;
        }
        startBattlePolling();
        await renderRun();
    }

    async function leaveRun(){
        if(!myRun) return;
        try{
            await supabaseClient.rpc("clan_dungeon_leave", { p_token: getToken(), p_run_id: myRun });
        }catch(e){}
        myRun = null;
        myState = null;
        if(raceTimer){ clearInterval(raceTimer); raceTimer = null; }
        stopPolling();
        stopSubChatPolling();
        await renderLobby();
    }

    // ---------- polling & refresh ----------
    let lastStateKey = "";

    function stateKey(st){
        if(!st) return "";
        const parts = [st.status, st.turn_phase, st.turn_player_id || "none", st.monster_index, st.monster_hp, (st.monster_hp>0&&st.turn_phase==="monster")?"M":""];
        (st.players || []).forEach(function(p){ parts.push(p.player_id, p.hp, p.alive, p.present?1:0); });
        return parts.join("|");
    }

    function startBattlePolling(){
        stopPolling();
        lastStateKey = "";
        timer = setInterval(async function(){
            if(!isOpen()){ stopPolling(); return; }
            if(!myRun){ stopPolling(); return; }
            const before = myState ? stateKey(myState) : "";
            await refreshState().catch(function(){});
            if(!myState) return;
            const after = stateKey(myState);
            if(before !== after){
                lastStateKey = after;
                await renderRun().catch(function(){});
            }
        }, 2500);
    }

    async function refreshState(){
        if(!myRun) return null;
        supabaseClient.rpc("clan_dungeon_heartbeat", { p_token: getToken(), p_run_id: myRun }).then(function(){}).catch(function(){});
        const { data, error } = await supabaseClient.rpc("clan_dungeon_get_state", { p_token: getToken(), p_run_id: myRun });
        if(error) throw error;
        myState = Array.isArray(data) ? data[0] : data;
        return myState;
    }

    async function getMemberNames(){
        const map = {};
        try{
            const { data, error } = await supabaseClient.rpc("clan_list_members", { p_token: getToken(), p_clan_id: curClanId });
            if(!error && data) data.forEach(function(m){ map[m.player_id] = m.username; });
        }catch(e){}
        return map;
    }

    return {
        open,
        stopPolling,
        tryJoin,
        enterRun,
        createRun,
        toggleReady,
        startRace,
        pressRace,
        leaveRun,
        pickSkill,
        pickWeaponSkill,
        cdToggleView,
        useCdPotion,
        useOnMonster,
        useOnPlayer,
        clearTargetsMenu,
        openStealPicker,
        selectStealSkill,
        useStealOn,
        cancelSteal,
        renderStealTargets,
        castSteal,
        claimReward,
        sendSubMessage,
        startSubChatPolling,
        stopSubChatPolling,
        _activeRunId: function(){ return myRun; }
    };

})();

window.ClanDungeon = ClanDungeon;