// ========================================
// CARD GAME - battle.js
// نظام القتال الحقيقي (PvE)
// ========================================


// ========================================
// حالة المعركة العامة
// ========================================

let battle = {

    player: null,
    enemy: null,

    prefix: "pve",

    phase: "idle", // idle | intro | countdown | racing | battle | finished

    turnOwner: null, // "player" أو "enemy"

    finished: false,

    turnInterval: null,

    raceWon: false,

    raceButtonLockedUntil: 0, // عقوبة الضغط المبكر على زر السباق (طابع زمني)

    botRaceTimeout: null,

    enemyUsedSkills: [], // كل مهارات هذا الخصم التي كُشفت ضد هذا اللاعب — تشمل النزالات
    // السابقة (محفوظة محليًا) + هذا النزال، وهي ما تُستخدم أساسًا لتحديد
    // ما يمكن "سرقته": يكفي أن يكون الخصم استخدمها ضدك في أي نزال سابق

    enemyUsedSkillsThisBattle: [], // فقط ما استخدمه الخصم فعليًا في هذا النزال
    // بالذات — هذه (لا enemyUsedSkills) هي ما يُستخدم لتحديد ما يمكن "نسخه"،
    // فالنسخ يتطلب أن يكون الخصم استخدم المهارة أمامك الآن، لا في نزال سابق

    currentMonsterId: null, // معرّف الوحش الحالي، يُستخدم كمفتاح لحفظ/تحميل
    // مهارات هذا الخصم المكشوفة سابقًا من التخزين المحلي

    playerUsedSkills: []

};



// ========================================
// حفظ/تحميل مهارات كل وحش التي كُشفت سابقًا (للسرقة عبر نزالات متعددة)
// ========================================

function pveRevealedSkillsStorageKey(monsterId){

    return "pve_revealed_skills_" + monsterId;

}


function pveLoadRevealedSkillIds(monsterId){

    if(!monsterId) return [];

    try{

        let raw = localStorage.getItem(pveRevealedSkillsStorageKey(monsterId));

        let ids = raw ? JSON.parse(raw) : [];

        return Array.isArray(ids) ? ids : [];

    }catch(e){

        return [];

    }

}


function pveSaveRevealedSkillIds(monsterId, ids){

    if(!monsterId) return;

    try{

        localStorage.setItem(pveRevealedSkillsStorageKey(monsterId), JSON.stringify(ids));

    }catch(e){}

}


// يُستدعى في كل مرة يستخدم فيها الخصم مهارة فعليًا ضد اللاعب: يضيفها لقائمة
// هذا النزال (للنسخ) ولقائمة كل المهارات المكشوفة تاريخيًا (للسرقة)، ثم
// يحفظ القائمة التاريخية محليًا حتى تبقى متاحة للسرقة في النزالات القادمة
function markEnemySkillUsed(skill){

    if(!battle.enemyUsedSkillsThisBattle.find(s => s.id === skill.id)){

        battle.enemyUsedSkillsThisBattle.push(skill);

    }

    if(!battle.enemyUsedSkills.find(s => s.id === skill.id)){

        battle.enemyUsedSkills.push(skill);

        let ids = pveLoadRevealedSkillIds(battle.currentMonsterId);

        if(!ids.includes(skill.id)){

            ids.push(skill.id);

            pveSaveRevealedSkillIds(battle.currentMonsterId, ids);

        }

    }

}



function wait(ms){

    return new Promise(resolve => setTimeout(resolve, ms));

}


// يضبط صورة المقاتل بأمان: لو لا توجد صورة أو فشل تحميلها،
// يزيل الـ src بالكامل حتى يظهر "مكان الصورة المخصص" (أيقونة + تدرج)
// المعرّف في CSS بدل أيقونة الصورة المعطوبة الافتراضية للمتصفح
function setFighterImage(imgEl, url){

    if(!imgEl) return;

    if(!url){

        imgEl.removeAttribute("src");

        return;

    }

    imgEl.onerror = () => {

        imgEl.removeAttribute("src");

    };

    imgEl.src = url;

}


// نفس فكرة setFighterImage لكن لبطاقات المقدمة (خلفية div وليست img):
// يتحقق أولاً أن الصورة تُحمَّل فعلاً قبل استبدال "مكان الصورة المخصص"،
// حتى لا يظهر مربع فارغ لو كان الرابط معطوبًا
function setIntroCardImage(cardEl, url){

    if(!cardEl || !url) return;

    let probe = new Image();

    probe.onload = () => {

        cardEl.style.backgroundImage = `url(${url})`;

    };

    probe.src = url;

}


// إعادة ضبط مظهر ساحة القتال (الزر وتقارب البطاقات) قبل بدء معركة جديدة
function resetBattleVisuals(prefix){

    let screen = document.getElementById(prefix + "-battle-screen");

    if(!screen) return;

    let arena = screen.querySelector(".battle-arena");

    let btn = document.getElementById(prefix + "-attack-button");

    let wrap = btn ? btn.closest(".attack-button-wrap") : null;

    if(arena) arena.classList.remove("cards-engaged");

    if(wrap) wrap.classList.remove("button-gone");

    if(btn){

        btn.style.visibility = "hidden";

        btn.classList.remove("racing-live", "locked");

        btn.onclick = null;

    }

    // نمسح ذاكرة آخر رسم لشرائح المهارات المستخدمة حتى لا تبقى شرائح
    // النزال السابق ظاهرة لو تطابق المفتاح صدفة
    let enemyUsedBox = document.getElementById(prefix + "-enemy-used-skills");
    let playerUsedBox = document.getElementById(prefix + "-player-used-skills");
    if(enemyUsedBox) delete enemyUsedBox.dataset.renderedKey;
    if(playerUsedBox) delete playerUsedBox.dataset.renderedKey;

}



function addBattleLog(text){

    let box =
    document.getElementById(battle.prefix + "-battle-log");

    if(!box) return;

    let line = document.createElement("div");

    line.textContent = text;

    box.appendChild(line);

    box.scrollTop = box.scrollHeight;

}


function ensureLogBox(prefix){

    let screen =
    document.getElementById(prefix + "-battle-screen");

    if(!screen) return;

    let existing =
    document.getElementById(prefix + "-battle-log");

    if(existing){

        existing.innerHTML = "";

    } else {

        let arena =
        screen.querySelector(".battle-arena");

        let log = document.createElement("div");

        log.id = prefix + "-battle-log";

        log.className = "battle-log";

        arena.after(log);

    }

    let existingBtn =
    document.getElementById(prefix + "-log-toggle-btn");

    if(!existingBtn){

        let logBtn = document.createElement("button");

        logBtn.id = prefix + "-log-toggle-btn";

        logBtn.className = "log-toggle-btn";

        logBtn.textContent = "📜 سجل الأحداث";

        logBtn.onclick = () => toggleLog(prefix);

        let screenEl = document.getElementById(prefix + "-battle-screen");

        let arena = screenEl.querySelector(".battle-arena");

        arena.after(logBtn);

        logBtn.after(document.getElementById(prefix + "-battle-log"));

    }

    document.getElementById(prefix + "-battle-log").classList.remove("open");

}


function toggleLog(prefix){

    let box = document.getElementById(prefix + "-battle-log");

    if(box) box.classList.toggle("open");

}



// ========================================
// جلب شخصية اللاعب النشطة ومهاراتها الحقيقية
// ========================================

async function getActivePlayerCharacter(){

    let player_id =
    localStorage.getItem("player_id");

    if(!player_id) return null;

    let player_token = localStorage.getItem("player_token");

    let cacheName = "active_pc_" + player_id;

    // نحاول أونلاين أولاً لأن هذه بيانات "تخص هذا اللاعب نفسه" (مستواه،
    // نقاطه) ونريدها محدّثة قدر الإمكان لعرض صحيح. لكن إن فشل الاتصال،
    // نستخدم آخر نسخة معروفة محليًا حتى يستطيع اللعب PvE أوفلاين.
    // مهم: هذا لا يُستخدم أبدًا لحساب/منح مكافآت — أي مكافأة مستقبلية
    // تُحسب حصريًا داخل RPC على الخادم يعيد قراءة القيم الحقيقية بنفسه.
    // نستخدم get_my_active_character (تتحقق من رمز الجلسة) بدل قراءة
    // players/player_characters مباشرة، فهما لم يعودا قابلين للقراءة العامة.

    if(GameCache.isOnline() && player_token){

        try{

            let {data:row, error} =
            await supabaseClient
            .rpc("get_my_active_character", { p_token: player_token })
            .single();

            if(error || !row) throw error || new Error("no pc");

            let pc = {
                id: row.pc_id,
                character_id: row.character_id,
                level: row.level,
                hp: row.hp,
                atk: row.atk,
                available_points: row.available_points,
                characters: {
                    name: row.name,
                    anime: row.anime,
                    identity_image: row.identity_image,
                    skill_card_image: row.skill_card_image,
                    glow_color: row.glow_color,
                    custom_glow_color: row.custom_glow_color
                }
            };

            GameCache.set(cacheName, pc);

            return pc;

        }catch(e){

            console.log("getActivePlayerCharacter network error, falling back to cache", e);

        }

    }

    return GameCache.getStale(cacheName);

}



async function loadCharacterSkills(character_id){

    // مهارات الشخصيات (الاسم/النوع/الضرر/التهدئة) بيانات مرجعية عامة للقراءة
    // فقط، لذا آمن تخزينها محليًا للعمل أوفلاين. لكن لاحظ: أي مكافأة أو نتيجة
    // معركة تُحفظ بشكل دائم يجب أن تمر عبر RPC على الخادم يعيد جلب هذه
    // الأرقام بنفسه من قاعدة البيانات — لا يثق أبدًا بما هو مخزن أو معروض هنا.

    let cacheName = "character_skills_" + character_id;

    let result = [];

    await GameCache.fetchWithCache(
        cacheName,
        async () => {
            let {data, error} =
            await supabaseClient
            .from("character_skills")
            .select(`

                slot,

                skills (*)

            `)
            .eq("character_id", character_id)
            .order("slot");

            if(error) throw error;

            return data
            .filter(row => row.skills)
            .map(row => ({...row.skills, slot: row.slot}));
        },
        (data) => { result = data; },
        () => { result = []; },
        10 * 60 * 1000
    );

    return result;

}


// ========================================
// خلفيات صفحات المهارات (كل 4 مهارات = صفحة)
// ========================================
// خلفية لكل مجموعة مهارات تُعرض في ساحة المعركة خلف أزرارها. بيانات
// تزيينية للعرض فقط (لا تؤثر على أي نتيجة)، تُخزن محليًا للعمل أوفلاين
// مثل باقي بيانات العرض المرجعية، وتُحدَّث من الشبكة كل دقيقة تقريبًا
// حتى يظهر تغيير لوحة الإدارة سريعًا.

let skillPageBackgroundsCache = {};

async function loadSkillPageBackgrounds(character_id){

    let cacheName = "skill_page_bgs_" + character_id;

    await GameCache.fetchWithCache(
        cacheName,
        async () => {
            let {data, error} =
            await supabaseClient
            .from("character_skill_page_backgrounds")
            .select("page_index, image_url")
            .eq("character_id", character_id);

            if(error) throw error;

            let map = {};

            (data || []).forEach(row => {
                if(row.image_url) map[row.page_index] = row.image_url;
            });

            return map;
        },
        (data) => { skillPageBackgroundsCache[character_id] = data || {}; },
        () => { skillPageBackgroundsCache[character_id] = {}; },
        60 * 1000
    );

}

