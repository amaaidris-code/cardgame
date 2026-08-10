// ========================================
// PvP — واجهة اللاعب (كل الحسابات الحاسمة على السيرفر)
// تدفّق كامل: ردهة (اختيار الخصم) -> تحدٍّ وقبول -> تصادم البطاقات ->
// زر الاستعداد الأحمر -> نزال عادي بالأدوار
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
    skillCache: {}, // skill_id -> سجل المهارة الكامل (اسم/نوع/effect/damage/cooldown...)
    stealMenuOpen: false,

    // تهدئة مهاراتي في هذه المباراة: skill_id -> last_used_turn
    myCooldowns: {},
    myTurnsTaken: 0,

    // حالة مرحلة السباق (بعد استعداد الطرفين، قبل بداية النزال الفعلي)
    raceStarted: false,
    raceResolvedLocally: false,
    raceLockedUntil: 0
};

// حالة الردهة (اختيار الخصم) والتحدي، منفصلة عن حالة النزال نفسه
let pvpLobby = {
    pollTimer: null,
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
}

function closePVPLobby(){
    pvpLobbyStopPolling();
    pvpCloseChallengeModal();

    if(pvpLobby.mode === "waiting" && pvpLobby.outgoingMatchId){
        // ألغِ التحدي المرسل إن كنا لا نزال ننتظر ردًا عليه
        supabaseClient.rpc("pvp_forfeit_match", {
            p_token: pvpGetToken(),
            p_match_id: pvpLobby.outgoingMatchId
        }).catch(() => {});
    } else {
        supabaseClient.rpc("pvp_leave_lobby", { p_token: pvpGetToken() }).catch(() => {});
    }

    pvpLobby.mode = "browsing";
    pvpLobby.outgoingMatchId = null;

    openScreen("solo-battle-screen");
}

function pvpSetLobbyStatus(text){
    let box = document.getElementById("pvp-lobby-status");
    if(box) box.textContent = text;
}

