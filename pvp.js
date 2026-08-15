// ========================================
// PvP — واجهة اللاعب (كل الحسابات الحاسمة على السيرفر)
// تدفّق كامل: ردهة (اختيار الخصم) -> تحدٍّ وقبول -> تصادم البطاقات ->
// زر الاستعداد الأحمر -> نزال عادي بالأدوار
// ========================================

let pvpState = {
    matchId: null,
    pollTimer: null,
    isFetching: false,
    isPlayer1: null,
    mySkills: [],
    myCharacterName: "",
    myCharacterId: null,
    finished: false,
    myUsedSkillIds: [],
    oppUsedSkillIds: [],
    skillCache: {}, // skill_id -> سجل المهارة الكامل (اسم/نوع/effect/damage/cooldown...)
    // مهارات كشفها الخصم لك في أي نزال سابق (cross-battle) — مصدر السرقة/السيطرة
    oppRevealedSkillIds: [],
    stealMenuOpen: false,

    // مهارات دفاع الخصم (type = "defense"): تُبقى دائمًا خيارًا للختم حتى لو
    // لم يستخدمها في هذه المباراة بعد (الدفاع مهارة أساسية لدى أي مقاتل)
    oppDefenseSkillIds: [],

    // المهارة الأولى للخصم (slot 1) — محمية ولا يمكن ختمها أبدًا
    oppFirstSkillId: null,

    // تهدئة مهاراتي في هذه المباراة: skill_id -> last_used_turn
    myCooldowns: {},
    myTurnsTaken: 0,

    // حالة مرحلة السباق (بعد استعداد الطرفين، قبل بداية النزال الفعلي)
    raceStarted: false,
    raceResolvedLocally: false,
    raceLockedUntil: 0,

    // مؤقت الـ60 ثانية للدور الحالي (متزامن مع turn_deadline على السيرفر)
    turnDeadline: null,
    turnTimerInterval: null,
        skipInFlight: false,

    // المهارات المختومة حتى نهاية المباراة (skill_id) لكل طرف — تُمنع
    // من الاستخدام، وتظهر مقفلة بشارة 🔒
    mySealedSkillIds: [],
    oppSealedSkillIds: [],

    // آخر HP معروف للطرفين — تُستخدم لاكتشاف حدوث ضرر فعلي بين استطلاع
    // وآخر (لعرض شارة الحدث المناسبة)، undefined يعني لم نحمّل الحالة بعد
    lastMyHp: undefined,
    lastOppHp: undefined
};

