// ========================================
// pvp.js
// نظام PvP: مباراة حقيقية بين لاعبين بالتناوب.
//
// مبدأ الأمان الأساسي: هذا الملف لا يحسب أي ضرر ولا يقرر أي دور ولا
// يقرر الفائز — هو فقط يعرض آخر حالة وصلته من السيرفر، ويرسل "أريد
// استخدام هذه المهارة" عبر pvp_submit_action. كل القواعد (الدور،
// التهدئة، الضرر، التجميد، الفوز) محسوبة ومُتحقق منها بالكامل داخل
// دوال RPC على Supabase (نفس أسلوب حماية الذهب/المستوى/الإدارة).
// ========================================

let pvp = {

    matchId: null,
    playerId: null,
    mySlot: null,
    state: null,
    mySkills: null,

    queueTimer: null,
    pollTimer: null,
    channel: null,

    charImages: {},

    logRendered: 0,
    prevHp: {1: null, 2: null}

};


// ========================================
// الدخول لطابور البحث عن خصم
// ========================================

async function startPVPBattle(){

    let playerId = localStorage.getItem("player_id");

    if(!playerId){

        alert("سجّل الدخول أولاً");

        return;

    }

    pvp.playerId = playerId;

    openScreen("pvp-battle-screen");

    pvpShowSearching(true);

    hideBattleResult("pvp");

    let {data, error} = await supabaseClient.rpc("pvp_join_queue", {
        p_player_id: playerId
    });

    if(error){

        alert(error.message || "تعذّر الدخول لطابور PvP");

        pvpShowSearching(false);

        openScreen("pvp-screen");

        return;

    }

    if(data.status === "matched"){

        await pvpEnterMatch(data.match_id);

    } else {

        pvpPollQueue();

    }

}


function pvpPollQueue(){

    clearInterval(pvp.queueTimer);

    pvp.queueTimer = setInterval(async () => {

        let {data, error} = await supabaseClient.rpc("pvp_check_match", {
            p_player_id: pvp.playerId
        });

        if(error) return;

        if(data.status === "matched"){

            clearInterval(pvp.queueTimer);

            await pvpEnterMatch(data.match_id);

        }

    }, 2000);

}


async function cancelPvPQueue(){

    clearInterval(pvp.queueTimer);

    if(pvp.playerId){

        await supabaseClient.rpc("pvp_cancel_queue", {
            p_player_id: pvp.playerId
        });

    }

    pvpShowSearching(false);

    openScreen("pvp-screen");

}


function pvpShowSearching(isSearching){

    let arena = document.querySelector("#pvp-battle-screen .battle-arena");

    if(!arena) return;

    let overlay = document.getElementById("pvp-searching-overlay");

    if(isSearching){

        arena.style.visibility = "hidden";

        if(!overlay){

            overlay = document.createElement("div");
            overlay.id = "pvp-searching-overlay";
            overlay.className = "pvp-searching-overlay";

            overlay.innerHTML =
            `<div class="pvp-spinner"></div>
             <p>جاري البحث عن خصم...</p>
             <button id="pvp-cancel-search-btn">إلغاء</button>`;

            document.getElementById("pvp-battle-screen").appendChild(overlay);

            overlay.querySelector("#pvp-cancel-search-btn").onclick = cancelPvPQueue;

        }

        overlay.style.display = "flex";

    } else {

        arena.style.visibility = "visible";

        if(overlay) overlay.style.display = "none";

    }

}


// ========================================
// دخول المباراة بعد المطابقة
// ========================================

async function pvpEnterMatch(matchId){

    pvp.matchId = matchId;
    pvp.logRendered = 0;
    pvp.prevHp = {1: null, 2: null};

    let {data, error} = await supabaseClient.rpc("pvp_get_match_state", {
        p_match_id: matchId,
        p_player_id: pvp.playerId
    });

    if(error){

        alert(error.message || "تعذّر تحميل المباراة");

        openScreen("pvp-screen");

        return;

    }

    pvp.state = data;
    pvp.mySlot = (data.player1_id === pvp.playerId) ? 1 : 2;

    await pvpLoadCharacterVisuals();
    await pvpFetchMySkills();

    pvpShowSearching(false);

    // عناصر خاصة بتجربة PvE (زر السباق والعد التنازلي) غير مستخدمة هنا
    let wrap = document.querySelector("#pvp-battle-screen .attack-button-wrap");
    let divider = document.querySelector("#pvp-battle-screen .vs-divider");

    if(wrap) wrap.style.display = "none";
    if(divider) divider.style.display = "none";

    ensureLogBox("pvp");

    renderPvPState();

    pvpSubscribeRealtime();

    clearInterval(pvp.pollTimer);

    pvp.pollTimer = setInterval(pvpRefreshState, 4000);

}


async function pvpLoadCharacterVisuals(){

    let ids = [pvp.state.player1_character_id, pvp.state.player2_character_id];

    let {data, error} = await supabaseClient
        .from("characters")
        .select("id, identity_image, glow_color")
        .in("id", ids);

    if(!error && data){

        data.forEach(c => { pvp.charImages[c.id] = c; });

    }

}


