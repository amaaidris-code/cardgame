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
    let turnTimerInterval = null;
    let turnDeadline = null;
    let skipInFlight = false;

    function getToken(){ return localStorage.getItem("player_token"); }
    function getPlayerId(){ return localStorage.getItem("player_id"); }
    function box(){ return document.getElementById("clandungeon-content"); }
    function isOpen(){ const s = document.getElementById("clandungeon-screen"); return s && s.classList.contains("active"); }
    function isMyCompTurn(){ return myState && myState.my_comp_turn; }

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
            if(remainingMs <= 0) requestSkipTurn();
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
        const myTurnNow = !!st.my_turn && st.turn_phase === "player";
        const myCompTurn = isMyCompTurn();

        const monsterImg = st.monster_image ? `<img class="cd-monster-img" src="${escapeHtml(st.monster_image)}" alt="${escapeHtml(st.monster_name)}">` : `<div class="cd-monster-img cd-noimg">👹</div>`;
        const monsterHpPct = st.monster_max_hp ? Math.max(0, Math.min(100, (st.monster_hp / st.monster_max_hp) * 100)) : 0;

        const partyHtml = players.map(function(p){
            const nm = members[p.player_id] || "لاعب";
            const isMe = String(p.player_id)===String(getPlayerId());
            const alive = p.alive;
            const hpPct = p.max_hp ? Math.max(0, Math.min(100,(p.hp/p.max_hp)*100)) : 0;
            const myComp = st.my_comp_alive;
            const compCard = isMe && st.my_comp_max_hp ? `
                <div class="cd-player-card cd-me cd-companion-card ${myComp?'':'cd-dead'} ${myCompTurn&&myComp?'cd-turn':''}">
                    <div class="cd-player-head">🐾 ${escapeHtml(st.my_comp_name || "مرافق")}</div>
                    <div class="cd-hpbar"><div class="cd-hpbar-fill" style="width:${st.my_comp_max_hp?Math.max(0,Math.min(100,(st.my_comp_hp/st.my_comp_max_hp)*100)):0}%"></div></div>
                    <div class="cd-hpnum">${myComp ? st.my_comp_hp + " / " + st.my_comp_max_hp : "☠️ سقط"}</div>
                </div>` : "";
            return `
                <div class="cd-player-card ${isMe?'cd-me':''} ${alive?'':'cd-dead'} ${!myCompTurn&&String(st.turn_player_id)===String(p.player_id)&&st.turn_phase==="player"?'cd-turn':''}">
                    <div class="cd-player-head">${isMe?"👤":"🤝"} ${escapeHtml(nm)}</div>
                    <div class="cd-hpbar"><div class="cd-hpbar-fill" style="width:${hpPct}%"></div></div>
                    <div class="cd-hpnum">${alive ? p.hp + " / " + p.max_hp : "☠️ سقط"}</div>
                </div>
                ${compCard}`;
        }).join("");

        const turnLabel = turnText(st, members);
        const monsterLabel = `الوحش ${st.monster_index + 1} / ${st.total_monsters}`;

        b.innerHTML = `
            <div id="clandungeon-toast" class="cd-toast hidden"></div>
            <div class="cd-battle">
                <div class="cd-leave-bar"><button class="cd-btn cd-leave" onclick="ClanDungeon.leaveRun()">🚪 عودة إلى الغارات</button></div>
                <div class="cd-turn-indicator ${myTurnNow?'cd-turn-mine':''}">${turnLabel}</div>
                <div id="cd-turn-timer" class="cd-turn-timer"></div>
                <div class="cd-monster-card ${st.turn_phase==="monster"?'cd-monster-turn':''}">
                    ${monsterImg}
                    <div class="cd-monster-name">${escapeHtml(st.monster_name || "وحش")} <span class="cd-wave">${monsterLabel}</span></div>
                    <div class="cd-hpbar"><div class="cd-hpbar-fill cd-monster-hp" style="width:${monsterHpPct}%"></div></div>
                    <div class="cd-hpnum">${st.monster_hp} / ${st.monster_max_hp}</div>
                </div>
                <div class="cd-party-grid">${partyHtml}</div>
                <div id="cd-targets" class="cd-targets"></div>
                <div class="cd-skill-area">
                    <div id="cd-skills" class="cd-skills"></div>
                    <div class="cd-skill-status" id="cd-skill-status"></div>
                    <div id="cd-weapon" class="cd-actions"></div>
                    <div id="cd-potions" class="cd-actions"></div>
                </div>
                ${subChatBlock()}
            </div>`;

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
            const sk = document.getElementById("cd-skills");
            if(sk){
                if(st.turn_phase === "monster"){
                    sk.innerHTML = '<div class="cd-waiting">👹 الوحش يتصرف...</div>';
                    // نحرّك الوحش تلقائيًا (server-authoritative، أي لاعب يستطيع تفعيله)
                    ensureMonsterAct();
                } else {
                    sk.innerHTML = '<div class="cd-waiting">⏳ دور لاعب آخر...</div>';
                }
            }
            selectedSkill = null;
        }

        renderWeaponBar();
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
    async function loadSkills(){
        const st = myState;
        const compTurn = isMyCompTurn();
        let skills = [];
        try{
            const { data, error } = await supabaseClient.rpc("clan_dungeon_list_skills", { p_token: getToken(), p_run_id: myRun });
            if(!error) skills = (data || []).filter(function(s){ return compTurn ? s.fighter_kind === "companion" : s.fighter_kind === "player"; });
        }catch(e){ skills = []; }

        const el = document.getElementById("cd-skills");
        if(!el) return;
        if(!skills.length){
            el.innerHTML = '<div class="cd-waiting">لا توجد مهارات.</div>';
            return;
        }
        selectedSkill = null;
        renderTargets();
        el.innerHTML = skills.map(function(s, i){
            return `<button class="cd-skill-btn" data-skill="${s.skill_id}" onclick="ClanDungeon.pickSkill('${s.skill_id}')">
                <span class="cd-skill-emoji">${skillEmoji(s)}</span>
                <span class="cd-skill-name">${escapeHtml(s.name)}</span>
                ${s.cooldown ? `<span class="cd-skill-cd">CD ${s.cooldown}</span>` : ""}
            </button>`;
        }).join("");
    }

    function clearSkills(){
        const el = document.getElementById("cd-skills");
        if(!el || !myTurn()) el.innerHTML = "";
    }

    function myTurn(){
        return myState && myState.my_turn && myState.turn_phase === "player";
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
    async function renderWeaponBar(){
        const el = document.getElementById("cd-weapon");
        if(!el) return;
        const st = myState;
        const myTurnNow = st && st.my_turn && st.turn_phase === "player";
        try{
            const { data, error } = await supabaseClient.rpc("get_my_active_weapon", { p_token: getToken() });
            if(error){ myWeapon = null; el.innerHTML = ""; return; }
            myWeapon = (Array.isArray(data) && data.length) ? data[0] : null;
        }catch(e){ myWeapon = null; el.innerHTML = ""; return; }
        if(!myWeapon){ el.innerHTML = ""; return; }

        const broken = (myWeapon.durability_current || 0) <= 0;
        const skills = Array.isArray(myWeapon.skills) ? myWeapon.skills : [];
        const skillBtns = skills.map(function(s){
            const locked = broken || !myTurnNow;
            return `<button class="weapon-skill-btn" style="--wcolor:${escapeHtml(s.color || '#ffffff')};" ${locked?"disabled":""} onclick="ClanDungeon.pickWeaponSkill('${s.skill_id}')">${escapeHtml(s.name || 'مهارة')}</button>`;
        }).join("");

        el.innerHTML = `
            <div class="weapon-box">
                <div class="weapon-header" style="--wcolor:${escapeHtml(myWeapon.glow_color || '#e8b93f')};">
                    ${myWeapon.image
                        ? `<img class="weapon-image" src="${escapeHtml(myWeapon.image)}" alt="">`
                        : `<span class="weapon-image weapon-image-ph">⚔️</span>`}
                    <div class="weapon-meta">
                        <div class="weapon-name">${escapeHtml(myWeapon.name || 'سلاح')}</div>
                        <div class="weapon-duce">${escapeHtml(broken ? "مكسور 💥" : (myWeapon.durability_current + " / " + (myWeapon.max_durability || "-") + " دص"))}</div>
                    </div>
                </div>
                <div class="weapon-skills">${skillBtns.length ? skillBtns : '<div class="weapon-name">لا مهارات</div>'}</div>
            </div>`;
    }

    async function renderPotionBar(){
        const el = document.getElementById("cd-potions");
        if(!el) return;
        const st = myState;
        const myTurnNow = st && st.my_turn && st.turn_phase === "player";
        try{
            const { data, error } = await supabaseClient.rpc("get_my_potions", { p_token: getToken() });
            if(error){ myPotions = []; el.innerHTML = ""; return; }
            myPotions = (Array.isArray(data) ? data : []).filter(function(p){ return (p.quantity || 0) > 0; });
        }catch(e){ myPotions = []; el.innerHTML = ""; return; }
        if(!myPotions.length){ el.innerHTML = ""; return; }
        el.innerHTML = `<div class="potion-bar">${myPotions.map(function(p){
            const borderColor = (p.glow_color && /^#[0-9A-Fa-f]{6}$/.test(p.glow_color)) ? p.glow_color : "#22c55e";
            const img = p.image ? `<img src="${escapeHtml(p.image)}" alt="">` : `<span style="font-size:18px;">🧪</span>`;
            return `<button class="potion-btn" style="--pcolor:${borderColor};" ${myTurnNow?"":"disabled"} onclick="ClanDungeon.useCdPotion('${p.potion_id}')" title="${escapeHtml(p.name || 'جرعة')}">${img}<span class="potion-qty">${p.quantity}</span></button>`;
        }).join("")}</div>`;
    }

    async function useCdPotion(potionId){
        if(!myTurn()){ toast("ليس دورك الآن"); return; }
        try{
            await supabaseClient.rpc("clan_dungeon_use_potion", { p_token: getToken(), p_run_id: myRun, p_potion_id: potionId });
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

    function renderTargets(){
        const st = myState;
        const el = document.getElementById("cd-targets");
        if(!el) return;
        if(!selectedSkill){ selectedWeaponSkill = false; el.innerHTML = ""; return; }
        const members = {};
        // نعيد بناء أسماء الأعضاء
        const players = (st && st.players) || [];
        const me = getPlayerId();
        let html = '<div class="cd-targets-label">🎯 اختر الهدف:</div>';
        html += `<button class="cd-target cd-target-monster" onclick="ClanDungeon.useOnMonster()">👹 الوحش (${st.monster_name || "وحش"})</button>`;
        players.forEach(function(p){
            if(!p.alive) return;
            const isMe = String(p.player_id)===String(me);
            html += `<button class="cd-target" onclick="ClanDungeon.useOnPlayer('${p.player_id}')">${isMe?"👤 نفسك":"🤝 لاعب"}</button>`;
        });
        el.innerHTML = html;
    }

    async function useOnMonster(){
        if(!selectedSkill) return;
        const skillId = selectedSkill;
        const isWeapon = selectedWeaponSkill;
        selectedSkill = null;
        renderTargets();
        await doUse(skillId, null, isWeapon);
    }

    async function useOnPlayer(targetId){
        if(!selectedSkill) return;
        const skillId = selectedSkill;
        const isWeapon = selectedWeaponSkill;
        selectedSkill = null;
        renderTargets();
        await doUse(skillId, targetId, isWeapon);
    }

    async function doUse(skillId, targetPlayerId, isWeapon){
        const weaponFlag = (isWeapon === undefined) ? selectedWeaponSkill : isWeapon;
        try{
            if(weaponFlag){
                await supabaseClient.rpc("clan_dungeon_use_weapon_skill", {
                    p_token: getToken(), p_run_id: myRun, p_skill_id: skillId,
                    p_target_player_id: targetPlayerId
                });
            } else if(isMyCompTurn()){
                await supabaseClient.rpc("clan_dungeon_use_companion_skill", {
                    p_token: getToken(), p_run_id: myRun, p_skill_id: skillId,
                    p_target_player_id: targetPlayerId
                });
            } else {
                await supabaseClient.rpc("clan_dungeon_use_skill", {
                    p_token: getToken(), p_run_id: myRun, p_skill_id: skillId,
                    p_target_player_id: targetPlayerId
                });
            }
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
        useCdPotion,
        useOnMonster,
        useOnPlayer,
        claimReward,
        sendSubMessage,
        startSubChatPolling,
        stopSubChatPolling,
        _activeRunId: function(){ return myRun; }
    };

})();

window.ClanDungeon = ClanDungeon;