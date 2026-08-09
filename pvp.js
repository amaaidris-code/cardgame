// ========================================
// PvP — واجهة اللاعب (كل الحسابات الحاسمة على السيرفر)
// ========================================

let pvpState = {
    matchId: null,
    pollTimer: null,
    isPlayer1: null,
    mySkills: [],
    myCharacterName: "",
    finished: false,
    myUsedSkillIds: [],
    oppUsedSkillIds: [],
    skillCache: {}, // skill_id -> سجل المهارة الكامل (اسم/نوع/effect...)
    stealMenuOpen: false
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
    pvpState.myUsedSkillIds = [];
    pvpState.oppUsedSkillIds = [];
    pvpCloseStealMenu();

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

    // نخزّن مهارات شخصيتنا في كاش المهارات كذلك حتى نعرض أسماءها فورًا
    // في شريط "مهارات استُخدمت" دون أي طلب شبكة إضافي
    pvpState.mySkills.forEach(s => { pvpState.skillCache[s.id] = s; });

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
    let myUsedIds, oppUsedIds;

    if(pvpState.isPlayer1){
        myHp = data.player1_hp; oppHp = data.player2_hp;
        myMaxHp = data.player1_max_hp; oppMaxHp = data.player2_max_hp;
        myName = data.player1_char_name; oppName = data.player2_char_name;
        myImage = data.player1_char_image; oppImage = data.player2_char_image;
        myUsedIds = data.player1_used_skill_ids || [];
        oppUsedIds = data.player2_used_skill_ids || [];
    } else {
        myHp = data.player2_hp; oppHp = data.player1_hp;
        myMaxHp = data.player2_max_hp; oppMaxHp = data.player1_max_hp;
        myName = data.player2_char_name; oppName = data.player1_char_name;
        myImage = data.player2_char_image; oppImage = data.player1_char_image;
        myUsedIds = data.player2_used_skill_ids || [];
        oppUsedIds = data.player1_used_skill_ids || [];
    }

    setFighterImage(document.getElementById("pvp-player-image"), myImage);
    setFighterImage(document.getElementById("pvp-enemy-image"), oppImage);

    document.getElementById("pvp-player-name-battle").textContent = myName || "أنت";
    document.getElementById("pvp-enemy-name").textContent = oppName || "الخصم";

    updateHpDisplay("pvp-player", myHp, myMaxHp);
    updateHpDisplay("pvp-enemy", oppHp, oppMaxHp);

    pvpState.myUsedSkillIds = myUsedIds;
    pvpState.oppUsedSkillIds = oppUsedIds;
    await pvpEnsureSkillsCached([...myUsedIds, ...oppUsedIds]);
    pvpRenderUsedSkillsUI();

    let myTurn = (data.turn_player_id === (pvpState.isPlayer1 ? data.player1_id : data.player2_id));
    pvpSetSkillsEnabled(myTurn && data.status === "active");

    // إن لم يعد دورنا (أو انتهت المباراة)، أي قائمة سرقة/نسخ مفتوحة لم تعد صالحة
    if(!(myTurn && data.status === "active")){
        pvpCloseStealMenu();
    }

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
        pvpCloseStealMenu();
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
// عرض أزرار المهارات (تشمل الآن السرقة/النسخ)
// ========================================
function renderPVPSkillButtons(){

    let container = document.getElementById("pvp-player-skills-pages");
    if(!container) return;

    container.innerHTML = "";

    let usable = pvpState.mySkills;

    if(usable.length === 0){
        usable = [{id:"default_atk", name:"هجوم عادي", type:"attack", damage:100, cooldown:0, effect:null}];
    }

    let page = document.createElement("div");
    page.className = "skills-page active";

    usable.forEach(skill => {
        let btn = document.createElement("button");
        btn.textContent = skill.name;
        btn.dataset.skillId = skill.id;

        if(skill.effect === "steal" || skill.effect === "copy"){
            btn.textContent = skill.name + (skill.effect === "steal" ? " 🕵️" : " 📋");
            btn.onclick = () => pvpOpenStealMenu(skill);
        } else {
            btn.onclick = () => pvpUseSkill(skill.id);
        }

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
// استخدام مهارة عادية — كل الحساب الفعلي بيحصل في الدالة على السيرفر
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
// جلب بيانات المهارات (الاسم/effect) للمهارات التي لم تُخزَّن بعد،
// حتى نعرض أسماءها في شريط "مهارات استُخدمت" وفي قائمة السرقة/النسخ.
// بيانات المهارات عامة وللقراءة فقط (نفس مبدأ GameCache)، لذا آمن طلبها.
// ========================================
async function pvpEnsureSkillsCached(ids){

    let missing = [...new Set(ids)].filter(id => id && !pvpState.skillCache[id]);
    if(missing.length === 0) return;

    let { data, error } =
    await supabaseClient
    .from("skills")
    .select("*")
    .in("id", missing);

    if(error || !data) return;

    data.forEach(s => { pvpState.skillCache[s.id] = s; });
}

function pvpRenderUsedSkillsUI(){

    let renderInto = (containerId, ids) => {
        let box = document.getElementById(containerId);
        if(!box) return;

        box.innerHTML = "";

        ids.forEach(id => {
            let s = pvpState.skillCache[id];
            if(!s) return;

            let chip = document.createElement("span");
            chip.className = "used-skill-chip";
            chip.textContent = s.name;
            box.appendChild(chip);
        });
    };

    renderInto("pvp-player-used-skills", pvpState.myUsedSkillIds);
    renderInto("pvp-enemy-used-skills", pvpState.oppUsedSkillIds);
}

// ========================================
// قائمة السرقة/النسخ: نعرض فقط المهارات التي استخدمها الخصم بالفعل
// في هذه المباراة (نفس ما تتحقق منه دالة السيرفر pvp_steal_or_copy_skill)
// ========================================
function pvpOpenStealMenu(abilitySkill){

    pvpCloseStealMenu();

    let candidates = pvpState.oppUsedSkillIds
    .map(id => pvpState.skillCache[id])
    .filter(s => s && s.effect !== "steal" && s.effect !== "copy");

    if(candidates.length === 0){
        alert("لم يستخدم الخصم أي مهارة قابلة للسرقة/النسخ بعد في هذه المباراة");
        return;
    }

    pvpState.stealMenuOpen = true;

    let verb = abilitySkill.effect === "steal" ? "سرقة" : "نسخ";

    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>${abilitySkill.effect === "steal" ? "🕵️" : "📋"} اختر مهارة الخصم لتُ${verb === "سرقة" ? "سرق" : "نسخ"}ها</h3>
            <div class="steal-options-list" id="pvp-steal-options-list"></div>
            <div class="steal-modal-buttons">
                <button id="pvp-steal-cancel-btn">إلغاء</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    let list = modal.querySelector("#pvp-steal-options-list");
    candidates.forEach(skill => {
        let btn = document.createElement("button");
        btn.className = "steal-option";
        btn.textContent = skill.name;
        btn.onclick = () => {
            pvpCloseStealMenu();
            pvpUseStealOrCopy(abilitySkill.id, skill.id);
        };
        list.appendChild(btn);
    });

    modal.querySelector("#pvp-steal-cancel-btn").onclick = pvpCloseStealMenu;
}

function pvpCloseStealMenu(){
    pvpState.stealMenuOpen = false;
    let modal = document.getElementById("pvp-steal-modal");
    if(modal) modal.remove();
}

// ========================================
// تنفيذ السرقة/النسخ — كل الحساب الفعلي (هل المهارة مملوكة، هل الدور
// دورنا، هل الخصم استخدم فعلًا هذه المهارة، الضرر...) يحصل على السيرفر
// ========================================
async function pvpUseStealOrCopy(abilitySkillId, targetSkillId){

    pvpSetSkillsEnabled(false);

    let { data, error } =
    await supabaseClient
    .rpc("pvp_steal_or_copy_skill", {
        p_token: pvpGetToken(),
        p_match_id: pvpState.matchId,
        p_ability_skill_id: abilitySkillId,
        p_target_skill_id: targetSkillId
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

    pvpCloseStealMenu();
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
        // نعود لشاشة اختيار نوع المواجهة (PvE/PvP)، وليس شاشة "PvP" القديمة
        // في الشاشة الرئيسية والتي أصبحت غير مستخدمة
        openScreen("solo-battle-screen");
    }, 500);
}