async function pvpRefreshLobby(){

    // أثناء انتظار رد على تحدٍّ أرسلته: نراقب حالة تلك المباراة تحديدًا
    if(pvpLobby.mode === "waiting"){
        await pvpPollOutgoingChallenge();
        return;
    }

    // نتصفّح القائمة: نجلب اللاعبين المتاحين + أي تحدٍّ وارد لنا
    let [{data: players, error: listError}, {data: incoming, error: incomingError}] =
    await Promise.all([
        supabaseClient.rpc("pvp_list_lobby", { p_token: pvpGetToken() }),
        supabaseClient.rpc("pvp_get_incoming_challenge", { p_token: pvpGetToken() }).single()
    ]);

    let incomingChallenge = (!incomingError && incoming && incoming.match_id) ? incoming : null;

    pvpLobby.incomingShown = incomingChallenge ? incomingChallenge.match_id : null;

    if(!listError){
        pvpRenderLobbyList(players || [], incomingChallenge);
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
        card.innerHTML = `
        <div class="character-info">
            <h3>⚔️ ${incomingChallenge.challenger_name || "لاعب"}</h3>
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
        card.innerHTML = `
        <div class="character-info">
            <h3>${p.character_name || "لاعب"}</h3>
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

    await supabaseClient.rpc("pvp_forfeit_match", {
        p_token: pvpGetToken(),
        p_match_id: pvpLobby.outgoingMatchId
    }).catch(() => {});

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
    pvpState.raceStarted = false;
    pvpState.raceResolvedLocally = false;
    pvpState.raceLockedUntil = 0;
    pvpCloseStealMenu();

    let token = pvpGetToken();

    let pc = await getActivePlayerCharacter();
    if(!pc){
        alert("لا توجد شخصية نشطة");
        return;
    }
    pvpState.myCharacterName = pc.characters ? pc.characters.name : "";
    pvpState.mySkills = await loadCharacterSkills(pc.character_id);
    pvpState.mySkills.forEach(s => { pvpState.skillCache[s.id] = s; });

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

    openScreen("pvp-battle-screen");

    let statusBox = document.getElementById("pvp-status-message");
    if(!statusBox){
        statusBox = document.createElement("div");
        statusBox.id = "pvp-status-message";
        statusBox.style.textAlign = "center";
        statusBox.style.padding = "20px";
        statusBox.style.fontSize = "18px";
        document.getElementById("pvp-battle-screen").prepend(statusBox);
    }
    statusBox.style.display = "block";
    statusBox.textContent = "";

    let arena = document.querySelector("#pvp-battle-screen .battle-arena");
    resetBattleVisuals("pvp");
    if(arena){
        arena.classList.remove("cards-engaged");
        arena.style.opacity = "1";
    }

    ensureLogBox("pvp");
    renderPVPSkillButtons();
    pvpSetSkillsEnabled(false);

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
    renderPVPSkillButtons();
    pvpRefreshState(true);
    pvpAfterReadyPollStart();
}

// نجيب حالة المباراة الحالية ونحدّث الشاشة
async function pvpRefreshState(isFirstLoad){

    if(pvpState.finished) return;

    let { data, error } =
    await supabaseClient
    .rpc("pvp_get_match_state", { p_token: pvpGetToken(), p_match_id: pvpState.matchId })
    .single();

    if(error || !data) return;

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

    if(pvpState.isPlayer1){
        myHp = data.player1_hp; oppHp = data.player2_hp;
        myMaxHp = data.player1_max_hp; oppMaxHp = data.player2_max_hp;
        myName = data.player1_char_name; oppName = data.player2_char_name;
        myImage = data.player1_char_image; oppImage = data.player2_char_image;
        myUsedIds = data.player1_used_skill_ids || [];
        oppUsedIds = data.player2_used_skill_ids || [];
        myTurnsTaken = data.player1_turns_taken || 0;
    } else {
        myHp = data.player2_hp; oppHp = data.player1_hp;
        myMaxHp = data.player2_max_hp; oppMaxHp = data.player1_max_hp;
        myName = data.player2_char_name; oppName = data.player1_char_name;
        myImage = data.player2_char_image; oppImage = data.player1_char_image;
        myUsedIds = data.player2_used_skill_ids || [];
        oppUsedIds = data.player1_used_skill_ids || [];
        myTurnsTaken = data.player2_turns_taken || 0;
    }

    setFighterImage(document.getElementById("pvp-player-image"), myImage);
    setFighterImage(document.getElementById("pvp-enemy-image"), oppImage);

    document.getElementById("pvp-player-name-battle").textContent = myName || "أنت";
    document.getElementById("pvp-enemy-name").textContent = oppName || "الخصم";

    updateHpDisplay("pvp-player", myHp, myMaxHp);
    updateHpDisplay("pvp-enemy", oppHp, oppMaxHp);

    pvpState.myUsedSkillIds = myUsedIds;
    pvpState.oppUsedSkillIds = oppUsedIds;
    pvpState.myTurnsTaken = myTurnsTaken;

    pvpState.myCooldowns = {};
    (data.my_cooldowns || []).forEach(c => {
        pvpState.myCooldowns[c.skill_id] = c.last_used_turn;
    });

    await pvpEnsureSkillsCached([...myUsedIds, ...oppUsedIds]);
    pvpRenderUsedSkillsUI();

    let myTurn = (data.turn_player_id === (pvpState.isPlayer1 ? data.player1_id : data.player2_id));
    pvpSetSkillsEnabled(myTurn && data.status === "active");

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
// عرض أزرار المهارات (تشمل السرقة/النسخ وشارات التهدئة)
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
        btn.innerHTML = `<span class="skill-name">${skill.name}</span>`;
        btn.dataset.skillId = skill.id;

        if(skill.effect === "steal" || skill.effect === "copy"){
            btn.querySelector(".skill-name").textContent =
                skill.name + (skill.effect === "steal" ? " 🕵️" : " 📋");
            btn.onclick = () => pvpOpenStealMenu(skill);
        } else {
            btn.onclick = () => pvpUseSkill(skill.id);
        }

        page.appendChild(btn);
    });

    container.appendChild(page);
    pvpApplyCooldownBadges();
}

// يحسب كم دورًا متبقيًا لتهدئة مهارة معيّنة بالاعتماد على my_cooldowns
// و عدد أدواري المُستهلكة، بنفس منطق cooldownTurnsRemaining في battle.js
function pvpCooldownRemaining(skill){
    if(!skill.cooldown || skill.cooldown <= 0) return 0;

    let lastUsed = pvpState.myCooldowns[skill.id];
    if(lastUsed === undefined || lastUsed === null) return 0;

    let remaining = skill.cooldown - (pvpState.myTurnsTaken - lastUsed);
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

function pvpSetSkillsEnabled(enabled){
    let container = document.getElementById("pvp-player-skills-pages");
    if(!container) return;

    pvpApplyCooldownBadges();

    container.querySelectorAll("button[data-skill-id]").forEach(btn => {
        let skill = pvpState.skillCache[btn.dataset.skillId];
        let onCooldown = skill ? pvpCooldownRemaining(skill) > 0 : false;
        btn.disabled = !enabled || onCooldown;
    });
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

    pvpLeaveMatch().catch(() => {});
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
        // نعود لشاشة اختيار نوع المواجهة (PvE/PvP)
        openScreen("solo-battle-screen");
    }, 500);
}