// حالة الردهة (اختيار الخصم) والتحدي، منفصلة عن حالة النزال نفسه
let pvpLobby = {
    pollTimer: null,
    isFetching: false,
    // 'browsing' نتصفح القائمة | 'waiting' أرسلت تحديًا وأنتظر ردًا
    mode: "browsing",
    outgoingMatchId: null,
    incomingShown: null // match_id لتحدٍّ وارد نعرضه حاليًا حتى لا نكرر المودال
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

function pvpLobbyStopPolling(){
    if(pvpLobby.pollTimer){
        clearInterval(pvpLobby.pollTimer);
        pvpLobby.pollTimer = null;
    }
}

// ========================================
// مؤقت الدور (60 ثانية) — يعرض العدّ التنازلي المتزامن مع turn_deadline
// القادم من السيرفر (وليس عدّادًا محليًا مستقلاً، حتى يبقى الطرفان متفقين
// حتى لو تأخر أحدهما في استقبال التحديثات). عند الوصول للصفر، يطلب من
// السيرفر تخطّي الدور (pvp_skip_turn) — السيرفر هو من يتحقق فعليًا من
// انتهاء المهلة، فلا ضرر من استدعائها أكثر من مرة أو من كلا الطرفين
// ========================================
function pvpStopTurnTimer(){
    if(pvpState.turnTimerInterval){
        clearInterval(pvpState.turnTimerInterval);
        pvpState.turnTimerInterval = null;
    }
    let box = document.getElementById("pvp-battle-timer");
    if(box) box.textContent = "";
}

function pvpUpdateTurnTimer(turnDeadlineIso){

    // لا نعيد تشغيل المؤقّت إن كان نفس الموعد الذي نعرضه أصلاً (يحدث هذا
    // في كل استطلاع تقريبًا طالما لم يتغيّر الدور) — إعادة التشغيل غير
    // الضرورية كل 1.2 ثانية غير مضرة بصريًا (لأن tick تحسب الوقت من موعد
    // الانتهاء الحقيقي دائمًا) لكنها تبقي المؤقّت يعمل بكفاءة أقل بلا داعٍ
    if(turnDeadlineIso === pvpState.turnDeadline && pvpState.turnTimerInterval){
        return;
    }

    pvpState.turnDeadline = turnDeadlineIso || null;

    if(pvpState.turnTimerInterval){
        clearInterval(pvpState.turnTimerInterval);
        pvpState.turnTimerInterval = null;
    }

    if(!pvpState.turnDeadline){
        let box = document.getElementById("pvp-battle-timer");
        if(box) box.textContent = "";
        return;
    }

    let deadlineMs = new Date(pvpState.turnDeadline).getTime();

    let tick = () => {

        let box = document.getElementById("pvp-battle-timer");
        if(!box) return;

        let remainingMs = deadlineMs - Date.now();
        let seconds = Math.max(0, Math.ceil(remainingMs / 1000));

        let m = Math.floor(seconds / 60);
        let s = seconds % 60;
        box.textContent = m + ":" + (s < 10 ? "0" + s : s);

        if(remainingMs <= 0){
            // لا نتوقف بعد محاولة فاشلة واحدة: بسبب فرق توقيت بسيط بين
            // المتصفح والخادم قد يرفض السيرفر pvp_skip_turn بقول "لم تنتهِ
            // مهلة الدور بعد" حتى وإن عرضنا نحن 0:00 — لذا نعيد المحاولة في
            // كل نبضة حتى يسلّم السيرفر الدور فعلًا (skipInFlight يمنع
            // تكدّس طلبات متزامنة)
            pvpRequestSkipTurn();
        }
    };

    tick();
    pvpState.turnTimerInterval = setInterval(tick, 1000);
}

async function pvpRequestSkipTurn(){
    if(!pvpState.matchId) return;
    if(pvpState.skipInFlight) return;
    pvpState.skipInFlight = true;
    try{
        await supabaseClient.rpc("pvp_skip_turn", {
            p_token: pvpGetToken(),
            p_match_id: pvpState.matchId
        });
    }catch(e){
        // قد تفشل لأن الطرف الآخر تخطّى الدور أولاً أو المهلة لم تنتهِ
        // فعليًا بعد على السيرفر (فرق توقيت بسيط) — لا مشكلة، سنعيد
        // المحاولة في النبضة التالية من المؤقّت حتى يسلّم السيرفر الدور
    }finally{
        pvpState.skipInFlight = false;
    }
    pvpRefreshState(false);
}

// ========================================
// الردهة: عرض اللاعبين المتاحين واختيار الخصم
// ========================================
async function openPVPLobby(){

    let token = pvpGetToken();
    if(!token){
        alert("سجّل الدخول أولاً");
        return;
    }

    let pc = await getActivePlayerCharacter();
    if(!pc){
        alert("لا توجد شخصية نشطة");
        return;
    }

    openScreen("pvp-lobby-screen");

    pvpLobby.mode = "browsing";
    pvpLobby.outgoingMatchId = null;
    pvpLobby.incomingShown = null;
    pvpCloseChallengeModal();

    pvpSetLobbyStatus("");

    await pvpRefreshLobby();

    pvpLobbyStopPolling();
    pvpLobby.pollTimer = setInterval(pvpRefreshLobby, 3000);

    // عند عودة اللاعب للتبويب (من خلفية/قفل الشاشة) نحدّث قائمة الردهة فورًا
    // بدل انتظار الدورة التالية، فيرى اللاعبون الجدد/المغادرون لحظيًا
    if(!pvpLobby._visibilityHandler){
        pvpLobby._visibilityHandler = () => {
            if(!document.hidden && pvpLobby.mode !== "waiting") pvpRefreshLobby();
        };
        document.addEventListener("visibilitychange", pvpLobby._visibilityHandler);
    }
}

async function closePVPLobby(){
    pvpLobbyStopPolling();
    pvpCloseChallengeModal();

    try {
        if(pvpLobby.mode === "waiting" && pvpLobby.outgoingMatchId){
            // ألغِ التحدي المرسل إن كنا لا نزال ننتظر ردًا عليه
            await supabaseClient.rpc("pvp_forfeit_match", {
                p_token: pvpGetToken(),
                p_match_id: pvpLobby.outgoingMatchId
            });
        } else {
            await supabaseClient.rpc("pvp_leave_lobby", { p_token: pvpGetToken() });
        }
    } catch(e) {}

    pvpLobby.mode = "browsing";
    pvpLobby.outgoingMatchId = null;

    openScreen("solo-battle-screen");
}

function pvpSetLobbyStatus(text){
    let box = document.getElementById("pvp-lobby-status");
    if(box) box.textContent = text;
}

async function pvpRefreshLobby(){
    if(pvpLobby.isFetching) return;
    pvpLobby.isFetching = true;

    try{

    // أثناء انتظار رد على تحدٍّ أرسلته: نراقب حالة تلك المباراة تحديدًا
    if(pvpLobby.mode === "waiting"){
        await pvpPollOutgoingChallenge();
        return;
    }

    // نتصفّح القائمة: نجلب اللاعبين المتاحين + أي تحدٍّ وارد لنا
    let [{data: players, error: listError}, {data: incoming, error: incomingError}] =
    await Promise.all([
        supabaseClient.rpc("pvp_list_lobby", { p_token: pvpGetToken() }),
        supabaseClient.rpc("pvp_get_incoming_challenge", { p_token: pvpGetToken() })
    ]);

    let incomingChallenge = (!incomingError && incoming && incoming.length > 0) ? incoming[0] : null;

    pvpLobby.incomingShown = incomingChallenge ? incomingChallenge.match_id : null;

    if(!listError){
        pvpRenderLobbyList(players || [], incomingChallenge);
    }

    }finally{
        pvpLobby.isFetching = false;
    }
}

function pvpRenderLobbyList(players, incomingChallenge){
    let box = document.getElementById("pvp-lobby-list");
    if(!box) return;

    box.innerHTML = "";

    // التحدي الوارد يظهر كأول بطاقة بزر "قبول التحدي" بدل نافذة منبثقة،
    // بحيث تصبح تجربة اللاعبين متماثلة: كل واحد يشوف زر تحدٍّ للآخر، ومن
    // يضغط أولًا يتحول زره عند الطرف الثاني تلقائيًا إلى "قبول التحدي"
    if(incomingChallenge){
        let card = document.createElement("div");
        card.className = "character-card pvp-incoming-card";
        // اسم التحدّي قد يحمله مستخدم عادي — يُهرب قبل العرض (XSS)
        let safeChallenger = escapeHtml(incomingChallenge.challenger_name || "لاعب");
        card.innerHTML = `
        <div class="character-info">
            <h3>⚔️ ${safeChallenger}</h3>
            <p class="pvp-incoming-note">تحدّاك هذا اللاعب!</p>
        </div>
        <div class="pvp-incoming-buttons">
            <button class="pvp-accept-btn">✅ قبول التحدي</button>
            <button class="pvp-decline-btn">❌ رفض</button>
        </div>
        `;
        card.querySelector(".pvp-accept-btn").onclick = () => pvpRespondChallenge(incomingChallenge.match_id, true);
        card.querySelector(".pvp-decline-btn").onclick = () => pvpRespondChallenge(incomingChallenge.match_id, false);
        box.appendChild(card);
    }

    if(players.length === 0){
        if(!incomingChallenge){
            box.innerHTML = "<p style='text-align:center;padding:15px;'>لا يوجد لاعبون متاحون الآن، انتظر قليلاً...</p>";
        }
        return;
    }

    players.forEach(p => {
        let card = document.createElement("div");
        card.className = "character-card";
        // اسم الشخصية المعروض في الردهة قد يكون لخصم — يُهرب قبل العرض (XSS)
        let safeCharName = escapeHtml(p.character_name || "لاعب");
        card.innerHTML = `
        <div class="character-info">
            <h3>${safeCharName}</h3>
        </div>
        <button>⚔️ تحدَّ</button>
        `;
        card.querySelector("button").onclick = () => pvpSendChallenge(p.player_id);
        box.appendChild(card);
    });
}

async function pvpSendChallenge(targetPlayerId){

    pvpSetLobbyStatus("جارٍ إرسال التحدي...");

    let { data, error } =
    await supabaseClient
    .rpc("pvp_send_challenge", { p_token: pvpGetToken(), p_target_player_id: targetPlayerId });

    if(error){
        alert(error.message || "تعذر إرسال التحدي");
        pvpSetLobbyStatus("");
        return;
    }

    pvpLobby.mode = "waiting";
    pvpLobby.outgoingMatchId = data;

    let listBox = document.getElementById("pvp-lobby-list");
    if(listBox) listBox.innerHTML = "";

    pvpSetLobbyStatus("⏳ في انتظار رد الخصم على التحدي...");
}

async function pvpCancelOutgoingChallenge(){
    if(!pvpLobby.outgoingMatchId) return;

    try {
        await supabaseClient.rpc("pvp_forfeit_match", {
            p_token: pvpGetToken(),
            p_match_id: pvpLobby.outgoingMatchId
        });
    } catch(e) {}

    pvpLobby.mode = "browsing";
    pvpLobby.outgoingMatchId = null;
    pvpSetLobbyStatus("تم إلغاء التحدي");
    await pvpRefreshLobby();
}

async function pvpPollOutgoingChallenge(){

    let { data, error } =
    await supabaseClient
    .rpc("pvp_get_match_state", { p_token: pvpGetToken(), p_match_id: pvpLobby.outgoingMatchId })
    .single();

    // PGRST116 = طلب .single() لم يجد أي صف — أي أن المباراة حُذفت فعلًا
    // (الخصم رفضها، أو انتهت صلاحيتها). أي خطأ آخر (انقطاع شبكة مؤقت،
    // تأخر الاتصال، إلخ) لا يعني رفضًا؛ نتجاهله ونحاول مجددًا في الدورة
    // التالية بدل الحكم خطأً بأن الخصم رفض التحدي.
    if(error && error.code === "PGRST116"){
        pvpLobby.mode = "browsing";
        pvpLobby.outgoingMatchId = null;
        pvpSetLobbyStatus("❌ رفض الخصم التحدي، اختر خصمًا آخر");
        await pvpRefreshLobby();
        return;
    }

    if(error || !data){
        // خطأ مؤقت (شبكة/اتصال) — لا نُسقط الانتظار، فقط نحاول مجددًا
        // في الدورة التالية للاستطلاع (كل 3 ثوانٍ).
        pvpLobby._outgoingFailCount = (pvpLobby._outgoingFailCount || 0) + 1;

        // بعد عدة محاولات فاشلة متتالية (~15 ثانية) نعتبر الاتصال بالمباراة
        // مفقودًا فعلًا ونعيد اللاعب للتصفح بدل تركه عالقًا إلى الأبد
        if(pvpLobby._outgoingFailCount >= 5){
            pvpLobby._outgoingFailCount = 0;
            pvpLobby.mode = "browsing";
            pvpLobby.outgoingMatchId = null;
            pvpSetLobbyStatus("⚠️ تعذر الاتصال بالتحدي، حاول مجددًا");
            await pvpRefreshLobby();
        }
        return;
    }

    pvpLobby._outgoingFailCount = 0;

    if(data.status === "ready_wait"){
        pvpLobbyStopPolling();
        pvpEnterReadyPhase(data.id);
        return;
    }
}

// ========================================
// إغلاق أي بقايا من نافذة تحدٍّ قديمة (لم تعد تُستخدم، الاستجابة الآن مباشرة من القائمة)
// ========================================
function pvpCloseChallengeModal(){
    let modal = document.getElementById("pvp-challenge-modal");
    if(modal) modal.remove();
}

async function pvpRespondChallenge(matchId, accept){

    pvpCloseChallengeModal();
    pvpLobby.incomingShown = null;

    let { error } =
    await supabaseClient
    .rpc("pvp_respond_challenge", { p_token: pvpGetToken(), p_match_id: matchId, p_accept: accept });

    if(error){
        alert(error.message || "تعذر تنفيذ الاستجابة");
        return;
    }

    if(!accept) return;

    pvpLobbyStopPolling();
    pvpEnterReadyPhase(matchId, null);
}

// ========================================
// مرحلة الاستعداد: تصادم البطاقات ثم زر الاستعداد الأحمر
// ========================================
async function pvpEnterReadyPhase(matchId, _unused){

    pvpState.matchId = matchId;
    pvpState.finished = false;
    pvpState.myUsedSkillIds = [];
    pvpState.oppUsedSkillIds = [];
    pvpState.myCooldowns = {};
    pvpState.myTurnsTaken = 0;
    pvpState.lastMyHp = undefined;
    pvpState.lastOppHp = undefined;
    pvpState.raceStarted = false;
    pvpState.raceResolvedLocally = false;
    pvpState.raceLockedUntil = 0;
    pvpStopTurnTimer();
    pvpCloseStealMenu();

    // نمسح ذاكرة آخر رسم لشرائح المهارات المستخدمة حتى لا تبقى شرائح
    // المباراة السابقة ظاهرة لو تطابقت قوائم المعرّفات صدفة
    let p1Box = document.getElementById("pvp-player-used-skills");
    let p2Box = document.getElementById("pvp-enemy-used-skills");
    if(p1Box) delete p1Box.dataset.renderedIds;
    if(p2Box) delete p2Box.dataset.renderedIds;

    let token = pvpGetToken();

    let pc = await getActivePlayerCharacter();
    if(!pc){
        alert("لا توجد شخصية نشطة");
        return;
    }
    pvpState.myCharacterName = pc.characters ? pc.characters.name : "";
    pvpState.myCharacterId = pc.character_id;
    pvpState.mySkills = await loadCharacterSkills(pc.character_id);
    pvpState.mySkills.forEach(s => { pvpState.skillCache[s.id] = s; });

    // خلفيات صفحات مهاراتي (تُرسم خلف الأزرار في ساحة المعركة)
    await loadSkillPageBackgrounds(pc.character_id);

    let { data, error } =
    await supabaseClient
    .rpc("pvp_get_match_state", { p_token: token, p_match_id: matchId })
    .single();

    if(error || !data){
        alert("تعذر تحميل المباراة");
        openPVPLobby();
        return;
    }

    pvpState.isPlayer1 = (data.player1_id === (await pvpGetMyPlayerId()));

    // تحميل مهارات الخصم التي كشفها لك في أي نزال سابق (cross-battle) —
    // مصدر قوائم السرقة والتحكم
    pvpState.oppRevealedSkillIds = [];
    let revealedRes = await supabaseClient
        .rpc("pvp_list_revealed_skills", { p_token: token, p_match_id: matchId });
    if(!revealedRes.error && revealedRes.data){
        pvpState.oppRevealedSkillIds = revealedRes.data.map(r => r.skill_id);
    }
    await pvpEnsureSkillsCached(pvpState.oppRevealedSkillIds);

    openScreen("pvp-battle-screen");

    let statusBox = document.getElementById("pvp-status-message");
    if(statusBox) statusBox.style.display = "block";
    if(statusBox) statusBox.textContent = "";

    let arena = document.querySelector("#pvp-battle-screen .battle-arena");
    resetBattleVisuals("pvp");
    if(arena){
        arena.classList.remove("cards-engaged");
        arena.style.opacity = "1";
    }

    ensureLogBox("pvp");
    renderPVPSkillButtons();
    pvpSetSkillsEnabled(false);
    pvpLoadWeapon();

    pvpApplyMatchStateToScreen(data);

    // تصادم البطاقات، ثم زر الاستعداد الأحمر
    await pvpRunIntroSequence(data);
    pvpShowReadyButton(data);
}

async function pvpGetMyPlayerId(){
    if(pvpState._myPlayerId) return pvpState._myPlayerId;
    let id = localStorage.getItem("player_id");
    pvpState._myPlayerId = id;
    return id;
}

function pvpApplyMatchStateToScreen(data){

    let myName, oppName, myImage, oppImage, myHp, oppHp, myMaxHp, oppMaxHp;

    if(pvpState.isPlayer1){
        myName = data.player1_char_name; oppName = data.player2_char_name;
        myImage = data.player1_char_image; oppImage = data.player2_char_image;
        myHp = data.player1_hp; oppHp = data.player2_hp;
        myMaxHp = data.player1_max_hp; oppMaxHp = data.player2_max_hp;
    } else {
        myName = data.player2_char_name; oppName = data.player1_char_name;
        myImage = data.player2_char_image; oppImage = data.player1_char_image;
        myHp = data.player2_hp; oppHp = data.player1_hp;
        myMaxHp = data.player2_max_hp; oppMaxHp = data.player1_max_hp;
    }

    setFighterImage(document.getElementById("pvp-player-image"), myImage);
    setFighterImage(document.getElementById("pvp-enemy-image"), oppImage);
    document.getElementById("pvp-player-name-battle").textContent = myName || "أنت";
    document.getElementById("pvp-enemy-name").textContent = oppName || "الخصم";
    updateHpDisplay("pvp-player", myHp, myMaxHp);
    updateHpDisplay("pvp-enemy", oppHp, oppMaxHp);
    pvpState.myCharImage = myImage;
    // عند تفعيل عرض "السلاح" نحافظ على صورة/اسم السلاح بعد كل تحديث
    if(pvpWeaponView && pvpWeapon){
        if(pvpWeapon.image) setFighterImage(document.getElementById("pvp-player-image"), pvpWeapon.image);
        document.getElementById("pvp-player-name-battle").textContent = "⚔️ " + (pvpWeapon.name || "سلاح");
    }
}

// نسخة مبسّطة من تصادم البطاقات في battle.js (بدون سباق، فقط سينمائية)
async function pvpRunIntroSequence(data){

    let screen = document.getElementById("pvp-battle-screen");
    let arena = screen.querySelector(".battle-arena");
    arena.style.overflow = "visible";

    let myImage = pvpState.isPlayer1 ? data.player1_char_image : data.player2_char_image;
    let oppImage = pvpState.isPlayer1 ? data.player2_char_image : data.player1_char_image;

    let playerColor = "#3b82ff";
    let enemyColor = "#ef4444";

    let playerCard = document.createElement("div");
    playerCard.className = "intro-card intro-player";
    playerCard.style.borderColor = playerColor;
    playerCard.style.boxShadow = "0 0 25px " + playerColor;
    setIntroCardImage(playerCard, myImage);

    let enemyCard = document.createElement("div");
    enemyCard.className = "intro-card intro-enemy";
    enemyCard.style.borderColor = enemyColor;
    enemyCard.style.boxShadow = "0 0 25px " + enemyColor;
    setIntroCardImage(enemyCard, oppImage);

    let vs = document.createElement("div");
    vs.className = "intro-vs";
    vs.textContent = "VS";
    vs.style.backgroundImage = `linear-gradient(90deg, ${enemyColor}, ${playerColor})`;

    let lineLeft = document.createElement("div");
    lineLeft.className = "intro-vs-line intro-vs-line-left";
    lineLeft.style.backgroundImage = `linear-gradient(90deg, ${enemyColor}, ${playerColor}, ${enemyColor}, ${playerColor})`;

    let lineRight = document.createElement("div");
    lineRight.className = "intro-vs-line intro-vs-line-right";
    lineRight.style.backgroundImage = `linear-gradient(90deg, ${enemyColor}, ${playerColor}, ${enemyColor}, ${playerColor})`;

    let flash = document.createElement("div");
    flash.className = "intro-flash";

    let wavePlayer = document.createElement("div");
    wavePlayer.className = "intro-wave";
    wavePlayer.style.color = playerColor;

    let waveEnemy = document.createElement("div");
    waveEnemy.className = "intro-wave";
    waveEnemy.style.color = enemyColor;

    arena.appendChild(playerCard);
    arena.appendChild(enemyCard);
    arena.appendChild(lineLeft);
    arena.appendChild(lineRight);
    arena.appendChild(wavePlayer);
    arena.appendChild(waveEnemy);
    arena.appendChild(vs);
    arena.appendChild(flash);

    await wait(50);

    playerCard.classList.add("slide-in");
    enemyCard.classList.add("slide-in");

    await wait(600);

    flash.classList.add("play");
    vs.classList.add("show");
    lineLeft.classList.add("show");
    lineRight.classList.add("show");
    wavePlayer.classList.add("show");
    arena.classList.add("shake");

    await wait(120);

    waveEnemy.classList.add("show");
    playerCard.classList.add("bounce-back");
    enemyCard.classList.add("bounce-back");

    await wait(380);

    arena.classList.remove("shake");

    await wait(700);

    playerCard.remove();
    enemyCard.remove();
    lineLeft.remove();
    lineRight.remove();
    wavePlayer.remove();
    waveEnemy.remove();
    vs.remove();
    flash.remove();

    arena.style.overflow = "hidden";
}

// زر الاستعداد الأحمر: كل لاعب يضغطه بنفسه، وبعد استعداد الطرفين يبدأ سباق
// الضغط (نفس نظام PvE: عدّ 1-2-3 فوق الزر، والضغط المبكر يُعاقَب)
function pvpShowReadyButton(data){

    let btn = document.getElementById("pvp-attack-button");

    if(!btn) { pvpAfterReadyPollStart(); return; }

    resetBattleVisuals("pvp");

    btn.style.visibility = "visible";
    btn.disabled = false;
    btn.classList.add("racing-live");
    btn.classList.remove("locked");

    let myReady = pvpState.isPlayer1 ? data.player1_ready : data.player2_ready;

    if(myReady){

        collapseRaceButton("pvp");

    } else {

        let readyClickHandler = async () => {
            btn.disabled = true;
            btn.onclick = null;

            let { error } =
            await supabaseClient
            .rpc("pvp_ready_up", { p_token: pvpGetToken(), p_match_id: pvpState.matchId });

            if(error){
                alert(error.message || "تعذر تأكيد الاستعداد");
                btn.disabled = false;
                btn.onclick = readyClickHandler;
                return;
            }

            collapseRaceButton("pvp");
            pvpSetLobbyStatus("");
            pvpUpdateReadyStatusText({
                player1_ready: pvpState.isPlayer1 ? true : data.player1_ready,
                player2_ready: pvpState.isPlayer1 ? data.player2_ready : true
            });
        };

        btn.onclick = readyClickHandler;

    }

    pvpUpdateReadyStatusText(data);

    pvpAfterReadyPollStart();
}

// يحدّث رسالة الحالة أثناء الاستعداد، ويُظهر للاعب إذا كان الخصم قد ضغط
// الاستعداد بالفعل حتى يعرف أنه عليه الضغط الآن أيضًا
function pvpUpdateReadyStatusText(data){

    let statusBox = document.getElementById("pvp-status-message");
    if(!statusBox) return;

    let myReady = pvpState.isPlayer1 ? data.player1_ready : data.player2_ready;
    let oppReady = pvpState.isPlayer1 ? data.player2_ready : data.player1_ready;

    statusBox.style.display = "block";

    if(myReady){
        statusBox.textContent = "⏳ بانتظار استعداد الخصم...";
    } else if(oppReady){
        statusBox.textContent = "🔥 الخصم استعد! اضغط الزر الآن";
    } else {
        statusBox.textContent = "اضغط الزر عند استعدادك!";
    }
}

function pvpAfterReadyPollStart(){
    pvpStopPolling();
    pvpState.pollTimer = setInterval(() => pvpRefreshState(false), 1200);
}

// ========================================
// مرحلة السباق: تُشغَّل مرة واحدة عندما تتحول حالة المباراة إلى "race"
// (بعد استعداد الطرفين)، بنفس آلية PvE تمامًا
// ========================================
async function pvpStartRacePhase(){

    let btn = document.getElementById("pvp-attack-button");
    let statusBox = document.getElementById("pvp-status-message");
    let countOverlay = document.getElementById("pvp-count-overlay");

    resetBattleVisuals("pvp");

    if(statusBox){
        statusBox.style.display = "block";
        statusBox.textContent = "استعدا...!";
    }

    pvpState.raceLockedUntil = 0;

    btn.style.visibility = "visible";
    btn.disabled = false;
    btn.onclick = () => pvpHandleEarlyPress();

    for(let n = 1; n <= 3; n++){

        if(countOverlay){
            countOverlay.textContent = n;
            countOverlay.classList.remove("show");
            void countOverlay.offsetWidth;
            countOverlay.classList.add("show");
        }

        await wait(750);

        // الخصم فاز بالسباق أثناء العد نفسه (سرّع الضغط عنده)؟ لا داعي نكمل
        if(pvpState.raceResolvedLocally) return;
    }

    if(countOverlay){
        countOverlay.textContent = "";
        countOverlay.classList.remove("show");
    }

    if(pvpState.raceResolvedLocally) return;

    let remainingLock = pvpState.raceLockedUntil - Date.now();

    if(remainingLock > 0){
        await wait(remainingLock);
        if(pvpState.raceResolvedLocally) return;
    }

    btn.disabled = false;
    btn.classList.remove("locked");
    btn.classList.add("racing-live");
    btn.onclick = () => pvpHandleRacePress();

    if(statusBox) statusBox.textContent = "اضغط الآن!";
}

// ضغط مبكر (أثناء العد): عقوبة "شلل" مؤقتة على الزر لثانية كاملة، بدون
// إلغاء السباق نفسه
function pvpHandleEarlyPress(){

    let btn = document.getElementById("pvp-attack-button");
    if(!btn || btn.disabled) return;

    btn.disabled = true;
    btn.classList.add("locked");

    pvpState.raceLockedUntil = Date.now() + 1000;

    setTimeout(() => {
        if(pvpState.raceResolvedLocally) return;
        btn.disabled = false;
        btn.classList.remove("locked");
    }, 1000);
}

// ضغط صحيح بعد انتهاء العد: نرسل للسيرفر، وهو الحكم الوحيد في من يبدأ أولًا
async function pvpHandleRacePress(){

    if(pvpState.raceResolvedLocally) return;

    let btn = document.getElementById("pvp-attack-button");
    if(btn) btn.onclick = null;

    let { data, error } =
    await supabaseClient
    .rpc("pvp_race_press", { p_token: pvpGetToken(), p_match_id: pvpState.matchId });

    if(pvpState.raceResolvedLocally) return;

    let statusBox = document.getElementById("pvp-status-message");

    if(error || data === "too_early"){
        // نادرًا ما تصل هنا (العقوبة محلية أصلًا)، لكن احتياطًا: أعد تفعيل الزر
        if(btn){ btn.onclick = () => pvpHandleRacePress(); }
        return;
    }

    pvpState.raceResolvedLocally = true;

    if(data === "won"){
        if(statusBox) statusBox.textContent = "🏆 لقد بدأت أنت أولاً!";
    } else {
        if(statusBox) statusBox.textContent = "⏳ الخصم كان أسرع! يبدأ هو أولاً";
    }

    collapseRaceButton("pvp");
}

// ========================================
// بعد ما المباراة تبقى شغالة: نعرض الشاشة ونبدأ نراقب الحالة
// (يبقى للتوافق: يُستخدم فقط في حال دخلنا مباشرة على مباراة نشطة بالفعل)
// ========================================
function pvpBeginMatchLoop(){
    ensureLogBox("pvp");
    renderPVPSkillButtons();
    pvpRefreshState(true);
    pvpAfterReadyPollStart();
}

// نجيب حالة المباراة الحالية ونحدّث الشاشة
async function pvpRefreshState(isFirstLoad){
    if(pvpState.finished) return;
    if(pvpState.isFetching) return;
    pvpState.isFetching = true;

    let { data, error } =
    await supabaseClient
    .rpc("pvp_get_match_state", { p_token: pvpGetToken(), p_match_id: pvpState.matchId })
    .single();

    if(error || !data) {
        pvpState.isFetching = false;
        return;
    }

    pvpState.isFetching = false;

    if(pvpState.isPlayer1 === null || pvpState.isPlayer1 === undefined){
        pvpState.isPlayer1 = (data.player1_id === (await pvpGetMyPlayerId()));
    }

    // لا نزال في مرحلة الاستعداد: حدّث فقط رسالة الانتظار (بدون لمس الأزرار/التصادم)
    if(data.status === "ready_wait"){
        pvpUpdateReadyStatusText(data);
        return;
    }

    // تحول الطرفان لمرحلة السباق: نشغّل واجهة السباق مرة واحدة فقط
    if(data.status === "race"){
        if(!pvpState.raceStarted){
            pvpState.raceStarted = true;
            pvpStartRacePhase();
        }
        return;
    }

    // إذا وصلنا هنا والحالة نشطة لكننا لم نحسم السباق محليًا (الخصم كان
    // أسرع مني بالضغط، أو ضغطتُ ولم يصل الرد بعد): نظّف واجهة السباق الآن
    if(pvpState.raceStarted && !pvpState.raceResolvedLocally){
        pvpState.raceResolvedLocally = true;
        collapseRaceButton("pvp");
        let statusBox = document.getElementById("pvp-status-message");
        let myTurnNow = (data.turn_player_id === (pvpState.isPlayer1 ? data.player1_id : data.player2_id));
        if(statusBox) statusBox.textContent = myTurnNow ? "🏆 لقد بدأت أنت أولاً!" : "⏳ الخصم كان أسرع! يبدأ هو أولاً";
    }

    let myHp, oppHp, myMaxHp, oppMaxHp, myName, oppName, myImage, oppImage;
    let myUsedIds, oppUsedIds, myTurnsTaken, myCooldownsRaw;
    let myFrozenTurns, oppFrozenTurns;
    let mySealedIds, oppSealedIds;

    // نلتقط القوائم القديمة (قبل هذا التحديث) لنكتشف لاحقًا هل استُخدمت
    // مهارة تجميد جديدة هذا الاستطلاع تحديدًا (لإظهار رسالة واضحة)
    let prevMyUsedIds = pvpState.myUsedSkillIds || [];
    let prevOppUsedIds = pvpState.oppUsedSkillIds || [];
    let prevMySealed = pvpState.mySealedSkillIds || [];
    let prevOppSealed = pvpState.oppSealedSkillIds || [];

    // نلتقط الـHP قبل هذا التحديث حتى نكتشف حصول ضرر فعلي هذا الاستطلاع
    // تحديدًا (وليس فقط عرض الرقم النهائي) — أول تحميل للمباراة undefined
    // عمدًا حتى لا نُظهر شارة "تعرضتَ لهجوم" خطأً عند مجرد فتح الشاشة
    let prevMyHp = pvpState.lastMyHp;
    let prevOppHp = pvpState.lastOppHp;

    if(pvpState.isPlayer1){
        myHp = data.player1_hp; oppHp = data.player2_hp;
        myMaxHp = data.player1_max_hp; oppMaxHp = data.player2_max_hp;
        myName = data.player1_char_name; oppName = data.player2_char_name;
        myImage = data.player1_char_image; oppImage = data.player2_char_image;
        myUsedIds = data.player1_used_skill_ids || [];
        oppUsedIds = data.player2_used_skill_ids || [];
        myTurnsTaken = data.player1_turns_taken || 0;
        myFrozenTurns = data.player1_frozen_turns || 0;
        oppFrozenTurns = data.player2_frozen_turns || 0;
        mySealedIds = data.player1_sealed_skill_ids || [];
        oppSealedIds = data.player2_sealed_skill_ids || [];
    } else {
        myHp = data.player2_hp; oppHp = data.player1_hp;
        myMaxHp = data.player2_max_hp; oppMaxHp = data.player1_max_hp;
        myName = data.player2_char_name; oppName = data.player1_char_name;
        myImage = data.player2_char_image; oppImage = data.player1_char_image;
        myUsedIds = data.player2_used_skill_ids || [];
        oppUsedIds = data.player1_used_skill_ids || [];
        myTurnsTaken = data.player2_turns_taken || 0;
        myFrozenTurns = data.player2_frozen_turns || 0;
        oppFrozenTurns = data.player1_frozen_turns || 0;
        mySealedIds = data.player2_sealed_skill_ids || [];
        oppSealedIds = data.player1_sealed_skill_ids || [];
    }

    setFighterImage(document.getElementById("pvp-player-image"), myImage);
    setFighterImage(document.getElementById("pvp-enemy-image"), oppImage);

    document.getElementById("pvp-player-name-battle").textContent = myName || "أنت";
    document.getElementById("pvp-enemy-name").textContent = oppName || "الخصم";

    updateHpDisplay("pvp-player", myHp, myMaxHp);
    updateHpDisplay("pvp-enemy", oppHp, oppMaxHp);

    // عند تفعيل عرض "السلاح" نحافظ على صورة/اسم السلاح بعد كل تحديث
    if(pvpWeaponView && pvpWeapon){
        if(pvpWeapon.image) setFighterImage(document.getElementById("pvp-player-image"), pvpWeapon.image);
        document.getElementById("pvp-player-name-battle").textContent = "⚔️ " + (pvpWeapon.name || "سلاح");
    }

    pvpRenderStatusBadges(data);

    pvpState.myUsedSkillIds = myUsedIds;
    pvpState.oppUsedSkillIds = oppUsedIds;
    pvpState.mySealedSkillIds = mySealedIds;
    pvpState.oppSealedSkillIds = oppSealedIds;
    pvpState.oppDefenseSkillIds = data.opponent_defense_skill_ids || [];
    pvpState.oppFirstSkillId = data.opponent_first_skill_id || null;
    pvpState.myTurnsTaken = myTurnsTaken;
    pvpState.lastMyHp = myHp;
    pvpState.lastOppHp = oppHp;

    pvpState.myCooldowns = {};
    (data.my_cooldowns || []).forEach(c => {
        pvpState.myCooldowns[c.skill_id] = {
            lastUsedTurn: c.last_used_turn,
            extraCooldown: c.extra_cooldown || 0
        };
    });

    await pvpEnsureSkillsCached([...myUsedIds, ...oppUsedIds, ...mySealedIds, ...oppSealedIds, ...(data.opponent_defense_skill_ids || [])]);
    pvpRenderUsedSkillsUI();

    let myTurn = (data.turn_player_id === (pvpState.isPlayer1 ? data.player1_id : data.player2_id));
    // allow using skills if it is my turn OR my hp is 0 and match is active
    pvpSetSkillsEnabled((myTurn || myHp <= 0) && data.status === "active");
    pvpApplySealedBadges();

    // شريط الجرع: متاح فقط في دوري، وحالته تُحدَّث عبر استعلام خفيف
    renderPvpPotionBar(myTurn && data.status === "active");

    pvpUpdateTurnTimer(data.status === "active" ? data.turn_deadline : null);

    if(!(myTurn && data.status === "active")){
        pvpCloseStealMenu();
        pvpCloseControlMenu();
        pvpCloseDelayMenu();
        pvpCloseShadowMenu();
    }

    // مؤشر تجميد بصري فوق صورة أي طرف لا يزال له أدوار متبقية من التجميد
    let playerImgEl = document.getElementById("pvp-player-image");
    let enemyImgEl = document.getElementById("pvp-enemy-image");
    if(playerImgEl) playerImgEl.classList.toggle("frozen-status", myFrozenTurns > 0);
    if(enemyImgEl) enemyImgEl.classList.toggle("frozen-status", oppFrozenTurns > 0);

    // هل استُخدمت مهارة تجميد جديدة هذا الاستطلاع تحديدًا؟ (للرسالة فقط،
    // بما أن عدّاد التجميد نفسه قد يعود لصفر فورًا لو كانت مدته دورًا واحدًا)
    let newOppSkillIds = oppUsedIds.filter(id => !prevOppUsedIds.includes(id));
    let newMySkillIds = myUsedIds.filter(id => !prevMyUsedIds.includes(id));
    let iGotFrozenNow = newOppSkillIds.some(id => pvpState.skillCache[id] && pvpState.skillCache[id].effect === "freeze");
    let iFrozeOppNow = newMySkillIds.some(id => pvpState.skillCache[id] && pvpState.skillCache[id].effect === "freeze");

    // هل استُخدمت مهارة "لا تُصد" (unblockable) تُلحق ضررًا هذا الاستطلاع
    // تحديدًا؟ (عندي أو عند الخصم) — نستخدمها لإظهار تأثير بصري مختلف
    // عن الضربة العادية حتى يعرف اللاعب فورًا أنه تعرّض لضربة لا تُصدّ
    let oppUnblockableNow = newOppSkillIds.some(id => pvpState.skillCache[id] && pvpState.skillCache[id].unblockable);
    let myUnblockableNow = newMySkillIds.some(id => pvpState.skillCache[id] && pvpState.skillCache[id].unblockable);

    // كشف أحداث الختم/فك الختم هذا الاستطلاع تحديدًا (بمقارنة قائمتي
    // المختوم عندي وعند الخصم بالقديمة): ختمُّ الخصم لي، ختمي للخصم،
    // أو فكّي للختم عن مهارتي المختومة
    let newMySealed = mySealedIds.filter(id => !prevMySealed.includes(id));
    let newOppSealed = oppSealedIds.filter(id => !prevOppSealed.includes(id));
    let freedMySealed = prevMySealed.filter(id => !mySealedIds.includes(id));
    let iGotSealedNow = newMySealed.length > 0;
    let iSealedOppNow = newOppSealed.length > 0;
    let iUnsealedNow = freedMySealed.length > 0;

    // هل استخدمتُ مهارة امتصاص (lifesteal) هذا الاستطلاع، وارتفعت صحتي
    // فعلاً؟ نعرض شارة شفاء مميزة بدل شارة الضربة العادية فقط
    let iUsedLifestealNow = newMySkillIds.some(id => pvpState.skillCache[id] && pvpState.skillCache[id].effect === "lifesteal");
    let lifestealHeal = (iUsedLifestealNow && prevMyHp !== undefined && myHp > prevMyHp) ? (myHp - prevMyHp) : 0;

    // كشف أحداث الانعكاس هذا الاستطلاع تحديدًا: مهارة انعكاس استُخدمت من أي
    // طرف — الانعكاس الآن ضربة مضادة فورية تعكس آخر هجوم عادي استقبله
    // مستخدمُها (يستردّ صحته ويرتدّ ضرر ذلك الهجوم على مصدره)، وليست حالة
    // دائمة تستهلكها الضربة القادمة كما كان سابقًا
    let iUsedReflectNow = newMySkillIds.some(id => pvpState.skillCache[id] && pvpState.skillCache[id].effect === "reflect");
    let iOppUsedReflectNow = newOppSkillIds.some(id => pvpState.skillCache[id] && pvpState.skillCache[id].effect === "reflect");

    let statusBox = document.getElementById("pvp-status-message");
    if(statusBox){
        if(data.status === "active"){
            statusBox.style.display = "block";
            statusBox.classList.remove("my-turn", "opp-turn", "frozen-note");
            if(iGotFrozenNow && !myTurn){
                statusBox.textContent = "🥶 تم تجميدك! الخصم يلعب دورًا إضافيًا";
                statusBox.classList.add("frozen-note");
            } else if(iFrozeOppNow && myTurn){
                statusBox.textContent = "🧊 جمّدت الخصم! العب دورك مجددًا";
                statusBox.classList.add("frozen-note");
            } else if(iGotSealedNow && !myTurn){
                statusBox.textContent = "🔒 الخصم ختم إحدى مهاراتك!";
                statusBox.classList.add("frozen-note");
            } else if(iSealedOppNow && myTurn){
                statusBox.textContent = "🔒 ختمتَ مهارة من مهارات الخصم!";
                statusBox.classList.add("frozen-note");
            } else if(iUnsealedNow && myTurn){
                statusBox.textContent = "🔓 فككتَ الختم عن مهارتك المختومة!";
                statusBox.classList.add("frozen-note");
            } else if(iUsedReflectNow){
                statusBox.textContent = "🔁 عكستَ الهجوم السابق على الخصم!";
                statusBox.classList.add("frozen-note");
            } else if(iOppUsedReflectNow){
                statusBox.textContent = "🔁 الخصم عكس هجومك السابق عليك!";
                statusBox.classList.add("frozen-note");
            } else if(myHp <= 0){
                statusBox.textContent = "⚠️ صحتك أصبحت صفرًا! يمكنك استخدام أي مهارة";
                statusBox.classList.add("frozen-note");
            } else {
                statusBox.textContent = myTurn ? "🟢 دورك الآن" : "⏳ دور الخصم...";
                statusBox.classList.add(myTurn ? "my-turn" : "opp-turn");
            }
        }
    }

    // شارة حدث المعركة في منتصف الساحة (نفس آلية PvE بالضبط): نستنتج ما
    // حدث فعليًا هذا الاستطلاع من مقارنة الحالة الجديدة بالقديمة — تجميد،
    // ثم ضرر فعلي، ثم صدّ (مهارة هجومية استُخدمت لكن لم يحصل ضرر بسببها،
    // أي امتصّها الدرع)، ثم استخدام دفاع. نعرض أول ما ينطبق فقط لكل استطلاع
    if(data.status === "active"){

        let newOppDealsDamageSkill = newOppSkillIds.some(id => {
            let s = pvpState.skillCache[id];
            return s && (s.type === "attack" || s.type === "special") && s.effect !== "freeze" && s.effect !== "reflect" && Number(s.damage) > 0;
        });
        let newMyDealsDamageSkill = newMySkillIds.some(id => {
            let s = pvpState.skillCache[id];
            return s && (s.type === "attack" || s.type === "special") && s.effect !== "freeze" && s.effect !== "reflect" && Number(s.damage) > 0;
        });
        let newOppDefenseSkill = newOppSkillIds.some(id => pvpState.skillCache[id] && pvpState.skillCache[id].type === "defense");
        let newMyDefenseSkill = newMySkillIds.some(id => pvpState.skillCache[id] && pvpState.skillCache[id].type === "defense");

        if(iGotFrozenNow){

            pvpAddBattleLog("🥶 تم تجميدك! الخصم يلعب دورًا إضافيًا");
            showBattleEffectBanner("pvp", "❄️ تم تجميدك!", "freeze");

        } else if(iFrozeOppNow){

            pvpAddBattleLog("🧊 جمّدتَ الخصم!");
            showBattleEffectBanner("pvp", "❄️ جمّدتَ الخصم!", "freeze");

        } else if(iGotSealedNow){

            pvpAddBattleLog("🔒 الخصم ختم إحدى مهاراتك حتى نهاية المباراة!");
            showBattleEffectBanner("pvp", "🔒 الخصم ختم مهارتك حتى نهاية المباراة!", "seal");

        } else if(iSealedOppNow){

            pvpAddBattleLog("🔒 ختمتَ مهارة من مهارات الخصم حتى نهاية المباراة!");
            showBattleEffectBanner("pvp", "🔒 ختمتَ مهارة الخصم حتى نهاية المباراة!", "seal");

        } else if(iUnsealedNow){

            pvpAddBattleLog("🔓 فككتَ الختم عن مهارتك المختومة!");
            showBattleEffectBanner("pvp", "🔓 فككتَ الختم عن مهارتك!", "unseal");

        } else if(lifestealHeal > 0){

            pvpAddBattleLog(`🩸 ضربة موفّقة وامتصصتَ ${lifestealHeal} صحة`);
            showBattleEffectBanner("pvp", `🩸 ضربة موفّقة وامتصصتَ ${lifestealHeal} صحة!`, "hit");

        } else if(iUsedReflectNow){

            let reflectedOnOpp = (prevOppHp !== undefined && oppHp < prevOppHp) ? (prevOppHp - oppHp) : 0;
            let restored = (prevMyHp !== undefined && myHp > prevMyHp) ? (myHp - prevMyHp) : 0;
            let msg = "🔁 عكستَ الهجوم السابق!";
            if(reflectedOnOpp > 0) msg += ` -${reflectedOnOpp} على الخصم`;
            if(restored > 0) msg += ` واسترجعت ${restored} صحة`;
            pvpAddBattleLog(msg);
            showBattleEffectBanner("pvp", msg, "reflect");

        } else if(iOppUsedReflectNow){

            // الخصم استخدم انعكاسًا عكسَ فيه آخر هجومٍ سابق استقبله (مني)،
            // فاسترجع هو صحته وخسرتُ أنا الصحة المرتدّة
            let took = (prevMyHp !== undefined && myHp < prevMyHp) ? (prevMyHp - myHp) : 0;
            let msg = "🔁 الخصم عكس هجومك السابق عليك!";
            if(took > 0) msg += ` -${took}`;
            pvpAddBattleLog(msg);
            showBattleEffectBanner("pvp", msg, "reflect");

        } else if(prevMyHp !== undefined && myHp < prevMyHp){

            if(myHp <= 0){
                pvpAddBattleLog("💀 ضربة قاتلة! صحتك أصبحت صفرًا، لكن يمكنك الاستمرار بأي مهارة");
                showBattleEffectBanner("pvp", "💀 ضربة قاتلة! صحتك أصبحت صفرًا", oppUnblockableNow ? "unblockable" : "hit");
            } else if(oppUnblockableNow){
                pvpAddBattleLog(`💥 ضربة لا تُصدّ عليك! -${prevMyHp - myHp}`);
                playHitEffect("pvp", true);
                showBattleEffectBanner("pvp", `💥 ضربة لا تُصدّ! -${prevMyHp - myHp}`, "unblockable");
            } else {
                pvpAddBattleLog(`💥 تعرّضتَ لهجوم! -${prevMyHp - myHp}`);
                showBattleEffectBanner("pvp", `💥 تعرّضتَ لهجوم! -${prevMyHp - myHp}`, "hit");
            }

        } else if(prevOppHp !== undefined && oppHp < prevOppHp){

            if(oppHp <= 0){
                pvpAddBattleLog("⚔️ ضربة قاتلة! لكن الخصم نجى — عليه الدفاع أو الانعكاس الآن");
                showBattleEffectBanner("pvp", "⚔️ ضربة قاتلة! لكن الخصم صَدّها!", myUnblockableNow ? "unblockable" : "hit");
            } else if(myUnblockableNow){
                pvpAddBattleLog(`⚔️ ضربة لا تُصدّ موفّقة! -${prevOppHp - oppHp} على الخصم`);
                playHitEffect("pvp", true);
                showBattleEffectBanner("pvp", `⚔️ ضربة لا تُصدّ! -${prevOppHp - oppHp}`, "unblockable");
            } else {
                pvpAddBattleLog(`⚔️ ضربة موفّقة! -${prevOppHp - oppHp} على الخصم`);
                showBattleEffectBanner("pvp", `⚔️ ضربة موفّقة! -${prevOppHp - oppHp}`, "hit");
            }

        } else if(newOppDealsDamageSkill && prevMyHp !== undefined && myHp >= prevMyHp){

            pvpAddBattleLog("🛡️ صددتَ هجوم الخصم!");
            showBattleEffectBanner("pvp", "🛡️ صددتَ هجوم الخصم!", "block");

        } else if(newMyDealsDamageSkill && prevOppHp !== undefined && oppHp >= prevOppHp){

            pvpAddBattleLog("🛡️ الخصم صدّ هجومك!");
            showBattleEffectBanner("pvp", "🛡️ الخصم صدّ هجومك!", "block");

        } else if(newOppDefenseSkill){

            pvpAddBattleLog("🛡️ الخصم استخدم الدفاع");
            showBattleEffectBanner("pvp", "🛡️ الخصم استخدم الدفاع!", "defense");

        } else if(newMyDefenseSkill){

            if(prevMyHp !== undefined && myHp > prevMyHp){
                let restored = myHp - prevMyHp;
                pvpAddBattleLog(`🛡️ صددتَ الضربة القاتلة بالدفاع واسترجعت ${restored} صحة!`);
                showBattleEffectBanner("pvp", `🛡️ صددتَ الضربة القاتلة بالدفاع! +${restored} صحة`, "defense");
            } else {
                pvpAddBattleLog("🛡️ استخدمتَ الدفاع");
                showBattleEffectBanner("pvp", "🛡️ استخدمتَ الدفاع!", "defense");
            }

        }

    }

    if(data.status === "finished"){
        pvpState.finished = true;
        pvpStopPolling();
        pvpStopTurnTimer();
        pvpCloseStealMenu();
        pvpCloseDelayMenu();
        pvpCloseShadowMenu();
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
// شارات الحالة فوق بطاقات المقاتلين (PvP): قوة مؤقتة / صحة مؤقتة /
// أدوار إضافية / درع انعكاس / درع امتصاص — من حقول pvp_get_match_state
// ========================================
function pvpRenderStatusBadges(data){
    let my = {}, opp = {};
    if(pvpState.isPlayer1){
        my = {
            tempAtk: data.player1_temp_atk || 0,
            extraTurns: data.player1_extra_turns || 0,
            reflectMult: data.player1_reflect_multiplier || 0,
            absorbHits: data.player1_absorb_hits || 0,
            shieldCharges: data.player1_shield_charges || 0,
            poisonDamage: data.player1_poison_damage || 0,
            poisonTurns: data.player1_poison_turns || 0
        };
        opp = {
            tempAtk: data.player2_temp_atk || 0,
            extraTurns: data.player2_extra_turns || 0,
            reflectMult: data.player2_reflect_multiplier || 0,
            absorbHits: data.player2_absorb_hits || 0,
            shieldCharges: data.player2_shield_charges || 0,
            poisonDamage: data.player2_poison_damage || 0,
            poisonTurns: data.player2_poison_turns || 0
        };
    } else {
        my = {
            tempAtk: data.player2_temp_atk || 0,
            extraTurns: data.player2_extra_turns || 0,
            reflectMult: data.player2_reflect_multiplier || 0,
            absorbHits: data.player2_absorb_hits || 0,
            shieldCharges: data.player2_shield_charges || 0,
            poisonDamage: data.player2_poison_damage || 0,
            poisonTurns: data.player2_poison_turns || 0
        };
        opp = {
            tempAtk: data.player1_temp_atk || 0,
            extraTurns: data.player1_extra_turns || 0,
            reflectMult: data.player1_reflect_multiplier || 0,
            absorbHits: data.player1_absorb_hits || 0,
            shieldCharges: data.player1_shield_charges || 0,
            poisonDamage: data.player1_poison_damage || 0,
            poisonTurns: data.player1_poison_turns || 0
        };
    }
    pvpRenderFighterStatusBadge("pvp-player", my);
    pvpRenderFighterStatusBadge("pvp-enemy", opp);
}

function pvpRenderFighterStatusBadge(idPrefix, fighter){
    let el = document.getElementById(idPrefix + "-status");
    if(!el) return;

    let badges = [];
    if((fighter.tempAtk || 0) > 0) badges.push("⚔️+" + fighter.tempAtk);
    if((fighter.extraTurns || 0) > 0) badges.push("⚡×" + fighter.extraTurns);
    if((fighter.reflectMult || 0) > 0) badges.push("🔁×" + fighter.reflectMult);
    if((fighter.absorbHits || 0) > 0) badges.push("🧲×" + fighter.absorbHits);
    if((fighter.shieldCharges || 0) > 0) badges.push("🛡️×" + fighter.shieldCharges);
    if((fighter.poisonDamage || 0) > 0 && (fighter.poisonTurns || 0) > 0)
        badges.push("☠️" + fighter.poisonDamage + "×" + fighter.poisonTurns);

    let key = badges.join("|");
    if(el.dataset.renderedKey === key) return;
    el.dataset.renderedKey = key;

    el.innerHTML = "";
    badges.forEach(b => {
        let span = document.createElement("span");
        span.className = "status-badge";
        span.textContent = b;
        el.appendChild(span);
    });
}

// ========================================
// عرض أزرار المهارات (تشمل السرقة/النسخ وشارات التهدئة)
// ========================================
function renderPVPSkillButtons(){

    let pagesEl = document.getElementById("pvp-player-skills-pages");
    if(!pagesEl) return;

    let container = pagesEl.closest(".skills-container");

    // وضع عرض "السلاح": نعرض مهارات السلاح وخلفياته بدل مهارات الشخصية
    if(pvpWeaponView && pvpWeapon){
        renderPvpWeaponSkillButtons(pagesEl, container);
        return;
    }

    // نحافظ على رقم الصفحة الحالية عبر إعادات الرسم المتكررة (تهدئة، دور...)
    let currentIndex = Number(pagesEl.dataset.activePage || 0);

    let usable = pvpState.mySkills;

    if(usable.length === 0){
        usable = [{id:"default_atk", name:"هجوم عادي", type:"attack", damage:100, cooldown:0, effect:null}];
    }

    let pagesOfSkills = chunkSkills(usable, SKILLS_PER_PAGE);

    currentIndex = Math.max(0, Math.min(currentIndex, pagesOfSkills.length - 1));

    pagesEl.innerHTML = "";

    pagesOfSkills.forEach((skillsChunk, i) => {

        let pageDiv = document.createElement("div");

        pageDiv.className = "skills-page" + (i === currentIndex ? " active" : "");

        // خلفية مخصصة لهذه الصفحة من لوحة الإدارة (إن وُجدت)
        let pageBg = getSkillPageBackground(pvpState.myCharacterId, i);

        if(pageBg){

            pageDiv.classList.add("skill-page-bg");

            pageDiv.style.backgroundImage = "url('" + pageBg.replace(/'/g, "\\'") + "')";

        }

        // حجم أزرار المهارات لهذه الصفحة (مقياس تُضبط من لوحة الإدارة)
        let pageScale = getSkillPageScale(pvpState.myCharacterId, i);

        if(pageScale > 0 && pageScale !== 1){

            pageDiv.style.setProperty("--skill-scale", pageScale);

        }

        skillsChunk.forEach(skill => {

            let btn = document.createElement("button");

            btn.innerHTML = `<span class="skill-name">${escapeHtml(skill.name)}</span>`;

            btn.dataset.skillId = skill.id;

            // لون اسم المهارة المخصص من لوحة الإدارة (إن وُجد)
            let skillColor = skill && skill.color;

            if(skillColor && /^#[0-9A-Fa-f]{6}$/.test(skillColor)){

                btn.querySelector(".skill-name").style.color = skillColor;

            }

            // الحد (stroke) المخصص لاسم المهارة من لوحة الإدارة
            let strokeColor = skill && skill.stroke_color;
            let strokeWidth = skill && skill.stroke_width;

            if(strokeWidth && strokeWidth > 0){

                let strokePx = Number(strokeWidth) || 0;
                let sColor = (strokeColor && /^#[0-9A-Fa-f]{6}$/.test(strokeColor)) ? strokeColor : '#000000';
                btn.querySelector(".skill-name").style.webkitTextStroke = strokePx + "px " + sColor;
                btn.querySelector(".skill-name").style.paintOrder = "stroke fill";

            }

            if(skill.effect === "steal" || skill.effect === "copy" || skill.effect === "control"){

                let emoji = skill.effect === "steal" ? " 🕵️" : (skill.effect === "copy" ? " 📋" : " 🎛️");

                btn.querySelector(".skill-name").textContent = skill.name + emoji;

                if(skill.effect === "copy"){

                    btn.onclick = () => pvpOpenStealMenu(skill, "copy");

                } else if(skill.effect === "steal"){

                    btn.onclick = () => pvpOpenStealMenu(skill, "steal");

                } else {

                    btn.onclick = () => pvpOpenControlMenu(skill);

                }

            } else if(skill.effect === "seal"){

                btn.querySelector(".skill-name").textContent =
                    skill.name + " 🔒";

                btn.disabled = false;

                btn.onclick = () => pvpOpenSealMenu(skill);

            } else if(skill.effect === "unseal"){

                btn.querySelector(".skill-name").textContent =
                    skill.name + " 🔓";

                btn.disabled = false;

                // يُرسل فعليًا إلى السيرفر عبر pvp_seal_or_unseal_skill
                // (فك الختم الحقيقي للمهارة المختومة) — القائمة تظهر مهاراتي المختومة
                btn.onclick = () => pvpOpenUnsealMenu(skill);

            } else if(skill.effect === "delay_cooldown"){

                btn.querySelector(".skill-name").textContent =
                    skill.name + " ⏳";

                btn.onclick = () => pvpOpenDelayMenu(skill);

            } else if(skill.effect === "shadow"){

                btn.querySelector(".skill-name").textContent =
                    skill.name + " 🌑";

                btn.onclick = () => pvpOpenShadowMenu(skill);

            } else {

                if(pvpIsNewBuffEffect(skill.effect)){

                    btn.querySelector(".skill-name").textContent =
                        skill.name + " ✨";

                } else if(skill.effect === "poison"){

                    btn.querySelector(".skill-name").textContent =
                        skill.name + " ☠️";

                }

                btn.onclick = () => pvpUseSkill(skill.id);

            }

            // المهارة المختومة تُعرض مقفلة بشارة 🔒 (الحماية الحقيقية على
            // السيرفر — pvp_use_skill يرفض أي مهارة في قائمة المختومة)
            if((pvpState.mySealedSkillIds || []).includes(skill.id)){

                btn.classList.add("skill-sealed");

                btn.classList.add("skill-locked");

                let badge = document.createElement("span");

                badge.className = "sealed-badge";

                badge.textContent = "🔒";

                btn.appendChild(badge);

            }

            attachSkillLongPress(btn, skill);

            pageDiv.appendChild(btn);

        });

        pagesEl.appendChild(pageDiv);

    });

    pagesEl.dataset.activePage = String(currentIndex);

    // النقاط أسفل الأزرار: نقطة واحدة لكل مجموعة من 4 مهارات
    let dotsEl = container ? container.querySelector(".skill-dots") : null;

    if(dotsEl){

        if(pagesOfSkills.length <= 1){

            dotsEl.style.display = "none";

        } else {

            dotsEl.style.display = "";

            dotsEl.innerHTML = "";

            pagesOfSkills.forEach((_, i) => {

                let dot = document.createElement("span");

                if(i === currentIndex) dot.classList.add("active");

                dot.onclick = () => goToSkillsPage("pvp", i);

                dotsEl.appendChild(dot);

            });

        }

    }

    // سحب اللمس للتنقل بين صفحات المهارات (مرة واحدة فقط لكل حاوية)
    if(!pagesEl.dataset.swipeBound){

        pagesEl.dataset.swipeBound = "1";

        let startX = null;

        pagesEl.addEventListener("touchstart", (e) => {

            startX = e.touches[0].clientX;

        }, { passive: true });

        pagesEl.addEventListener("touchend", (e) => {

            if(startX === null) return;

            let endX = e.changedTouches[0].clientX;

            let deltaX = endX - startX;

            startX = null;

            let SWIPE_THRESHOLD = 40;

            if(Math.abs(deltaX) < SWIPE_THRESHOLD) return;

            let pages = pagesEl.querySelectorAll(".skills-page");

            let active = Number(pagesEl.dataset.activePage || 0);

            if(deltaX < 0){

                // سحب لليسار → الصفحة التالية
                if(active < pages.length - 1) goToSkillsPage("pvp", active + 1);

            } else {

                // سحب لليمين → الصفحة السابقة
                if(active > 0) goToSkillsPage("pvp", active - 1);

            }

        }, { passive: true });

    }

    pvpApplyCooldownBadges();
}

// يحسب كم دورًا متبقيًا لتهدئة مهارة معيّنة بنفس معادلة السيرفر
// (pvp_skill_remaining_cd): التهدئة الأساسية + التهدئة الإضافية من
// مهارة تأجيل التهديدة، مطروحًا منها ما مر من أدوار هذا المقاتل نفسه
function pvpCooldownRemaining(skill){
    if(!skill.cooldown || skill.cooldown <= 0) return 0;

    let entry = pvpState.myCooldowns[skill.id];
    if(!entry || entry.lastUsedTurn === undefined || entry.lastUsedTurn === null) return 0;

    let remaining = skill.cooldown + (entry.extraCooldown || 0) - (pvpState.myTurnsTaken - entry.lastUsedTurn);
    return remaining > 0 ? remaining : 0;
}

function pvpApplyCooldownBadges(){
    let container = document.getElementById("pvp-player-skills-pages");
    if(!container) return;

    container.querySelectorAll("button[data-skill-id]").forEach(btn => {
        let skill = pvpState.skillCache[btn.dataset.skillId];
        if(!skill) return;

        let existingBadge = btn.querySelector(".cooldown-badge");
        if(existingBadge) existingBadge.remove();
        btn.classList.remove("on-cooldown");

        let remaining = pvpCooldownRemaining(skill);
        if(remaining > 0){
            btn.classList.add("on-cooldown");
            let badge = document.createElement("span");
            badge.className = "cooldown-badge";
            badge.textContent = remaining;
            btn.appendChild(badge);
        }
    });
}

// يحدّث شارة الختم 🔒 على أزرار المهارات دون إعادة بناء القائمة كلها —
// نفس نمط pvpApplyCooldownBadges تمامًا، لأنه لا يعاد بناء الأزرار مع كل
// استطلاع (الختم/فك الختم يحدثان أثناء المباراة بعد بناء الأزرار)
function pvpApplySealedBadges(){
    let container = document.getElementById("pvp-player-skills-pages");
    if(!container) return;

    container.querySelectorAll("button[data-skill-id]").forEach(btn => {
        let skill = pvpState.skillCache[btn.dataset.skillId];
        if(!skill) return;

        let existingBadge = btn.querySelector(".sealed-badge");
        if(existingBadge) existingBadge.remove();
        btn.classList.remove("skill-sealed");

        if((pvpState.mySealedSkillIds || []).includes(skill.id)){
            btn.classList.add("skill-sealed");
            btn.classList.add("skill-locked");
            let badge = document.createElement("span");
            badge.className = "sealed-badge";
            badge.textContent = "🔒";
            btn.appendChild(badge);
        }
    });
}

function pvpSetSkillsEnabled(enabled){
    let container = document.getElementById("pvp-player-skills-pages");
    if(!container) return;

    pvpApplyCooldownBadges();

    // نفس ملاحظة battle.js: لا نستخدم btn.disabled لأنها تمنع pointerdown
    // بالكامل فيصبح الضغط المطوّل لعرض وصف المهارة مستحيلاً وقت الانتظار
    // (دور الخصم أو التهدئة) — وهو بالضبط الوقت الذي يرغب فيه اللاعب
    // بمراجعة الوصف غالبًا. الحماية الفعلية موجودة أصلاً على السيرفر
    // (pvp_use_skill / pvp_steal_or_copy_skill يرفضان أي محاولة خارج دورك)
    container.querySelectorAll("button[data-skill-id]").forEach(btn => {
        let skill = pvpState.skillCache[btn.dataset.skillId];
        let onCooldown = skill ? pvpCooldownRemaining(skill) > 0 : false;
        let sealed = skill ? (pvpState.mySealedSkillIds || []).includes(skill.id) : false;
        btn.classList.toggle("skill-locked", !enabled || onCooldown || sealed);
    });

    // أزرار سلاح اللاعب: يُعطَّل وقت دور الخصم أو عند كسر السلاح
    let wBox = document.getElementById("pvp-weapon-box");
    if(wBox){
        let broken = pvpWeapon ? ((pvpWeapon.durability_current || 0) <= 0) : false;
        wBox.querySelectorAll(".weapon-skill-btn").forEach(btn => {
            btn.classList.toggle("skill-locked", !enabled || broken);
        });
    }
}

// ========================================
// استخدام مهارة عادية — كل الحساب الفعلي بيحصل في الدالة على السيرفر
// ========================================
async function pvpUseSkill(skillId){

    // مهارة الختم/فك الختم لا تُرسل أبدًا إلى pvp_use_skill (الخادم يرفضها
    // بخطأ "يجب استخدامها من قائمتها الخاصة")؛ تُفتح قائمتها بدلًا من ذلك
    let guardSkill = pvpState.skillCache[skillId];
    if(guardSkill && guardSkill.effect === "seal"){
        pvpOpenSealMenu(guardSkill);
        return;
    }
    if(guardSkill && guardSkill.effect === "unseal"){
        pvpOpenUnsealMenu(guardSkill);
        return;
    }

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
// سلاح اللاعب (PvP): زر بجانب مهاراتك، استخدامه ينقص المتانة ويستدعيه السيرفر
// ========================================
let pvpWeapon = null;
let pvpWeaponView = false;
let pvpWeaponBgs = {};

async function pvpLoadWeapon(){
    pvpWeapon = null;
    pvpWeaponView = false;
    let token = pvpGetToken();
    if(!token) return;
    try{
        let { data } = await supabaseClient.rpc("get_my_active_weapon", { p_token: token });
        if(data && data[0]) pvpWeapon = data[0];
    }catch(e){ pvpWeapon = null; }
    pvpRenderWeaponBox();
    renderPvpWeaponIcon();
    pvpSetSkillsEnabled(pvpState.myTurn);
}

function pvpRenderWeaponBox(){
    let container = document.querySelector('#pvp-battle-screen .player-card .skills-container') ||
                    (document.getElementById("pvp-player-skills-pages") || {}).closest ? (document.getElementById("pvp-player-skills-pages").closest(".skills-container")) : null;
    let existing = document.getElementById("pvp-weapon-box");
    if(existing) existing.remove();
    if(!container || !pvpWeapon) return;
    let w = pvpWeapon;
    let broken = (w.durability_current || 0) <= 0;
    let duce = (w.durability_current || 0) + " / " + (w.max_durability || 0);
    let skills = Array.isArray(w.skills) ? w.skills : [];
    let skillBtns = skills.map(s => `<button class="weapon-skill-btn" data-skill-id="${s.id}" style="--wcolor:${s.color || '#ffffff'};" ${broken?'disabled':''} onclick="pvpUseWeaponSkill('${s.id}')">${escapeHtml(s.name || 'مهارة')}</button>`).join("");
    let box = document.createElement("div");
    box.id = "pvp-weapon-box";
    box.className = "weapon-box";
    box.innerHTML = `
        <div class="weapon-header" style="--wcolor:${w.glow_color || '#e8b93f'};">
            ${w.image ? `<img class="weapon-image" src="${escapeHtml(w.image)}" alt="">` : `<span class="weapon-image weapon-image-ph">⚔️</span>`}
            <div class="weapon-meta">
                <div class="weapon-name">${escapeHtml(w.name || 'سلاح')}</div>
                <div class="weapon-duce" id="pvp-weapon-duce">${escapeHtml(broken ? "مكسور 💥" : duce)}</div>
            </div>
            <button class="weapon-toggle" onclick="togglePvpWeaponSkills()" title="إظهار/إخفاء مهارات السلاح">▶</button>
        </div>
        <div class="weapon-skills" id="pvp-weapon-skills">
            ${skillBtns.length ? skillBtns : '<div class="weapon-name">لا مهارات</div>'}
        </div>`;
    container.appendChild(box);
}

function togglePvpWeaponSkills(){
    let el = document.getElementById("pvp-weapon-skills");
    if(el) el.style.display = (el.style.display === 'none' ? 'block' : 'none');
}

// يرسم مهارات السلاح ضمن شريط مهارات اللاعب في وضع عرض "السلاح" (PvP)
function renderPvpWeaponSkillButtons(pagesEl, container){
    let skills = Array.isArray(pvpWeapon.skills) ? pvpWeapon.skills : [];
    let pagesOfSkills = chunkSkills(skills, SKILLS_PER_PAGE);
    let currentIndex = Number(pagesEl.dataset.activePage || 0);
    currentIndex = Math.max(0, Math.min(currentIndex, pagesOfSkills.length - 1));

    pagesEl.innerHTML = "";

    pagesOfSkills.forEach((skillsChunk, i) => {
        let pageDiv = document.createElement("div");
        pageDiv.className = "skills-page" + (i === currentIndex ? " active" : "");

        let bg = (pvpWeaponBgs || {})[i];
        if(bg && bg.url){
            pageDiv.classList.add("skill-page-bg");
            pageDiv.style.backgroundImage = "url('" + bg.url.replace(/'/g, "\\'") + "')";
        }
        if(bg && Number(bg.scale) > 0 && Number(bg.scale) !== 1){
            pageDiv.style.setProperty("--skill-scale", Number(bg.scale));
        }

        skillsChunk.forEach(skill => {
            let btn = document.createElement("button");
            btn.innerHTML = `<span class="skill-name">${escapeHtml(skill.name)}</span>`;
            let color = skill.color || '#ffffff';
            if(/^#[0-9A-Fa-f]{6}$/.test(color)) btn.querySelector(".skill-name").style.color = color;
            let sc = skill.stroke_color;
            let sw = skill.stroke_width;
            if(Number(sw) > 0){
                let sColor = (sc && /^#[0-9A-Fa-f]{6}$/.test(sc)) ? sc : '#000000';
                btn.querySelector(".skill-name").style.webkitTextStroke = (Number(sw)||0) + "px " + sColor;
                btn.querySelector(".skill-name").style.paintOrder = "stroke fill";
            }
            let broken = (pvpWeapon.durability_current || 0) <= 0;
            btn.disabled = broken;
            if(broken) btn.classList.add("skill-locked");

            if(skill.effect === "steal" || skill.effect === "copy" || skill.effect === "control"){
                let emoji = skill.effect === "steal" ? " 🕵️" : (skill.effect === "copy" ? " 📋" : " 🎛️");
                btn.querySelector(".skill-name").textContent = skill.name + emoji;
                if(skill.effect === "copy"){
                    btn.onclick = () => pvpOpenStealMenu(skill, "copy");
                } else if(skill.effect === "steal"){
                    btn.onclick = () => pvpOpenStealMenu(skill, "steal");
                } else {
                    btn.onclick = () => pvpOpenControlMenu(skill);
                }
            } else if(skill.effect === "seal"){
                btn.querySelector(".skill-name").textContent = skill.name + " 🔒";
                btn.onclick = () => pvpOpenSealMenu(skill);
            } else if(skill.effect === "unseal"){
                btn.querySelector(".skill-name").textContent = skill.name + " 🔓";
                btn.onclick = () => pvpOpenUnsealMenu(skill);
            } else if(skill.effect === "delay_cooldown"){
                btn.querySelector(".skill-name").textContent = skill.name + " ⏳";
                btn.onclick = () => pvpOpenDelayMenu(skill);
            } else if(skill.effect === "shadow"){
                btn.querySelector(".skill-name").textContent = skill.name + " 🌑";
                btn.onclick = () => pvpOpenShadowMenu(skill);
            } else {
                btn.onclick = () => pvpUseWeaponSkill(skill.id);
            }
            pageDiv.appendChild(btn);
        });

        pagesEl.appendChild(pageDiv);
    });

    pagesEl.dataset.activePage = String(currentIndex);

    let dotsEl = container ? container.querySelector(".skill-dots") : null;
    if(dotsEl){
        if(pagesOfSkills.length <= 1){
            dotsEl.style.display = "none";
        } else {
            dotsEl.style.display = "";
            dotsEl.innerHTML = "";
            pagesOfSkills.forEach((_, i) => {
                let dot = document.createElement("span");
                if(i === currentIndex) dot.classList.add("active");
                dot.onclick = () => goToSkillsPage("pvp", i);
                dotsEl.appendChild(dot);
            });
        }
    }
}

// أيقونة السلاح في معركة PvP: عند الضغط يتغير عرض البطاقة إلى السلاح
async function renderPvpWeaponIcon(){
    let icon = document.getElementById("pvp-weapon-icon");
    if(!icon) return;
    icon.style.display = "none";
    if(!pvpWeapon) return;

    try{
        let { data } = await supabaseClient.rpc("get_weapon_skill_page_backgrounds", { p_weapon_id: pvpWeapon.weapon_id });
        pvpWeaponBgs = {};
        (Array.isArray(data) ? data : []).forEach(row => {
            pvpWeaponBgs[row.page_index] = { url: row.image_url || "", scale: Number(row.skill_scale) > 0 ? Number(row.skill_scale) : 1 };
        });
    }catch(e){ pvpWeaponBgs = {}; }

    let inWeapon = !!pvpWeaponView;
    let myImg = pvpState.myCharImage || "";
    let imgSrc = inWeapon ? myImg : (pvpWeapon.image || "");
    icon.innerHTML = imgSrc
        ? `<img src="${escapeHtml(imgSrc)}" alt="">`
        : (inWeapon ? "🃏" : "⚔️");
    icon.style.display = "inline-flex";
}

function pvpToggleWeaponView(){
    if(!pvpWeapon) return;
    pvpWeaponView = !pvpWeaponView;

    if(pvpWeaponView){
        let box = document.getElementById("pvp-weapon-box");
        if(box) box.style.display = "none";
    } else {
        let box = document.getElementById("pvp-weapon-box");
        if(box) box.style.display = "";
    }

    renderPvpWeaponIcon();
    renderPVPSkillButtons();
    pvpRefreshState(false);
}

async function pvpUseWeaponSkill(skillId){
    pvpSetSkillsEnabled(false);
    let { data, error } = await supabaseClient.rpc("pvp_use_weapon_skill", {
        p_token: pvpGetToken(), p_match_id: pvpState.matchId, p_skill_id: skillId
    }).single();
    if(error){ alert(error.message || "تعذر تنفيذ الحركة"); pvpRefreshState(false); return; }
    if(pvpWeapon) pvpWeapon.durability_current = Math.max(0, (pvpWeapon.durability_current || 0) - 1);
    pvpRenderWeaponBox();
    if(pvpWeaponView) renderPVPSkillButtons();
    pvpRefreshState(false);
}

// ========================================
// الجرع في PvP: جرعة واحدة لكل دور دون استهلاك الدور — التفعيل موثوق
// من السيرفر (pvp_use_potion) الذي يخصم ويطبّق ويبقي دورك معك.
// ========================================

let pvpPotionCache = [];

async function pvpLoadMyPotions(){
    let token = pvpGetToken();
    if(!token) return [];
    try{
        let { data, error } = await supabaseClient.rpc("get_my_potions", { p_token: token });
        if(error) throw error;
        pvpPotionCache = Array.isArray(data) ? data : [];
    }catch(e){ return pvpPotionCache; }
    return pvpPotionCache;
}

function renderPvpPotionBar(enabled){
    let bar = document.getElementById("pvp-potion-bar");
    if(!bar) return;
    if(!pvpState.matchId || pvpState.finished){
        bar.innerHTML = "";
        return;
    }
    let potions = pvpPotionCache || [];
    if(potions.length === 0){
        // حمّل الجرع مرة واحدة في بداية النزال
        pvpLoadMyPotions().then(() => {
            if(pvpPotionCache.length) renderPvpPotionBarInternal(enabled);
        });
        return;
    }
    renderPvpPotionBarInternal(enabled);
}

function renderPvpPotionBarInternal(enabled){
    let bar = document.getElementById("pvp-potion-bar");
    if(!bar) return;
    let potions = pvpPotionCache || [];
    let color = p => (p.glow_color && /^#[0-9A-Fa-f]{6}$/.test(p.glow_color)) ? p.glow_color : "#22c55e";
    let img = p => p.image ? `<img src="${escapeHtml(p.image)}" alt="">` : `<span style="font-size:18px;">🧪</span>`;
    bar.innerHTML = potions.map(p => `
        <button class="potion-btn" style="--pcolor:${color(p)};" ${enabled ? "" : "disabled"} onclick="usePvpPotion('${p.potion_id}')" title="${escapeHtml(p.name || 'جرعة')}">
            ${img(p)}
            <span class="potion-qty">${p.quantity}</span>
        </button>`).join("");
}

async function usePvpPotion(potionId){
    let potion = (pvpPotionCache || []).find(p => String(p.potion_id) === String(potionId));
    // الجرعة بمهارة من نوع "اختيار هدف" (سرقة/نسخ/سيطرة/ختم/فك ختم/تأجيل/ظل)
    // تتصرف تمامًا كالمهارة الحقيقية: تفتح قائمة الأهداف ثم تنفّذ عبر RPC خاص.
    if(potion && potion.effect_skill_type && isPvpPotionPickerType(potion.effect_skill_type)){
        pvpOpenPotionPicker(potion);
        return;
    }
    let { data, error } = await supabaseClient.rpc("pvp_use_potion", {
        p_token: pvpGetToken(), p_match_id: pvpState.matchId, p_potion_id: potionId
    }).single();
    if(error){ alert(error.message || "تعذر استخدام الجرعة"); }
    await pvpLoadMyPotions();
    pvpRefreshState(false);
}

// أنواع جرع الاختيار (تحتاج هدفًا حقيقيًا مثل مهارات الاختيار العادية)
function isPvpPotionPickerType(t){
    return t === "steal" || t === "copy" || t === "control"
        || t === "seal" || t === "unseal" || t === "delay_cooldown" || t === "shadow";
}

// يبني مهارة صناعية من نوع الجرعة (مطابق لمنطق battle.js)
function pvpPotionSkillFields(typeChoice, value){
    switch(typeChoice){
        case "defense": return { type: "defense", effect: null, unblockable: false, params: { amount: value } };
        case "steal": return { type: "special", effect: "steal", unblockable: false, params: {} };
        case "copy": return { type: "special", effect: "copy", unblockable: false, params: {} };
        case "control": return { type: "special", effect: "control", unblockable: false, params: {} };
        case "unblockable": return { type: "special", effect: null, unblockable: true, params: { amount: value } };
        case "freeze": return { type: "special", effect: "freeze", unblockable: false, params: { amount: value } };
        case "lifesteal": return { type: "special", effect: "lifesteal", unblockable: false, params: { amount: value } };
        case "reflect": return { type: "special", effect: "reflect", unblockable: false, params: { reflect_mult: value || 1 } };
        case "unblockable_reflect": return { type: "special", effect: "reflect", unblockable: true, params: { reflect_mult: value || 1, unblockable_reflect: true } };
        case "seal": return { type: "special", effect: "seal", unblockable: false, params: {} };
        case "unseal": return { type: "special", effect: "unseal", unblockable: false, params: {} };
        case "consecutive_turns": return { type: "special", effect: "consecutive_turns", unblockable: false, params: { extra_turns: value || 1 } };
        case "absorb_atk": return { type: "special", effect: "absorb_atk", unblockable: false, params: { amount: value || 1 } };
        case "absorb_hp": return { type: "special", effect: "absorb_hp", unblockable: false, params: { amount: value || 1 } };
        case "hp_boost": return { type: "special", effect: "hp_boost", unblockable: false, params: { amount: value } };
        case "atk_boost": return { type: "special", effect: "atk_boost", unblockable: false, params: { amount: value } };
        case "poison": return { type: "special", effect: "poison", unblockable: false, params: { poison_damage: value, poison_turns: value } };
        case "delay_cooldown": return { type: "special", effect: "delay_cooldown", unblockable: false, params: { delay: value } };
        case "shadow": return { type: "special", effect: "shadow", unblockable: false, params: { shadow_list: [] } };
        default: return { type: "attack", effect: null, unblockable: false, params: { amount: value } };
    }
}

// يفتح قائمة الأهداف المناسبة لجرعة اختيار وفق نوعها
function pvpOpenPotionPicker(potion){
    let typeChoice = potion.effect_skill_type;
    let value = Number(potion.effect_value || 0);
    let skill = Object.assign({}, pvpPotionSkillFields(typeChoice, value), {
        id: "potion-skill-" + potion.potion_id,
        name: potion.name || "جرعة",
        damage: value,
        cooldown: 0
    });

    switch(typeChoice){
        case "steal": case "copy":
            pvpOpenPotionStealCopy(potion, skill, typeChoice);
            break;
        case "control":
            pvpOpenPotionControl(potion, skill);
            break;
        case "seal": case "unseal":
            pvpOpenPotionSealUnseal(potion, skill, typeChoice);
            break;
        case "delay_cooldown":
            pvpOpenPotionDelay(potion, skill);
            break;
        case "shadow":
            pvpOpenPotionShadow(potion, skill);
            break;
    }
}

function pvpClosePotionMenu(){
    let modal = document.getElementById("pvp-steal-modal");
    if(modal && modal.dataset.modalFor === "potion") modal.remove();
}

// جرعة سرقة/نسخ: نعرض مهارات الخصم القابلة للسرقة/النسخ
function pvpOpenPotionStealCopy(potion, abilitySkill, mode){
    pvpClosePotionMenu();
    let sourceIds = (mode === "steal")
        ? [...new Set([...(pvpState.oppRevealedSkillIds || []), ...(pvpState.oppUsedSkillIds || [])])]
        : (pvpState.oppUsedSkillIds || []);
    let candidates = sourceIds
        .map(id => pvpState.skillCache[id])
        .filter(s => s && !["steal","copy","control","shadow","delay_cooldown"].includes(s.effect));
    if(candidates.length === 0){
        alert(mode === "steal" ? "لا توجد مهارة خصم قابلة للسرقة الآن" : "لا توجد مهارة خصم قابلة للنسخ الآن");
        return;
    }
    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.dataset.modalFor = "potion";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>${mode === "steal" ? "🫳 جرعة — اختر مهارة خصم لسرقتها" : "📋 جرعة — اختر مهارة خصم لنسخها"}</h3>
            <div class="steal-options-list" id="pvp-steal-options-list"></div>
            <div class="steal-modal-buttons">
                <button id="pvp-steal-cancel-btn">إلغاء</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    let list = modal.querySelector("#pvp-steal-options-list");
    candidates.forEach(s => {
        let btn = document.createElement("button");
        btn.className = "steal-option";
        btn.textContent = s.name;
        btn.onclick = () => { pvpClosePotionMenu(); pvpUsePotionTarget(potion.potion_id, s.id); };
        list.appendChild(btn);
    });
    modal.querySelector("#pvp-steal-cancel-btn").onclick = pvpClosePotionMenu;
}

// جرعة سيطرة
function pvpOpenPotionControl(potion, abilitySkill){
    pvpClosePotionMenu();
    let sourceIds = [...new Set([...(pvpState.oppRevealedSkillIds || []), ...(pvpState.oppUsedSkillIds || [])])];
    let candidates = sourceIds
        .map(id => pvpState.skillCache[id])
        .filter(s => s && !["steal","copy","control","shadow","delay_cooldown"].includes(s.effect));
    if(candidates.length === 0){ alert("لا توجد مهارة خصم قابلة للسيطرة الآن"); return; }
    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.dataset.modalFor = "potion";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>🎛️ جرعة — اختر مهارة خصم للسيطرة عليها واستخدامها فورًا</h3>
            <div class="steal-options-list" id="pvp-steal-options-list"></div>
            <div class="steal-modal-buttons">
                <button id="pvp-steal-cancel-btn">إلغاء</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    let list = modal.querySelector("#pvp-steal-options-list");
    candidates.forEach(s => {
        let btn = document.createElement("button");
        btn.className = "steal-option";
        btn.textContent = s.name;
        btn.onclick = () => { pvpClosePotionMenu(); pvpUsePotionTarget(potion.potion_id, s.id); };
        list.appendChild(btn);
    });
    modal.querySelector("#pvp-steal-cancel-btn").onclick = pvpClosePotionMenu;
}

// جرعة ختم / فك ختم
function pvpOpenPotionSealUnseal(potion, abilitySkill, mode){
    pvpClosePotionMenu();
    let candidates;
    if(mode === "seal"){
        let ids = [...new Set([...(pvpState.oppUsedSkillIds || []), ...(pvpState.oppDefenseSkillIds || [])])];
        candidates = ids.map(id => pvpState.skillCache[id])
            .filter(s => s && !(pvpState.oppSealedSkillIds || []).includes(s.id));
    } else {
        candidates = (pvpState.mySealedSkillIds || []).map(id => pvpState.skillCache[id]).filter(s => s);
    }
    if(candidates.length === 0){
        alert(mode === "seal" ? "لا توجد مهارة خصم قابلة للختم الآن" : "لا توجد مهارة مختومة لديك لفك ختمها");
        return;
    }
    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.dataset.modalFor = "potion";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>${mode === "seal" ? "🔒 جرعة — اختر مهارة خصم لختمها" : "🔓 جرعة — اختر مهارتك المختومة لفك ختمها"}</h3>
            <div class="steal-options-list" id="pvp-steal-options-list"></div>
            <div class="steal-modal-buttons">
                <button id="pvp-steal-cancel-btn">إلغاء</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    let list = modal.querySelector("#pvp-steal-options-list");
    candidates.forEach(s => {
        let btn = document.createElement("button");
        btn.className = "steal-option";
        btn.textContent = s.name;
        btn.onclick = () => { pvpClosePotionMenu(); pvpUsePotionTarget(potion.potion_id, s.id); };
        list.appendChild(btn);
    });
    modal.querySelector("#pvp-steal-cancel-btn").onclick = pvpClosePotionMenu;
}

// جرعة تأجيل تهدئة
function pvpOpenPotionDelay(potion, abilitySkill){
    pvpClosePotionMenu();
    let ids = [...new Set([...(pvpState.oppUsedSkillIds || []), ...(pvpState.oppDefenseSkillIds || [])])];
    let candidates = ids.map(id => pvpState.skillCache[id])
        .filter(s => s && s.cooldown > 0 && !(pvpState.oppSealedSkillIds || []).includes(s.id));
    if(candidates.length === 0){ alert("لا توجد مهارة خصم لها تهدئة لتأجيلها الآن"); return; }
    let delay = Number(potion.effect_value || 1);
    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.dataset.modalFor = "potion";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>⏳ جرعة — أخّر تهدئة مهارة خصم (+${delay} ${delay === 1 ? "دور" : "أدوار"})</h3>
            <div class="steal-options-list" id="pvp-steal-options-list"></div>
            <div class="steal-modal-buttons">
                <button id="pvp-steal-cancel-btn">إلغاء</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    let list = modal.querySelector("#pvp-steal-options-list");
    candidates.forEach(s => {
        let btn = document.createElement("button");
        btn.className = "steal-option";
        btn.textContent = s.name;
        btn.onclick = () => { pvpClosePotionMenu(); pvpUsePotionTarget(potion.potion_id, s.id); };
        list.appendChild(btn);
    });
    modal.querySelector("#pvp-steal-cancel-btn").onclick = pvpClosePotionMenu;
}

// تنفيذ جرعة اختيار عبر RPC pvp_use_potion_target
async function pvpUsePotionTarget(potionId, targetSkillId){
    pvpSetSkillsEnabled(false);
    let { data, error } = await supabaseClient
        .rpc("pvp_use_potion_target", {
            p_token: pvpGetToken(), p_match_id: pvpState.matchId,
            p_potion_id: potionId, p_target_skill_id: targetSkillId
        }).single();
    if(error){ alert(error.message || "تعذر تنفيذ حركة الجرعة"); pvpRefreshState(false); return; }
    await pvpLoadMyPotions();
    pvpRefreshState(false);
}

// جرعة ظل: تفتح قائمة الظل ثم مهارات الشخصية (نفس سير pvpOpenShadowMenu)
async function pvpOpenPotionShadow(potion, abilitySkill){
    pvpClosePotionMenu();
    let { data, error } = await supabaseClient
        .rpc("pvp_list_shadow_pool", { p_token: pvpGetToken(), p_self_character_id: pvpState.myCharacterId || null });
    if(error || !data){ alert(error ? (error.message || "تعذر جلب قائمة الظل") : "قائمة الظل فارغة"); return; }
    let chars = {};
    data.forEach(row => {
        if(!chars[row.character_id]){
            chars[row.character_id] = { id: row.character_id, name: row.character_name || "وحش", image: row.identity_image || "", skills: [] };
        }
        if(row.skill_id){
            chars[row.character_id].skills.push({
                id: row.skill_id, name: row.skill_name, type: row.skill_type,
                damage: row.skill_damage, cooldown: row.skill_cooldown, effect: row.skill_effect,
                unblockable: row.skill_unblockable, color: row.skill_color,
                description: row.skill_description, params: row.skill_params
            });
        }
    });
    let charList = Object.values(chars);
    let listHtml = charList.length > 0
        ? charList.map(c => `<button class="steal-option shadow-char-option" data-id="${escapeHtml(String(c.id))}">🌑 ${escapeHtml(c.name)}</button>`).join("")
        : "<p>لا توجد شخصيات مؤهلة في قائمة الظل حاليًا</p>";
    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.dataset.modalFor = "potion";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>🌑 جرعة — استدعِ ظل شخصية واستخدم إحدى مهاراته</h3>
            <div class="steal-options-list">${listHtml}</div>
            <div class="steal-modal-buttons">
                <button id="pvp-steal-cancel-btn">إلغاء</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll(".shadow-char-option").forEach(btn => {
        btn.onclick = () => {
            let charId = btn.dataset.id;
            let charEntry = chars[charId];
            pvpClosePotionMenu();
            pvpOpenPotionShadowSkill(potion, charEntry);
        };
    });
    modal.querySelector("#pvp-steal-cancel-btn").onclick = pvpClosePotionMenu;
}

function pvpOpenPotionShadowSkill(potion, charEntry){
    if(!charEntry) return;
    let usable = charEntry.skills || [];
    let listHtml = usable.length > 0
        ? usable.map(s => `<button class="steal-option shadow-skill-option" data-id="${escapeHtml(String(s.id))}">${escapeHtml(s.name)}</button>`).join("")
        : "<p>لا توجد مهارة صالحة في هذا الظل</p>";
    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.dataset.modalFor = "potion";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>🌑 جرعة — استخدم مهارة من ظل "${escapeHtml(charEntry.name)}"</h3>
            <div class="steal-options-list">${listHtml}</div>
            <div class="steal-modal-buttons">
                <button id="pvp-steal-cancel-btn">إلغاء</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll(".shadow-skill-option").forEach(btn => {
        btn.onclick = () => {
            let skillId = btn.dataset.id;
            pvpClosePotionMenu();
            pvpUsePotionShadow(potion.potion_id, charEntry.id, skillId);
        };
    });
    modal.querySelector("#pvp-steal-cancel-btn").onclick = pvpClosePotionMenu;
}

// تنفيذ جرعة ظل عبر RPC pvp_use_potion_shadow
async function pvpUsePotionShadow(potionId, charId, skillId){
    pvpSetSkillsEnabled(false);
    let { data, error } = await supabaseClient
        .rpc("pvp_use_potion_shadow", {
            p_token: pvpGetToken(), p_match_id: pvpState.matchId,
            p_potion_id: potionId, p_character_id: charId, p_skill_id: skillId
        }).single();
    if(error){ alert(error.message || "تعذر تنفيذ حركة الجرعة"); pvpRefreshState(false); return; }
    await pvpLoadMyPotions();
    pvpRefreshState(false);
}

// ========================================
// جلب بيانات المهارات (الاسم/effect/damage/cooldown) للمهارات التي لم
// تُخزَّن بعد، حتى نعرض أسماءها وشارات تهدئتها. بيانات المهارات عامة
// وللقراءة فقط (نفس مبدأ GameCache)، لذا آمن طلبها.
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

    // نتفادى إعادة بناء الشرائح إذا لم تتغيّر قائمة المعرّفات فعليًا منذ
    // آخر رسم — إعادة البناء غير المشروطة (innerHTML="" في كل استطلاع كل
    // 1.2 ثانية) كانت تُزيل العنصر الذي يضغط عليه اللاعب مطوّلاً من الـ DOM
    // أثناء الضغط نفسه، فيُطلق المتصفح pointercancel ويُلغي المؤقّت قبل
    // أن يصل لل500ms المطلوبة لعرض الوصف — وهذا كان يجعل الضغط المطوّل
    // يبدو معطّلاً تمامًا على مهارات الخصم رغم أن الكود صحيح
    let renderInto = (containerId, ids, cacheKey, sealedIds) => {
        let box = document.getElementById(containerId);
        if(!box) return;

        sealedIds = sealedIds || [];

        let key = ids.map(id => id + (sealedIds.includes(id) ? ":S" : "")).join(",");
        if(box.dataset[cacheKey] === key) return;
        box.dataset[cacheKey] = key;

        box.innerHTML = "";

        ids.forEach(id => {
            let s = pvpState.skillCache[id];
            if(!s) return;

            let sealed = sealedIds.includes(id);

            let chip = document.createElement("span");
            chip.className = "used-skill-chip" + (sealed ? " sealed" : "");
            chip.textContent = s.name + (sealed ? " 🔒" : "");
            attachSkillLongPress(chip, s);
            box.appendChild(chip);
        });
    };

    renderInto("pvp-player-used-skills", pvpState.myUsedSkillIds, "renderedIds", pvpState.mySealedSkillIds);

    // نعرض تحت بطاقة الخصم كل ما استخدمه ضدك في هذه المباراة فقط (نفس ما
    // يُتاح للسرقة/النسخ) — الضغط المطوّل على أي منها يعرض وصفها وتأثيرها
    // تمامًا كمهاراتك أنت. لا شيء من مباراة سابقة يظهر هنا: كل مباراة تبدأ
    // نظيفة ولا يمكن سرقة/نسخ إلا ما استخدمه الخصم في هذه المباراة تحديدًا
    let oppIds = [...new Set(pvpState.oppUsedSkillIds)];
    renderInto("pvp-enemy-used-skills", oppIds, "renderedIds", pvpState.oppSealedSkillIds);
}

// سجل أحداث PvP — نفس آلية addBattleLog في PvE، يكتب سطرًا في صندوق السجل
// (#pvp-battle-log الذي ينشئه ensureLogBox) ويُمرِّره لأسفل تلقائيًا
function pvpAddBattleLog(text){
    let box = document.getElementById("pvp-battle-log");
    if(!box) return;
    let line = document.createElement("div");
    line.textContent = text;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
}

// ========================================
// قائمة السرقة/النسخ: نعرض فقط المهارات التي استخدمها الخصم بالفعل
// في هذه المباراة (نفس ما تتحقق منه دالة السيرفر pvp_steal_or_copy_skill)
// ========================================
function pvpOpenStealMenu(abilitySkill, mode){

    pvpCloseStealMenu();

    mode = mode || abilitySkill.effect;

    // السرقة تعرض أي مهارة كشفها الخصم في نزال سابق (cross-battle) أو هذه
    // المباراة؛ النسخ يعرض فقط مهارات استخدمها الخصم في هذه المباراة بالذات
    let sourceIds = (mode === "steal")
        ? [...new Set([...pvpState.oppRevealedSkillIds, ...pvpState.oppUsedSkillIds])]
        : pvpState.oppUsedSkillIds;

    let candidates = sourceIds
    .map(id => pvpState.skillCache[id])
    .filter(s => s && s.effect !== "steal" && s.effect !== "copy" && s.effect !== "control");

    if(candidates.length === 0){
        alert(mode === "steal"
            ? "لم يكشف الخصم أي مهارة قابلة للسرقة بعد في أي نزال"
            : "لم يستخدم الخصم أي مهارة قابلة للنسخ بعد في هذه المباراة");
        return;
    }

    pvpState.stealMenuOpen = true;

    let verb = mode === "steal" ? "سرقة" : "نسخ";

    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>${mode === "steal" ? "🕵️" : "📋"} اختر مهارة الخصم لتُ${verb === "سرقة" ? "سرق" : "نسخ"}ها</h3>
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
// قائمة التحكم (السيطرة): تشبه السرقة لكن المهارة المُسيطر عليها تدخل في
// تهدئة عند اللاعب بعد استخدامها (فرق جوهري). تُعرض مهارات كشفها الخصم
// في أي نزال سابق (cross-battle) أو هذه المباراة. الحساب الفعلي على السيرفر
// عبر pvp_control_skill.
// ========================================
function pvpOpenControlMenu(abilitySkill){

    pvpCloseControlMenu();

    let sourceIds = [...new Set([...pvpState.oppRevealedSkillIds, ...pvpState.oppUsedSkillIds])];

    let candidates = sourceIds
    .map(id => pvpState.skillCache[id])
    .filter(s => s && s.effect !== "steal" && s.effect !== "copy" && s.effect !== "control");

    if(candidates.length === 0){
        alert("لم يكشف الخصم أي مهارة قابلة للتحكم بعد في أي نزال");
        return;
    }

    let modal = document.createElement("div");
    modal.id = "pvp-control-modal";
    modal.className = "steal-modal";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>🎛️ اختر مهارة الخصم لتسيطر عليها وتستخدمها (ستدخل في التهدئة)</h3>
            <div class="steal-options-list" id="pvp-control-options-list"></div>
            <div class="steal-modal-buttons">
                <button id="pvp-control-cancel-btn">إلغاء</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    let list = modal.querySelector("#pvp-control-options-list");
    candidates.forEach(skill => {
        let btn = document.createElement("button");
        btn.className = "steal-option";
        btn.textContent = skill.name;
        btn.onclick = () => {
            pvpCloseControlMenu();
            pvpUseControl(abilitySkill.id, skill.id);
        };
        list.appendChild(btn);
    });

    modal.querySelector("#pvp-control-cancel-btn").onclick = pvpCloseControlMenu;
}

function pvpCloseControlMenu(){
    let modal = document.getElementById("pvp-control-modal");
    if(modal) modal.remove();
}

// تنفيذ التحكم — كل الحساب الحاسم على السيرفر عبر pvp_control_skill
async function pvpUseControl(abilitySkillId, targetSkillId){

    pvpSetSkillsEnabled(false);

    let { data, error } =
    await supabaseClient
    .rpc("pvp_control_skill", {
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
// قائمة الختم: نعرض فقط المهارات التي استخدمها الخصم في هذه المباراة
// وغير المختومة مسبقًا (نفس ما تتحقق منه دالة السيرفر)
// ========================================
function pvpCloseSealMenu(){
    let modal = document.getElementById("pvp-steal-modal");
    if(modal) modal.remove();
}

// ========================================
function pvpOpenSealMenu(abilitySkill){

    pvpCloseSealMenu();

    // المهارة الأولى للخصم (slot 1) محمية من الختم: نُبقيها ظاهرة في القائمة
    // لكن معطّلة، حتى يرى اللاعب كل المهارات التي استخدمها الخصم مع إدراك
    // أن الأولى لا يمكن ختمها (الخادم يرفضها أيضًا كطبقة حماية إضافية)
    let firstSkillId = pvpState.oppFirstSkillId;

    let usedCandidates = pvpState.oppUsedSkillIds
    .map(id => pvpState.skillCache[id])
    .filter(s => s && !(pvpState.oppSealedSkillIds || []).includes(s.id));

    // دفاع الخصم مهارة أساسية: يبقى خيارًا للختم دائمًا حتى لو لم يستخدمه
    // في هذه المباراة بعد (مطابقة لمنطق الخادم pvp_seal_or_unseal_skill)
    let defenseCandidates = (pvpState.oppDefenseSkillIds || [])
    .map(id => pvpState.skillCache[id])
    .filter(s => s && !(pvpState.oppSealedSkillIds || []).includes(s.id));

    let candidates = [];
    let seenIds = {};
    [usedCandidates, defenseCandidates].forEach(list => {
        list.forEach(s => {
            if(!seenIds[s.id]){
                seenIds[s.id] = true;
                candidates.push(s);
            }
        });
    });

    if(candidates.length === 0){
        alert("لا توجد مهارة قابلة للختم الآن (الخصم لم يستخدم أي مهارة غير مختومة في هذه المباراة)");
        return;
    }

    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>🔒 اختر مهارة الخصم لتختمها حتى نهاية المباراة</h3>
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
        let isProtected = !!(firstSkillId && skill.id === firstSkillId);
        btn.className = isProtected ? "steal-option pvp-protected-skill" : "steal-option";
        btn.textContent = isProtected ? `${skill.name} (المهارة الأولى — محمية)` : skill.name;
        if(isProtected){
            btn.disabled = true;
        }else{
            btn.onclick = () => {
                pvpCloseSealMenu();
                pvpUseSealOrUnseal(abilitySkill.id, skill.id);
            };
        }
        list.appendChild(btn);
    });

    modal.querySelector("#pvp-steal-cancel-btn").onclick = pvpCloseSealMenu;
}

// ========================================
// قائمة فك الختم: نعرض مهاراتي المختومة لاختيار ما يُفك ختمه
// ========================================
function pvpOpenUnsealMenu(abilitySkill){

    pvpCloseSealMenu();

    let candidates = (pvpState.mySealedSkillIds || [])
    .map(id => pvpState.skillCache[id])
    .filter(s => s);

    if(candidates.length === 0){
        alert("لا توجد أي مهارة مختومة لديك لفك ختمها");
        return;
    }

    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>🔓 اختر مهارة من مهاراتك المختومة لفك ختمها</h3>
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
            pvpCloseSealMenu();
            pvpUseSealOrUnseal(abilitySkill.id, skill.id);
        };
        list.appendChild(btn);
    });

    modal.querySelector("#pvp-steal-cancel-btn").onclick = pvpCloseSealMenu;
}

// ========================================
// تنفيذ الختم/فك الختم — كل التحقق الفعلي (هل المهارة مملوكة، هل الدور
// دورنا، هل المهارة قابلة للختم/مختومة...) يحصل على السيرفر
// ========================================
async function pvpUseSealOrUnseal(abilitySkillId, targetSkillId){

    pvpSetSkillsEnabled(false);

    let { data, error } =
    await supabaseClient
    .rpc("pvp_seal_or_unseal_skill", {
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

// هل هذا الأثر من مفاعيل الأنواع الجديدة (تأثير ذاتي يستهلك الدور)؟ نفس
// منطق isNewBuffEffect في battle.js — تُنفَّذ عبر pvp_use_skill مباشرة
function pvpIsNewBuffEffect(effect){
    return effect === "consecutive_turns"
        || effect === "absorb_atk"
        || effect === "absorb_hp"
        || effect === "hp_boost"
        || effect === "atk_boost";
}

// قيمة مفعول مهارة: تُقرأ من skill.params (إن وُجدت) وإلا من رقم المهارة
// نفسه (skill.damage) كمقابل احتياطي — مطابق لمنطق السيرفر
function pvpSkillParamAmount(skill, key, fallback){
    let p = skill && skill.params;
    if(p && p[key] !== undefined && p[key] !== null && p[key] !== ""){
        let v = Number(p[key]);
        if(!isNaN(v)) return v;
    }
    let fb = Number(fallback);
    if(!isNaN(fb)) return fb;
    return 1;
}

// ========================================
// قائمة تأجيل التهدئة: نعرض مهارات الخصم المعروفة لدينا (ما استخدمه في
// هذه المباراة + دفاعه) التي لها تهدئة وغير مختومة — السيرفر يتحقق فعليًا
// من ملكية الخصم للمهارة المستهدفة
// ========================================
function pvpOpenDelayMenu(abilitySkill){

    pvpCloseDelayMenu();

    let knownIds = [...new Set([...(pvpState.oppUsedSkillIds || []), ...(pvpState.oppDefenseSkillIds || [])])];

    let candidates = knownIds
    .map(id => pvpState.skillCache[id])
    .filter(s => s && s.cooldown > 0 && !(pvpState.oppSealedSkillIds || []).includes(s.id));

    if(candidates.length === 0){
        alert("لا توجد مهارة خصم معروفة لها تهدئة لتأجيلها الآن");
        return;
    }

    let delayTurns = pvpSkillParamAmount(abilitySkill, "turns", abilitySkill.damage);

    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.dataset.modalFor = "delay";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>⏳ أخّر تهدئة مهارة الخصم (+${delayTurns} ${delayTurns === 1 ? "دور" : "أدوار"})</h3>
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
            pvpCloseDelayMenu();
            pvpUseDelaySkill(abilitySkill.id, skill.id);
        };
        list.appendChild(btn);
    });

    modal.querySelector("#pvp-steal-cancel-btn").onclick = pvpCloseDelayMenu;
}

function pvpCloseDelayMenu(){
    let modal = document.getElementById("pvp-steal-modal");
    if(modal && modal.dataset.modalFor === "delay") modal.remove();
}

// ========================================
// تنفيذ تأجيل التهدئة — التحقق الفعلي (الملكية، الدور، الحالة النشطة...)
// كله على السيرفر عبر pvp_delay_cooldown
// ========================================
async function pvpUseDelaySkill(abilitySkillId, targetSkillId){

    pvpSetSkillsEnabled(false);

    let { data, error } =
    await supabaseClient
    .rpc("pvp_delay_cooldown", {
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

async function pvpFetchCustomShadowCharacters(charIds){
    if(!charIds || charIds.length === 0) return [];
    let selfId = pvpState.myCharacterId || null;
    let filtered = charIds.filter(id => String(id) !== String(selfId));
    if(filtered.length === 0) return [];

    try {
        let {data: chars, error: charsErr} = await supabaseClient
            .from("characters")
            .select("id, name, identity_image")
            .in("id", filtered);
        if(charsErr || !chars) return [];

        let {data: skills, error: skillsErr} = await supabaseClient
            .from("character_skills")
            .select(`
                character_id,
                skill_id,
                skills (*)
            `)
            .in("character_id", filtered);
        if(skillsErr) skills = [];

        let skillMap = {};
        (skills || []).forEach(s => {
            let sk = s.skills;
            if(!sk) return;
            if(!skillMap[s.character_id]) skillMap[s.character_id] = [];
            skillMap[s.character_id].push({
                id: s.skill_id,
                name: sk.name,
                type: sk.type,
                damage: sk.damage,
                cooldown: sk.cooldown,
                effect: sk.effect,
                unblockable: sk.unblockable,
                color: sk.color,
                description: sk.description,
                params: sk.params
            });
        });

        return chars.map(c => ({
            id: c.id,
            name: c.name || "ظل",
            image: c.identity_image || "",
            skills: skillMap[c.id] || [],
            isCustomShadow: true
        }));
    } catch(e){
        console.error("pvpFetchCustomShadowCharacters failed", e);
        return [];
    }
}

// ========================================
// قائمة الظل (PvP): نعرض الشخصيات المؤهلة من shadow_eligible_characters
// (عبر pvp_list_shadow_pool) ثم مهارات الشخصية المختارة
// ========================================
async function pvpOpenShadowMenu(abilitySkill){

    pvpCloseShadowMenu();

    let { data, error } =
    await supabaseClient
    .rpc("pvp_list_shadow_pool", { p_token: pvpGetToken(), p_self_character_id: pvpState.myCharacterId || null });

    if(error || !data){
        alert(error ? (error.message || "تعذر جلب قائمة الظل") : "قائمة الظل فارغة");
        return;
    }

    // البيانات تأتي صفًا واحدًا لكل مهارة — نجمعها حسب الشخصية
    let chars = {};
    data.forEach(row => {
        if(!chars[row.character_id]){
            chars[row.character_id] = {
                id: row.character_id,
                name: row.character_name || "وحش",
                image: row.identity_image || "",
                skills: []
            };
        }
        if(row.skill_id){
            chars[row.character_id].skills.push({
                id: row.skill_id,
                name: row.skill_name,
                type: row.skill_type,
                damage: row.skill_damage,
                cooldown: row.skill_cooldown,
                effect: row.skill_effect,
                unblockable: row.skill_unblockable,
                color: row.skill_color,
                description: row.skill_description,
                params: row.skill_params
            });
        }
    });

    let charList = Object.values(chars);

    // دمج القائمة المخصصة مع المهزومة
    let customIds = (abilitySkill.params && Array.isArray(abilitySkill.params.shadow_list)) ? abilitySkill.params.shadow_list : [];
    if(customIds.length > 0){
        let customChars = await pvpFetchCustomShadowCharacters(customIds);
        customChars.forEach(c => { chars[String(c.id)] = c; });
        let customIdsSet = new Set(customChars.map(c => String(c.id)));
        let defeatedOnly = charList.filter(c => !customIdsSet.has(String(c.id)));
        charList = [...customChars, ...defeatedOnly];
    }

    let listHtml = charList.length > 0
    ? charList
        .map(c => `<button class="steal-option shadow-char-option" data-id="${escapeHtml(String(c.id))}">🌑 ${escapeHtml(c.name)}</button>`)
        .join("")
    : "<p>لا توجد شخصيات مؤهلة في قائمة الظل حاليًا</p>";

    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.dataset.modalFor = "shadow";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>🌑 استدعِ ظل شخصية واستخدم إحدى مهاراته</h3>
            <div class="steal-options-list">${listHtml}</div>
            <div class="steal-modal-buttons">
                <button id="pvp-steal-cancel-btn">إلغاء</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    modal.querySelectorAll(".shadow-char-option").forEach(btn => {
        btn.onclick = () => {
            let charId = btn.dataset.id;
            pvpCloseShadowMenu();
            pvpOpenShadowSkillMenu(abilitySkill, charId, chars[charId]);
        };
    });

    modal.querySelector("#pvp-steal-cancel-btn").onclick = pvpCloseShadowMenu;
}

function pvpOpenShadowSkillMenu(abilitySkill, charId, charEntry){

    if(!charEntry) return;

    let usable = charEntry.skills || [];

    let listHtml = usable.length > 0
    ? usable
        .map(s => `<button class="steal-option shadow-skill-option" data-id="${escapeHtml(String(s.id))}">${escapeHtml(s.name)}</button>`)
        .join("")
    : "<p>لا توجد مهارة صالحة في هذا الظل</p>";

    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.dataset.modalFor = "shadow";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>🌑 استخدم مهارة من ظل "${escapeHtml(charEntry.name)}"</h3>
            <div class="steal-options-list">${listHtml}</div>
            <div class="steal-modal-buttons">
                <button id="pvp-steal-cancel-btn">إلغاء</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    modal.querySelectorAll(".shadow-skill-option").forEach(btn => {
        btn.onclick = () => {
            let skillId = btn.dataset.id;
            let skill = charEntry.skills.find(s => String(s.id) === String(skillId));
            let effect = skill && skill.effect;
            if(effect === "steal" || effect === "copy" || effect === "control"
               || effect === "seal" || effect === "unseal" || effect === "delay_cooldown"){
                pvpCloseShadowMenu();
                pvpOpenShadowTargetMenu(abilitySkill.id, skill);
            } else {
                pvpCloseShadowMenu();
                pvpUseShadowSkill(abilitySkill.id, charId, skillId);
            }
        };
    });

    modal.querySelector("#pvp-steal-cancel-btn").onclick = pvpCloseShadowMenu;
}

// ========================================
// المهارات الظلية التي تحتاج هدفًا (سرقة/نسخ/تحكم/ختم/فك ختم/تأجيل) تفتح
// قائمة أهداف مناسبة ثم تستدعي الدالة المختصة على السيرفر (نفس دوال المهارات
// العادية) — السيرفر يتقبل الآن مهارة من مخزون الظل كمصدر للمهارة
// ========================================
function pvpOpenShadowTargetMenu(abilitySkillId, skill){
    if(!skill) return;

    let effect = skill.effect;

    let candidateIds;
    if(effect === "unseal"){
        candidateIds = pvpState.mySealedSkillIds || [];
    } else if(effect === "copy"){
        candidateIds = (pvpState.oppUsedSkillIds || [])
            .filter(id => !["steal","copy","control"].includes(pvpState.skillCache[id] && pvpState.skillCache[id].effect));
    } else if(effect === "seal"){
        candidateIds = [...new Set([...(pvpState.oppUsedSkillIds || []), ...(pvpState.oppDefenseSkillIds || [])])];
    } else if(effect === "delay_cooldown"){
        candidateIds = [...new Set([...(pvpState.oppUsedSkillIds || []), ...(pvpState.oppDefenseSkillIds || [])])]
            .filter(id => { let s = pvpState.skillCache[id]; return s && s.cooldown > 0; });
    } else {
        // steal / control
        candidateIds = [...new Set([...(pvpState.oppRevealedSkillIds || []), ...(pvpState.oppUsedSkillIds || [])])]
            .filter(id => { let s = pvpState.skillCache[id]; return s && !["steal","copy","control","shadow","delay_cooldown"].includes(s.effect); });
    }

    let candidates = candidateIds
        .map(id => pvpState.skillCache[id])
        .filter(s => s && (effect !== "seal" || !(pvpState.oppSealedSkillIds || []).includes(s.id)));

    if(candidates.length === 0){
        alert("لا توجد مهارة مستهدفة متاحة لهذه المهارة الظلية الآن");
        return;
    }

    let verb = effect === "steal" ? "لسرقته" :
               effect === "copy" ? "لنسخه" :
               effect === "control" ? "للسيطرة عليه" :
               effect === "seal" ? "لختمه" :
               effect === "unseal" ? "لفك ختمه" :
               "لتأجيله";

    let modal = document.createElement("div");
    modal.id = "pvp-steal-modal";
    modal.className = "steal-modal";
    modal.dataset.modalFor = "shadow";
    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>🌑 مهارة الظل "${escapeHtml(skill.name)}" — اختر المهارة ${verb}</h3>
            <div class="steal-options-list" id="pvp-shadow-target-list"></div>
            <div class="steal-modal-buttons">
                <button id="pvp-steal-cancel-btn">إلغاء</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    let list = modal.querySelector("#pvp-shadow-target-list");
    candidates.forEach(s => {
        let btn = document.createElement("button");
        btn.className = "steal-option";
        btn.textContent = s.name;
        btn.onclick = () => {
            pvpCloseShadowMenu();
            if(effect === "steal" || effect === "copy"){
                pvpUseStealOrCopy(abilitySkillId, s.id);
            } else if(effect === "control"){
                pvpUseControl(abilitySkillId, s.id);
            } else if(effect === "seal" || effect === "unseal"){
                pvpUseSealOrUnseal(abilitySkillId, s.id);
            } else if(effect === "delay_cooldown"){
                pvpUseDelaySkill(abilitySkillId, s.id);
            }
        };
        list.appendChild(btn);
    });

    modal.querySelector("#pvp-steal-cancel-btn").onclick = pvpCloseShadowMenu;
}

function pvpCloseShadowMenu(){
    let modal = document.getElementById("pvp-steal-modal");
    if(modal && modal.dataset.modalFor === "shadow") modal.remove();
}

// ========================================
// تنفيذ مهارة الظل — التحقق الفعلي (هل الشخصية في القائمة، هل المهارة من
// مهاراتها...) كله على السيرفر عبر pvp_use_shadow
// ========================================
async function pvpUseShadowSkill(abilitySkillId, charId, skillId){

    pvpSetSkillsEnabled(false);

    let { data, error } =
    await supabaseClient
    .rpc("pvp_use_shadow", {
        p_token: pvpGetToken(),
        p_match_id: pvpState.matchId,
        p_ability_skill_id: abilitySkillId,
        p_character_id: charId,
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

    pvpCloseStealMenu();
    pvpCloseDelayMenu();
    pvpCloseShadowMenu();
    pvpStopPolling();
    pvpStopTurnTimer();
    pvpState.matchId = null;
    pvpState.finished = false;
}

// ========================================
// زر "العودة" داخل شاشة معركة PvP: كان سابقًا مجرد تبديل شاشة بدون تنظيف
// المباراة على السيرفر (bug)، فتبقى المباراة عالقة وتمنع اللاعبَين من
// الظهور لبعضهما لاحقًا في الردهة. الآن ننسحب فعليًا من المباراة أولاً
// (استسلام إن كانت نشطة، أو حذفها إن كانت لا تزال بانتظار/استعداد) ثم
// نعود للشاشة الرئيسية.
// ========================================
function pvpLeaveBattleClicked(){

    // نُبدّل الشاشة فورًا دون انتظار الشبكة — زر العودة يجب أن يعمل دائمًا
    // فورًا حتى لو كان الاتصال بطيئًا أو معلّقًا. تنظيف/استسلام المباراة
    // على السيرفر يحصل في الخلفية بعد ذلك ولا يوقف عودة اللاعب للقائمة.
    openScreen("solo-battle-screen");

    try {
        pvpLeaveMatch().catch(() => {});
    } catch(e) {}
}

function pvpShowResult(iWon){

    let statusBox = document.getElementById("pvp-status-message");
    if(statusBox){
        statusBox.style.display = "block";
        statusBox.textContent = iWon ? "🏆 فزت! وأُضيف الخصم المهزوم إلى ظلك 🌑" : "💔 خسرت";
    }

    pvpSetSkillsEnabled(false);

    // عند الفوز: نضيف خصمنا المهزوم إلى مخزون الظل الشخصي
    if(iWon && pvpState.matchId){
        supabaseClient.rpc("pvp_add_winner_shadow", {
            p_token: pvpGetToken(),
            p_match_id: pvpState.matchId
        }).catch(() => {});
    }

    setTimeout(() => {
        // نعود لشاشة اختيار نوع المواجهة (PvE/PvP)
        openScreen("solo-battle-screen");
    }, 1500);
}