// تُرجع رابط خلفية الصفحة فورًا من الكاش ("" إن لم توجد) — تُستدعى من
// داخل وظائف الرسم المتزامنة، لذلك لا تنتظر أي جلب من الشبكة
function getSkillPageBackground(character_id, pageIndex){

    let map = skillPageBackgroundsCache[character_id];

    if(!map) return "";

    return map[pageIndex] || "";

}
function safeGlowColor(color, fallback){

    if(color && /^#[0-9A-Fa-f]{6}$/.test(color)) return color;

    return fallback;

}


function buildFighter(pc, skills, isPlayer){

    let c = pc.characters || {};

    let effectiveColor = safeGlowColor(c.custom_glow_color, null) || safeGlowColor(c.glow_color, "#3b82ff");

    return {

        name: c.name,

        image: c.identity_image,

        hp: pc.hp,

        maxHp: pc.hp,

        skills: skills,

        turnsTaken: 0,

        cooldownUsedAt: {},

        lastHitSnapshot: null,

        // شحنات الدرع المتبقية من مهارة دفاع/دفاع مسروق "يتحمّل عدة ضربات":
        // كل ضربة قادمة تُمتَص تلقائيًا وتُنقِص شحنة واحدة حتى تنفد
        shieldCharges: 0,

        // حالة الانعكاس: مضاعف الانعكاس الحالي (0 = غير منعكس). أي مهارة
        // انعكاس تُفعّل وضع "يرتد الضرر القادم كاملًا × المضاعف على المهاجم"
        reflectMultiplier: 0,

        // حالة التجميد/الشلل: عدد الأدوار القادمة التي يخسرها هذا المقاتل بالكامل
        frozenTurns: 0,

        // المهارات المختومة (بمهارة "ختم"): لا يمكن استخدامها حتى نهاية
        // النزال، إلا إذا فُكّ ختمها بمهارة "فك الختم"
        sealedSkillIds: [],

        playerCharacterId: pc.id,

        characterId: pc.character_id,

        isPlayer: isPlayer,

        glow: effectiveColor

    };

}



// ملاحظة: دالة بناء الوحش أصبحت عامة (buildMonsterFighter) وتُبنى من قاعدة البيانات
// بدل الغول الثابت سابقًا. أي وحش يُضاف من لوحة الإدارة يعمل تلقائيًا في PvE.



// ========================================
// حساب الضرر (ثابت من قاعدة البيانات، بدون علاقة بـ ATK)
// ========================================

function calcDamage(skill){

    // مهارة التجميد/الشلل لا تُلحق ضررًا؛ رقمها يمثّل عدد أدوار التجميد بدلاً من ذلك
    if(skill.effect === "freeze") return 0;

    // مهارة الانعكاس لا تُلحق ضررًا مباشرًا؛ رقمها يمثّل مضاعف ارتداد الضرر
    if(skill.effect === "reflect") return 0;

    // مهارتا الختم/فك الختم لا تُلحقان ضررًا؛ رقمهما يمثّل عدد المهارات
    // القابلة للختم/فك الختم في التفعيل الواحد
    if(skill.effect === "seal") return 0;

    if(skill.effect === "unseal") return 0;

    if(skill.type === "attack" || skill.type === "special")
        return Number(skill.damage) || 0;

    return 0;

}



// ملاحظة مهمة: التهدئة تُحسب بعدد أدوار "هذا المقاتل نفسه" (fighter.turnsTaken)
// وليس بعداد مشترك بين اللاعب والخصم. من قبل كانت تُحسب بعداد عام يزيد مع كل
// فعل من الطرفين، فكانت مهارة تهدئتها 2 تصبح جاهزة تلقائيًا في نفس اللحظة
// التي يحتاجها اللاعب فيها (لأن دورة كاملة = فعل لاعب + فعل خصم = زيادتان),
// أي أن التهدئة عمليًا لم تكن تمنع شيئًا. الآن التهدئة تُقاس بعدد أدوار
// المقاتل نفسه التي مرت منذ آخر استخدام.

function isSkillReady(fighter, skill){

    if(!skill.cooldown || skill.cooldown <= 0)
        return true;

    let lastUsed = fighter.cooldownUsedAt[skill.id];

    if(lastUsed === undefined)
        return true;

    return (fighter.turnsTaken - lastUsed) >= skill.cooldown;

}


// عدد الأدوار المتبقية قبل أن تصبح المهارة جاهزة مجددًا
function cooldownTurnsRemaining(fighter, skill){

    if(!skill.cooldown || skill.cooldown <= 0)
        return 0;

    let lastUsed = fighter.cooldownUsedAt[skill.id];

    if(lastUsed === undefined)
        return 0;

    let remaining = skill.cooldown - (fighter.turnsTaken - lastUsed);

    return remaining > 0 ? remaining : 0;

}


// هل هذه المهارة مختومة على صاحبها (بمهارة "ختم")؟ المهارة المختومة لا
// يمكن استخدامها إطلاقًا حتى نهاية النزال، إلا بفك ختمها بمهارة "فك الختم"
function isSkillSealed(fighter, skill){

    return !!(fighter && fighter.sealedSkillIds && fighter.sealedSkillIds.includes(skill.id));

}



function allPlayerSkills(fighter){

    return fighter.skills;

}



// ملاحظة: مهارات الخصم الظاهرة لم تعد تُحفظ بين النزالات — كل نزال جديد
// يبدأ بقائمة فارغة، ويجب أن يستخدم الخصم المهارة فعليًا في هذا النزال
// نفسه حتى يمكن نسخها؛ للسرقة يكفي أن يكون استخدمها في أي نزال سابق ضد هذا
// الوحش (battle.enemyUsedSkillsThisBattle = [] عند بدء كل نزال جديد)



// دالة عامة لبناء أي مقاتل وحش من صف في جدول characters + مهاراته
function buildMonsterFighter(character, skills){

    if(!skills || skills.length === 0){

        skills = [

            {id:"default_atk", name:"هجوم عادي", type:"attack", damage: character.atk || 100, cooldown:0, effect:null}

        ];

    }

    return {

        id: character.id,

        name: character.name,

        image: character.identity_image,

        hp: character.hp,

        maxHp: character.hp,

        skills: skills,

        turnsTaken: 0,

        cooldownUsedAt: {},

        lastHitSnapshot: null,

        // شحنات الدرع المتبقية من مهارة دفاع/دفاع مسروق "يتحمّل عدة ضربات":
        // كل ضربة قادمة تُمتَص تلقائيًا وتُنقِص شحنة واحدة حتى تنفد
        shieldCharges: 0,

        // حالة الانعكاس: مضاعف الانعكاس الحالي (0 = غير منعكس). أي مهارة
        // انعكاس تُفعّل وضع "يرتد الضرر القادم كاملًا × المضاعف على المهاجم"
        reflectMultiplier: 0,

        // حالة التجميد/الشلل: عدد الأدوار القادمة التي يخسرها هذا المقاتل بالكامل
        frozenTurns: 0,

        // المهارات المختومة حتى نهاية النزال (تُمنع بإضافة معرّفاتها هنا)
        sealedSkillIds: [],

        isPlayer: false,

        glow: safeGlowColor(character.glow_color, "#22c55e")

    };

}



// ========================================
// بدء معركة PvE
// ========================================

async function startPVEBattle(monsterId){

    if(!monsterId){

        openScreen("pve-select-screen");

        loadMonsterList();

        return;

    }

    openScreen("pve-battle-screen");

    resetBattleVisuals("pve");


    let pc = await getActivePlayerCharacter();

    if(!pc){

        alert("لا توجد شخصية نشطة");

        openScreen("home-screen");

        return;

    }


    let monsterCacheName = "monster_row_" + monsterId;

    let monsterRow = null;

    await GameCache.fetchWithCache(
        monsterCacheName,
        async () => {
            let {data, error} =
            await supabaseClient
            .from("characters")
            .select("*")
            .eq("id", monsterId)
            .single();

            if(error) throw error;
            return data;
        },
        (data) => { monsterRow = data; },
        () => { monsterRow = null; },
        10 * 60 * 1000
    );

    if(!monsterRow){

        alert("تعذر تحميل هذا الوحش (تحتاج اتصالاً بالإنترنت في أول مرة فقط)");

        openScreen("pve-select-screen");

        return;

    }

    let monsterSkills = await loadCharacterSkills(monsterId);


    let skills = await loadCharacterSkills(pc.character_id);

    if(skills.length === 0){

        skills = [

            {id:"default_atk", name:"هجوم عادي", type:"attack", damage:100, cooldown:0, effect:null},

            {id:"default_def", name:"دفاع", type:"defense", damage:0, cooldown:2, effect:null}

        ];

    }

    // خلفيات صفحات مهارات اللاعب (يُستخدمها الرسم مباشرة بعد ذلك)
    await loadSkillPageBackgrounds(pc.character_id);


    battle.player = buildFighter(pc, skills, true);

    battle.enemy = buildMonsterFighter(monsterRow, monsterSkills);

    battle.prefix = "pve";

    battle.phase = "idle";

    battle.turnOwner = null;

    battle.finished = false;

    battle.raceWon = false;

    battle.raceButtonLockedUntil = 0;

    setTurnIndicatorText("pve-turn-indicator", "", null);

    // مهارات هذا النزال بالذات (تُستخدم لتحديد ما يمكن نسخه) تبدأ فارغة
    // دائمًا — يجب أن يستخدم الخصم المهارة فعليًا في هذا النزال نفسه حتى
    // يمكن نسخها. أما قائمة "كل ما كُشف من قبل" (تُستخدم للسرقة) فتُحمَّل
    // من التخزين المحلي الخاص بهذا الوحش تحديدًا، فتبقى مهارات سبق أن
    // استخدمها هذا الخصم ضدك في نزالات سابقة قابلة للسرقة حتى لو لم
    // يستخدمها في هذا النزال بعد
    battle.currentMonsterId = monsterId;

    battle.enemyUsedSkillsThisBattle = [];

    let revealedIds = pveLoadRevealedSkillIds(monsterId);

    battle.enemyUsedSkills = monsterSkills.filter(s => revealedIds.includes(s.id));

    battle.playerUsedSkills = [];


    ensureLogBox("pve");

    renderSkillButtons("pve");

    updateBattleScreen();

    renderUsedSkillsUI("pve");

    hideBattleResult("pve");


    await runIntroSequence("pve");

}



// تنفيذ startPVPBattle الفعلي موجود الآن في pvp.js



// ========================================
// تحديث الشاشة (HP، الأسماء، الصور)
// ========================================

// تحويل hex إلى rgba مع شفافية مخصصة (لاستخدامها في box-shadow/border)
function hexToRgba(hex, alpha){

    hex = safeGlowColor(hex, "#3b82ff");

    let r = parseInt(hex.slice(1,3), 16);
    let g = parseInt(hex.slice(3,5), 16);
    let b = parseInt(hex.slice(5,7), 16);

    return `rgba(${r},${g},${b},${alpha})`;

}


// تطبيق لون توهج كل مقاتل على بطاقته في شاشة المعركة عبر CSS variables
function applyGlowColors(){

    if(!battle.player || !battle.enemy) return;

    let prefix = battle.prefix;

    let playerCardEl = document.querySelector("#" + prefix + "-battle-screen .player-card");
    let enemyCardEl = document.querySelector("#" + prefix + "-battle-screen .enemy-card");

    if(playerCardEl){

        playerCardEl.style.setProperty("--glow-border", hexToRgba(battle.player.glow, 0.55));
        playerCardEl.style.setProperty("--glow-shadow", hexToRgba(battle.player.glow, 0.22));
        playerCardEl.style.setProperty("--glow-shadow-strong", hexToRgba(battle.player.glow, 0.5));

    }

    if(enemyCardEl){

        enemyCardEl.style.setProperty("--glow-border", hexToRgba(battle.enemy.glow, 0.55));
        enemyCardEl.style.setProperty("--glow-shadow", hexToRgba(battle.enemy.glow, 0.22));
        enemyCardEl.style.setProperty("--glow-shadow-strong", hexToRgba(battle.enemy.glow, 0.5));

    }

}


function updateBattleScreen(){

    if(!battle.player || !battle.enemy) return;

    let prefix = battle.prefix;

    let playerHp = document.getElementById(prefix + "-player-hp");
    let enemyHp = document.getElementById(prefix + "-enemy-hp");
    let playerBar = document.getElementById(prefix + "-player-hp-bar");
    let enemyBar = document.getElementById(prefix + "-enemy-hp-bar");
    let playerName = document.getElementById(prefix + "-player-name-battle");
    let enemyName = document.getElementById(prefix + "-enemy-name");
    let playerImage = document.getElementById(prefix + "-player-image");
    let enemyImage = document.getElementById(prefix + "-enemy-image");

    if(playerHp) playerHp.innerHTML = `${battle.player.hp} / ${battle.player.maxHp}`;
    if(enemyHp) enemyHp.innerHTML = `${battle.enemy.hp} / ${battle.enemy.maxHp}`;

    if(playerBar){
        playerBar.style.width = (battle.player.hp / battle.player.maxHp * 100) + "%";
        updateHpBarColor(playerBar, battle.player.hp, battle.player.maxHp);
    }

    if(enemyBar){
        enemyBar.style.width = (battle.enemy.hp / battle.enemy.maxHp * 100) + "%";
        updateHpBarColor(enemyBar, battle.enemy.hp, battle.enemy.maxHp);
    }

    if(playerName) playerName.textContent = battle.player.name;
    if(enemyName) enemyName.textContent = battle.enemy.name;

    setFighterImage(playerImage, battle.player.image);
    setFighterImage(enemyImage, battle.enemy.image);

    // مؤشر بصري خفيف على المقاتل المجمّد
    if(playerImage) playerImage.classList.toggle("frozen-status", !!(battle.player.frozenTurns > 0));
    if(enemyImage) enemyImage.classList.toggle("frozen-status", !!(battle.enemy.frozenTurns > 0));

    // مؤشر بصري على وضع الانعكاس + شارة المضاعف (تظهر ما دام الانعكاس نشطًا)
    toggleReflectStatus(playerImage, battle.player);
    toggleReflectStatus(enemyImage, battle.enemy);

    applyGlowColors();

    renderSkillButtons(prefix);

    renderUsedSkillsUI(prefix);

}


// شارة وضع الانعكاس: تلوّن صورة المقاتل وتحطّ شارة ذهبية تعرض المضاعف
// (مثل مؤشر التجميد، لكنها تظهر ما دام الانعكاس نشطًا وتختفي عند زواله)
function toggleReflectStatus(imageEl, fighter){

    if(!imageEl) return;

    imageEl.classList.toggle("reflect-status", !!(fighter.reflectMultiplier > 0));

    let card = imageEl.closest(".battle-card");

    if(!card) return;

    let badge = card.querySelector(".reflect-badge");

    if(fighter.reflectMultiplier > 0){

        if(!badge){

            badge = document.createElement("div");

            badge.className = "reflect-badge";

            card.appendChild(badge);

        }

        badge.textContent = "🔁 " + fighter.reflectMultiplier + "×";

    } else if(badge){

        badge.remove();

    }

}


function updateHpBarColor(bar, hp, maxHp){

    if(!bar) return;

    let percent = hp / maxHp;

    bar.classList.remove("hp-mid","hp-low");

    if(percent <= 0.25) bar.classList.add("hp-low");

    else if(percent <= 0.5) bar.classList.add("hp-mid");

}



// ========================================
// المقدمة السينمائية: تصادم البطاقات + VS
// ========================================

async function runIntroSequence(prefix){

    let screen = document.getElementById(prefix + "-battle-screen");

    let arena = screen.querySelector(".battle-arena");

    arena.style.overflow = "visible";

    let playerColor = safeGlowColor(battle.player.glow, "#3b82ff");
    let enemyColor = safeGlowColor(battle.enemy.glow, "#22c55e");


    let playerCard = document.createElement("div");
    playerCard.className = "intro-card intro-player";
    playerCard.style.borderColor = hexToRgba(playerColor, 0.85);
    playerCard.style.boxShadow = "0 0 25px " + hexToRgba(playerColor, 0.6);
    setIntroCardImage(playerCard, battle.player.image);

    let enemyCard = document.createElement("div");
    enemyCard.className = "intro-card intro-enemy";
    enemyCard.style.borderColor = hexToRgba(enemyColor, 0.85);
    enemyCard.style.boxShadow = "0 0 25px " + hexToRgba(enemyColor, 0.6);
    setIntroCardImage(enemyCard, battle.enemy.image);

    let vs = document.createElement("div");
    vs.className = "intro-vs";
    vs.textContent = "VS";
    vs.style.backgroundImage = `linear-gradient(90deg, ${enemyColor}, ${playerColor})`;
    vs.style.filter =
        `drop-shadow(0 0 14px ${hexToRgba(enemyColor,0.8)}) drop-shadow(0 0 14px ${hexToRgba(playerColor,0.8)})`;

    let lineLeft = document.createElement("div");
    lineLeft.className = "intro-vs-line intro-vs-line-left";
    lineLeft.style.backgroundImage =
        `linear-gradient(90deg, ${enemyColor}, ${playerColor}, ${enemyColor}, ${playerColor})`;

    let lineRight = document.createElement("div");
    lineRight.className = "intro-vs-line intro-vs-line-right";
    lineRight.style.backgroundImage =
        `linear-gradient(90deg, ${enemyColor}, ${playerColor}, ${enemyColor}, ${playerColor})`;

    let flash = document.createElement("div");
    flash.className = "intro-flash";

    // موجتان ملوّنتان (لون كل مقاتل) تنبعثان من نقطة الاصطدام
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

    // مرحلة 1: البطاقتان تتقاربان حتى تتلامسا بالضبط في المنتصف (تصادم حقيقي، بدون تداخل)
    playerCard.classList.add("slide-in");
    enemyCard.classList.add("slide-in");

    await wait(600);

    // لحظة الاصطدام: ومضة ضوء + اهتزاز + خطا ضوء + أمواج ملوّنة + ظهور VS
    flash.classList.add("play");
    vs.classList.add("show");
    lineLeft.classList.add("show");
    lineRight.classList.add("show");
    wavePlayer.classList.add("show");

    arena.classList.add("shake");

    await wait(120);

    waveEnemy.classList.add("show");

    // مرحلة 2: كل بطاقة ترتد للخلف قليلًا (رد فعل الاصطدام) ويبقى فراغ بينهما لـ VS والأمواج
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

    await startCountdownAndRace(prefix);

}



// ========================================
// العد التنازلي + سباق أول ضغطة
// ========================================

async function startCountdownAndRace(prefix){

    let btn = document.getElementById(prefix + "-attack-button");

    let timerBox = document.getElementById(prefix + "-battle-timer");

    let countOverlay = document.getElementById(prefix + "-count-overlay");

    battle.phase = "countdown";

    timerBox.textContent = "";

    // الزر ظاهر وأحمر منذ البداية، ويبقى قابلاً للضغط عمدًا أثناء العد —
    // حتى يقدر الكود يرصد الضغط المبكر ويعاقب عليه (بدل ما يتجاهله المتصفح
    // تلقائيًا لكونه disabled، وهو ما كان يجعل عقوبة الضغط المبكر ميتة
    // تمامًا ولا تُنفَّذ أبدًا، فينفع الـ spam بلا أي رادع)
    btn.style.visibility = "visible";

    btn.disabled = false;

    battle.raceButtonLockedUntil = 0;

    btn.onclick = () => handleEarlyPress(prefix);


    // عداد تصاعدي 1 ثم 2 ثم 3 فوق الزر مباشرة
    for(let n = 1; n <= 3; n++){

        if(countOverlay){

            countOverlay.textContent = n;

            countOverlay.classList.remove("show");

            void countOverlay.offsetWidth; // إعادة تشغيل الأنيميشن

            countOverlay.classList.add("show");

        }

        await wait(750);

    }

    if(countOverlay){

        countOverlay.textContent = "";

        countOverlay.classList.remove("show");

    }


    // الآن الزر مفعّل، من يضغطه أولاً يبدأ أولاً — لكن إذا كان لا يزال
    // "مشلولاً" بسبب ضغطة مبكرة قريبة من نهاية العد، ننتظر بقية مدة
    // العقوبة أولاً قبل ما نسمح بالسباق فعليًا، حتى لا يفلت المستخدم من
    // العقوبة بمجرد أن ينتهي العد
    battle.phase = "racing";

    let remainingLock = battle.raceButtonLockedUntil - Date.now();

    if(remainingLock > 0){

        await wait(remainingLock);

        if(battle.phase !== "racing") return;

    }

    btn.disabled = false;

    btn.classList.remove("locked");

    btn.classList.add("racing-live");

    btn.onclick = () => handleRacePress(prefix);


    let botDelay = 400 + Math.random() * 1000;

    battle.raceWon = false;

    battle.botRaceTimeout = setTimeout(() => {

        if(battle.raceWon) return;

        battle.raceWon = true;

        battle.turnOwner = "enemy";

        btn.classList.remove("racing-live");

        addBattleLog("الخصم كان أسرع! يبدأ هو أولاً");

        collapseRaceButton(prefix);

        battle.phase = "battle";

        processTurn();

    }, botDelay);

}



function handleEarlyPress(prefix){

    let btn = document.getElementById(prefix + "-attack-button");

    if(btn.disabled) return; // بالفعل تحت العقوبة، تجاهل الضغط الإضافي

    btn.disabled = true;

    btn.classList.add("locked");

    // عقوبة ثانية كاملة (1000ms) على الضغط المبكر، وليس نصف ثانية
    battle.raceButtonLockedUntil = Date.now() + 1000;

    setTimeout(() => {

        // أعد التفعيل فقط لو ما زلنا بمرحلة العد التنازلي (لسه ما بدأ
        // السباق الفعلي)، وإلا فالمنطق في startCountdownAndRace هو من
        // يتكفّل بإعادة التفعيل باحترام بقية العقوبة
        if(battle.phase === "countdown"){

            btn.disabled = false;

            btn.classList.remove("locked");

        }

    }, 1000);

}



// إخفاء الزر بأنيميشن وتقريب البطاقتين من بعض بعد ما ينتهي دوره
function collapseRaceButton(prefix){

    let btn = document.getElementById(prefix + "-attack-button");

    let screen = document.getElementById(prefix + "-battle-screen");

    let arena = screen.querySelector(".battle-arena");

    let wrap = btn ? btn.closest(".attack-button-wrap") : null;

    if(wrap) wrap.classList.add("button-gone");

    if(arena) arena.classList.add("cards-engaged");

    if(btn){

        btn.onclick = null;

        setTimeout(() => {

            btn.style.visibility = "hidden";

        }, 450);

    }

}



function handleRacePress(prefix){

    if(battle.raceWon) return;

    battle.raceWon = true;

    clearTimeout(battle.botRaceTimeout);

    battle.turnOwner = "player";

    document.getElementById(prefix + "-battle-timer").textContent = "";

    addBattleLog("لقد بدأت أنت أولاً!");

    collapseRaceButton(prefix);

    battle.phase = "battle";

    processTurn();

}



// ========================================
// دورة الأدوار الرئيسية
// ========================================

function processTurn(){

    if(battle.finished) return;

    let currentFighter =
    (battle.turnOwner === "enemy") ? battle.enemy : battle.player;

    // فحص التجميد/الشلل: صاحب الدور المجمّد يخسر دوره بالكامل بدون أي
    // فعل (حتى الدفاع أو السرقة)، والدور ينتقل مباشرة للطرف الآخر
    if(currentFighter.frozenTurns && currentFighter.frozenTurns > 0){

        currentFighter.frozenTurns--;

        addBattleLog(`${currentFighter.name} ما زال مجمدًا ولا يستطيع الحركة هذا الدور!`);

        setTurnIndicatorText(
            "pve-turn-indicator",
            currentFighter === battle.player ? "🥶 أنت مجمّد! يخسر دورك بالكامل" : "🧊 الخصم مجمّد! يخسر دوره بالكامل",
            "frozen-note"
        );

        renderSkillButtons(battle.prefix);

        setTimeout(() => {

            if(battle.finished) return;

            battle.turnOwner =
            (battle.turnOwner === "enemy") ? "player" : "enemy";

            processTurn();

        }, 900);

        return;

    }

    setTurnIndicatorText(
        "pve-turn-indicator",
        battle.turnOwner === "player" ? "🟢 دورك الآن" : "⏳ دور الخصم...",
        battle.turnOwner === "player" ? "my-turn" : "opp-turn"
    );

    if(battle.turnOwner === "enemy"){

        enemyAct();

    } else {

        startTurnTimer();

    }

    renderSkillButtons(battle.prefix);

}



// ========================================
// رسم أزرار المهارات (هجوم / مهارة مميزة + المهارات المسروقة)
// الدفاع أيضًا زر عادي يضغطه اللاعب بنفسه في الوقت المناسب
//
// تُعرض 4 مهارات كحد أقصى في كل صفحة. إن كانت هناك مهارات أكثر، يمكن
// الانتقال بينها بسحب اللمس (يمينًا/يسارًا) أو بالنقر على النقاط أسفل
// الأزرار، والتي تُظهر أيضًا في أي مجموعة من أربع مهارات نحن حاليًا.
// ========================================

const SKILLS_PER_PAGE = 4;


function chunkSkills(list, size){

    let chunks = [];

    for(let i = 0; i < list.length; i += size){

        chunks.push(list.slice(i, i + size));

    }

    return chunks.length > 0 ? chunks : [[]];

}


function buildSkillButton(skill){

    let btn = document.createElement("button");

    btn.innerHTML =
    `<span class="skill-name">${escapeHtml(skill.name)}</span>`;

    let ready = isSkillReady(battle.player, skill);

    let remaining = cooldownTurnsRemaining(battle.player, skill);

    // هل خُتمت هذه المهارة بمهارة ختم من الخصم؟ لا يمكن استخدامها إطلاقًا
    let sealed = isSkillSealed(battle.player, skill);

    // الدفاع أصبح يستهلك الدور تمامًا مثل الهجوم، لذا يُقفل خارج دور اللاعب أيضًا.
    // السرقة والنسخ فقط تبقيان متاحتين في أي وقت. الختم/فك الختم فعلان يستهلكان الدور.
    let isTurnLocked =
    skill.effect !== "steal"
    && skill.effect !== "copy"
    && battle.turnOwner !== "player";

    // ملاحظة مهمة: لا نستخدم btn.disabled هنا رغم أن المهارة مقفلة فعليًا.
    // العنصر disabled في المتصفح يمنع كل أحداث الإصبع/الفأرة عنه تمامًا
    // (بما فيها pointerdown)، فيصبح الضغط المطوّل لعرض الوصف مستحيلاً على
    // زر مقفل — وهذا بالذات كان يمنع رؤية وصف مهاراتك كل مرة لا يكون
    // دورك أو تكون المهارة في تهدئة. الحماية الفعلية من الاستخدام غير
    // المسموح تبقى داخل handleSkillClick نفسها (تتحقق من الدور/التهدئة
    // وتتجاهل الضغط أو تُنبّه)، ونكتفي هنا بمظهر بصري "مقفل" فقط
    let locked = sealed || !ready || isTurnLocked || battle.finished;

    btn.classList.toggle("skill-locked", locked);

    if(sealed){

        btn.classList.add("skill-sealed");

        let badge = document.createElement("span");

        badge.className = "sealed-badge";

        badge.textContent = "🔒";

        btn.appendChild(badge);

    }

    if(!ready && remaining > 0){

        btn.classList.add("on-cooldown");

        let badge = document.createElement("span");

        badge.className = "cooldown-badge";

        badge.textContent = remaining;

        btn.appendChild(badge);

    }

    btn.onclick = () => handleSkillClick(skill);

    attachSkillLongPress(btn, skill);

    return btn;

}


// يُبدّل الصفحة/النقطة النشطة فقط (بدون إعادة بناء الأزرار)، ويحفظ
// رقم الصفحة الحالية على الحاوية حتى لا يُعاد اللاعب لأول صفحة في
// كل مرة تُحدَّث فيها الأزرار (تهدئة، تبديل دور...)
function goToSkillsPage(prefix, index){

    let pagesEl = document.getElementById(prefix + "-player-skills-pages");

    if(!pagesEl) return;

    let pages = pagesEl.querySelectorAll(".skills-page");

    if(pages.length === 0) return;

    index = Math.max(0, Math.min(index, pages.length - 1));

    pagesEl.dataset.activePage = String(index);

    pages.forEach((p, i) => p.classList.toggle("active", i === index));

    let container = pagesEl.closest(".skills-container");

    let dots = container ? container.querySelectorAll(".skill-dots span") : [];

    dots.forEach((d, i) => d.classList.toggle("active", i === index));

}


function renderSkillButtons(prefix){

    if(!battle.player) return;

    let pagesEl = document.getElementById(prefix + "-player-skills-pages");

    if(!pagesEl) return;

    let container = pagesEl.closest(".skills-container");

    // نحافظ على رقم الصفحة الحالية عبر إعادات الرسم المتكررة (تهدئة، دور...)
    let currentIndex = Number(pagesEl.dataset.activePage || 0);

    let allSkills = allPlayerSkills(battle.player);

    let pagesOfSkills = chunkSkills(allSkills, SKILLS_PER_PAGE);

    currentIndex = Math.max(0, Math.min(currentIndex, pagesOfSkills.length - 1));


    pagesEl.innerHTML = "";

    pagesOfSkills.forEach((skillsChunk, i) => {

        let pageDiv = document.createElement("div");

        pageDiv.className = "skills-page" + (i === currentIndex ? " active" : "");

        // خلفية مخصصة لهذه الصفحة من لوحة الإدارة (إن وُجدت)
        let pageBg = getSkillPageBackground(battle.player.characterId, i);

        if(pageBg){

            pageDiv.classList.add("skill-page-bg");

            pageDiv.style.backgroundImage = "url('" + pageBg.replace(/'/g, "\\'") + "')";

        }

        skillsChunk.forEach(skill => {

            pageDiv.appendChild(buildSkillButton(skill));

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

                dot.onclick = () => goToSkillsPage(prefix, i);

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
                if(active < pages.length - 1) goToSkillsPage(prefix, active + 1);

            } else {

                // سحب لليمين → الصفحة السابقة
                if(active > 0) goToSkillsPage(prefix, active - 1);

            }

        }, { passive: true });

    }

}



function handleSkillClick(skill){

    if(battle.finished) return;

    // المهارة المختومة لا يمكن استخدامها إطلاقًا حتى نهاية النزال
    if(isSkillSealed(battle.player, skill)){

        alert("هذه المهارة مختومة 🔒 ولا يمكن استخدامها حتى نهاية النزال");

        return;

    }

    if(skill.type === "defense"){

        if(battle.turnOwner !== "player") return;

        if(!isSkillReady(battle.player, skill)){

            alert("هذه المهارة ما زالت في التهدئة");

            return;

        }

        useDefense(skill);

        return;

    }

    if(skill.effect === "steal"){

        openStealMenu(skill);

        return;

    }

    if(skill.effect === "copy"){

        openCopyMenu(skill);

        return;

    }

    if(skill.effect === "seal"){

        openSealMenu(skill);

        return;

    }

    if(skill.effect === "unseal"){

        openUnsealMenu(skill);

        return;

    }

    // هجوم عادي أو مهارة مميزة ضررية = فعل يستهلك الدور
    if(battle.turnOwner !== "player") return;

    if(!isSkillReady(battle.player, skill)){

        alert("هذه المهارة ما زالت في التهدئة");

        return;

    }

    playerConsumeTurn(skill, "enemy");

}



// ========================================
// اختيار الهدف عند استخدام مهارة مسروقة (تُستخدم فورًا لحظة السرقة)
// ========================================

function openStealTargetMenu(targetSkill, onChoose, onSkip, verbLabel = "المسروقة"){

    closeStealTargetMenu();

    let modal = document.createElement("div");

    modal.id = "target-modal";

    modal.className = "steal-modal";

    modal.innerHTML = `

        <div class="steal-modal-box">

            <h3>🎯 استخدم "${escapeHtml(targetSkill.name)}" ${verbLabel} على من؟</h3>

            <div class="steal-modal-buttons">

                <button id="target-enemy-btn">الخصم</button>

                <button id="target-self-btn">نفسي</button>

            </div>

            <p class="steal-or" style="margin-top:12px;">

                <button id="target-cancel-btn">تخطّي</button>

            </p>

        </div>

    `;

    document.body.appendChild(modal);

    modal.querySelector("#target-enemy-btn").onclick = () => {

        closeStealTargetMenu();

        onChoose("enemy");

    };

    modal.querySelector("#target-self-btn").onclick = () => {

        closeStealTargetMenu();

        onChoose("self");

    };

    modal.querySelector("#target-cancel-btn").onclick = () => {

        closeStealTargetMenu();

        if(onSkip) onSkip();

    };

}


function closeStealTargetMenu(){

    let modal = document.getElementById("target-modal");

    if(modal) modal.remove();

}



// ========================================
// ضغطة مطوّلة على مهارة: عرض وصف تفصيلي (الوصف/الضرر/التهدئة)
// ========================================

function attachSkillLongPress(btn, skill){

    let pressTimer = null;

    let longPressed = false;

    let start = () => {

        longPressed = false;

        clearTimeout(pressTimer);

        pressTimer = setTimeout(() => {

            longPressed = true;

            showSkillDetails(skill);

        }, 500);

    };

    let cancel = () => {

        clearTimeout(pressTimer);

    };

    btn.addEventListener("pointerdown", start);

    btn.addEventListener("pointerup", cancel);

    btn.addEventListener("pointerleave", cancel);

    btn.addEventListener("pointercancel", cancel);

    btn.addEventListener("contextmenu", (e) => e.preventDefault());

    let originalOnclick = btn.onclick;

    btn.onclick = (e) => {

        if(longPressed){

            longPressed = false;

            return;

        }

        if(originalOnclick) originalOnclick(e);

    };

}


function showSkillDetails(skill){

    closeSkillDetailsModal();

    let modal = document.createElement("div");

    modal.id = "skill-details-modal";

    modal.className = "steal-modal";

    let dmgLine =
    (skill.damage && Number(skill.damage) > 0)
    ? `<p class="skill-detail-line"><strong>الضرر:</strong> ${skill.damage}</p>`
    : "";

    let cdLine =
    `<p class="skill-detail-line"><strong>التهدئة:</strong> ${
        (skill.cooldown && skill.cooldown > 0) ? (skill.cooldown + " دورة") : "بدون تهدئة"
    }</p>`;

    let descText = skill.description
    ? skill.description
    : "لا يوجد وصف لهذه المهارة";

    modal.innerHTML = `

        <div class="steal-modal-box">

            <h3>${escapeHtml(skill.name)}</h3>

            <p class="skill-desc-text">${escapeHtml(descText)}</p>

            ${dmgLine}

            ${cdLine}

            <div class="steal-modal-buttons">

                <button id="skill-details-close-btn">إغلاق</button>

            </div>

        </div>

    `;

    document.body.appendChild(modal);

    modal.querySelector("#skill-details-close-btn").onclick = closeSkillDetailsModal;

    // نُؤخّر ربط إغلاق الخلفية خطوة واحدة: القافزة تفتح أثناء استمرار
    // الضغط (بعد 500ms)، فإن رُبط الإغلاق فورًا فإن رفع الإصبع/الفأرة
    // يُطلق "click" على الخلفية التي ظهرت للتو تحت المؤشر ويُغلقها مباشرة
    setTimeout(() => {

        modal.onclick = (e) => {

            if(e.target === modal) closeSkillDetailsModal();

        };

    }, 0);

}


function closeSkillDetailsModal(){

    let modal = document.getElementById("skill-details-modal");

    if(modal) modal.remove();

}



function playerConsumeTurn(skill, target){

    clearTurnTimer();

    let defender =
    (target === "self") ? battle.player : battle.enemy;

    // نفس إصلاح الغول: إذا كان عند اللاعب ضربة سابقة لم يدافع عنها، واختار
    // الآن الهجوم بدل الدفاع، تلك الضربة "فائتة" ولا يجوز إلغاؤها لاحقًا
    if(battle.player.lastHitSnapshot && !battle.player.lastHitSnapshot.consumed){

        battle.player.lastHitSnapshot.consumed = true;

    }

    // نفس إصلاح enemyAct: نُسجّل الدور والتهدئة قبل resolveAction
    battle.player.turnsTaken++;

    if(skill.cooldown > 0)
        battle.player.cooldownUsedAt[skill.id] = battle.player.turnsTaken;

    resolveAction(battle.player, defender, skill);

    if(checkBattleEnd()) return;

    battle.turnOwner = "enemy";

    setTimeout(processTurn, 900);

}



async function enemyAct(){

    renderSkillButtons(battle.prefix);

    await wait(700);

    if(battle.finished) return;

    let enemy = battle.enemy;

    // الدفاع صار خيار دور الخصم نفسه تمامًا مثل اللاعب: إمّا يدافع (يلغي
    // آخر ضربة) أو يهاجم، وليس الاثنين معًا في نفس الجولة.
    let defenseSkill = enemy.skills.find(s => s.type === "defense");

    let canDefend =
    defenseSkill
    && isSkillReady(enemy, defenseSkill)
    && !isSkillSealed(enemy, defenseSkill)
    && enemy.lastHitSnapshot
    && !enemy.lastHitSnapshot.consumed;

    if(canDefend && Math.random() < 0.5){

        enemy.hp = enemy.lastHitSnapshot.hpBefore;

        enemy.lastHitSnapshot.consumed = true;

        // الدفاع فعل ينهي حالة انعكاس الخصم السابقة (مطابقة لمنطق PvP)
        enemy.reflectMultiplier = 0;

        let enduranceHits = Math.max(1, Number(defenseSkill.damage) || 1);

        enemy.shieldCharges = (enemy.shieldCharges || 0) + (enduranceHits - 1);

        enemy.turnsTaken++;

        if(defenseSkill.cooldown > 0)
            enemy.cooldownUsedAt[defenseSkill.id] = enemy.turnsTaken;

        markEnemySkillUsed(defenseSkill);

        renderUsedSkillsUI(battle.prefix);

        updateBattleScreen();

        addBattleLog(
        enduranceHits > 1
        ? `${enemy.name} استخدم الدفاع وألغى الضربة! (يتحمّل ${enduranceHits - 1} ضربات إضافية تلقائيًا)`
        : `${enemy.name} استخدم الدفاع وألغى الضربة!`
        );

        showBattleEffectBanner(battle.prefix, "🛡️ الخصم استخدم الدفاع وألغى الضربة!", "defense");

        if(checkBattleEnd()) return;

        battle.turnOwner = "player";

        processTurn();

        return;

    }

    // إصلاح ثغرة: إذا لم يدافع الخصم عن آخر ضربة تلقاها (سواء لأن الدفاع
    // بتهدئة، أو لأنه اختار الهجوم بدل الدفاع)، تُصبح تلك الضربة "فائتة"
    // ولا يجوز إلغاؤها لاحقًا بعد أدوار قادمة — وإلا يرجع دمه من العدم في
    // جولة لاحقة دون أي ضربة جديدة فعلية
    if(enemy.lastHitSnapshot && !enemy.lastHitSnapshot.consumed){

        enemy.lastHitSnapshot.consumed = true;

    }

    let special =
    enemy.skills.find(s =>
        s.type === "special"
        && s.effect !== "steal" && s.effect !== "copy" && s.effect !== "reflect"
        && s.effect !== "seal" && s.effect !== "unseal"
        && !isSkillSealed(enemy, s)
        && isSkillReady(enemy, s));

    // مهارة الانعكاس تُستخدم كخيار احتياطي فقط: إذا لم تكن هناك مهارة مميزة
    // أخرى جاهزة، ولم يكن الخصم في وضع انعكاس فعلًا (حتى لا يُجدّدها بلا فائدة)
    let reflectSkill =
    (enemy.reflectMultiplier <= 0) &&
    enemy.skills.find(s =>
        s.type === "special" && s.effect === "reflect" && !isSkillSealed(enemy, s) && isSkillReady(enemy, s));

    // مهارة الختم: يختم الخصم مهارة عشوائية استخدمها اللاعب في هذا النزال
    // (غير مختومة). مهارة فك الختم: يحرر عشوائيًا إحدى مهاراته المختومة.
    // كلتاهما خيارات احتمالية (لا يُستخدمان في كل دور) حتى لا تصيرا
    // المهارة الوحيدة التي يكررها الخصم
    let sealSkill =
    enemy.skills.find(s =>
        s.type === "special" && s.effect === "seal" && !isSkillSealed(enemy, s) && isSkillReady(enemy, s));

    let unsealSkill =
    enemy.skills.find(s =>
        s.type === "special" && s.effect === "unseal" && !isSkillSealed(enemy, s) && isSkillReady(enemy, s));

    let sealablePlayerSkills =
    battle.playerUsedSkills.filter(s => !isSkillSealed(battle.player, s));

    let sealChoice =
    (sealSkill && sealablePlayerSkills.length > 0 && Math.random() < 0.6)
    ? sealSkill
    : null;

    let unsealChoice =
    (unsealSkill && (enemy.sealedSkillIds || []).length > 0 && Math.random() < 0.8)
    ? unsealSkill
    : null;

    let chosen =
    special
    || sealChoice
    || unsealChoice
    || reflectSkill
    || enemy.skills.find(s => s.type === "attack" && !isSkillSealed(enemy, s));

    // نُسجّل الدور والتهدئة قبل resolveAction لأنها هي من تُحدّث الواجهة
    // (renderUsedSkillsUI / updateBattleScreen)، وإلا تظهر شارة التهدئة
    // متأخرة بخطوة واحدة عن الحالة الفعلية
    enemy.turnsTaken++;

    if(chosen.cooldown > 0)
        enemy.cooldownUsedAt[chosen.id] = enemy.turnsTaken;

    if(chosen.effect === "seal" || chosen.effect === "unseal"){

        enemyUseSealOrUnseal(chosen);

        return;

    }

    resolveAction(enemy, battle.player, chosen);

    if(checkBattleEnd()) return;

    battle.turnOwner = "player";

    processTurn();

}


// تطبيق مهارتي الختم/فك الختم من جانب الخصم: تختاران هدفًا عشوائيًا صالحًا
// وتُطبّقان أثرهما مباشرة (يُسجَّل الدور والتهدئة من قِبل المتصل)
function enemyUseSealOrUnseal(skill){

    let enemy = battle.enemy;

    markEnemySkillUsed(skill);

    if(skill.effect === "seal"){

        let sealable =
        battle.playerUsedSkills.filter(s => !isSkillSealed(battle.player, s));

        let target = sealable[Math.floor(Math.random() * sealable.length)];

        if(!target){

            addBattleLog(`${enemy.name} حاول ختم مهارة لكن لا توجد مهارة قابلة للختم الآن`);

        } else {

            battle.player.sealedSkillIds = battle.player.sealedSkillIds || [];

            if(!battle.player.sealedSkillIds.includes(target.id)){

                battle.player.sealedSkillIds.push(target.id);

            }

            addBattleLog(`${enemy.name} ختم مهارة "${target.name}" حتى نهاية النزال!`);

            showBattleEffectBanner(battle.prefix, `🔒 الخصم ختم مهارة "${target.name}"!`, "seal");

        }

    } else {

        let sealedList = enemy.sealedSkillIds || [];

        let targetId = sealedList[Math.floor(Math.random() * sealedList.length)];

        if(!targetId){

            addBattleLog(`${enemy.name} حاول فك الختم لكن لا توجد مهارة مختومة لديه`);

        } else {

            enemy.sealedSkillIds = sealedList.filter(id => id !== targetId);

            let skillObj = enemy.skills.find(s => s.id === targetId);

            let skillName = skillObj ? skillObj.name : "مهارة";

            addBattleLog(`${enemy.name} فك الختم عن مهارة "${skillName}"!`);

            showBattleEffectBanner(battle.prefix, `🔓 الخصم فك الختم عن "${skillName}"!`, "unseal");

        }

    }

    renderUsedSkillsUI(battle.prefix);

    renderSkillButtons(battle.prefix);

    updateBattleScreen();

    if(checkBattleEnd()) return;

    battle.turnOwner = "player";

    processTurn();

}



// ========================================
// عرض شرائح المهارات الظاهرة (الخصم/اللاعب)
// ========================================


function renderUsedSkillsUI(prefix){

    let enemyBox = document.getElementById(prefix + "-enemy-used-skills");

    let playerBox = document.getElementById(prefix + "-player-used-skills");

    // نفس إصلاح PvP: لا نعيد بناء الشرائح إلا إذا تغيّر محتواها فعليًا
    // (الاسم أو حالة التهدئة)، حتى لا يُقطع الضغط المطوّل على شريحة قيد
    // إعادة الرسم في نفس اللحظة
    if(enemyBox){

        let key = battle.enemyUsedSkills.map(s => {
            let ready = isSkillReady(battle.enemy, s);
            let remaining = cooldownTurnsRemaining(battle.enemy, s);
            let sealed = isSkillSealed(battle.enemy, s) ? "S" : "0";
            return s.id + ":" + (!ready && remaining > 0 ? remaining : "0") + ":" + sealed;
        }).join(",");

        if(enemyBox.dataset.renderedKey !== key){

        enemyBox.dataset.renderedKey = key;

        enemyBox.innerHTML = "";

        battle.enemyUsedSkills.forEach(s => {

            let ready = isSkillReady(battle.enemy, s);

            let remaining = cooldownTurnsRemaining(battle.enemy, s);

            let sealed = isSkillSealed(battle.enemy, s);

            let chip = document.createElement("span");

            chip.className = "used-skill-chip" + ((!ready && remaining > 0) ? " on-cooldown" : "") + (sealed ? " sealed" : "");

            chip.textContent = s.name + (sealed ? " 🔒" : "");

            if(!ready && remaining > 0){

                let badge = document.createElement("span");

                badge.className = "cooldown-badge";

                badge.textContent = remaining;

                chip.appendChild(badge);

            }

            attachSkillLongPress(chip, s);

            enemyBox.appendChild(chip);

        });

        }

    }

    if(playerBox){

        let key = battle.playerUsedSkills.map(s => {
            return s.id + ":" + (isSkillSealed(battle.player, s) ? "S" : "0");
        }).join(",");

        if(playerBox.dataset.renderedKey !== key){

        playerBox.dataset.renderedKey = key;

        playerBox.innerHTML = "";

        battle.playerUsedSkills.forEach(s => {

            let sealed = isSkillSealed(battle.player, s);

            let chip = document.createElement("span");

            chip.className = "used-skill-chip" + (sealed ? " sealed" : "");

            chip.textContent = s.name + (sealed ? " 🔒" : "");

            attachSkillLongPress(chip, s);

            playerBox.appendChild(chip);

        });

        }

    }

}



function resolveAction(attacker, defender, skill, trackUsed = true){

    let dmg = calcDamage(skill);

    // مهارة انعكاس: لا ضرر مباشر — تُفعّل وضع الانعكاس لدى المهاجم (يرتد
    // الضرر القادم إليه كاملًا × المضاعف على مصدره). أي فعل آخر يُنهي حالة
    // انعكاس المهاجم السابقة التي كانت تنتظر ضربة الخصم القادمة فقط.
    let isReflectSkill = skill.effect === "reflect";

    if(isReflectSkill){

        attacker.reflectMultiplier = Math.max(1, Number(skill.damage) || 1);

        dmg = 0;

    } else {

        attacker.reflectMultiplier = 0;

    }

    let hpBefore = defender.hp;

    // انعكاس الخصم: يُحسب على أساس الضرر الوارد قبل امتصاص الدرع — إن كان
    // المدافع في وضع انعكاس والهجوم ليس "لا تُصد" وسبّب ضررًا فعلًا، يرتد
    // الضرر كاملًا × مضاعف انعكاسه على المهاجم نفسه (حتى لو امتصّ الدرع
    // الضربة عن المدافع، فالهجوم الحقيقي ما زال انعكس على مصدره)، وتُستهلك
    // حالة الانعكاس (وضع مرّة واحدة فقط) — نفس سلوك سيرفر PvP
    let reflectedDmg = 0;

    if(!skill.unblockable && dmg > 0 && (defender.reflectMultiplier || 0) > 0){

        reflectedDmg = dmg * defender.reflectMultiplier;

        defender.reflectMultiplier = 0;

        attacker.hp = Math.max(0, attacker.hp - reflectedDmg);

    }

    // درع "تحمّل عدة ضربات" المتبقي من دفاع سابق: يمتص هذه الضربة تلقائيًا
    // (طالما ليست "لا تُصد") وينقص شحنة واحدة، بدل تطبيق الضرر مباشرة
    let absorbedByShield =
    !skill.unblockable && dmg > 0 && (defender.shieldCharges || 0) > 0;

    if(absorbedByShield){

        defender.shieldCharges--;

        dmg = 0;

    } else {

        defender.hp = Math.max(0, defender.hp - dmg);

    }

    // إن كانت المهارة "لا تُصد" (unblockable)، تُعتبر الضربة مستهلكة فورًا
    // حتى لا يقدر الدفاع (عادي أو مسروق) على إلغائها لاحقًا. وكذلك إن
    // امتصّها الدرع، فلا يوجد ضرر جديد يحتاج اللاعب لإلغائه يدويًا.
    // مهارة الانعكاس لا تُنشئ "ضربة معلّقة" على الهدف إطلاقًا (لا ضرر فعلي)
    if(skill.effect !== "reflect"){

        defender.lastHitSnapshot = { hpBefore: hpBefore, consumed: !!skill.unblockable || absorbedByShield };

    }

    // مهارة "امتصاص" (lifesteal): يعالج المهاجم نفسه بمقدار الضرر الفعلي
    // الذي تسبّبه (بعد الدرع/الصد)، أي إن مُنع الضرر كله فلا شفاء — وصولاً
    // للحد الأقصى من الصحة فقط
    let healedAmount = 0;

    if(skill.effect === "lifesteal" && dmg > 0 && attacker.hp < attacker.maxHp){

        healedAmount = Math.min(dmg, attacker.maxHp - attacker.hp);

        attacker.hp += healedAmount;

    }

    if(!trackUsed){

        // مهارة مسروقة: لا تُضاف إلى قائمة "مهاراتي المستخدمة"، فقط
        // مهارة السرقة نفسها تُضاف (تُسجَّل لاحقًا من قِبل المستدعي)

    } else if(attacker === battle.enemy){

        markEnemySkillUsed(skill);

    } else if(attacker === battle.player){

        if(!battle.playerUsedSkills.find(s => s.id === skill.id)){

            battle.playerUsedSkills.push(skill);

        }

    }

    renderUsedSkillsUI(battle.prefix);

    updateBattleScreen();

    let defenderPrefix =
    (defender === battle.player)
    ? battle.prefix + "-player"
    : battle.prefix + "-enemy";

    applyDamageEffect(battle.prefix, defenderPrefix, dmg, false);

    // رقم شفاء الامتصاص يظهر فوق بطاقة المهاجم نفسه (قيمة خضراء +)
    if(healedAmount > 0){

        let attackerPrefix =
        (attacker === battle.player)
        ? battle.prefix + "-player"
        : battle.prefix + "-enemy";

        showDamagePopup(attackerPrefix, healedAmount, true);

    }

    // ضرر الانعكاس المرتدّ يظهر فوق بطاقة المهاجم نفسه (الذي تلقّى الصفعة)
    if(reflectedDmg > 0){

        playHitEffect(battle.prefix);

        let attackerPrefix =
        (attacker === battle.player)
        ? battle.prefix + "-player"
        : battle.prefix + "-enemy";

        showDamagePopup(attackerPrefix, reflectedDmg, false);

    }

    // شارة الحدث في منتصف الساحة: توضّح فورًا هل الضربة نجحت، أم امتصّها
    // الدرع، أم كانت تجميدًا — دون الحاجة لفتح سجل المعركة
    let iAmDefender = (defender === battle.player);

    // شارة الحدث: الانعكاس أولًا في الأهمية حتى لو امتصّ الدرع الضربة أيضًا
    // (كانت شارة الدرع تحل محل شارة الانعكاس فتختفي رسالة "عكس الضرر")
    if(reflectedDmg > 0){

        showBattleEffectBanner(
            battle.prefix,
            iAmDefender
            ? `🔁 عكستَ ضرر الخصم عليه! -${reflectedDmg}`
            : `🔁 ${defender.name} عكس الضرر عليك! -${reflectedDmg}`,
            "reflect"
        );

    } else if(isReflectSkill){

        showBattleEffectBanner(
            battle.prefix,
            attacker === battle.player
            ? `🔁 وضع الانعكاس نشط ×${attacker.reflectMultiplier}! الضرر القادم سيرتد`
            : `🔁 الخصم في وضع الانعكاس! (×${attacker.reflectMultiplier})`,
            "reflect"
        );

    } else if(absorbedByShield){

        showBattleEffectBanner(
            battle.prefix,
            iAmDefender ? "🛡️ صددتَ الهجوم بالدرع!" : "🛡️ الخصم صدّ هجومك بالدرع!",
            "block"
        );

    } else if(skill.effect === "freeze"){

        showBattleEffectBanner(
            battle.prefix,
            iAmDefender ? "❄️ تم تجميدك!" : "❄️ جمّدتَ الخصم!",
            "freeze"
        );

    } else if(skill.effect === "lifesteal" && healedAmount > 0){

        showBattleEffectBanner(
            battle.prefix,
            iAmDefender
            ? `🩸 تعرّضتَ لهجوم! -${dmg} والخصم امتصّ ${healedAmount} صحة`
            : `🩸 ضربة موفّقة! -${dmg} وامتصصتَ ${healedAmount} صحة`,
            "hit"
        );

    } else if(dmg > 0){

        showBattleEffectBanner(
            battle.prefix,
            iAmDefender ? `💥 تعرّضتَ لهجوم! -${dmg}` : `⚔️ ضربة موفّقة! -${dmg}`,
            "hit"
        );

    }

    // سجل المعركة: الانعكاس قبل الدرع، مع توضيح إن امتصّ الدرع الضربة
    // أيضًا (كان فرع الدرع يخفي سجل الانعكاس تمامًا عند اجتماعهما)
    if(reflectedDmg > 0){

        let shieldNote = absorbedByShield
        ? ` (وامتصّ ${defender.name} الضربة أيضًا بدرعه!)`
        : "";

        addBattleLog(`${attacker.name} استخدم ${skill.name} → ${dmg} ضرر على ${defender.name}، لكن ${defender.name} عكس الضرر! -${reflectedDmg} على ${attacker.name}${shieldNote}`);

    } else if(absorbedByShield){

        addBattleLog(`${attacker.name} استخدم ${skill.name}، لكن ${defender.name} امتصّها بدرعه! (متبقٍ ${defender.shieldCharges} من التحمّل)`);

    } else if(skill.effect === "lifesteal" && healedAmount > 0){

        addBattleLog(`${attacker.name} استخدم ${skill.name} → ${dmg} ضرر وامتصّ ${healedAmount} صحة`);

    } else if(isReflectSkill){

        addBattleLog(`${attacker.name} استخدم ${skill.name} ودخل في وضع الانعكاس (×${attacker.reflectMultiplier})`);

    } else {

        addBattleLog(`${attacker.name} استخدم ${skill.name} → ${dmg} ضرر`);

    }

    // مهارة الشلل/التجميد: تُجمّد الهدف فيخسر دوره القادم بالكامل (بدون
    // أي فعل، حتى الدفاع) — تُطبَّق بعد رسالة الضرر العادية حتى يظهر
    // للاعب أولاً مقدار الضرر إن وجد، ثم حالة التجميد. عدد الأدوار
    // المجمَّدة يُؤخذ من رقم المهارة نفسه (بدل الضرر، لأنه لا فائدة له هنا)
    if(skill.effect === "freeze"){

        let freezeTurns = Math.max(1, Number(skill.damage) || 1);

        defender.frozenTurns = (defender.frozenTurns || 0) + freezeTurns;

        addBattleLog(`${defender.name} تجمّد! سيخسر ${freezeTurns > 1 ? freezeTurns + " أدوار قادمة" : "دوره القادم"} بالكامل`);

    }

    // ملاحظة: دفاع الخصم لم يعد فعلًا تلقائيًا مجانيًا هنا — صار قرار دوره
    // بالكامل (إمّا يدافع أو يهاجم)، ويُحسم داخل enemyAct عند بداية دوره.

}



// ========================================
// الدفاع (زر يدوي، لا يظهر أي تنبيه — اللاعب يقرر بنفسه)
// ========================================

function useDefense(defenseSkill){

    if(!isSkillReady(battle.player, defenseSkill)){

        alert("الدفاع ما زال في التهدئة");

        return;

    }

    let snapshot = battle.player.lastHitSnapshot;

    if(!snapshot || snapshot.consumed){

        addBattleLog("لا يوجد ضرر حالي لصده");

        return;

    }

    clearTurnTimer();

    battle.player.hp = snapshot.hpBefore;

    snapshot.consumed = true;

    // أي فعل غير الانعكاس (بما فيه الدفاع) يُنهي حالة انعكاس المهاجم السابقة
    // — مطابقة لمنطق السيرفر في PvP حيث يُصفَّر الانعكاس مع أي فعل آخر
    battle.player.reflectMultiplier = 0;

    // رقم مهارة الدفاع الآن يمثّل "عدد الضربات التي يمكن تحمّلها": الضربة
    // الحالية تُلغى فورًا، وأي ضربات إضافية (N-1) تُمتص تلقائيًا لاحقًا
    let enduranceHits = Math.max(1, Number(defenseSkill.damage) || 1);

    battle.player.shieldCharges = (battle.player.shieldCharges || 0) + (enduranceHits - 1);

    // الدفاع الآن يستهلك الدور تمامًا مثل الهجوم
    battle.player.turnsTaken++;

    if(defenseSkill.cooldown > 0)
        battle.player.cooldownUsedAt[defenseSkill.id] = battle.player.turnsTaken;

    if(!battle.playerUsedSkills.find(s => s.id === defenseSkill.id)){

        battle.playerUsedSkills.push(defenseSkill);

    }

    renderUsedSkillsUI(battle.prefix);

    updateBattleScreen();

    addBattleLog(
    enduranceHits > 1
    ? `${battle.player.name} استخدم الدفاع وألغى الضربة! (يتحمّل ${enduranceHits - 1} ضربات إضافية تلقائيًا)`
    : `${battle.player.name} استخدم الدفاع وألغى الضربة!`
    );

    showBattleEffectBanner(battle.prefix, "🛡️ استخدمتَ الدفاع وألغيتَ الضربة!", "defense");

    if(checkBattleEnd()) return;

    battle.turnOwner = "enemy";

    setTimeout(processTurn, 900);

}



// ========================================
// نظام السرقة (مفترس)
// ========================================

function openStealMenu(stealSkill){

    if(!isSkillReady(battle.player, stealSkill)){

        alert("مهارة السرقة ما زالت في التهدئة");

        return;

    }

    closeStealMenu();

    // رقم مهارة السرقة نفسه يمثّل الآن "عدد المهارات الممكن سرقتها
    // واستخدامها فورًا في نفس هذا التفعيل" بدل الضرر (لا فائدة للضرر هنا)
    let maxSteal = Math.max(1, Number(stealSkill.damage) || 1);

    let selectedNames = [];

    let modal = document.createElement("div");

    modal.id = "steal-modal";

    modal.className = "steal-modal";


    // تظهر كل المهارات التي كشفها الخصم دائمًا، حتى لو كانت بتهدئة الآن —
    // فقط تُعلَّم بعداد التهدئة المتبقية وتصير غير قابلة للسرقة مؤقتًا
    let stealableSkills = battle.enemyUsedSkills;

    let usedListHtml = stealableSkills.length > 0
    ? stealableSkills
        .map(s => {

            let ready = isSkillReady(battle.enemy, s);

            let remaining = cooldownTurnsRemaining(battle.enemy, s);

            let cooldownBadge =
            (!ready && remaining > 0)
            ? `<span class="cooldown-badge">${remaining}</span>`
            : "";

            let disabledAttr = ready ? "" : "disabled";

            let onCooldownClass = ready ? "" : "on-cooldown";

            return `<button class="steal-option ${onCooldownClass}" data-name="${escapeHtml(s.name)}" ${disabledAttr}>${escapeHtml(s.name)}${cooldownBadge}</button>`;

        })
        .join("")
    : "<p>لم تظهر أي مهارة من الخصم بعد في هذه المعركة</p>";


    modal.innerHTML = `

        <div class="steal-modal-box">

            <h3>🗡️ اختر حتى ${maxSteal} ${maxSteal === 1 ? "مهارة" : "مهارات"} لسرقتها واستخدامها فورًا</h3>

            <div class="steal-options-list">
                ${usedListHtml}
            </div>

            <p class="steal-or">— أو اكتب اسم المهارة بالضبط وأضفها للاختيار —</p>

            <input id="steal-name-input" type="text" placeholder="اسم المهارة">

            <div class="steal-modal-buttons">

                <button id="steal-add-name-btn">إضافة للاختيار</button>

            </div>

            <p class="steal-or" id="steal-selected-label">لم تُختر أي مهارة بعد (0/${maxSteal})</p>

            <div class="steal-modal-buttons">

                <button id="steal-confirm-btn">سرقة واستخدام</button>

                <button id="steal-cancel-btn">إلغاء</button>

            </div>

        </div>

    `;


    document.body.appendChild(modal);


    function refreshSelectedLabel(){

        let label = document.getElementById("steal-selected-label");

        if(!label) return;

        label.textContent =
        selectedNames.length > 0
        ? `المختارة: ${selectedNames.join("، ")} (${selectedNames.length}/${maxSteal})`
        : `لم تُختر أي مهارة بعد (0/${maxSteal})`;

    }

    function toggleSelect(name, btn){

        let idx = selectedNames.indexOf(name);

        if(idx >= 0){

            selectedNames.splice(idx, 1);

            if(btn) btn.classList.remove("steal-selected");

        } else {

            if(selectedNames.length >= maxSteal){

                alert(`لا يمكن اختيار أكثر من ${maxSteal} ${maxSteal === 1 ? "مهارة" : "مهارات"} في نفس السرقة`);

                return;

            }

            selectedNames.push(name);

            if(btn) btn.classList.add("steal-selected");

        }

        refreshSelectedLabel();

    }


    modal.querySelectorAll(".steal-option").forEach(btn => {

        btn.onclick = () => {

            toggleSelect(btn.dataset.name, btn);

        };

    });


    modal.querySelector("#steal-add-name-btn").onclick = () => {

        let input = document.getElementById("steal-name-input");

        let typedName = input.value.trim();

        if(!typedName){

            alert("اكتب اسم المهارة أولاً");

            return;

        }

        toggleSelect(typedName, null);

        input.value = "";

    };


    modal.querySelector("#steal-cancel-btn").onclick = closeStealMenu;

    modal.querySelector("#steal-confirm-btn").onclick = () => {

        if(selectedNames.length === 0){

            alert("اختر مهارة واحدة على الأقل");

            return;

        }

        attemptStealMulti(stealSkill, selectedNames);

    };

}


function closeStealMenu(){

    let modal = document.getElementById("steal-modal");

    if(modal) modal.remove();

}


// يتحقق من كل الأسماء المختارة، ثم يستهلك دور/تهدئة مهارة السرقة مرة واحدة
// فقط لهذه الدفعة بالكامل، ثم ينفّذ كل مهارة مسروقة فورًا واحدة تلو الأخرى
function attemptStealMulti(stealSkill, names){

    let uniqueNames = [...new Set(names.map(n => n.trim()).filter(Boolean))];

    let resolvedSkills = [];

    for(let name of uniqueNames){

        // السرقة بالاسم المكتوب تعمل حتى لو لم تُستخدم المهارة بعد في هذا
        // النزال — يكفي أنها فعلًا إحدى مهارات الخصم الحقيقية (بعكس النسخ،
        // الذي يقتصر فقط على المهارات التي ظهرت فعليًا في نفس هذا النزال)
        let targetSkill =
        battle.enemy.skills.find(s => s.name.trim() === name);

        if(!targetSkill){

            alert(`لا توجد مهارة بهذا الاسم لدى الخصم: "${name}"`);

            return;

        }

        // لا يمكن سرقة مهارة الخصم وهي حاليًا في فترة تهدئة عنده
        if(!isSkillReady(battle.enemy, targetSkill)){

            alert(`مهارة "${name}" في تهدئة عند الخصم حاليًا، لا يمكن سرقتها الآن`);

            return;

        }

        resolvedSkills.push(targetSkill);

    }

    closeStealMenu();

    clearTurnTimer();

    // إذا استُخدمت هذه الدفعة كفعل دور اللاعب فعلاً (لا خارج دوره)، ولم تحتوِ
    // على أي مهارة دفاع من ضمن ما سُرق (أي لن يُلغَ الضرر بأي شكل ضمن هذه
    // الدفعة نفسها)، فهو بذلك تنازل عن نافذة الدفاع عن أي ضربة سابقة لم
    // يلغِها بعد. أما إن كانت إحدى المهارات المسروقة دفاعًا، فتُترك الضربة
    // كما هي ليتولّى ذلك الدفاع إلغاءها بنفسه داخل الطابور أدناه
    let consumesPlayerTurn = (battle.turnOwner === "player");

    let batchHandlesDefense = resolvedSkills.some(s => s.type === "defense");

    if(consumesPlayerTurn
    && !batchHandlesDefense
    && battle.player.lastHitSnapshot
    && !battle.player.lastHitSnapshot.consumed){

        battle.player.lastHitSnapshot.consumed = true;

    }

    battle.player.turnsTaken++;

    if(stealSkill.cooldown > 0)
        battle.player.cooldownUsedAt[stealSkill.id] = battle.player.turnsTaken;

    if(!battle.playerUsedSkills.find(s => s.id === stealSkill.id)){

        battle.playerUsedSkills.push(stealSkill);

    }

    renderUsedSkillsUI(battle.prefix);

    runStolenSkillsQueue(resolvedSkills, 0, consumesPlayerTurn);

}


// ينفّذ المهارات المسروقة المختارة واحدة تلو الأخرى (فوريًا)، ثم يُسلِّم
// الدور للخصم (أو يُحدّث الأزرار) مرة واحدة فقط بعد انتهاء الدفعة بالكامل
function runStolenSkillsQueue(queue, index, consumesPlayerTurn){

    if(index >= queue.length){

        if(checkBattleEnd()) return;

        // مثل الدفاع، يمكن استخدام السرقة في أي وقت. إن استُخدمت في دور
        // اللاعب فهي تُنهي دوره (كأنها فعله لهذا الدور)، وإن استُخدمت خارج
        // دوره فلا تُغيّر ملكية الدور الحالية.
        if(consumesPlayerTurn){

            battle.turnOwner = "enemy";

            setTimeout(processTurn, 900);

        } else {

            renderSkillButtons(battle.prefix);

        }

        return;

    }

    let targetSkill = queue[index];

    if(targetSkill.type === "defense"){

        // مهارة دفاع مسروقة: تُستخدم فورًا على نفسك فقط (لا يوجد هدف يُختار)
        let snapshot = battle.player.lastHitSnapshot;

        if(snapshot && !snapshot.consumed){

            battle.player.hp = snapshot.hpBefore;

            snapshot.consumed = true;

            let enduranceHits = Math.max(1, Number(targetSkill.damage) || 1);

            battle.player.shieldCharges = (battle.player.shieldCharges || 0) + (enduranceHits - 1);

            updateBattleScreen();

            addBattleLog(
            enduranceHits > 1
            ? `${battle.player.name} استخدم "${targetSkill.name}" المسروقة وألغى الضربة! (يتحمّل ${enduranceHits - 1} ضربات إضافية تلقائيًا)`
            : `${battle.player.name} استخدم "${targetSkill.name}" المسروقة وألغى الضربة!`
            );

        } else {

            alert(`مهارة "${targetSkill.name}" المسروقة دفاعية: لا تُلغي إلا ضررًا موجودًا حاليًا عليك، ولا يوجد ضرر لصده الآن`);

            addBattleLog(`لا يوجد ضرر حالي لصده بمهارة "${targetSkill.name}" المسروقة`);

        }

        runStolenSkillsQueue(queue, index + 1, consumesPlayerTurn);

        return;

    }

    // السرقة تُستخدم فورًا: اللاعب يختار الهدف في نفس اللحظة. التخطّي هنا
    // لا يُلغي الدفعة بالكامل (الدور مُستهلَك أصلاً)، فقط يتجاوز هذه المهارة
    openStealTargetMenu(targetSkill, (target) => {

        let defender = (target === "self") ? battle.player : battle.enemy;

        resolveAction(battle.player, defender, targetSkill, false);

        addBattleLog(`${battle.player.name} استخدم مهارة "${targetSkill.name}" المسروقة!`);

        runStolenSkillsQueue(queue, index + 1, consumesPlayerTurn);

    }, () => {

        addBattleLog(`تم تخطّي استخدام "${targetSkill.name}" المسروقة`);

        runStolenSkillsQueue(queue, index + 1, consumesPlayerTurn);

    });

}




// ========================================
// مهارة "نسخ": نفس فكرة السرقة تمامًا، لكن بفرق جوهري واحد: يمكنها نسخ
// مهارة الخصم واستخدامها فورًا حتى لو كانت تلك المهارة في تهدئة عند
// الخصم حاليًا (السرقة لا تسمح بذلك). مهارة النسخ نفسها لا تملك ضررًا:
// رقمها (damage) يمثّل "عدد المهارات القابلة للنسخ والاستخدام الفوري"،
// ولها تهدئتها الخاصة (cooldown) تمامًا مثل مهارة السرقة.
// ========================================

function openCopyMenu(copySkill){

    if(!isSkillReady(battle.player, copySkill)){

        alert("مهارة النسخ ما زالت في التهدئة");

        return;

    }

    closeCopyMenu();

    let maxCopy = Math.max(1, Number(copySkill.damage) || 1);

    let selectedNames = [];

    let modal = document.createElement("div");

    modal.id = "copy-modal";

    modal.className = "steal-modal";


    // بخلاف السرقة: النسخ يتطلب أن يكون الخصم استخدم المهارة في هذا
    // النزال بالذات (لا يكفي أن يكون استخدمها في نزال سابق)، لكن ضمن هذا
    // النزال تبقى كل مهاراته الظاهرة قابلة للاختيار دائمًا حتى لو كانت
    // حاليًا في تهدئة عنده — النسخ يتجاوز تهدئته عمدًا
    let copyableSkills = battle.enemyUsedSkillsThisBattle;

    let usedListHtml = copyableSkills.length > 0
    ? copyableSkills
        .map(s => `<button class="steal-option" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`)
        .join("")
    : "<p>لم تظهر أي مهارة من الخصم بعد في هذه المعركة</p>";


    modal.innerHTML = `

        <div class="steal-modal-box">

            <h3>📋 اختر حتى ${maxCopy} ${maxCopy === 1 ? "مهارة" : "مهارات"} لنسخها واستخدامها فورًا</h3>

            <div class="steal-options-list">
                ${usedListHtml}
            </div>

            <p class="steal-or" id="copy-selected-label">لم تُختر أي مهارة بعد (0/${maxCopy})</p>

            <div class="steal-modal-buttons">

                <button id="copy-confirm-btn">نسخ واستخدام</button>

                <button id="copy-cancel-btn">إلغاء</button>

            </div>

        </div>

    `;


    document.body.appendChild(modal);


    function refreshSelectedLabel(){

        let label = document.getElementById("copy-selected-label");

        if(!label) return;

        label.textContent =
        selectedNames.length > 0
        ? `المختارة: ${selectedNames.join("، ")} (${selectedNames.length}/${maxCopy})`
        : `لم تُختر أي مهارة بعد (0/${maxCopy})`;

    }

    function toggleSelect(name, btn){

        let idx = selectedNames.indexOf(name);

        if(idx >= 0){

            selectedNames.splice(idx, 1);

            if(btn) btn.classList.remove("steal-selected");

        } else {

            if(selectedNames.length >= maxCopy){

                alert(`لا يمكن اختيار أكثر من ${maxCopy} ${maxCopy === 1 ? "مهارة" : "مهارات"} في نفس النسخ`);

                return;

            }

            selectedNames.push(name);

            if(btn) btn.classList.add("steal-selected");

        }

        refreshSelectedLabel();

    }


    modal.querySelectorAll(".steal-option").forEach(btn => {

        btn.onclick = () => {

            toggleSelect(btn.dataset.name, btn);

        };

    });


    modal.querySelector("#copy-cancel-btn").onclick = closeCopyMenu;

    modal.querySelector("#copy-confirm-btn").onclick = () => {

        if(selectedNames.length === 0){

            alert("اختر مهارة واحدة على الأقل");

            return;

        }

        attemptCopyMulti(copySkill, selectedNames);

    };

}


function closeCopyMenu(){

    let modal = document.getElementById("copy-modal");

    if(modal) modal.remove();

}


// يتحقق من كل الأسماء المختارة (بدون شرط تهدئة الخصم — هذا هو الفرق
// الجوهري عن السرقة)، ثم يستهلك دور/تهدئة مهارة النسخ مرة واحدة فقط
// لهذه الدفعة بالكامل، ثم ينفّذ كل مهارة منسوخة فورًا واحدة تلو الأخرى
function attemptCopyMulti(copySkill, names){

    let uniqueNames = [...new Set(names.map(n => n.trim()).filter(Boolean))];

    let resolvedSkills = [];

    for(let name of uniqueNames){

        // النسخ يكون فقط من المهارات التي استخدمها الخصم فعليًا في هذا النزال
        let targetSkill =
        battle.enemyUsedSkillsThisBattle.find(s => s.name.trim() === name);

        if(!targetSkill){

            alert(`لا توجد مهارة بهذا الاسم ظهرت من الخصم بعد: "${name}"`);

            return;

        }

        // بخلاف السرقة: لا يوجد أي تحقق من تهدئة الخصم هنا عمدًا —
        // النسخ يمكنه نسخ المهارة واستخدامها حتى وهي بتهدئة عنده حاليًا

        resolvedSkills.push(targetSkill);

    }

    closeCopyMenu();

    clearTurnTimer();

    let consumesPlayerTurn = (battle.turnOwner === "player");

    let batchHandlesDefense = resolvedSkills.some(s => s.type === "defense");

    if(consumesPlayerTurn
    && !batchHandlesDefense
    && battle.player.lastHitSnapshot
    && !battle.player.lastHitSnapshot.consumed){

        battle.player.lastHitSnapshot.consumed = true;

    }

    battle.player.turnsTaken++;

    if(copySkill.cooldown > 0)
        battle.player.cooldownUsedAt[copySkill.id] = battle.player.turnsTaken;

    if(!battle.playerUsedSkills.find(s => s.id === copySkill.id)){

        battle.playerUsedSkills.push(copySkill);

    }

    renderUsedSkillsUI(battle.prefix);

    runCopiedSkillsQueue(resolvedSkills, 0, consumesPlayerTurn);

}


// نفس فكرة runStolenSkillsQueue تمامًا (تنفيذ المهارات المنسوخة المختارة
// واحدة تلو الأخرى، ثم تسليم الدور أو تحديث الأزرار مرة واحدة بعد الدفعة)
function runCopiedSkillsQueue(queue, index, consumesPlayerTurn){

    if(index >= queue.length){

        if(checkBattleEnd()) return;

        if(consumesPlayerTurn){

            battle.turnOwner = "enemy";

            setTimeout(processTurn, 900);

        } else {

            renderSkillButtons(battle.prefix);

        }

        return;

    }

    let targetSkill = queue[index];

    if(targetSkill.type === "defense"){

        // مهارة دفاع منسوخة: تُستخدم فورًا على نفسك فقط (لا يوجد هدف يُختار)
        let snapshot = battle.player.lastHitSnapshot;

        if(snapshot && !snapshot.consumed){

            battle.player.hp = snapshot.hpBefore;

            snapshot.consumed = true;

            let enduranceHits = Math.max(1, Number(targetSkill.damage) || 1);

            battle.player.shieldCharges = (battle.player.shieldCharges || 0) + (enduranceHits - 1);

            updateBattleScreen();

            addBattleLog(
            enduranceHits > 1
            ? `${battle.player.name} استخدم "${targetSkill.name}" المنسوخة وألغى الضربة! (يتحمّل ${enduranceHits - 1} ضربات إضافية تلقائيًا)`
            : `${battle.player.name} استخدم "${targetSkill.name}" المنسوخة وألغى الضربة!`
            );

        } else {

            alert(`مهارة "${targetSkill.name}" المنسوخة دفاعية: لا تُلغي إلا ضررًا موجودًا حاليًا عليك، ولا يوجد ضرر لصده الآن`);

            addBattleLog(`لا يوجد ضرر حالي لصده بمهارة "${targetSkill.name}" المنسوخة`);

        }

        runCopiedSkillsQueue(queue, index + 1, consumesPlayerTurn);

        return;

    }

    // النسخ يُستخدم فورًا: اللاعب يختار الهدف في نفس اللحظة
    openStealTargetMenu(targetSkill, (target) => {

        let defender = (target === "self") ? battle.player : battle.enemy;

        resolveAction(battle.player, defender, targetSkill, false);

        addBattleLog(`${battle.player.name} استخدم مهارة "${targetSkill.name}" المنسوخة!`);

        runCopiedSkillsQueue(queue, index + 1, consumesPlayerTurn);

    }, () => {

        addBattleLog(`تم تخطّي استخدام "${targetSkill.name}" المنسوخة`);

        runCopiedSkillsQueue(queue, index + 1, consumesPlayerTurn);

    }, "المنسوخة");

}




// ========================================
// مهارة "ختم": يختار اللاعب حتى N من مهارات الخصم التي استخدمها فعليًا
// في هذا النزال ويختمها حتى نهاية النزال (لا يمكن للخصم استخدامها بعدها).
// رقم المهارة = عدد المهارات القابلة للختم في التفعيل الواحد. فعل يستهلك
// الدور بالكامل (بعكس السرقة/النسخ اللتين تبقىان متاحتين في أي وقت).
// ========================================

function openSealMenu(sealSkill){

    if(battle.turnOwner !== "player") return;

    if(battle.finished) return;

    if(isSkillSealed(battle.player, sealSkill)){

        alert("مهارة الختم هذه مختومة 🔒");

        return;

    }

    if(!isSkillReady(battle.player, sealSkill)){

        alert("مهارة الختم ما زالت في التهدئة");

        return;

    }

    closeSealMenu();

    let maxSeal = Math.max(1, Number(sealSkill.damage) || 1);

    let selectedNames = [];

    // تُختم فقط المهارات التي استخدمها الخصم في هذا النزال بالذات وغير
    // المختومة مسبقًا (لا فائدة من ختم ما هو مختوم فعلًا)
    let sealableSkills =
    battle.enemyUsedSkillsThisBattle.filter(s => !isSkillSealed(battle.enemy, s));

    let usedListHtml = sealableSkills.length > 0
    ? sealableSkills
        .map(s => `<button class="steal-option" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`)
        .join("")
    : "<p>لم يستخدم الخصم أي مهارة في هذه المعركة بعد لتُختم</p>";

    let modal = document.createElement("div");

    modal.id = "seal-modal";

    modal.className = "steal-modal";

    modal.innerHTML = `

        <div class="steal-modal-box">

            <h3>🔒 اختر حتى ${maxSeal} ${maxSeal === 1 ? "مهارة" : "مهارات"} من الخصم لختمها حتى نهاية النزال</h3>

            <div class="steal-options-list">
                ${usedListHtml}
            </div>

            <p class="steal-or" id="seal-selected-label">لم تُختر أي مهارة بعد (0/${maxSeal})</p>

            <div class="steal-modal-buttons">

                <button id="seal-confirm-btn">ختم</button>

                <button id="seal-cancel-btn">إلغاء</button>

            </div>

        </div>

    `;

    document.body.appendChild(modal);


    function refreshSelectedLabel(){

        let label = document.getElementById("seal-selected-label");

        if(!label) return;

        label.textContent =
        selectedNames.length > 0
        ? `المختارة: ${selectedNames.join("، ")} (${selectedNames.length}/${maxSeal})`
        : `لم تُختر أي مهارة بعد (0/${maxSeal})`;

    }

    function toggleSelect(name, btn){

        let idx = selectedNames.indexOf(name);

        if(idx >= 0){

            selectedNames.splice(idx, 1);

            if(btn) btn.classList.remove("steal-selected");

        } else {

            if(selectedNames.length >= maxSeal){

                alert(`لا يمكن اختيار أكثر من ${maxSeal} ${maxSeal === 1 ? "مهارة" : "مهارات"} في نفس الختم`);

                return;

            }

            selectedNames.push(name);

            if(btn) btn.classList.add("steal-selected");

        }

        refreshSelectedLabel();

    }


    modal.querySelectorAll(".steal-option").forEach(btn => {

        btn.onclick = () => {

            toggleSelect(btn.dataset.name, btn);

        };

    });


    modal.querySelector("#seal-cancel-btn").onclick = closeSealMenu;

    modal.querySelector("#seal-confirm-btn").onclick = () => {

        if(selectedNames.length === 0){

            alert("اختر مهارة واحدة على الأقل");

            return;

        }

        attemptSealMulti(sealSkill, selectedNames);

    };

}


function closeSealMenu(){

    let modal = document.getElementById("seal-modal");

    if(modal) modal.remove();

}


// يتحقق من كل الأسماء المختارة (مهارات استخدمها الخصم فعلًا في هذا النزال
// وغير مختومة)، ثم يستهلك دور/تهدئة مهارة الختم مرة واحدة فقط لهذه الدفعة
// بالكامل، ويختم كل المهارات المختارة، ثم يسلّم الدور للخصم
function attemptSealMulti(sealSkill, names){

    if(battle.turnOwner !== "player") return;

    if(battle.finished) return;

    let uniqueNames = [...new Set(names.map(n => n.trim()).filter(Boolean))];

    let resolvedSkills = [];

    for(let name of uniqueNames){

        let targetSkill =
        battle.enemyUsedSkillsThisBattle.find(s => s.name.trim() === name);

        if(!targetSkill){

            alert(`لا توجد مهارة بهذا الاسم ظهرت من الخصم بعد: "${name}"`);

            return;

        }

        if(isSkillSealed(battle.enemy, targetSkill)){

            alert(`مهارة "${name}" مختومة مسبقًا`);

            return;

        }

        resolvedSkills.push(targetSkill);

    }

    closeSealMenu();

    clearTurnTimer();

    battle.enemy.sealedSkillIds = battle.enemy.sealedSkillIds || [];

    resolvedSkills.forEach(s => {

        if(!battle.enemy.sealedSkillIds.includes(s.id)){

            battle.enemy.sealedSkillIds.push(s.id);

        }

    });

    battle.player.turnsTaken++;

    if(sealSkill.cooldown > 0)
        battle.player.cooldownUsedAt[sealSkill.id] = battle.player.turnsTaken;

    if(!battle.playerUsedSkills.find(s => s.id === sealSkill.id)){

        battle.playerUsedSkills.push(sealSkill);

    }

    renderUsedSkillsUI(battle.prefix);

    renderSkillButtons(battle.prefix);

    updateBattleScreen();

    let namesList = resolvedSkills.map(s => `"${s.name}"`).join("، ");

    addBattleLog(`${battle.player.name} ختم ${resolvedSkills.length > 1 ? "مهارات" : "مهارة"} ${namesList} حتى نهاية النزال!`);

    showBattleEffectBanner(battle.prefix, `🔒 ختمتَ مهارة ${namesList}!`, "seal");

    if(checkBattleEnd()) return;

    battle.turnOwner = "enemy";

    setTimeout(processTurn, 900);

}


// ========================================
// مهارة "فك الختم": يزيل اللاعب الختم عن حتى N من مهاراته المختومة حتى
// يستطيع استخدامها من جديد. رقم المهارة = عدد المهارات القابلة لفك الختم
// عنها في التفعيل الواحد. فعل يستهلك الدور بالكامل.
// ========================================

function openUnsealMenu(unsealSkill){

    if(battle.turnOwner !== "player") return;

    if(battle.finished) return;

    if(isSkillSealed(battle.player, unsealSkill)){

        alert("مهارة فك الختم هذه مختومة 🔒");

        return;

    }

    if(!isSkillReady(battle.player, unsealSkill)){

        alert("مهارة فك الختم ما زالت في التهدئة");

        return;

    }

    closeUnsealMenu();

    let maxUnseal = Math.max(1, Number(unsealSkill.damage) || 1);

    let selectedNames = [];

    let mySealedSkills =
    (battle.player.sealedSkillIds || [])
        .map(id => battle.player.skills.find(s => s.id === id))
        .filter(Boolean);

    let usedListHtml = mySealedSkills.length > 0
    ? mySealedSkills
        .map(s => `<button class="steal-option" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`)
        .join("")
    : "<p>لا توجد أي مهارة مختومة لديك لفك ختمها</p>";

    let modal = document.createElement("div");

    modal.id = "unseal-modal";

    modal.className = "steal-modal";

    modal.innerHTML = `

        <div class="steal-modal-box">

            <h3>🔓 اختر حتى ${maxUnseal} ${maxUnseal === 1 ? "مهارة" : "مهارات"} من مهاراتك المختومة لفك ختمها</h3>

            <div class="steal-options-list">
                ${usedListHtml}
            </div>

            <p class="steal-or" id="unseal-selected-label">لم تُختر أي مهارة بعد (0/${maxUnseal})</p>

            <div class="steal-modal-buttons">

                <button id="unseal-confirm-btn">فك الختم</button>

                <button id="unseal-cancel-btn">إلغاء</button>

            </div>

        </div>

    `;

    document.body.appendChild(modal);


    function refreshSelectedLabel(){

        let label = document.getElementById("unseal-selected-label");

        if(!label) return;

        label.textContent =
        selectedNames.length > 0
        ? `المختارة: ${selectedNames.join("، ")} (${selectedNames.length}/${maxUnseal})`
        : `لم تُختر أي مهارة بعد (0/${maxUnseal})`;

    }

    function toggleSelect(name, btn){

        let idx = selectedNames.indexOf(name);

        if(idx >= 0){

            selectedNames.splice(idx, 1);

            if(btn) btn.classList.remove("steal-selected");

        } else {

            if(selectedNames.length >= maxUnseal){

                alert(`لا يمكن اختيار أكثر من ${maxUnseal} ${maxUnseal === 1 ? "مهارة" : "مهارات"} في نفس الفك`);

                return;

            }

            selectedNames.push(name);

            if(btn) btn.classList.add("steal-selected");

        }

        refreshSelectedLabel();

    }


    modal.querySelectorAll(".steal-option").forEach(btn => {

        btn.onclick = () => {

            toggleSelect(btn.dataset.name, btn);

        };

    });


    modal.querySelector("#unseal-cancel-btn").onclick = closeUnsealMenu;

    modal.querySelector("#unseal-confirm-btn").onclick = () => {

        if(selectedNames.length === 0){

            alert("اختر مهارة واحدة على الأقل");

            return;

        }

        attemptUnsealMulti(unsealSkill, selectedNames);

    };

}


function closeUnsealMenu(){

    let modal = document.getElementById("unseal-modal");

    if(modal) modal.remove();

}


// يتحقق من الأسماء المختارة (مهارات اللاعب المختومة فعلًا)، ثم يستهلك
// دور/تهدئة مهارة فك الختم مرة واحدة لهذه الدفعة، ويفك الختم عن كل المهارات
// المختارة، ثم يسلّم الدور للخصم
function attemptUnsealMulti(unsealSkill, names){

    if(battle.turnOwner !== "player") return;

    if(battle.finished) return;

    let uniqueNames = [...new Set(names.map(n => n.trim()).filter(Boolean))];

    let resolvedSkills = [];

    for(let name of uniqueNames){

        let targetSkill =
        battle.player.skills.find(s => s.name.trim() === name);

        if(!targetSkill){

            alert(`لا توجد مهارة بهذا الاسم لديك: "${name}"`);

            return;

        }

        if(!isSkillSealed(battle.player, targetSkill)){

            alert(`مهارة "${name}" ليست مختومة أصلًا`);

            return;

        }

        resolvedSkills.push(targetSkill);

    }

    closeUnsealMenu();

    clearTurnTimer();

    let sealedList = battle.player.sealedSkillIds || [];

    resolvedSkills.forEach(s => {

        sealedList = sealedList.filter(id => id !== s.id);

    });

    battle.player.sealedSkillIds = sealedList;

    battle.player.turnsTaken++;

    if(unsealSkill.cooldown > 0)
        battle.player.cooldownUsedAt[unsealSkill.id] = battle.player.turnsTaken;

    if(!battle.playerUsedSkills.find(s => s.id === unsealSkill.id)){

        battle.playerUsedSkills.push(unsealSkill);

    }

    renderUsedSkillsUI(battle.prefix);

    renderSkillButtons(battle.prefix);

    updateBattleScreen();

    let namesList = resolvedSkills.map(s => `"${s.name}"`).join("، ");

    addBattleLog(`${battle.player.name} فك الختم عن ${resolvedSkills.length > 1 ? "مهارات" : "مهارة"} ${namesList}!`);

    showBattleEffectBanner(battle.prefix, `🔓 فككت الختم عن ${namesList}!`, "unseal");

    if(checkBattleEnd()) return;

    battle.turnOwner = "enemy";

    setTimeout(processTurn, 900);

}


// ========================================
// مؤقت الدور (3 دقائق)
// ========================================

function startTurnTimer(){

    clearTurnTimer();

    let seconds = 60;

    updateTimerDisplay(seconds);

    battle.turnInterval = setInterval(() => {

        seconds--;

        updateTimerDisplay(seconds);

        if(seconds <= 0){

            clearTurnTimer();

            addBattleLog("انتهى الوقت! تم تخطي دورك");

            battle.turnOwner = "enemy";

            processTurn();

        }

    }, 1000);

}


function updateTimerDisplay(seconds){

    let m = Math.floor(seconds / 60);

    let s = seconds % 60;

    let box = document.getElementById(battle.prefix + "-battle-timer");

    if(box) box.textContent = m + ":" + (s < 10 ? "0" + s : s);

}


function clearTurnTimer(){

    if(battle.turnInterval){

        clearInterval(battle.turnInterval);

        battle.turnInterval = null;

    }

}



// ========================================
// نهاية المعركة
// ========================================

function checkBattleEnd(){

    if(battle.enemy.hp <= 0){

        endBattle(true);

        return true;

    }

    if(battle.player.hp <= 0){

        endBattle(false);

        return true;

    }

    return false;

}


function endBattle(playerWon){

    battle.finished = true;

    battle.phase = "finished";

    clearTurnTimer();

    renderSkillButtons(battle.prefix);

    addBattleLog(playerWon ? "لقد فزت بالمعركة!" : "لقد خسرت المعركة");

    showBattleResult(playerWon);

}


function showBattleResult(playerWon){

    hideBattleResult(battle.prefix);

    let arena =
    document.querySelector("#" + battle.prefix + "-battle-screen .battle-arena");

    if(!arena) return;

    let overlay = document.createElement("div");

    overlay.className = "battle-result-overlay";

    overlay.innerHTML = `

        <h2>${playerWon ? "🏆 فزت!" : "💀 خسرت"}</h2>

        <button id="battle-result-back-btn">العودة</button>

    `;

    arena.appendChild(overlay);

    overlay
    .querySelector("#battle-result-back-btn")
    .onclick = () => {

        overlay.remove();

        openScreen("solo-battle-screen");

    };

}


function hideBattleResult(prefix){

    let overlay =
    document.querySelector("#" + prefix + "-battle-screen .battle-result-overlay");

    if(overlay) overlay.remove();

}



// ========================================
// تأثيرات بصرية (اهتزاز + رقم داميج طائر)
// ========================================

function showDamagePopup(targetPrefix, amount, isHeal){

    let img = document.getElementById(targetPrefix + "-image");

    if(!img) return;

    let wrapper = img.closest(".battle-card");

    if(!wrapper) return;

    wrapper.style.position = "relative";

    let popup = document.createElement("div");

    popup.className = "damage-popup" + (isHeal ? " heal" : "");

    popup.textContent = (isHeal ? "+" : "-") + amount;

    popup.style.left = "50%";

    popup.style.top = "10px";

    popup.style.transform = "translateX(-50%)";

    wrapper.appendChild(popup);

    setTimeout(() => popup.remove(), 1000);

}


function playHitEffect(prefix){

    let arena =
    document.querySelector("#" + prefix + "-battle-screen .battle-arena");

    if(!arena) return;

    arena.classList.add("shake", "hit-flash");

    setTimeout(() => {

        arena.classList.remove("shake", "hit-flash");

    }, 350);

}


function applyDamageEffect(prefix, targetPrefix, amount, isHeal){

    playHitEffect(prefix);

    showDamagePopup(targetPrefix, amount, isHeal);

}


// ========================================
// شارة حدث المعركة (هجوم/صدّ/دفاع/تجميد...) — نص قصير يظهر لحظيًا في
// منتصف ساحة القتال (نفس الآلية لـ PvE و PvP، الدالة عامة يستخدمها
// battle.js و pvp.js معًا)
// kind: "hit" | "block" | "defense" | "freeze" | "info"
// ========================================
function showBattleEffectBanner(prefix, text, kind){

    let arena = document.querySelector("#" + prefix + "-battle-screen .battle-arena");

    if(!arena) return;

    // لو كانت هناك شارة سابقة لم تختفِ بعد، أزلها فورًا حتى لا تتراكم
    // الشارات فوق بعضها عند حدوث أكثر من فعل بسرعة
    let existing = arena.querySelector(".battle-effect-banner");
    if(existing) existing.remove();

    let banner = document.createElement("div");

    banner.className = "battle-effect-banner effect-" + (kind || "info");

    banner.textContent = text;

    arena.appendChild(banner);

    requestAnimationFrame(() => banner.classList.add("show"));

    setTimeout(() => {

        banner.classList.remove("show");
        banner.classList.add("hide");

        setTimeout(() => banner.remove(), 220);

    }, 1300);

}


// ========================================
// رسالة "دورك الآن / دور الخصم" أسفل عداد الوقت مباشرة
// elId: معرّف العنصر (مختلف بين pve وpvp لأسباب توافق قديمة)
// ========================================
function setTurnIndicatorText(elId, text, cssClass){

    let box = document.getElementById(elId);

    if(!box) return;

    box.textContent = text || "";

    box.classList.remove("my-turn", "opp-turn", "frozen-note");

    if(cssClass) box.classList.add(cssClass);

}
