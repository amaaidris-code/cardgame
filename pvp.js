// ========================================
// PvP — واجهة اللاعب (كل الحسابات الحاسمة على السيرفر)
// ========================================

let pvpState = {
    matchId: null,
    pollTimer: null,
    isPlayer1: null,
    mySkills: [],
    myCharacterName: "",
    finished: false
};

function pvpGetToken(){
    return localStorage.getItem("player_token");
}

function pvpStopPolling(){
    if(pvpState.pollTimer){
        clearInterval(pvpState.pollTimer);
        pvpState.pollTimer = null;
    }
}

// ========================================
// بداية شاشة PvP: البحث عن مباراة أو الانضمام لواحدة منتظرة
// ========================================
async function startPVPBattle(){

    let token = pvpGetToken();

    if(!token){
        alert("سجّل الدخول أولاً");
        return;
    }

    openScreen("pvp-battle-screen");
    pvpState.finished = false;

    let arena = document.querySelector("#pvp-battle-screen .battle-arena");
    if(arena) arena.style.opacity = "0.3";

    let statusBox = document.getElementById("pvp-status-message");
    if(!statusBox){
        statusBox = document.createElement("div");
        statusBox.id = "pvp-status-message";
        statusBox.style.textAlign = "center";
        statusBox.style.padding = "20px";
        statusBox.style.fontSize = "18px";
        document.getElementById("pvp-battle-screen").prepend(statusBox);
    }
    statusBox.textContent = "🔎 جارٍ البحث عن خصم...";
    statusBox.style.display = "block";

    // إخفاء عناصر السباق/العداد القديمة غير المستخدمة في هذا النظام
    let attackBtn = document.getElementById("pvp-attack-button");
    let timerEl = document.getElementById("pvp-battle-timer");
    if(attackBtn) attackBtn.style.display = "none";
    if(timerEl) timerEl.style.display = "none";

    let pc = await getActivePlayerCharacter();
    if(!pc){
        statusBox.textContent = "لا توجد شخصية نشطة";
        return;
    }

    pvpState.myCharacterName = pc.characters ? pc.characters.name : "";
    pvpState.mySkills = await loadCharacterSkills(pc.character_id);

    let { data, error } =
    await supabaseClient
    .rpc("pvp_find_or_create_match", { p_token: token })
    .single();

    if(error || !data){
        statusBox.textContent = "تعذر البحث عن مباراة، حاول مرة أخرى";
        console.log("pvp_find_or_create_match error", error);
        return;
    }

    pvpState.matchId = data.match_id;
    pvpState.isPlayer1 = data.is_player1;

    if(data.status === "waiting"){
        statusBox.textContent = "⏳ في انتظار انضمام لاعب آخر...";
        pvpPollForOpponent(statusBox, arena);
    } else {
        statusBox.style.display = "none";
        if(arena) arena.style.opacity = "1";
        pvpBeginMatchLoop();
    }
}

// ننتظر لحد ما حد تاني ينضم للمباراة
function pvpPollForOpponent(statusBox, arena){
    pvpStopPolling();

    pvpState.pollTimer = setInterval(async () => {

        let { data, error } =
        await supabaseClient
        .rpc("pvp_get_match_state", { p_token: pvpGetToken(), p_match_id: pvpState.matchId })
        .single();

        if(error || !data) return;

        if(data.status === "active"){
            pvpStopPolling();
            statusBox.style.display = "none";
            if(arena) arena.style.opacity = "1";
            pvpBeginMatchLoop();
        }

    }, 2000);
}

// بعد ما المباراة تبقى شغالة: نعرض الشاشة ونبدأ نراقب الحالة
function pvpBeginMatchLoop(){

    renderPVPSkillButtons();
    pvpRefreshState(true);

    pvpStopPolling();
    pvpState.pollTimer = setInterval(() => pvpRefreshState(false), 2000);
}