async function pvpFetchMySkills(){

    let me = pvpSlotData(pvp.mySlot);

    let {data, error} = await supabaseClient
        .from("character_skills")
        .select("skills(id,name,type,damage,cooldown,effect,unblockable)")
        .eq("character_id", me.charId);

    if(error || !data){

        pvp.mySkills = [];

        return;

    }

    pvp.mySkills = data.map(row => row.skills).filter(Boolean);

}


async function pvpRefreshState(){

    if(!pvp.matchId) return;

    let {data, error} = await supabaseClient.rpc("pvp_get_match_state", {
        p_match_id: pvp.matchId,
        p_player_id: pvp.playerId
    });

    if(!error && data){

        pvp.state = data;

        renderPvPState();

    }

}


function pvpSubscribeRealtime(){

    if(pvp.channel){

        supabaseClient.removeChannel(pvp.channel);

        pvp.channel = null;

    }

    pvp.channel = supabaseClient
    .channel("pvp-match-" + pvp.matchId)
    .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "pvp_matches",
        filter: "id=eq." + pvp.matchId
    }, payload => {

        pvp.state = payload.new;

        renderPvPState();

    })
    .subscribe();

}


function pvpUnsubscribeRealtime(){

    if(pvp.channel){

        supabaseClient.removeChannel(pvp.channel);

        pvp.channel = null;

    }

}


// ========================================
// قراءة بيانات طرف معيّن (1 أو 2) من صف المباراة المسطّح
// ========================================

function pvpSlotData(n){

    let p = "player" + n + "_";

    return {

        hp: pvp.state[p + "hp"],
        maxHp: pvp.state[p + "max_hp"],
        name: pvp.state[p + "name"],
        charId: pvp.state[p + "character_id"],
        turnsTaken: pvp.state[p + "turns_taken"],
        cooldowns: pvp.state[p + "cooldowns"] || {},
        usedSkills: pvp.state[p + "used_skills"] || [],
        frozenTurns: pvp.state[p + "frozen_turns"] || 0,
        lastHit: pvp.state[p + "last_hit"]

    };

}


function pvpCooldownRemaining(me, skill){

    if(!skill.cooldown || skill.cooldown <= 0) return 0;

    let usedAt = me.cooldowns[skill.id];

    if(usedAt === undefined || usedAt === null) return 0;

    return Math.max(0, skill.cooldown - (me.turnsTaken - usedAt));

}


// ========================================
// العرض الرئيسي — يُستدعى بعد أي تحديث لحالة المباراة
// ========================================

function renderPvPState(){

    if(!pvp.state) return;

    let me = pvpSlotData(pvp.mySlot);
    let opp = pvpSlotData(3 - pvp.mySlot);

    let myChar = pvp.charImages[me.charId];
    let oppChar = pvp.charImages[opp.charId];

    document.getElementById("pvp-player-name-battle").textContent = me.name;
    document.getElementById("pvp-enemy-name").textContent = opp.name;

    document.getElementById("pvp-player-hp").textContent =
    Math.max(0, me.hp) + " / " + me.maxHp;

    document.getElementById("pvp-enemy-hp").textContent =
    Math.max(0, opp.hp) + " / " + opp.maxHp;

    document.getElementById("pvp-player-hp-bar").style.width =
    Math.max(0, (me.hp / me.maxHp) * 100) + "%";

    document.getElementById("pvp-enemy-hp-bar").style.width =
    Math.max(0, (opp.hp / opp.maxHp) * 100) + "%";

    let myImg = document.getElementById("pvp-player-image");
    let oppImg = document.getElementById("pvp-enemy-image");

    if(myChar) setFighterImage(myImg, myChar.identity_image);
    if(oppChar) setFighterImage(oppImg, oppChar.identity_image);

    myImg.classList.toggle("frozen-status", me.frozenTurns > 0);
    oppImg.classList.toggle("frozen-status", opp.frozenTurns > 0);

    myImg.style.boxShadow =
    "0 0 20px " + safeGlowColor(myChar && myChar.glow_color, "#3b82ff");

    oppImg.style.boxShadow =
    "0 0 20px " + safeGlowColor(oppChar && oppChar.glow_color, "#e04b4b");

    // فرقعة ضرر/شفاء عند تغيّر الدم عن آخر عرض
    if(pvp.prevHp[pvp.mySlot] !== null && pvp.prevHp[pvp.mySlot] !== me.hp){

        showDamagePopup("pvp-player", Math.abs(me.hp - pvp.prevHp[pvp.mySlot]), me.hp > pvp.prevHp[pvp.mySlot]);

    }

    if(pvp.prevHp[3 - pvp.mySlot] !== null && pvp.prevHp[3 - pvp.mySlot] !== opp.hp){

        showDamagePopup("pvp-enemy", Math.abs(opp.hp - pvp.prevHp[3 - pvp.mySlot]), opp.hp > pvp.prevHp[3 - pvp.mySlot]);

    }

    pvp.prevHp[pvp.mySlot] = me.hp;
    pvp.prevHp[3 - pvp.mySlot] = opp.hp;

    pvpRenderUsedSkills("pvp-player-used-skills", me.usedSkills);
    pvpRenderUsedSkills("pvp-enemy-used-skills", opp.usedSkills);

    pvpRenderSkillButtons(me);

    pvpRenderTurnStatus();

    pvpRenderLog();

    if(pvp.state.status === "finished"){

        clearInterval(pvp.pollTimer);

        pvpUnsubscribeRealtime();

        showPvPResult(pvp.state.winner === pvp.mySlot);

    }

}