// نجيب حالة المباراة الحالية ونحدّث الشاشة
async function pvpRefreshState(isFirstLoad){

    if(pvpState.finished) return;

    let { data, error } =
    await supabaseClient
    .rpc("pvp_get_match_state", { p_token: pvpGetToken(), p_match_id: pvpState.matchId })
    .single();

    if(error || !data) return;

    let myHp, oppHp, myMaxHp, oppMaxHp, myName, oppName, myImage, oppImage;

    if(pvpState.isPlayer1){
        myHp = data.player1_hp; oppHp = data.player2_hp;
        myMaxHp = data.player1_max_hp; oppMaxHp = data.player2_max_hp;
        myName = data.player1_char_name; oppName = data.player2_char_name;
        myImage = data.player1_char_image; oppImage = data.player2_char_image;
    } else {
        myHp = data.player2_hp; oppHp = data.player1_hp;
        myMaxHp = data.player2_max_hp; oppMaxHp = data.player1_max_hp;
        myName = data.player2_char_name; oppName = data.player1_char_name;
        myImage = data.player2_char_image; oppImage = data.player1_char_image;
    }

    setFighterImage(document.getElementById("pvp-player-image"), myImage);
    setFighterImage(document.getElementById("pvp-enemy-image"), oppImage);

    document.getElementById("pvp-player-name-battle").textContent = myName || "أنت";
    document.getElementById("pvp-enemy-name").textContent = oppName || "الخصم";

    updateHpDisplay("pvp-player", myHp, myMaxHp);
    updateHpDisplay("pvp-enemy", oppHp, oppMaxHp);

    let myTurn = (data.turn_player_id === (pvpState.isPlayer1 ? data.player1_id : data.player2_id));
    pvpSetSkillsEnabled(myTurn && data.status === "active");

    let statusBox = document.getElementById("pvp-status-message");
    if(statusBox){
        if(data.status === "active"){
            statusBox.style.display = "block";
            statusBox.textContent = myTurn ? "🟢 دورك الآن" : "⏳ دور الخصم...";
        }
    }

    if(data.status === "finished"){
        pvpState.finished = true;
        pvpStopPolling();
        let iWon = data.winner_id === (pvpState.isPlayer1 ? data.player1_id : data.player2_id);
        pvpShowResult(iWon);
    }
}

function updateHpDisplay(prefix, hp, maxHp){
    hp = Math.max(0, hp || 0);
    maxHp = maxHp || 1;
    let pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));

    let bar = document.getElementById(prefix + "-hp-bar");
    let text = document.getElementById(prefix + "-hp");

    if(bar) bar.style.width = pct + "%";
    if(text) text.textContent = hp + " / " + maxHp;

    if(bar) updateHpBarColor(bar, hp, maxHp);
}

// ========================================
// عرض أزرار المهارات (نسخة مبسطة بدون سرقة/نسخ)
// ========================================
function renderPVPSkillButtons(){

    let container = document.getElementById("pvp-player-skills-pages");
    if(!container) return;

    container.innerHTML = "";

    let usable = pvpState.mySkills.filter(s => s.effect !== "steal" && s.effect !== "copy");

    if(usable.length === 0){
        usable = [{id:"default_atk", name:"هجوم عادي", type:"attack", damage:100, cooldown:0, effect:null}];
    }

    let page = document.createElement("div");
    page.className = "skills-page active";

    usable.forEach(skill => {
        let btn = document.createElement("button");
        btn.textContent = skill.name;
        btn.dataset.skillId = skill.id;
        btn.onclick = () => pvpUseSkill(skill.id);
        page.appendChild(btn);
    });

    container.appendChild(page);
}

function pvpSetSkillsEnabled(enabled){
    let container = document.getElementById("pvp-player-skills-pages");
    if(!container) return;
    container.querySelectorAll("button").forEach(b => b.disabled = !enabled);
}

// ========================================
// استخدام مهارة — كل الحساب الفعلي بيحصل في الدالة على السيرفر
// ========================================
async function pvpUseSkill(skillId){

    pvpSetSkillsEnabled(false);

    let { data, error } =
    await supabaseClient
    .rpc("pvp_use_skill", {
        p_token: pvpGetToken(),
        p_match_id: pvpState.matchId,
        p_skill_id: skillId
    })
    .single();

    if(error){
        alert(error.message || "تعذر تنفيذ الحركة");
        pvpRefreshState(false);
        return;
    }

    pvpRefreshState(false);
}

// ========================================
// الاستسلام / الخروج من الشاشة
// ========================================
async function pvpLeaveMatch(){

    if(pvpState.matchId && !pvpState.finished){
        try{
            await supabaseClient.rpc("pvp_forfeit_match", {
                p_token: pvpGetToken(),
                p_match_id: pvpState.matchId
            });
        }catch(e){}
    }

    pvpStopPolling();
    pvpState.matchId = null;
    pvpState.finished = false;
}

function pvpShowResult(iWon){

    let statusBox = document.getElementById("pvp-status-message");
    if(statusBox){
        statusBox.style.display = "block";
        statusBox.textContent = iWon ? "🏆 فزت!" : "💔 خسرت";
    }

    pvpSetSkillsEnabled(false);

    setTimeout(() => {
        alert(iWon ? "فزت في المعركة! 🏆" : "خسرت هذه المرة 💔");
        openScreen("pvp-screen");
    }, 500);
}