function pvpRenderUsedSkills(containerId, skills){

    let box = document.getElementById(containerId);

    if(!box) return;

    box.innerHTML = skills.map(s =>
        `<span class="used-skill-chip">${s.name}</span>`
    ).join("");

}


function pvpRenderSkillButtons(me){

    let page = document.getElementById("pvp-player-skills-pages");

    if(!page) return;

    page.innerHTML = "";

    let itsMyTurn =
    (pvp.state.turn_owner === pvp.mySlot) && pvp.state.status === "active";

    let container = document.createElement("div");
    container.className = "skills-page active";

    (pvp.mySkills || []).forEach(skill => {

        let btn = document.createElement("button");

        btn.innerHTML = `<span class="skill-name">${skill.name}</span>`;

        let remaining = pvpCooldownRemaining(me, skill);

        if(remaining > 0){

            btn.classList.add("on-cooldown");
            btn.disabled = true;

            let badge = document.createElement("span");
            badge.className = "cooldown-badge";
            badge.textContent = remaining;
            btn.appendChild(badge);

        } else if(!itsMyTurn){

            btn.disabled = true;

        }

        btn.onclick = () => submitPvPAction(skill);

        container.appendChild(btn);

    });

    page.appendChild(container);

}


function pvpRenderTurnStatus(){

    let box = document.getElementById("pvp-battle-timer");

    if(!box) return;

    if(pvp.state.status === "finished"){

        box.textContent = "";

        return;

    }

    box.textContent =
    (pvp.state.turn_owner === pvp.mySlot) ? "🟢 دورك!" : "⏳ دور الخصم...";

}


function pvpRenderLog(){

    let box = document.getElementById("pvp-battle-log");

    if(!box) return;

    let entries = pvp.state.log || [];

    for(let i = pvp.logRendered; i < entries.length; i++){

        let line = document.createElement("div");
        line.textContent = entries[i].text;
        box.appendChild(line);

    }

    pvp.logRendered = entries.length;

    box.scrollTop = box.scrollHeight;

}


// ========================================
// إرسال فعل قتالي — السيرفر وحده يقرر النتيجة
// ========================================

async function submitPvPAction(skill){

    if(!pvp.state || pvp.state.status !== "active") return;

    if(pvp.state.turn_owner !== pvp.mySlot){

        showToast("ليس دورك الآن");

        return;

    }

    pvpDisableSkillButtons(true);

    let {data, error} = await supabaseClient.rpc("pvp_submit_action", {
        p_match_id: pvp.matchId,
        p_player_id: pvp.playerId,
        p_skill_id: skill.id
    });

    pvpDisableSkillButtons(false);

    if(error){

        showToast(error.message || "تعذّر تنفيذ الحركة");

        return;

    }

    if(!data.ok){

        showToast(data.reason || "لا يمكن تنفيذ هذا الفعل الآن");

        return;

    }

    pvp.state = data.state;

    renderPvPState();

}


function pvpDisableSkillButtons(disabled){

    document.querySelectorAll("#pvp-player-skills-pages button")
    .forEach(b => { b.disabled = disabled; });

}


// ========================================
// نتيجة المباراة والخروج منها
// ========================================

function showPvPResult(won){

    hideBattleResult("pvp");

    let arena = document.querySelector("#pvp-battle-screen .battle-arena");

    if(!arena) return;

    let overlay = document.createElement("div");
    overlay.className = "battle-result-overlay";

    overlay.innerHTML =
    `<h2>${won ? "🏆 فزت!" : "💀 خسرت"}</h2>
     <button id="pvp-result-back-btn">العودة</button>`;

    arena.appendChild(overlay);

    overlay.querySelector("#pvp-result-back-btn").onclick = () => {

        overlay.remove();

        pvpLeaveMatch();

        openScreen("pvp-screen");

    };

}


function pvpLeaveMatch(){

    clearInterval(pvp.pollTimer);

    pvpUnsubscribeRealtime();

    pvp.matchId = null;
    pvp.state = null;
    pvp.mySkills = null;
    pvp.mySlot = null;

}


// الخروج من مباراة جارية (زر العودة) = انسحاب فعلي يُسجَّل كخسارة له
// وفوز للخصم — وليس مجرد إخفاء الشاشة، حتى لا يهرب لاعب من خسارة واضحة
async function forfeitPvPMatch(){

    if(pvp.matchId && pvp.state && pvp.state.status === "active"){

        await supabaseClient.rpc("pvp_forfeit", {
            p_match_id: pvp.matchId,
            p_player_id: pvp.playerId
        });

    }

    clearInterval(pvp.queueTimer);

    pvpLeaveMatch();

    openScreen("pvp-screen");

}

