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

    enemyUsedSkills: [], // كل مهارات هذا الخصم التي كُشفت ضد هذا اللاعب —Include النزالات
    // السابقة (محفوظة محليًا) + هذا النزال، وهي ما تُستخدم أساسًا لتحديد
    // ما يمكن "سرقته": يكفي أن يكون الخصم استخدمها ضدك في أي نزال سابق

    enemyUsedSkillsThisBattle: [], // فقط ما استخدمه الخصم فعليًا في هذا النزال
    // بالذات — هذه (لا enemyUsedSkills) هي ما يُستخدم لتحديد ما可以 "نسخه"،
    // فالنسخ يتطلب أن يكون الخصم استخدم المهارة أمامك الآن، لا في نزال سابق

    currentMonsterId: null, // معرّف الوحش الحالي، يُستخدم كمفتاح لحفظ/تحميل
    // مهارات هذا الخصم المكشوفة سابقًا من التخزين المحلي

    playerUsedSkills: [],

    // حالة الختم (تُحفظ في Supabase لتَتّ survive logout/login)
    // sealedSkillIds: معرّفات المهارات المختومة حتى نهاية النزال
    playerSealedSkillIds: [],   // مهارات اللاعب المختومة
    enemySealedSkillIds: [],    // مهارات العدو المختومة

    // مجموعة الظلال (تُحفظ في Supabase لتَتّ survive logout/login)
    //تحتوي على شخصيات الظلال و مهاراتها التي يُمكن للاعب استخدامها
    playerShadowPool: [],       // مجموعة شخصيات الظلال التي تمتلكها
    enemyShadowPool: [],        // مجموعة شخصيات الظلال التي يمتلكها العدو

    // ===== حالة الزنزانة (Dungeon) =====
    // عند الدخول في زنزانة: يحتفظ اللاعب بصحته وتهدئة مهاراته بين الوحوش
    // ولا يُعاد بناؤه من جديد إلا عند بدء زنزانة جديدة كليًا
    dungeonId: null,            // معرّف الزنزانة (null في المعارك العادية)
    dungeonName: null,
    dungeonGrade: null,
    dungeonGoldPrize: 0,
    dungeonPointsPrize: 0,
    dungeonMonsterIds: [],      // ترتيب معرّفات الوحوش
    dungeonIndex: 0,            // فهرس الوحش الحالي

};



// ========================================
// حفظ/تحميل مهارات كل وحش التي كُشفت سابقًا (للسرقة عبر نزالات متعددة)
// ========================================

function pveRevealedSkillsStorageKey(monsterId){

    return "pve_revealed_skills_" + monsterId;

}


function pveLoadRevealedSkillIds(monsterId){

    if(!monsterId || (typeof monsterId !== 'string' && typeof monsterId !== 'number')) return [];

    try{

        let raw = localStorage.getItem(pveRevealedSkillsStorageKey(monsterId));

        let ids = raw ? JSON.parse(raw) : [];

        return Array.isArray(ids) ? ids : [];

    }catch(e){

        return [];

    }

}


function pveSaveRevealedSkillIds(monsterId, ids){

    if(!monsterId || (typeof monsterId !== 'string' && typeof monsterId !== 'number')) return;

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

    // نفس الشيء لشارات الحالة (قوة/صحة مؤقتة، أدوار إضافية، دروع...)
    let enemyStatus = document.getElementById(prefix + "-enemy-status");
    let playerStatus = document.getElementById(prefix + "-player-status");
    if(enemyStatus) delete enemyStatus.dataset.renderedKey;
    if(playerStatus) delete playerStatus.dataset.renderedKey;
    if(enemyStatus) enemyStatus.innerHTML = "";
    if(playerStatus) playerStatus.innerHTML = "";

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
            .maybeSingle();

            if(error || !row) throw error || new Error("no pc");

            let pc = {
                id: row.pc_id,
                character_id: row.character_id,
                level: row.level,
                hp: row.hp,
                atk: row.atk,
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
            .select("page_index, image_url, skill_scale")
            .eq("character_id", character_id);

            if(error) throw error;

            let map = {};

            (data || []).forEach(row => {
                map[row.page_index] = {
                    url: row.image_url || "",
                    scale: Number(row.skill_scale) > 0 ? Number(row.skill_scale) : 1
                };
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

    let entry = map[pageIndex];

    return (entry && entry.url) || "";

}

// يُرجع مقياس حجم أزرار المهارات لهذه الصفحة (يُضبط من لوحة الإدارة)
function getSkillPageScale(character_id, pageIndex){

    let map = skillPageBackgroundsCache[character_id];

    if(!map) return 1;

    let entry = map[pageIndex];

    return (entry && Number(entry.scale) > 0) ? Number(entry.scale) : 1;

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

        atk: isPlayer ? (Number(pc.atk) || 100) : 0,

        turnsTaken: 0,

        cooldownUsedAt: {},

        lastHitSnapshot: null,

        // شحنات الدرع المتبقية من مهارة دفاع/دفاع مسروق "يتحمّل عدة ضربات":
        // كل ضربة قادمة تُمتَص تلقائيًا وتُنقِص شحنة واحدة حتى تنفد
        shieldCharges: 0,

        // حالة التجميد/الشلل: عدد الأدوار القادمة التي يخسرها هذا المقاتل بالكامل
        frozenTurns: 0,

        // المهارات المختومة (بمهارة "ختم"): لا يمكن استخدامها حتى نهاية
        // النزال، إلا إذا فُكّ ختمها بمهارة "فك الختم"
        sealedSkillIds: [],

        // ===== مفاعيل الأنواع الجديدة (مطابقة لمنطق السيرفر في PvP) =====

        // قوة هجوم مؤقتة (atk_boost): تُضاف لضرر كل هجوم/مهارة ضررية
        tempAtk: 0,

        // صحة مؤقتة فوق الحد الأقصى (absorb_hp): تُمتَص بها الضربات
        tempHp: 0,

        // أدوار إضافية (consecutive_turns): بعد استهلاك الدور يُستمر به
        extraTurns: 0,

        // سُم: poisonDamage = ضرر السُم لكل دور، poisonTurns = الأدوار المتبقية
        poisonDamage: 0,
        poisonTurns: 0,

        // درع امتصاص: absorbMode = "atk" (يحوّل الضربة لقوة مؤقتة) أو
        // "hp" (يحوّلها لصحة مؤقتة)، وعدد الضربات المتبقية في absorbHits
        absorbMode: null,
        absorbHits: 0,

        // درع الانعكاس: عند تفعيل مهارة "انعكاس" يُثبَّت المضاعف هنا،
        // وأول ضربة قابلة للصد قادمة على صاحب الدرع ترتد على مهاجمها
        reflectMult: 0,

        // مهارة "انعكاس لا يُصدّ": عندما تكون صحيحة يُعكس الضرر كضرر لا
        // يُحجب إلا بالامتصاص، ويُعكس ضرر السُم كذلك
        reflectUnblockable: false,

        // أدوار تهدئة إضافية تُضاف لمهارة معيّنة (مهارة "تأجيل التهدئة")
        cooldownExtra: {},

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

// ========================================
// توسّع ضرر مهارات الهجوم تلقائيًا مع ارتفاع صفة ATK.
// القاعدة:
//   - المهارة الأولى (هجوم عادي) أساسها 100 وليست مثبّتة، بل تنمو أيضًا.
//   - كل مهارة هجوم يجب أن تتفوق على التي قبلها بـ 150 إذا كانت عادية،
//     أو بـ 200 (بالمكافئ العادي) إذا كانت غير قابلة للصد (unblockable تُحسب
//     ضعف ضررها فقط لغرض الفجوة، والضرر الفعلي لا يُضاعف).
//   - عند كل +50 في ATK: أصلح أول فجوة ناقصة (ارفع المهارة اللاحقة) حتى
//     تستقر، وعند اكتمال كل الفجوات ارفع المهارة الأولى بمقدار +50. هذا
//     يجعل التوزيع يتناوب أول/ثاني ثم أخيرًا غير القابلة للصد (أول, ثاني,
//     أول, ثاني, ثم غير القابلة للصد...).
// تُطبَّق على اللاعب في PvE وPvP معًا (المكافئ في SQL: pvp_scaled_attack_damage).
// ========================================

// القيمة "الفعلية" لمهارة هجوم لأغراض الفجوة: غير القابلة للصد تُحسب ضعفها
function atkGapValue(dmg, unblockable){
    return unblockable ? dmg * 2 : dmg;
}

// هدف الفجوة بين المهارة السابقة وهذه: 150 عادية أو 200 إن كانت غير قابلة للصد
function atkGapTarget(skill){
    return skill.unblockable ? 200 : 150;
}

// يحسب الضرر الفعلي لكل مهارة هجوم للاعب بالنظر إلى ATK الحالي.
// القاعدة: غير القابلة للصد تُحسب ضعفها فقط لأغراض الفجوة (الضرر الفعلي لا
// يُضاعف). تُوزَّع النقاط (+50 لكل boost من ATK) بحيث تبقى الفجوة بين المهارة
// السابقة والمهارة التالية بمكافئها العادي: 150 بين مهارتين عاديتين، و200 بين
// عادية وغير قابلة للصد (2 × الضرر − السابقة = 200). يعيد كائن skill_id -> الضرر.
function computeScaledAttackDamages(atk, skills){
    const BASE_ATK = 100;
    const result = {};
    const atkSkills = (skills || []).filter(s =>
        (s.type === "attack" || s.type === "special")
        && (s.effect === null || s.effect === undefined || s.effect === "" || s.effect === "poison")
    );
    if(atkSkills.length === 0) return result;

    const boosts = Math.max(0, Math.floor((atk - BASE_ATK) / 50));
    const totalPoints = boosts * 50;

    // ترتيب المهارات حسب الخانة (slot) — مطابق تمامًا لترتيب السيرفر في
    // PvP (pvp_scaled_attack_damage) حتى تتطابق النتيجة في PvE وPvP ولوحة
    // الإدارة لكل الشخصيات (بما فيها القادمة لاحقًا)
    const sorted = [...atkSkills].sort((a, b) =>
        (Number(a.slot) || 0) - (Number(b.slot) || 0)
    );
    const n = sorted.length;
    const f = sorted.map(s => (s.unblockable || s.effect === "poison") ? 2 : 1);
    const base = sorted.map(s => Math.max(0, Number(s.damage) || 0));

    // هدف الفجوة التراكمية لكل مهارة (بالمكافئ العادي)
    const cum = [0];
    for(let i = 1; i < n; i++){
        cum[i] = cum[i - 1] + ((sorted[i].unblockable || sorted[i].effect === "poison") ? 200 : 150);
    }

    // حل نظام خطي لإيجاد الزيادة (بالضرر الفعلي) لكل مهارة بحيث:
    //   f[i] * (base[i] + d[i]) = f[0] * (base[0] + d[0]) + cum[i]
    //   ومجموع الزيادات = totalPoints
    const f0 = f[0];
    const A = f0 * base[0];
    let S = 0, T = 0;
    for(let i = 1; i < n; i++){
        S += 1 / f[i];
        T += (A + cum[i]) / f[i] - base[i];
    }
    const d0 = (totalPoints - T) / (1 + f0 * S);
    const d = [d0];
    for(let i = 1; i < n; i++){
        d[i] = (A + f0 * d0 + cum[i]) / f[i] - base[i];
    }

    // لا يمكن إنقاص الضرر: أي توزيع سالب يُقص ويُعوَّض من المهارة الأولى
    for(let i = 0; i < n; i++){
        if(d[i] < 0){ const sh = -d[i]; d[i] = 0; d[0] -= sh; }
    }
    if(d[0] < 0){ const need = -d[0]; d[0] = 0; d[n - 1] += need; }

    // التقريب إلى مضاعفات 50 مع الحفاظ على المجموع الكلي
    const r = d.map(x => Math.round(x / 50) * 50);
    let diff = totalPoints - r.reduce((a, b) => a + b, 0), idx = 0;
    while(diff !== 0 && idx < n * 1000){
        if(diff > 0){ r[idx % n] += 50; diff -= 50; }
        else if(r[idx % n] >= 50){ r[idx % n] -= 50; diff += 50; }
        idx++;
    }

    sorted.forEach((s, i) => { result[s.id] = base[i] + r[i]; });
    return result;
}

// الضرر "الفعلي" لمهارة ما بعد تطبيق توسّع ATK (أساسي + الزيادة الموزعة).
// للمهارات داخل computeScaledAttackDamages (هجوم/خاصة ضررية + سم) يُؤخذ
// الرقم الموسّع مباشرة من خريطة scaledAttackDamages، وإلا فالقيمة الأساسية
function effectiveSkillDamage(skill, attacker){

    if(attacker && attacker.scaledAttackDamages && attacker.scaledAttackDamages[skill.id] !== undefined){

        return attacker.scaledAttackDamages[skill.id];

    }

    return Number(skill.damage) || 0;

}


function calcDamage(skill, attacker){

    // مهارة التجميد/الشلل لا تُلحق ضررًا؛ رقمها يمثّل عدد أدوار التجميد بدلاً من ذلك
    if(skill.effect === "freeze") return 0;

    // مهارة الانعكاس لا تُلحق ضررًا مباشرًا؛ رقمها يمثّل مضاعف ارتداد الضرر
    if(skill.effect === "reflect") return 0;

    // مهارتا الختم/فك الختم لا تُلحقان ضررًا؛ رقمهما يمثّل عدد المهارات
    // القابلة للختم/فك الختم في التفعيل الواحد
    if(skill.effect === "seal") return 0;

    if(skill.effect === "unseal") return 0;

    // مفاعيل الأنواع الجديدة لا تُلحق ضررًا مباشرًا إطلاقًا (كلها مهارات
    // خاصة تُنفَّذ عبر معالجاتها الخاصة خارج resolveAction)
    if(isNewBuffEffect(skill.effect)) return 0;

    if(skill.effect === "delay_cooldown") return 0;

    if(skill.effect === "shadow") return 0;

    if(skill.type === "attack" || skill.type === "special"){

        // توسّع ضرر الهجوم تلقائيًا مع ارتفاع ATK (للمقاتل الذي يملك قائمة
        // مضاعفة محسوبة مسبقًا من computeScaledAttackDamages)
        if(attacker && attacker.scaledAttackDamages && attacker.scaledAttackDamages[skill.id] !== undefined){
            return attacker.scaledAttackDamages[skill.id];
        }

        return Number(skill.damage) || 0;

    }

    return 0;

}


// ========================================
// مساعدات مفاعيل الأنواع الجديدة
// ========================================

// هل هذا الأثر من مفاعيل الأنواع الجديدة (تأثير ذاتي يستهلك الدور)؟
function isNewBuffEffect(effect){

    return effect === "consecutive_turns"
        || effect === "absorb_atk"
        || effect === "absorb_hp"
        || effect === "hp_boost"
        || effect === "atk_boost";

}


// قيمة مفعول مهارة: تُقرأ من skill.params (إن وُجدت) وإلا من رقم المهارة
// نفسه (skill.damage) كمقابل احتياطي — مطابق لمنطق السيرفر الذي يقرأ
// params أولاً ثم يقع على damage
function skillParamAmount(skill, key, fallback){

    let p = skill && skill.params;

    if(p && p[key] !== undefined && p[key] !== null && p[key] !== ""){

        let v = Number(p[key]);

        if(!isNaN(v)) return v;

    }

    let fb = Number(fallback);

    if(!isNaN(fb)) return fb;

    return 1;

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

    // مهارة "تأجيل التهدئة" تمدّد تهدئة المهارة المستهدفة بأدوار إضافية
    let totalCooldown = skill.cooldown + (fighter.cooldownExtra[skill.id] || 0);

    return (fighter.turnsTaken - lastUsed) >= totalCooldown;

}


// عدد الأدوار المتبقية قبل أن تصبح المهارة جاهزة مجددًا
function cooldownTurnsRemaining(fighter, skill){

    if(!skill.cooldown || skill.cooldown <= 0)
        return 0;

    let lastUsed = fighter.cooldownUsedAt[skill.id];

    if(lastUsed === undefined)
        return 0;

    let totalCooldown = skill.cooldown + (fighter.cooldownExtra[skill.id] || 0);

    let remaining = totalCooldown - (fighter.turnsTaken - lastUsed);

    return remaining > 0 ? remaining : 0;

}


// هل هذه المهارة مختومة على صاحبها (بمهارة "ختم")؟ المهارة المختومة لا
// يمكن استخدامها إطلاقًا حتى نهاية النزال، إلا بفك ختمها بمهارة "فك الختم"
function isSkillSealed(fighter, skill){

    // التحقق من الحالة المحلية أولاً (الأسرع)
    let localSealed = !!(fighter && fighter.sealedSkillIds && fighter.sealedSkillIds.includes(skill.id));

    // إذا لم تكن مختومة محلياً ولمباراة PvP، جرب التحقق من Supabase
    if(!localSealed && battle.prefix === "pvp" && battle.playerToken && skill && skill.id){

        // سنقوم بتحديث الحالة بعد تحميلها من قاعدة البيانات في syncBattleStateFromSupabase

    }

    return localSealed;

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

        // حالة التجميد/الشلل: عدد الأدوار القادمة التي يخسرها هذا المقاتل بالكامل
        frozenTurns: 0,

        // المهارات المختومة حتى نهاية النزال (تُمنع بإضافة معرّفاتها هنا)
        sealedSkillIds: [],

        // ===== مفاعيل الأنواع الجديدة (مطابقة لمنطق السيرفر في PvP) =====

        tempAtk: 0,

        tempHp: 0,

        extraTurns: 0,

        poisonDamage: 0,
        poisonTurns: 0,

        absorbMode: null,
        absorbHits: 0,

        reflectMult: 0,

        reflectUnblockable: false,

        cooldownExtra: {},

        isPlayer: false,

        glow: safeGlowColor(character.glow_color, "#22c55e")

    };

}



// ========================================
// بدء معركة PvE
// ========================================

async function startPVEBattle(monsterId){

    console.log("startPVEBattle called with:", monsterId);

    if(!monsterId){

        openScreen("pve-select-screen");

        loadMonsterList();

        return;

    }

    openScreen("pve-battle-screen");

    try {
        window.shadowPoolCache = await fetchShadowPoolFromSupabase();
    } catch (e) {
        console.error("Failed to fetch shadow pool", e);
        window.shadowPoolCache = [];
    }

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

    if(skills.length === 0){

        skills = [

            {id:"default_atk", name:"هجوم عادي", type:"attack", damage:100, cooldown:0, effect:null},

            {id:"default_def", name:"دفاع", type:"defense", damage:0, cooldown:2, effect:null}

        ];

    }

    // خلفيات صفحات مهارات اللاعب (يُستخدمها الرسم مباشرة بعد ذلك)
    await loadSkillPageBackgrounds(pc.character_id);


    battle.player = buildFighter(pc, skills, true);

    // توسّع ضرر الهجمات تلقائيًا مع ارتفاع ATK للاعب
    battle.player.scaledAttackDamages = computeScaledAttackDamages(
        battle.player.atk, battle.player.skills
    );

    battle.enemy = buildMonsterFighter(monsterRow, monsterSkills);

    battle.prefix = "pve";

    battle.monsterId = monsterId;

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



// ========================================
// وضع الزنزانة (Dungeon): يقاتل اللاعب عدة وحوش بالتتابع مع بقاء صحته
// وتهدئة مهاراته كما هي بين النزالات، ولا تُستعاد إلا عند إكمال الزنزانة
// كلها أو الهزيمة
// ========================================

async function startDungeonBattle(dungeon){

    if(!dungeon || !dungeon.monster_ids || dungeon.monster_ids.length === 0){

        alert("هذه الزنزانة بلا وحوش");

        openScreen("gate-screen");

        loadGates();

        return;

    }

    openScreen("pve-battle-screen");

    resetBattleVisuals("pve");

    let pc = await getActivePlayerCharacter();

    if(!pc){

        alert("لا توجد شخصية نشطة");

        openScreen("gate-screen");

        return;

    }

    let skills = await loadCharacterSkills(pc.character_id);

    if(skills.length === 0){

        skills = [

            {id:"default_atk", name:"هجوم عادي", type:"attack", damage:100, cooldown:0, effect:null},

            {id:"default_def", name:"دفاع", type:"defense", damage:0, cooldown:2, effect:null}

        ];

    }

    await loadSkillPageBackgrounds(pc.character_id);

    // يُبنى اللاعب مرة واحدة فقط عند بدء الزنزانة؛ نزالات الوحوش اللاحقة
    // تعيد استخدام نفس الكائن فتبقى صحته وتهدئة مهاراته محفوظة
    battle.player = buildFighter(pc, skills, true);

    battle.player.scaledAttackDamages = computeScaledAttackDamages(battle.player.atk, battle.player.skills);

    battle.prefix = "pve";

    battle.phase = "idle";

    battle.finished = false;

    battle.raceWon = false;

    battle.raceButtonLockedUntil = 0;

    battle.dungeonId = dungeon.id;

    battle.dungeonName = dungeon.name;

    battle.dungeonGrade = dungeon.grade;

    battle.dungeonGoldPrize = dungeon.gold_prize || 0;

    battle.dungeonMonsterIds = (dungeon.monster_ids || []).slice();

    battle.dungeonIndex = 0;

    battle.playerUsedSkills = [];

    battle.enemyUsedSkills = [];

    battle.enemyUsedSkillsThisBattle = [];

    battle.playerSealedSkillIds = [];

    battle.enemySealedSkillIds = [];

    ensureLogBox("pve");

    addBattleLog(`🚪 دخول الزنزانة: ${battle.dungeonName} (التدرّج ${battle.dungeonGrade}) — ${battle.dungeonMonsterIds.length} وحوش`);

    await startDungeonMonster(battle.dungeonMonsterIds[0]);

}


async function startDungeonMonster(monsterId){

    let monsterRow = null;

    await GameCache.fetchWithCache(

        "monster_row_" + monsterId,

        async () => {

            let {data, error} = await supabaseClient.from("characters").select("*").eq("id", monsterId).single();

            if(error) throw error;

            return data;

        },

        (data) => { monsterRow = data; },

        () => { monsterRow = null; },

        10 * 60 * 1000

    );

    if(!monsterRow){

        alert("تعذر تحميل أحد الوحوش");

        openScreen("gate-screen");

        return;

    }

    let monsterSkills = await loadCharacterSkills(monsterId);

    // إعادة ضبط حالة النزال كاملة قبل بدء الوحش الجديد: بدون هذا يبقى
    // battle.finished نشطًا من نهاية النزال السابق فتُجمَّد جميع الأدوار
    // (لا يستطيع اللاعب الحركة ولا يعمل الخصم)
    battle.phase = "idle";

    battle.finished = false;

    battle.turnOwner = null;

    battle.raceWon = false;

    battle.raceButtonLockedUntil = 0;

    // بين الوحوش تُصفَّر تأثيرات المعركة المؤقتة للاعب (السم، الدروع،
    // التجميد، ...) بينما تبقى صحته وتهدئة مهاراته كما هي
    resetPlayerTransientState();

    battle.enemy = buildMonsterFighter(monsterRow, monsterSkills);

    battle.currentMonsterId = monsterId;

    battle.enemyUsedSkillsThisBattle = [];

    let revealedIds = pveLoadRevealedSkillIds(monsterId);

    battle.enemyUsedSkills = monsterSkills.filter(s => revealedIds.includes(s.id));

    battle.playerUsedSkills = [];

    setTurnIndicatorText("pve-turn-indicator", "", null);

    updateBattleScreen();

    renderUsedSkillsUI("pve");

    hideBattleResult("pve");

    await runIntroSequence("pve");

}


// تصفير تأثيرات المعركة المؤقتة للاعب عند الانتقال لوحش جديد، مع الإبقاء
// على الصحة الحالية وتهدئة المهارات
function resetPlayerTransientState(){

    let p = battle.player;

    if(!p) return;

    p.shieldCharges = 0;

    p.frozenTurns = 0;

    p.sealedSkillIds = [];

    p.tempAtk = 0;

    p.tempHp = 0;

    p.extraTurns = 0;

    p.poisonDamage = 0;

    p.poisonTurns = 0;

    p.absorbMode = null;

    p.absorbHits = 0;

    p.reflectMult = 0;

    p.reflectUnblockable = false;

    p.lastHitSnapshot = null;

    p.defending = false;

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

    applyGlowColors();

    renderSkillButtons(prefix);

    renderUsedSkillsUI(prefix);

    renderStatusBadges(prefix);

}


// شارات الحالة فوق بطاقات المقاتلين: قوة مؤقتة / صحة مؤقتة / أدوار إضافية /
// درع انعكاس / درع امتصاص (من مفاعيل الأنواع الجديدة)
function renderStatusBadges(prefix){

    renderFighterStatusBadge(prefix + "-enemy", battle.enemy);

    renderFighterStatusBadge(prefix + "-player", battle.player);

}


function renderFighterStatusBadge(idPrefix, fighter){

    let el = document.getElementById(idPrefix + "-status");

    if(!el) return;

    let badges = [];

    if((fighter.tempAtk || 0) > 0) badges.push("⚔️+" + fighter.tempAtk);

    if((fighter.extraTurns || 0) > 0) badges.push("⚡×" + fighter.extraTurns);

    if((fighter.reflectMult || 0) > 0) badges.push("🔁×" + fighter.reflectMult);

    if((fighter.absorbHits || 0) > 0) badges.push("🧲×" + fighter.absorbHits);

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

    // تطبيق سُم في بداية الدور: يتلقى المسموم ضررًا قبل كل دور له
    let poisonedFighter = (currentFighter === battle.player) ? battle.enemy : battle.player;
    if(poisonedFighter.poisonTurns > 0 && poisonedFighter.poisonDamage > 0 && poisonedFighter.hp > 0){
        let poisonDmg = poisonedFighter.poisonDamage;
        // مهارة "انعكاس لا يُصدّ": إذا كان درع الانعكاس فعّالًا يعكس ضرر
        // السُم كضرر لا يُصدّ على مَن سمَّمه (الطرف الآخر)
        if(poisonedFighter.reflectUnblockable){
            let poisoner = (poisonedFighter === battle.player) ? battle.enemy : battle.player;
            poisonedFighter.reflectUnblockable = false;
            poisonedFighter.reflectMult = 0;
            poisoner.hp = Math.max(0, poisoner.hp - poisonDmg);
            addBattleLog(`🔁 ${poisonedFighter.name} عكس ضرر السُم! ${poisoner.name} يتلقى ${poisonDmg} ضرر لا يُصدّ`);
            updateBattleScreen();
            if(poisoner.hp <= 0){
                battle.finished = true;
                let winner = (poisoner === battle.player) ? "enemy" : "player";
                battle.winner = winner;
                endBattle(winner);
                return;
            }
        } else {
            poisonedFighter.hp = Math.max(0, poisonedFighter.hp - poisonDmg);
            addBattleLog(`☠️ ${poisonedFighter.name} يتلقى ${poisonDmg} ضرر سُم! (متبقي ${poisonedFighter.poisonTurns} ${poisonedFighter.poisonTurns === 1 ? "دور" : "أدوار"})`);
            updateBattleScreen();
            if(poisonedFighter.hp <= 0){
                battle.finished = true;
                let winner = (poisonedFighter === battle.player) ? "enemy" : "player";
                battle.winner = winner;
                endBattle(winner);
                return;
            }
        }
        poisonedFighter.poisonTurns--;
    }

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
// تسليم الدور بعد فعل يستهلك الدور (لللاعب أو الخصم) مع مراعاة مهارة
// "الأدوار المتتالية" (consecutive_turns): إن كان لدى المقاتل أدوار إضافية
// (extraTurns) يبقى الدور عنده ويُنقص دور واحد، وإلا ينتقل الدور للطرف الآخر.
// يستخدمها كل الفاعلين الذين يستهلكون الدور بدل تكرار نفس النهاية يدويًا
// ========================================

function pveEndTurn(owner){

    if(battle.finished) return;

    let fighter = (owner === "player") ? battle.player : battle.enemy;

    if((fighter.extraTurns || 0) > 0){

        fighter.extraTurns--;

        battle.turnOwner = owner;

        addBattleLog(`⚡ دور إضافي! ${fighter.name} يستمر في الدور (متبقي ${fighter.extraTurns})`);

        setTimeout(processTurn, 900);

        return;

    }

    battle.turnOwner = (owner === "player") ? "enemy" : "player";

    setTimeout(processTurn, 900);

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

    // لون اسم المهارة المخصص من لوحة الإدارة (إن وُجد) — يظهر فوق خلفية
    // الصفحة مباشرة دون صندوق خلفي، مع بقاء ظل النص لضمان الوضوح
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

    let ready = isSkillReady(battle.player, skill);

    let remaining = cooldownTurnsRemaining(battle.player, skill);

    // هل خُتمت هذه المهارة بمهارة ختم من الخصم؟ لا يمكن استخدامها إطلاقًا
    let sealed = isSkillSealed(battle.player, skill);

    // الدفاع أصبح يستهلك الدور تمامًا مثل الهجوم، لذا يُقفل خارج دور اللاعب أيضًا.
    // السرقة والنسخ فقط تبقيان متاحتين في أي وقت. الختم/فك الختم فعلان يستهلكان الدور.
    // يُستثنى من ذلك حالة "0 HP" حيث يُسمح بالقيام بأي فعل للمحاولة الأخيرة
    let isTurnLocked =
    skill.effect !== "steal"
    && skill.effect !== "copy"
    && skill.effect !== "shadow"
    && battle.turnOwner !== "player"
    && battle.player.hp > 0;

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

        // حجم أزرار المهارات لهذه الصفحة (مقياس تُضبط من لوحة الإدارة)
        let pageScale = getSkillPageScale(battle.player.characterId, i);

        if(pageScale > 0 && pageScale !== 1){

            pageDiv.style.setProperty("--skill-scale", pageScale);

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

        if(battle.turnOwner !== "player" && battle.player.hp > 0) return;

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

    if(skill.effect === "control"){

        openControlMenu(skill);

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

    if(skill.effect === "reflect"){

        playerUseReflect(skill);

        return;

    }

    if(skill.effect === "delay_cooldown"){

        openDelayMenu(skill);

        return;

    }

    if(skill.effect === "shadow"){

        openShadowMenu(skill);

        return;

    }

    if(isNewBuffEffect(skill.effect)){

        if(battle.turnOwner !== "player" && battle.player.hp > 0) return;

        if(!isSkillReady(battle.player, skill)){

            alert("هذه المهارة ما زالت في التهدئة");

            return;

        }

        playerUseBuffSkill(skill);

        return;

    }

    if(skill.effect === "poison"){

        if(battle.turnOwner !== "player") return;

        if(!isSkillReady(battle.player, skill)){

            alert("هذه المهارة ما زالت في التهدئة");

            return;

        }

        playerUsePoisonSkill(skill);

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

    let rawDmg = (skill.damage && Number(skill.damage) > 0) ? skill.damage : null;

    let scaledDmg =
    (battle.player
     && battle.player.scaledAttackDamages
     && battle.player.scaledAttackDamages[skill.id] !== undefined)
    ? battle.player.scaledAttackDamages[skill.id]
    : null;

    let dmgLine = (scaledDmg !== null)
    ? `<p class="skill-detail-line"><strong>الضرر:</strong> ${scaledDmg}${(rawDmg !== null && Number(rawDmg) !== Number(scaledDmg)) ? ` <span class="skill-detail-scaled-note">(الأساسي ${rawDmg})</span>` : ""}</p>`
    : (rawDmg !== null
        ? `<p class="skill-detail-line"><strong>الضرر:</strong> ${rawDmg}</p>`
        : "");

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

    pveEndTurn("player");

}

// مهارة السُم للاعب: تُلحق ضررًا فوريًا (كالهجوم العادي) ثم تُفعّل
// أثر السُم المتواصل. الجولة الأولى من السُم تُحتسب من هذه الاستخدام،
//remainingTurns = poisonTurns - 1. لو poisonTurns = 1 فهي هجوم عادي فقط.
function playerUsePoisonSkill(skill){

    clearTurnTimer();

    let defender = battle.enemy;

    if(battle.player.lastHitSnapshot && !battle.player.lastHitSnapshot.consumed){

        battle.player.lastHitSnapshot.consumed = true;

    }

    battle.player.turnsTaken++;

    if(skill.cooldown > 0)
        battle.player.cooldownUsedAt[skill.id] = battle.player.turnsTaken;

    resolveAction(battle.player, defender, skill);

    if(checkBattleEnd()) return;

    let poisonDmg = Math.max(1, skillParamAmount(skill, "poison_damage", effectiveSkillDamage(skill, battle.player)));

    let poisonTurns = Math.max(1, skillParamAmount(skill, "poison_turns", skill.damage));

    let remainingTurns = Math.max(0, poisonTurns - 1);

    if(remainingTurns > 0 && defender.hp > 0){

        defender.poisonDamage = poisonDmg;

        defender.poisonTurns = remainingTurns;

        addBattleLog(`☠️ ${defender.name} مسموم! سيتلقى ${poisonDmg} ضرر سُم إضافي لمدة ${remainingTurns} ${remainingTurns === 1 ? "دور" : "أدوار"}`);

        showBattleEffectBanner(battle.prefix, `☠️ ${defender.name} مسموم!`, "info");

    } else if(defender.hp > 0){

        addBattleLog(`☠️ ${defender.name} تلقى ضررًا مباشرًا!`);

    }

    updateBattleScreen();

    if(checkBattleEnd()) return;

    pveEndTurn("player");

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

    // إذا كان الخصم على صفر صحة (نجا من ضربة قاتلة كان بمقدوره صدّها) يجب
    // عليه الدفاع حتمًا — لا خيار له ولا قرعة، وإلا يموت في نفس الدور
    let mustDefend = canDefend && enemy.hp <= 0;

    if(canDefend && (mustDefend || Math.random() < 0.5)){

        enemy.hp = enemy.lastHitSnapshot.hpBefore;

        enemy.lastHitSnapshot.consumed = true;

        // لو كانت الضربة المُلغاة من نوع امتصاص، يُسترجع الشفاء الذي كسبه
        // المهاجم (اللاعب) منها — لا يصح أن يبقى على صحته الجديدة من ضربة
        // أُلغيت أساسًا
        if(enemy.lastHitSnapshot.attackerLifestealHeal > 0){

            battle.player.hp = Math.max(0, battle.player.hp - enemy.lastHitSnapshot.attackerLifestealHeal);

        }

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

        pveEndTurn("enemy");

        return;

    }

    // المهارات الضررية الخاصة العادية (استثناءًا من مهارات الأنواع الجديدة
    // التي تُعالَج بخيارات احتمالية منفصلة أدناه)
    let special =
    enemy.skills.find(s =>
        s.type === "special"
        && s.effect !== "steal" && s.effect !== "copy" && s.effect !== "reflect"
        && s.effect !== "seal" && s.effect !== "unseal"
        && !isNewBuffEffect(s.effect)
        && s.effect !== "delay_cooldown" && s.effect !== "shadow"
        && !isSkillSealed(enemy, s)
        && isSkillReady(enemy, s));

    // الانعكاس (النمط الجديد) درع استباقي: يفعّله الخصم أحيانًا ليُرتدّ
    // هجوم اللاعب القابل للصد القادم عليه — يُفعَّل فقط إن لم يكن لديه
    // درع انعكاس نشط أصلًا
    let reflectSkill =
    enemy.skills.find(s =>
        s.type === "special" && s.effect === "reflect" && !isSkillSealed(enemy, s) && isSkillReady(enemy, s));

    // الانعكاس (بأثر رجعي مثل الدفاع): يعكس آخر ضربة من اللاعب، لذا لا يستخدمه
    // الخصم إلا إن كانت هناك ضربة أخيرة قابلة للعكس (لم يدافع عنها بعد)
    let reflectChoice =
    (reflectSkill && enemy.lastHitSnapshot && !enemy.lastHitSnapshot.consumed && Math.random() < 0.3)
    ? reflectSkill
    : null;

    // مهارات الأنواع الجديدة الذاتية (تعزيز/امتصاص/أدوار متتالية): يستخدمها
    // الخصم وفق احتمالات وظروف أولوية بسيطة حتى لا يكررها في كل دور
    let buffSkill =
    enemy.skills.find(s =>
        s.type === "special"
        && isNewBuffEffect(s.effect)
        && !isSkillSealed(enemy, s)
        && isSkillReady(enemy, s));

    let buffChoice = null;

    if(buffSkill){

        let want = 0.35;

        if(buffSkill.effect === "hp_boost" || buffSkill.effect === "absorb_hp"){

            if(enemy.hp / enemy.maxHp < 0.45) want = 0.8;

        }

        if(buffSkill.effect === "consecutive_turns" && (enemy.extraTurns || 0) > 0) want = 0.05;

        if(buffSkill.effect === "absorb_atk" && (enemy.absorbHits || 0) > 0) want = 0.15;

        if(buffSkill.effect === "atk_boost" && (enemy.tempAtk || 0) > 0) want = 0.2;

        if(Math.random() < want) buffChoice = buffSkill;

    }

    // تأجيل التهدئة: يؤخّر الخصم تهدئة إحدى مهارات اللاعب المستخدمة أحيانًا
    let delaySkill =
    enemy.skills.find(s =>
        s.type === "special" && s.effect === "delay_cooldown" && !isSkillSealed(enemy, s) && isSkillReady(enemy, s));

    let delayChoice =
    (delaySkill && battle.playerUsedSkills.length > 0 && Math.random() < 0.4)
    ? delaySkill
    : null;

    // الظل: يستدعي الخصم وحشًا مُهزَمًا من مخزونه أحيانًا لاستخدام إحدى مهاراته
    let shadowSkill =
    enemy.skills.find(s =>
        s.type === "special" && s.effect === "shadow" && !isSkillSealed(enemy, s) && isSkillReady(enemy, s));

    let shadowChoice =
    (shadowSkill && pveShadowPool().length > 0 && Math.random() < 0.45)
    ? shadowSkill
    : null;

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
    battle.playerUsedSkills.filter(s => !isSkillSealed(battle.player, s) && Number(s.slot) !== 1);

    // مثل اتجاه اللاعب: مهارة دفاع اللاعب تبقى قابلة للختم من الخصم دائمًا
    // حتى لو لم يستخدمها في هذا النزال بعد (الدفاع مهارة أساسية)
    let playerDefenseSkill =
    battle.player.skills.find(s => s.type === "defense");

    if(playerDefenseSkill
    && Number(playerDefenseSkill.slot) !== 1
    && !isSkillSealed(battle.player, playerDefenseSkill)
    && !sealablePlayerSkills.find(s => s.id === playerDefenseSkill.id)){

        sealablePlayerSkills.push(playerDefenseSkill);

    }

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
    || buffChoice
    || delayChoice
    || shadowChoice
    || sealChoice
    || unsealChoice
    || reflectChoice
    || enemy.skills.find(s => s.type === "attack" && !isSkillSealed(enemy, s));

    // إصلاح ثغرة: إذا لم يدافع الخصم عن آخر ضربة تلقاها (اختار أي فعل آخر)
    // تُصبح تلك الضربة "فائتة" ولا يجوز إلغاؤها لاحقًا بعد أدوار قادمة —
    // وإلا يرجع دمه من العدم في جولة لاحقة دون أي ضربة جديدة فعلية.
    // الانعكاس الجديد درع استباقي لا يعتمد على اللقطة إطلاقًا
    if(enemy.lastHitSnapshot && !enemy.lastHitSnapshot.consumed){

        enemy.lastHitSnapshot.consumed = true;

    }

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

    if(chosen.effect === "reflect"){

        enemyUseReflect(chosen);

        return;

    }

    // مهارات الأنواع الجديدة (تعزيز/امتصاص/أدوار متتالية/تأجيل التهدئة/الظل)
    // تُنفَّذ عبر معالج الخصم الخاص (الدور والتهدئة سُجّلا أعلاه)
    if(isNewBuffEffect(chosen.effect) || chosen.effect === "delay_cooldown" || chosen.effect === "shadow"){

        await enemyUseNewEffect(chosen);

        return;

    }

    if(chosen.effect === "poison"){

        resolveAction(enemy, battle.player, chosen);

        if(checkBattleEnd()) return;

        let poisonDmg = Math.max(1, skillParamAmount(chosen, "poison_damage", effectiveSkillDamage(chosen, battle.enemy)));

        let poisonTurns = Math.max(1, skillParamAmount(chosen, "poison_turns", chosen.damage));

        let remainingTurns = Math.max(0, poisonTurns - 1);

        if(remainingTurns > 0 && battle.player.hp > 0){

            battle.player.poisonDamage = poisonDmg;

            battle.player.poisonTurns = remainingTurns;

            addBattleLog(`☠️ ${battle.player.name} مسموم! سيتلقى ${poisonDmg} ضرر سُم إضافي لمدة ${remainingTurns} ${remainingTurns === 1 ? "دور" : "أدوار"}`);

            showBattleEffectBanner(battle.prefix, `☠️ ${battle.player.name} مسموم!`, "info");

        } else if(battle.player.hp > 0){

            addBattleLog(`☠️ ${battle.player.name} تلقى ضررًا مباشرًا!`);

        }

        updateBattleScreen();

        if(checkBattleEnd()) return;

        pveEndTurn("enemy");

        return;

    }

    resolveAction(enemy, battle.player, chosen);

    if(checkBattleEnd()) return;

    pveEndTurn("enemy");

}


// تطبيق مهارتي الختم/فك الختم من جانب الخصم: تختاران هدفًا عشوائيًا صالحًا
// وتُطبّقان أثرهما مباشرة (يُسجَّل الدور والتهدئة من قِبل المتصل)
function enemyUseSealOrUnseal(skill){

    let enemy = battle.enemy;

    markEnemySkillUsed(skill);

    if(skill.effect === "seal"){

        let sealable =
        battle.playerUsedSkills.filter(s => !isSkillSealed(battle.player, s) && Number(s.slot) !== 1);

        // دفاع اللاعب قابل للختم دائمًا (مهارة أساسية) حتى لو لم يستخدمه بعد
        let playerDefenseSkill =
        battle.player.skills.find(s => s.type === "defense");

        if(playerDefenseSkill
        && Number(playerDefenseSkill.slot) !== 1
        && !isSkillSealed(battle.player, playerDefenseSkill)
        && !sealable.find(s => s.id === playerDefenseSkill.id)){

            sealable.push(playerDefenseSkill);

        }

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

    pveEndTurn("enemy");

}


// ========================================
// نجاة من الضربة القاتلة عند صفر صحة
// ========================================
// عندما يصل المقاتل إلى صفر صحة من ضربة كان بمقدوره صدّها، يُنقَذ من الموت
// الفوري ويبقى على صفر حتى دوره (انظر fighterCanBlockLastHit). حين يستخدم
// بعدها أي مهارة صدّ (دفاع/انعكاس/امتصاص) تُعيد هذه الدالة صحته إلى ما قبل
// الضربة القاتلة وتُستهلك اللقطة — أي أنه "صدّ" الضربة فعليًا. يُرجع true
// إن كان هناك فعلاً نجاة تمّت
function rescueFighterFromFatalHit(fighter){

    let snapshot = fighter.lastHitSnapshot;

    if(snapshot && !snapshot.consumed && (fighter.hp || 0) <= 0 && (snapshot.dmgDealt || 0) > 0){

        fighter.hp = snapshot.hpBefore;

        snapshot.consumed = true;

        return true;

    }

    return false;

}


// ========================================
// مفاعيل الأنواع الجديدة (PvE)
// ========================================


// المهارات الممنوعة من استخدامها عبر "الظل" (مطابقة لقائمة المنع في السيرفر)
const PVE_SHADOW_EXCLUDED_EFFECTS = ["copy", "seal", "unseal", "shadow", "delay_cooldown"];


// يُطبّق المفعول الذاتي لمهارات الأنواع الجديدة (تعزيز/امتصاص/أدوار متتالية)
// على مقاتل معيّن، ويعيد سطر سجل جاهزًا للمعاينة. القيم تُقرأ من skill.params
// وإلا من رقم المهارة (damage) — مطابق لمنطق السيرفر
function applyPveBuff(fighter, skill){

    let amount = Math.max(1, skillParamAmount(skill, "amount", skill.damage));

    if(skill.effect === "atk_boost"){

        fighter.tempAtk = (fighter.tempAtk || 0) + amount;

        return `${fighter.name} عزّز قوته الهجومية! +${amount} قوة مؤقتة`;

    }

    if(skill.effect === "hp_boost"){

        // تسمح بالاستشفاء حتى لو كانت الصحة ممتلئة، فتتجاوز الحد الأقصى مؤقتًا
        let healed = amount;

        fighter.hp = fighter.hp + amount;

        // إن تجاوزت الصحة الحد الأقصى، نرفع الحد الأقصى ليطابقها
        if(fighter.hp > fighter.maxHp){
            fighter.maxHp = fighter.hp;
        }

        return `${fighter.name} استعاد ${healed} صحة!`;

    }

    if(skill.effect === "absorb_atk"){

        // الامتصاص الآن استباقي بأثر رجعي مثل الانعكاس والدفاع: يُمتص "آخر
        // ضربة" أصابت المقاتل ويحوّلها إلى قوة هجومية مؤقتة، بدل أن يكون
        // درعًا ينتظر الضربة القادمة. إن لم تكن هناك ضربة أخيرة يحتمل امتصاصها
        // فلا يحدث شيء.
        let absorbed = retroAbsorbNow(fighter, skill, "atk");

        if(absorbed === null){
            return `لا يوجد ضرر حالٍ ليستوعبه الامتصاص (ليس هناك ضربة أخيرة على ${fighter.name})`;
        }

        return `${fighter.name} امتصّ آخر ضربة (${absorbed} ضرر) وحوّلها إلى قوة هجومية مؤقتة!`;

    }

    if(skill.effect === "absorb_hp"){

        // مماثل: يُمتص آخر ضربة ويحوّلها إلى صحة
        let absorbed = retroAbsorbNow(fighter, skill, "hp");

        if(absorbed === null){
            return `لا يوجد ضرر حالٍ ليستوعبه الامتصاص (ليس هناك ضربة أخيرة على ${fighter.name})`;
        }

        return `${fighter.name} امتصّ آخر ضربة (${absorbed} ضرر) وحوّلها إلى صحة!`;

    }

    if(skill.effect === "consecutive_turns"){

        fighter.extraTurns = (fighter.extraTurns || 0) + amount;

        return `${fighter.name} حصل على ${amount} ${amount === 1 ? "دور إضافي" : "أدوار إضافية"}`;

    }

    if(skill.effect === "poison"){

        let poisonDmg = Math.max(1, skillParamAmount(skill, "poison_damage", effectiveSkillDamage(skill, fighter)));
        let poisonTurns = Math.max(1, skillParamAmount(skill, "poison_turns", skill.damage));

        let target = (fighter === battle.player) ? battle.enemy : battle.player;

        target.poisonDamage = poisonDmg;
        target.poisonTurns = poisonTurns;

        return `${target.name} مسموم! سيتلقى ${poisonDmg} ضرر لمدة ${poisonTurns} ${poisonTurns === 1 ? "دور" : "أدوار"}`;

    }

    return "";

}


// يُنفّذ مهارة الأنواع الجديدة من جانب الخصم (الدور والتهدئة سُجّلا في
// enemyAct قبل الوصول إلى هنا)
async function enemyUseNewEffect(skill){

    let enemy = battle.enemy;

    markEnemySkillUsed(skill);

    if(skill.effect === "delay_cooldown"){

        let candidates = battle.playerUsedSkills.filter(s => s.cooldown > 0);

        if(candidates.length === 0) candidates = battle.player.skills.filter(s => s.cooldown > 0);

        let target = candidates[Math.floor(Math.random() * candidates.length)];

        if(target){

            let delayTurns = Math.max(1, skillParamAmount(skill, "turns", skill.damage));

            battle.player.cooldownExtra[target.id] = (battle.player.cooldownExtra[target.id] || 0) + delayTurns;

            addBattleLog(`${enemy.name} أخّر تهدئة "${target.name}" عندك! (+${delayTurns} ${delayTurns === 1 ? "دور" : "أدوار"})`);

            showBattleEffectBanner(battle.prefix, `⏳ ${enemy.name} أخّر تهدئة "${target.name}"!`, "info");

        } else {

            addBattleLog(`${enemy.name} حاول تأجيل التهدئة لكن لا توجد مهارة مناسبة لديك`);

        }

    } else if(skill.effect === "shadow"){

        let pool = pveShadowPool();

        // دمج القائمة المخصصة مع المهزومة للعدو أيضًا
        let customIds = (skill.params && Array.isArray(skill.params.shadow_list)) ? skill.params.shadow_list : [];
        if(customIds.length > 0){
            let customChars = await fetchCustomShadowCharacters(customIds, enemy.id);
            let customIdsSet = new Set(customChars.map(c => String(c.id)));
            let defeatedOnly = pool.filter(e => !customIdsSet.has(String(e.id)));
            pool = [...customChars, ...defeatedOnly];
        }

        let entry = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;

        let available = entry ? (entry.skills || []).filter(s => !PVE_SHADOW_EXCLUDED_EFFECTS.includes(s.effect)) : [];

        let targetSkill = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : null;

        if(entry && targetSkill){

            addBattleLog(`${enemy.name} استدعى ظل "${entry.name}" واستخدم "${targetSkill.name}"!`);

            showBattleEffectBanner(battle.prefix, `🌑 ${enemy.name} استخدم "${targetSkill.name}" من ظل ${entry.name}!`, "info");

            executeShadowSkill(battle.enemy, battle.player, targetSkill);

        } else {

            addBattleLog(`${enemy.name} استدعى الظل لكن لا توجد مهارة صالحة للاستخدام`);

        }

    } else {

        let logLine = applyPveBuff(enemy, skill);

        if(logLine) addBattleLog(logLine);

        showBattleEffectBanner(battle.prefix, logLine || "الخصم استخدم مهارة خاصة", "info");

    }

    renderUsedSkillsUI(battle.prefix);

    renderSkillButtons(battle.prefix);

    updateBattleScreen();

    if(checkBattleEnd()) return;

    pveEndTurn("enemy");

}


// يُنفّذ مهارةً مستدعاةً من "الظل" وكأن صاحب الظل استخدمها: دفاع → إلغاء
// ضربة على المستخدم، انعكاس → درع استباقي، مفاعيل ذاتية → تطبيق مباشر،
// وأي مهارة ضررية/تجميد → resolveAction على الهدف (trackUsed=false لأنها
// ليست من مهارات المستخدم نفسه)
function executeShadowSkill(user, target, skill){

    if(skill.type === "defense"){

        let snapshot = user.lastHitSnapshot;

        if(snapshot && !snapshot.consumed){

            user.hp = snapshot.hpBefore;

            snapshot.consumed = true;

            if(snapshot.attackerLifestealHeal > 0){

                target.hp = Math.max(0, target.hp - snapshot.attackerLifestealHeal);

            }

            updateBattleScreen();

            addBattleLog(`${user.name} استخدم "${skill.name}" الظلية دفاعيًا وألغى الضربة!`);

        } else {

            addBattleLog(`لا يوجد ضرر حالي لصده بمهارة "${skill.name}" الظلية`);

        }

        return;

    }

    if(skill.effect === "reflect"){

        if(!user.lastHitSnapshot || user.lastHitSnapshot.consumed){

            addBattleLog(`لا يوجد ضرر حالٍ ليعكسه الانعكاس بمهارة "${skill.name}" الظلية`);

            return;

        }

        let reflectDmg = retroReflectNow(user, skill);

        updateBattleScreen();

        addBattleLog(`${user.name} عكسَ آخر ضربة بمهارة "${skill.name}" الظلية! (ضرر ${reflectDmg})`);

        return;

    }

    if(isNewBuffEffect(skill.effect)){

        let logLine = applyPveBuff(user, skill);

        if(logLine) addBattleLog(logLine);

        updateBattleScreen();

        return;

    }

    resolveAction(user, target, skill, false);

}


// ========================================
// مخزون الظل (الوحوش المهزومة — يُحفظ محليًا ليُستخدم في مهارة "الظل")
// ========================================

function pveShadowPoolStorageKey(){

    return "pve_shadow_pool";

}


async function fetchShadowPoolFromSupabase(){
    let token = localStorage.getItem("player_token");
    if(!token) return [];
    
    // استخدام RPC الموحد (الذي يجمع البيانات مع مهاراتها في طلب واحد)
    let { data, error } = await supabaseClient.rpc("pvp_list_shadow_pool", { 
        p_token: token,
        p_self_character_id: battle.player ? battle.player.characterId : null
    });
    if(error || !data) return [];
    
    // إعادة تجميع الصفوف المسطحة إلى كائنات شخصيات
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

    return Object.values(chars);
}

function pveLoadShadowPool(){
    return window.shadowPoolCache || [];
}


function pveSaveShadowPool(pool){

    try{

        localStorage.setItem(pveShadowPoolStorageKey(), JSON.stringify(pool));

    }catch(e){}

}


function pveShadowPool(){

    return pveLoadShadowPool();

}


async function pveAddDefeatedToShadowPool(enemy){

    if(!enemy || !enemy.id) return;

    try {
        // استخدام RPC التي تحلّ user_id من السيرفر (SECURITY DEFINER)
        // لأن هذا العميل لا يستخدم جلسات Supabase Auth، بل نظام player_token
        // المخصص، فلا يمكن الاعتماد على auth.uid() في سياسات RLS
        const { error } = await supabaseClient.rpc("add_to_shadow_pool", {
            p_token: localStorage.getItem("player_token"),
            p_character_id: enemy.id
        });

        if (error) throw error;

        // تحديث الكاش المحلي
        if(!window.shadowPoolCache) window.shadowPoolCache = [];
        if(!window.shadowPoolCache.find(e => e.id === enemy.id)){
            window.shadowPoolCache.push(enemy);
        }
    } catch (error) {
        console.error("Failed to add shadow to pool:", error);
    }
}


async function fetchCustomShadowCharacters(charIds, selfCharacterId){
    if(!charIds || charIds.length === 0) return [];
    let filtered = charIds.filter(id => String(id) !== String(selfCharacterId));
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
        console.error("fetchCustomShadowCharacters failed", e);
        return [];
    }
}


// ========================================
// معالجات اللاعب لمهارات الأنواع الجديدة
// ========================================

function playerUseBuffSkill(skill){

    clearTurnTimer();

    let logLine = applyPveBuff(battle.player, skill);

    battle.player.turnsTaken++;

    if(skill.cooldown > 0)
        battle.player.cooldownUsedAt[skill.id] = battle.player.turnsTaken;

    if(!battle.playerUsedSkills.find(s => s.id === skill.id)){

        battle.playerUsedSkills.push(skill);

    }

    renderUsedSkillsUI(battle.prefix);

    renderSkillButtons(battle.prefix);

    updateBattleScreen();

    if(logLine) addBattleLog(logLine);

    showBattleEffectBanner(battle.prefix, logLine || "استخدمتَ مهارة خاصة", "info");

    if(checkBattleEnd()) return;

    pveEndTurn("player");

}


// تأجيل التهدئة (اللاعب): يختار مهارة خصم ظاهرة لتأخير تهدئتها
function openDelayMenu(delaySkill){

    if(battle.turnOwner !== "player") return;

    if(battle.finished) return;

    if(isSkillSealed(battle.player, delaySkill)){

        alert("مهارة تأجيل التهدئة هذه مختومة 🔒");

        return;

    }

    if(!isSkillReady(battle.player, delaySkill)){

        alert("مهارة تأجيل التهدئة ما زالت في التهدئة");

        return;

    }

    closeDelayMenu();

    let delayTurns = Math.max(1, skillParamAmount(delaySkill, "turns", delaySkill.damage));

    // الأهداف: مهارات الخصم الظاهرة في هذا النزال ولها تهدئة أصلًا، وإلا
    // فكل مهارات الخصم ذات التهدئة
    let targets = battle.enemyUsedSkillsThisBattle.filter(s => s.cooldown > 0);

    if(targets.length === 0){

        targets = battle.enemy.skills.filter(s => s.cooldown > 0);

    }

    let listHtml = targets.length > 0
    ? targets
        .map(s => `<button class="steal-option delay-option" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`)
        .join("")
    : "<p>لا توجد مهارة خصم لها تهدئة لتعمل عليها</p>";

    let modal = document.createElement("div");

    modal.id = "delay-modal";

    modal.className = "steal-modal";

    modal.innerHTML = `

        <div class="steal-modal-box">

            <h3>⏳ أخّر تهدئة مهارة الخصم (+${delayTurns} ${delayTurns === 1 ? "دور" : "أدوار"})</h3>

            <div class="steal-options-list">
                ${listHtml}
            </div>

            <div class="steal-modal-buttons">

                <button id="delay-confirm-btn" disabled>تأجيل التهدئة</button>

                <button id="delay-cancel-btn">إلغاء</button>

            </div>

        </div>

    `;

    document.body.appendChild(modal);

    let selected = null;

    modal.querySelectorAll(".delay-option").forEach(btn => {

        btn.onclick = () => {

            modal.querySelectorAll(".delay-option").forEach(b => b.classList.remove("steal-selected"));

            selected = btn.dataset.name;

            btn.classList.add("steal-selected");

            document.getElementById("delay-confirm-btn").disabled = false;

        };

    });

    modal.querySelector("#delay-confirm-btn").onclick = () => {

        if(!selected) return;

        closeDelayMenu();

        pveUseDelaySkill(delaySkill, selected);

    };

    modal.querySelector("#delay-cancel-btn").onclick = closeDelayMenu;

}


function closeDelayMenu(){

    let modal = document.getElementById("delay-modal");

    if(modal) modal.remove();

}


function pveUseDelaySkill(delaySkill, targetName){

    if(battle.finished) return;

    let target = battle.enemy.skills.find(s => s.name === targetName);

    if(!target){

        alert("تعذر العثور على المهارة المستهدفة");

        return;

    }

    clearTurnTimer();

    let delayTurns = Math.max(1, skillParamAmount(delaySkill, "turns", delaySkill.damage));

    battle.enemy.cooldownExtra[target.id] = (battle.enemy.cooldownExtra[target.id] || 0) + delayTurns;

    battle.player.turnsTaken++;

    if(delaySkill.cooldown > 0)
        battle.player.cooldownUsedAt[delaySkill.id] = battle.player.turnsTaken;

    if(!battle.playerUsedSkills.find(s => s.id === delaySkill.id)){

        battle.playerUsedSkills.push(delaySkill);

    }

    renderUsedSkillsUI(battle.prefix);

    renderSkillButtons(battle.prefix);

    updateBattleScreen();

    addBattleLog(`${battle.player.name} أخّر تهدئة "${target.name}" عند الخصم! (+${delayTurns} ${delayTurns === 1 ? "دور" : "أدوار"})`);

    showBattleEffectBanner(battle.prefix, `⏳ أخّرتَ تهدئة "${target.name}"!`, "info");

    if(checkBattleEnd()) return;

    pveEndTurn("player");

}


// الظل (اللاعب): قائمة أولية بالوحوش المهزومة، ثم قائمة مهارات الوحش المختار
async function openShadowMenu(shadowSkill){

    if(battle.turnOwner !== "player") return;

    if(battle.finished) return;

    if(isSkillSealed(battle.player, shadowSkill)){

        alert("مهارة الظل هذه مختومة 🔒");

        return;

    }

    if(!isSkillReady(battle.player, shadowSkill)){

        alert("مهارة الظل ما زالت في التهدئة");

        return;

    }

    closeShadowMenu();

    let pool = pveShadowPool().filter(e => String(e.id) !== String(battle.player.characterId));

    // دمج قائمة الظل المخصصة مع المهزومة
    let customIds = (shadowSkill.params && Array.isArray(shadowSkill.params.shadow_list)) ? shadowSkill.params.shadow_list : [];
    if(customIds.length > 0){
        let customChars = await fetchCustomShadowCharacters(customIds, battle.player.characterId);
        // إزالة التكرار: الشخصية المخصصة تأخذ الأولوية
        let customIdsSet = new Set(customChars.map(c => String(c.id)));
        let defeatedOnly = pool.filter(e => !customIdsSet.has(String(e.id)));
        pool = [...customChars, ...defeatedOnly];
    }

    // حفظ القائمة المدمجة مؤقتًا لاستخدامها في openShadowSkillMenu / pveUseShadowSkill
    battle.shadowMergedPool = pool;

    let listHtml = pool.length > 0
    ? pool
        .map(e => `<button class="steal-option shadow-char-option" data-id="${escapeHtml(String(e.id))}">🌑 ${escapeHtml(e.name || "وحش")}</button>`)
        .join("")
    : "<p>لا توجد شخصيات مؤهلة في قائمة الظل</p>";

    let modal = document.createElement("div");

    modal.id = "shadow-modal";

    modal.className = "steal-modal";

    modal.innerHTML = `

        <div class="steal-modal-box">

            <h3>🌑 استدعِ ظل شخصية واستخدم إحدى مهاراته</h3>

            <div class="steal-options-list">
                ${listHtml}
            </div>

            <div class="steal-modal-buttons">

                <button id="shadow-cancel-btn">إلغاء</button>

            </div>

        </div>

    `;

    document.body.appendChild(modal);

    modal.querySelectorAll(".shadow-char-option").forEach(btn => {

        btn.onclick = () => {

            closeShadowMenu();

            openShadowSkillMenu(shadowSkill, btn.dataset.id);

        };

    });

    modal.querySelector("#shadow-cancel-btn").onclick = closeShadowMenu;

}


function openShadowSkillMenu(shadowSkill, charId){

    if(battle.finished) return;

    let entry = (battle.shadowMergedPool || pveShadowPool()).find(e => String(e.id) === String(charId));

    if(!entry) return;

    let usable = (entry.skills || []).filter(s => !PVE_SHADOW_EXCLUDED_EFFECTS.includes(s.effect));

    let listHtml = usable.length > 0
    ? usable
        .map(s => `<button class="steal-option shadow-skill-option" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`)
        .join("")
    : "<p>لا توجد مهارة صالحة في هذا الظل</p>";

    let modal = document.createElement("div");

    modal.id = "shadow-skill-modal";

    modal.className = "steal-modal";

    modal.innerHTML = `

        <div class="steal-modal-box">

            <h3>🌑 استخدم مهارة من ظل "${escapeHtml(entry.name)}"</h3>

            <div class="steal-options-list">
                ${listHtml}
            </div>

            <div class="steal-modal-buttons">

                <button id="shadow-skill-back-btn">رجوع</button>

            </div>

        </div>

    `;

    document.body.appendChild(modal);

    modal.querySelectorAll(".shadow-skill-option").forEach(btn => {

        btn.onclick = () => {

            closeShadowMenu();

            pveUseShadowSkill(shadowSkill, charId, btn.dataset.name);

        };

    });

    modal.querySelector("#shadow-skill-back-btn").onclick = () => {

        let m = document.getElementById("shadow-skill-modal");

        if(m) m.remove();

        openShadowMenu(shadowSkill);

    };

}


function closeShadowMenu(){

    let m = document.getElementById("shadow-modal");

    if(m) m.remove();

    let s = document.getElementById("shadow-skill-modal");

    if(s) s.remove();

}


function pveUseShadowSkill(shadowSkill, charId, skillName){

    if(battle.finished) return;

    let entry = (battle.shadowMergedPool || pveShadowPool()).find(e => String(e.id) === String(charId));

    let targetSkill = entry ? (entry.skills || []).find(s => s.name === skillName) : null;

    if(!targetSkill){

        alert("تعذر العثور على المهارة في ظل الوحش");

        return;

    }

    clearTurnTimer();

    battle.player.turnsTaken++;

    if(shadowSkill.cooldown > 0)
        battle.player.cooldownUsedAt[shadowSkill.id] = battle.player.turnsTaken;

    if(!battle.playerUsedSkills.find(s => s.id === shadowSkill.id)){

        battle.playerUsedSkills.push(shadowSkill);

    }

    renderUsedSkillsUI(battle.prefix);

    renderSkillButtons(battle.prefix);

    updateBattleScreen();

    addBattleLog(`${battle.player.name} استدعى ظل "${entry.name}" واستخدم "${targetSkill.name}"!`);

    showBattleEffectBanner(battle.prefix, `🌑 استخدمتَ "${targetSkill.name}" من ظل ${entry.name}!`, "info");

    executeShadowSkill(battle.player, battle.enemy, targetSkill);

    if(checkBattleEnd()) return;

    pveEndTurn("player");

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

        // الشرائح تحت بطاقة الخصم تعرض فقط مهارات هذا النزال الحالي بالذات
        // (enemyUsedSkillsThisBattle) حتى لا تبقى مهارات نزالات سابقة ظاهرة،
        // فيبدو وكأنها لم "تُصفَّر" مع بدء نزال جديد
        let key = battle.enemyUsedSkillsThisBattle.map(s => {
            let ready = isSkillReady(battle.enemy, s);
            let remaining = cooldownTurnsRemaining(battle.enemy, s);
            let sealed = isSkillSealed(battle.enemy, s) ? "S" : "0";
            return s.id + ":" + (!ready && remaining > 0 ? remaining : "0") + ":" + sealed;
        }).join(",");

        if(enemyBox.dataset.renderedKey !== key){

        enemyBox.dataset.renderedKey = key;

        enemyBox.innerHTML = "";

        battle.enemyUsedSkillsThisBattle.forEach(s => {

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



function resolveAction(attacker, defender, skill, trackUsed = true, isReflectedHit = false){

    let dmg = calcDamage(skill, attacker);

    // القوة المؤقتة (atk_boost) تُضاف لضرر الهجمات والمهارات الضررية فقط
    if((skill.type === "attack" || skill.type === "special") && dmg > 0){

        dmg += (attacker.tempAtk || 0);

    }

    // مهارة الانعكاس لم تعد تُنفَّذ هنا إطلاقًا: صارت درعًا استباقيًا يُفعَّل
    // عبر playerUseReflect / enemyUseReflect قبل الوصول إلى resolveAction.
    // لو وصلت هنا لأي سبب نادر فلا تُسبب ضررًا مباشرًا
    if(skill.effect === "reflect"){

        dmg = 0;

    }

    let hpBefore = defender.hp;

    // قواعد الدروع الثلاثة أمام الضربات الواردة (مطابقة لمنطق السيرفر):
    //   1. الانعكاس (reflect): يصدّ الضربات القابلة للصد فقط، ويحترم مهارة
    //      "لا تُصد" (unblockable) — الضربة غير القابلة للصد تمرّ مباشرة
    //      ولا تُنعكس.
    //   2. الامتصاص (absorb_atk / absorb_hp): يمتصّ كل الضربات، بما فيها
    //      "لا تُصد" — لا يوجد أي فحص !skill.unblockable هنا عمدًا.
    //   3. درع التحمّل (shieldCharges من الدفاع): يحترم "لا تُصد" كذلك.

    // درع الانعكاس عند المدافع: أول ضربة قابلة للصد (غير "لا تُصد") تصل إليه
    // ترتد على مهاجمها × المضاعف، ويُستهلك الدرع بعدها. الضربة المُنعكسة
    // نفسها (isReflectedHit) لا تُعيد تفعيل أي درع — مانع التكرار المطابق
    // للسيرفر، فلا تُرتد ضربة مرتدّة مرة أخرى أبدًا
    let reflected = false;

    let reflectedDmg = 0;

    if(dmg > 0 && !skill.unblockable && (defender.reflectMult || 0) > 0 && !isReflectedHit && defender !== attacker){

        reflected = true;

        reflectedDmg = Math.max(1, Math.floor(dmg * defender.reflectMult));

        let unblockableReflect = !!defender.reflectUnblockable;

        defender.reflectMult = 0;

        defender.reflectUnblockable = false;

        // انعكاس لا يُصدّ: الضرر المنعكس لا يُحجب إلا بمهارة الامتصاص لدى
        // المهاجم. وإلا فيُعكس كضرر مباشر لا يُصدّ على المهاجم
        if(unblockableReflect && attacker.absorbHits > 0){

            if(attacker.absorbMode === "atk"){

                attacker.tempAtk += reflectedDmg;

            } else {

                attacker.hp += reflectedDmg;

                if(attacker.hp > attacker.maxHp) attacker.maxHp = attacker.hp;

            }

            attacker.absorbHits--;

            if(attacker.absorbHits <= 0){

                attacker.absorbMode = null;

                attacker.absorbHits = 0;

            }

        } else {

            attacker.hp = Math.max(0, attacker.hp - reflectedDmg);

        }

    }

    // درع الامتصاص (absorb_atk / absorb_hp): أي ضربة تُمتَص بدل أن تُلحق
    // ضررًا — قابلة للصد أو "لا تُصد" على حد سواء — وتتحول إلى قوة مؤقتة
    // (atk) أو صحة مسترجعة (hp). يأتي بعد درع الانعكاس وقبل درع "تحمّل
    // عدة ضربات" — مطابق لترتيب السيرفر
    let absorbedByAbsorb = false;

    let absorbedAmount = 0;

    let absorbModeForMsg = null;

    if(!reflected && dmg > 0 && !isReflectedHit && (defender.absorbHits || 0) > 0){

        absorbedByAbsorb = true;

        absorbedAmount = dmg;

        absorbModeForMsg = defender.absorbMode;

        if(absorbModeForMsg === "atk"){

            defender.tempAtk = (defender.tempAtk || 0) + absorbedAmount;

        } else {

            defender.hp = defender.hp + absorbedAmount;

            if(defender.hp > defender.maxHp){
                defender.maxHp = defender.hp;
            }

        }

        defender.absorbHits--;

        if(defender.absorbHits <= 0){

            defender.absorbMode = null;

            defender.absorbHits = 0;

        }

        dmg = 0;

    }

    // درع "تحمّل عدة ضربات" المتبقي من دفاع سابق: يمتص هذه الضربة تلقائيًا
    // (طالما ليست "لا تُصد") وينقص شحنة واحدة، بدل تطبيق الضرر مباشرة
    let absorbedByShield = false;

    if(!reflected && !absorbedByAbsorb && !skill.unblockable && dmg > 0 && (defender.shieldCharges || 0) > 0){

        absorbedByShield = true;

        defender.shieldCharges--;

        dmg = 0;

    }

    if(!reflected && !absorbedByAbsorb && !absorbedByShield){

        defender.hp = Math.max(0, defender.hp - dmg);

    }

    let dmgApplied = Math.min(dmg, hpBefore);

    // مهارة "امتصاص" (lifesteal): يعالج المهاجم نفسه بمقدار الضرر الفعلي
    // الذي تسبّبه (بعد الدرع/الصد)، أي إن مُنع الضرر كله فلا شفاء — وصولاً
    // للحد الأقصى من الصحة فقط. تُحسب أولًا حتى تُخزَّن قيمة الشفاء في لقطة
    // الضربة، فإذا ألغى المدافع الضربة لاحقًا (دفاع) يُسترجع الشفاء من
    // المهاجم لأنه لا يصح منطقيًا أن يكسب صحة من ضربة أُلغيت
    let healedAmount = 0;

    if(!reflected && skill.effect === "lifesteal" && dmg > 0 && attacker.hp < attacker.maxHp){

        healedAmount = Math.min(dmg, attacker.maxHp - attacker.hp);

        attacker.hp += healedAmount;

    }

    // لقطة آخر ضربة وقعت على المدافع: تُستعمل في "الدفاع" (إلغاء الضربة
    // واسترجاع الصحة). الضربة "لا تُصد" (unblockable) لا تترك ضررًا يُلغى،
    // والضربة الممتصة بدرع (امتصاص أو تحمّل) لا تُنشئ ضررًا يُسترجع.
    // الانعكاس الجديد استباقي (درع) لا يعتمد على اللقطة إطلاقًا، لذا الضربة
    // المرتدّة لا تُنشئ لقطة على المدافع (لم يتعرض لأي ضرر)
    if(skill.effect !== "reflect" && !reflected){

        defender.lastHitSnapshot = {
            hpBefore: hpBefore,
            dmgDealt: dmgApplied,
            consumed: !!skill.unblockable || absorbedByShield || absorbedByAbsorb,
            unblockable: !!skill.unblockable,
            reflectable: false,
            attackerLifestealHeal: (skill.effect === "lifesteal") ? healedAmount : 0
        };

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

    // الضربة المرتدّة تُظهر أثرها على المهاجم نفسه (حامل درع الانعكاس لم
    // يتعرض لأي ضرر)، بينما الضربات العادية على المدافع
    if(reflected){

        let attackerPrefix =
        (attacker === battle.player)
        ? battle.prefix + "-player"
        : battle.prefix + "-enemy";

        applyDamageEffect(battle.prefix, attackerPrefix, reflectedDmg, false);

    } else {

        applyDamageEffect(battle.prefix, defenderPrefix, dmg, false, !!skill.unblockable);

    }

    // رقم شفاء الامتصاص يظهر فوق بطاقة المهاجم نفسه (قيمة خضراء +)
    if(healedAmount > 0){

        let attackerPrefix =
        (attacker === battle.player)
        ? battle.prefix + "-player"
        : battle.prefix + "-enemy";

        showDamagePopup(attackerPrefix, healedAmount, true);

    }

    // امتصاص → صحة: رقم الصحة المسترجعة يظهر فوق بطاقة المدافع (قيمة خضراء +)
    if(absorbedByAbsorb && absorbModeForMsg === "hp"){

        showDamagePopup(defenderPrefix, absorbedAmount, true);

    }

    // شارة الحدث في منتصف الساحة: توضّح فورًا هل الضربة نجحت، أم امتصّها
    // الدرع، أم كانت تجميدًا — دون الحاجة لفتح سجل المعركة
    let iAmDefender = (defender === battle.player);

    if(reflected){

        showBattleEffectBanner(
            battle.prefix,
            iAmDefender ? `🔁 درع الانعكاس ردّ الهجوم على الخصم! -${reflectedDmg}` : `🔁 هجومك ارتدّ عليك بدرع انعكاس الخصم! -${reflectedDmg}`,
            "reflect"
        );

    } else if(absorbedByAbsorb){

        let statWord = (absorbModeForMsg === "atk") ? "قوة" : "صحة";

        showBattleEffectBanner(
            battle.prefix,
            iAmDefender ? `🧲 امتصصتَ الهجوم! +${absorbedAmount} ${statWord}` : `🧲 الخصم امتصّ هجومك! +${absorbedAmount} ${statWord}`,
            "block"
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

    if(reflected){

        addBattleLog(`${attacker.name} هاجم بـ${skill.name} لكن ${defender.name} عكس الهجوم بدرعه! -${reflectedDmg} على ${attacker.name}`);

    } else if(absorbedByAbsorb){

        let statWord = (absorbModeForMsg === "atk") ? "قوة مؤقتة" : "صحة";

        addBattleLog(`${defender.name} امتصّ ${skill.name} من ${attacker.name}! +${absorbedAmount} ${statWord} (متبقٍ ${defender.absorbHits})`);

    } else if(absorbedByShield){

        addBattleLog(`${attacker.name} استخدم ${skill.name}، لكن ${defender.name} امتصّها بدرعه! (متبقٍ ${defender.shieldCharges} من التحمّل)`);

    } else if(skill.effect === "lifesteal" && healedAmount > 0){

        addBattleLog(`${attacker.name} استخدم ${skill.name} → ${dmg} ضرر وامتصّ ${healedAmount} صحة`);

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
// الانعكاس (النمط الجديد): درع استباقي — عند التفعيل يُثبَّت مضاعف ارتداد
// على المستخدم، وأول ضربة قابلة للصد تصل إليه لاحقًا ترتد على مهاجمها
// × المضاعف ثم يُستهلك الدرع (نُفّذ منطق الارتداد داخل resolveAction).
// مطابق تمامًا لمنطق السيرفر في PvP
// ========================================

// الانعكاس الاستباقي أصبح بأثر رجعي مثل الدفاع تمامًا: عوض أن يُجهّز درعًا
// ليرتدّ عن أول ضربة قابلة للصد قادمة، يعكس آخر ضربة وقعها الخصم على المستخدم
// — يستعيد صحته السابقة، يُستهلك اللقطة، ويُعيد الضرر نفسه × المضاعف على الخصم.
// يعيد مقدار الضرر المنعكس، أو null إن لم توجد ضربة حالية ليعكسها
function retroReflectNow(caster, skill){

    let snapshot = caster.lastHitSnapshot;

    if(!snapshot || snapshot.consumed || (snapshot.dmgDealt || 0) <= 0){

        if(snapshot && snapshot.consumed && (caster.hp || 0) > 0 && (snapshot.dmgDealt || 0) > 0) return null;

        return null;

    }

    let attacker = (caster === battle.player) ? battle.enemy : battle.player;

    // استرجاع صحة المستخدم إلى ما قبل آخر ضربة (يُنقَذ حتى لو كان على صفر)
    caster.hp = snapshot.hpBefore;

    snapshot.consumed = true;

    // لو كانت الضربة المُلغاة من نوع امتصاص، يُسترجع الشفاء الذي كسبه الخصم
    // منها — لا يصح أن يبقى على صحته الجديدة من ضربة أُلغيت أساسًا
    if(snapshot.attackerLifestealHeal > 0){

        attacker.hp = Math.max(0, attacker.hp - snapshot.attackerLifestealHeal);

    }

    let reflectMult = Math.max(1, skillParamAmount(skill, "reflect_mult", skill.damage));

    let reflectDmg = Math.max(1, Math.floor(snapshot.dmgDealt * reflectMult));

    let attHpBefore = attacker.hp;

    attacker.hp = Math.max(0, attacker.hp - reflectDmg);

    // الضربة المُنعكسة من انعكاس عادي تصير ضربةً عاديةً قابلة للصدّ على المهاجم:
    // تُسجَّل في لقطة آخر ضربة عنده (غير مُستهلكة وغير "لا تُصدّ") حتى يتمكن
    // (لاعبًا كان أو خصمًا) من استخدام الدفاع وإلغائها واسترجاع صحته.
    // أما الانعكاس "لا يُصدّ" فلا يترك ضربةً قابلةً للصدّ (consumed=true)
    let unblockableReflect = !!(skill.params && skill.params.unblockable_reflect);

    attacker.lastHitSnapshot = {

        hpBefore: attHpBefore,

        dmgDealt: reflectDmg,

        consumed: unblockableReflect,

        unblockable: unblockableReflect,

        reflectable: false,

        attackerLifestealHeal: 0

    };

    return reflectDmg;

}


// ========================================
// امتصاص "آخر ضربة" بأثر رجعي (بدل درع للضربة القادمة)
// ========================================
// يعمل تمامًا مثل الانعكاس والدفاع: يقرأ fighter.lastHitSnapshot، وإن كانت
// هناك ضربة أخيرة غير مُستهلكة على المقاتل، تُلغى (تُعاد صحته إلى ما قبلها)
// ويُحوَّل ضررها إلى قوة (mode="atk") أو صحة (mode="hp"). يستهلك اللقطة.
// يُرجع مقدار الضرر المُمتص، أو null إن لم تكن هناك ضربة أخيرة قابلة للامتصاص.
function retroAbsorbNow(fighter, skill, mode){

    let snapshot = fighter.lastHitSnapshot;

    if(!snapshot || snapshot.consumed || (snapshot.dmgDealt || 0) <= 0){

        return null;

    }

    let attacker = (fighter === battle.player) ? battle.enemy : battle.player;

    // إلغاء الضربة: تعيد صحة المستخدم إلى ما قبل آخر ضربة
    fighter.hp = snapshot.hpBefore;

    if(snapshot.attackerLifestealHeal > 0){

        attacker.hp = Math.max(0, attacker.hp - snapshot.attackerLifestealHeal);

    }

    snapshot.consumed = true;

    let converted = snapshot.dmgDealt;

    if(mode === "atk"){

        fighter.tempAtk = (fighter.tempAtk || 0) + converted;

    } else {

        fighter.hp = (fighter.hp || 0) + converted;

        if(fighter.hp > fighter.maxHp) fighter.maxHp = fighter.hp;

    }

    return converted;

}


function playerUseReflect(reflectSkill){

    if(battle.turnOwner !== "player") return;

    if(battle.finished) return;

    if(!isSkillReady(battle.player, reflectSkill)){

        alert("مهارة الانعكاس ما زالت في التهدئة");

        return;

    }

    if(!battle.player.lastHitSnapshot || battle.player.lastHitSnapshot.consumed){

        addBattleLog("لا يوجد ضرر حالٍ ليعكسه الانعكاس");

        showBattleEffectBanner(battle.prefix, "🔁 لا توجد ضربة أخيرة لتعكسها", "info");

        return;

    }

    clearTurnTimer();

    let reflectDmg = retroReflectNow(battle.player, reflectSkill);

    battle.player.turnsTaken++;

    if(reflectSkill.cooldown > 0)
        battle.player.cooldownUsedAt[reflectSkill.id] = battle.player.turnsTaken;

    if(!battle.playerUsedSkills.find(s => s.id === reflectSkill.id)){

        battle.playerUsedSkills.push(reflectSkill);

    }

    renderUsedSkillsUI(battle.prefix);

    updateBattleScreen();

    addBattleLog(`${battle.player.name} عكسَ آخر ضربة من الخصم وألغاها! (ضرر ${reflectDmg})`);

    showBattleEffectBanner(battle.prefix, `🔁 عكستَ آخر ضربة! (ضرر ${reflectDmg})`, "reflect");

    pveEndTurn("player");

}


// يُنفَّذ بعد أن سجّل enemyAct دورَ الخصم وتهدئته (لا يعدّ الدور من جديد)
function enemyUseReflect(reflectSkill){

    let enemy = battle.enemy;

    // بأثر رجعي مثل الدفاع: لا يعكس إلا إن كانت هناك ضربة أخيرة من اللاعب
    // غير مدافَع عنها. (القرعة في enemyAct تضمن وجودها قبل استدعاء هذه الدالة)
    if(!enemy.lastHitSnapshot || enemy.lastHitSnapshot.consumed) return;

    let reflectDmg = retroReflectNow(enemy, reflectSkill);

    markEnemySkillUsed(reflectSkill);

    renderUsedSkillsUI(battle.prefix);

    updateBattleScreen();

    addBattleLog(`${enemy.name} عكسَ آخر ضربة منك وألغاها! (ضرر ${reflectDmg})`);

    showBattleEffectBanner(battle.prefix, `🔁 ${enemy.name} عكسَ آخر ضربة! (ضرر ${reflectDmg})`, "reflect");

    if(checkBattleEnd()) return;

    pveEndTurn("enemy");

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

    // لو كانت الضربة المُلغاة من نوع امتصاص، يُسترجع الشفاء الذي كسبه
    // المهاجم (الخصم) منها — لا يصح أن يبقى على صحته الجديدة من ضربة
    // أُلغيت أساسًا
    if(snapshot.attackerLifestealHeal > 0){

        battle.enemy.hp = Math.max(0, battle.enemy.hp - snapshot.attackerLifestealHeal);

    }

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

    pveEndTurn("player");

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


// ========================================
// مهارة "السيطرة": تشبه السرقة تمامًا (تسمح باستخدام مهارات الخصم فورًا)
// لكن مع فرق جوهري واحد: المهارة التي تُسيطر عليها تدخل في تهدئة عندك
// بعد استخدامها، فلا يمكنك إعادة السيطرة عليها واستخدامها مجددًا قبل انتهاء
// مدة تهدئتها. وكذلك مهارة السيطرة نفسها لها تهدئتها الخاصة تمامًا كالسرقة.
// تظهر المهارات الظاهرة من الخصم في أي نزال سابق (قائمة الكشف العامة)، مثل
// السرقة تمامًا (بعكس النسخ الذي يقتصر على مهارات هذا النزال فقط).
// رقم المهارة (damage) يمثّل "عدد المهارات القابلة للسيطرة والاستخدام الفوري".
// ========================================

function openControlMenu(controlSkill){

    if(!isSkillReady(battle.player, controlSkill)){

        alert("مهارة السيطرة ما زالت في التهدئة");

        return;

    }

    closeControlMenu();

    let maxControl = Math.max(1, skillParamAmount(controlSkill, "control_count", controlSkill.damage) || 1);

    let selectedNames = [];

    let modal = document.createElement("div");

    modal.id = "control-modal";

    modal.className = "steal-modal";


    // تظهر كل المهارات التي كشفها الخصم في أي نزال سابق (قائمة السرقة
    // العامة)، وتُعلَّم باستخدام مهارة السيطرة الخاصة باللاعب — أي المهارة
    // التي سبق السيطرة عليها واستخدامها عندك تدخل تهدئة ولا يمكن الاختيار
    // منها مجددًا حتى تنتهي تهدئتها
    let controllableSkills = battle.enemy.skills || battle.enemyUsedSkills;

    let usedListHtml = controllableSkills.length > 0
    ? controllableSkills
        .map(s => {

            let ready = isSkillReady(battle.player, s);

            let remaining = cooldownTurnsRemaining(battle.player, s);

            let cooldownBadge =
            (!ready && remaining > 0)
            ? `<span class="cooldown-badge">${remaining}</span>`
            : "";

            let disabledAttr = ready ? "" : "disabled";

            let onCooldownClass = ready ? "" : "on-cooldown";

            return `<button class="steal-option ${onCooldownClass}" data-name="${escapeHtml(s.name)}" ${disabledAttr}>${escapeHtml(s.name)}${cooldownBadge}</button>`;

        })
        .join("")
    : "<p>لم تكشف أي مهارة من الخصم بعد (أو كلها في تهدئة)</p>";


    modal.innerHTML = `

        <div class="steal-modal-box">

            <h3>🎛️ اختر حتى ${maxControl} ${maxControl === 1 ? "مهارة" : "مهارات"} للسيطرة عليها واستخدامها فورًا</h3>

            <div class="steal-options-list">
                ${usedListHtml}
            </div>

            <p class="steal-or">— أو اكتب اسم المهارة بالضبط وأضفها للاختيار —</p>

            <input id="control-name-input" type="text" placeholder="اسم المهارة">

            <div class="steal-modal-buttons">

                <button id="control-add-name-btn">إضافة للاختيار</button>

            </div>

            <p class="steal-or" id="control-selected-label">لم تُختر أي مهارة بعد (0/${maxControl})</p>

            <div class="steal-modal-buttons">

                <button id="control-confirm-btn">سيطرة واستخدام</button>

                <button id="control-cancel-btn">إلغاء</button>

            </div>

        </div>

    `;


    document.body.appendChild(modal);


    function refreshSelectedLabel(){

        let label = document.getElementById("control-selected-label");

        if(!label) return;

        label.textContent =
        selectedNames.length > 0
        ? `المختارة: ${selectedNames.join("، ")} (${selectedNames.length}/${maxControl})`
        : `لم تُختر أي مهارة بعد (0/${maxControl})`;

    }

    function toggleSelect(name, btn){

        let idx = selectedNames.indexOf(name);

        if(idx >= 0){

            selectedNames.splice(idx, 1);

            if(btn) btn.classList.remove("steal-selected");

        } else {

            if(selectedNames.length >= maxControl){

                alert(`لا يمكن اختيار أكثر من ${maxControl} ${maxControl === 1 ? "مهارة" : "مهارات"} في نفس السيطرة`);

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


    modal.querySelector("#control-add-name-btn").onclick = () => {

        let input = document.getElementById("control-name-input");

        let typedName = input.value.trim();

        if(!typedName){

            alert("اكتب اسم المهارة أولاً");

            return;

        }

        toggleSelect(typedName, null);

        input.value = "";

    };


    modal.querySelector("#control-cancel-btn").onclick = closeControlMenu;

    modal.querySelector("#control-confirm-btn").onclick = () => {

        if(selectedNames.length === 0){

            alert("اختر مهارة واحدة على الأقل");

            return;

        }

        attemptControlMulti(controlSkill, selectedNames);

    };

}


function closeControlMenu(){

    let modal = document.getElementById("control-modal");

    if(modal) modal.remove();

}


// يتحقق من كل الأسماء المختارة، ثم يستهلك دور/تهدئة مهارة السيطرة مرة واحدة
// فقط لهذه الدفعة بالكامل، ثم ينفّذ كل مهارة مُسيطر عليها فورًا واحدة تلو
// الأخرى، مع وضع كل مهارة مُسيطر عليها في تهدئة عند اللاعب (هذا هو الفرق
// الجوهري عن السرقة)
function attemptControlMulti(controlSkill, names){

    let uniqueNames = [...new Set(names.map(n => n.trim()).filter(Boolean))];

    let resolvedSkills = [];

    for(let name of uniqueNames){

        // السيطرة بالاسم المكتوب تعمل حتى لو لم تُستخدم المهارة في هذا
        // النزال — يكفي أنها فعلًا إحدى مهارات الخصم الحقيقية (مثل السرقة)
        let targetSkill =
        battle.enemy.skills.find(s => s.name.trim() === name);

        if(!targetSkill){

            alert(`لا توجد مهارة بهذا الاسم ظهرت من الخصم: "${name}"`);

            return;

        }

        // مهارات السيطرة/السرقة/النسخ/الظل/تأجيل التهدئة لا يمكن السيطرة عليها
        if(["control", "steal", "copy", "shadow", "delay_cooldown"].includes(targetSkill.effect)){

            alert(`لا يمكن السيطرة على مهارة "${name}" (من نوع لا يقبل السيطرة)`);

            return;

        }

        // لا يمكن السيطرة على مهارة الخصم وهي حاليًا في فترة تهدئة عنده
        if(!isSkillReady(battle.enemy, targetSkill)){

            alert(`مهارة "${name}" في تهدئة عند الخصم حاليًا، لا يمكن السيطرة عليها الآن`);

            return;

        }

        // لا يمكن السيطرة على مهارة سبق السيطرة عليها وهي بتهدئة عند اللاعب
        if(!isSkillReady(battle.player, targetSkill)){

            alert(`مهارة "${name}" في تهدئة عندك حاليًا، انتظر انتهاء تهدئتها لإعادة السيطرة عليها`);

            return;

        }

        resolvedSkills.push(targetSkill);

    }

    closeControlMenu();

    clearTurnTimer();

    // نفس منطق السرقة: إما تستهلك نافذة الدفاع (إن لم تتضمن الدفعة أي دفاع/
    // انعكاس) أو تُترك الضربة ليتولى الدفاع التعامل معها داخل الطابور أدناه
    let consumesPlayerTurn = (battle.turnOwner === "player");

    let batchHandlesDefense =
    resolvedSkills.some(s => s.type === "defense" || s.effect === "reflect");

    if(consumesPlayerTurn
    && !batchHandlesDefense
    && battle.player.lastHitSnapshot
    && !battle.player.lastHitSnapshot.consumed){

        battle.player.lastHitSnapshot.consumed = true;

    }

    battle.player.turnsTaken++;

    if(controlSkill.cooldown > 0)
        battle.player.cooldownUsedAt[controlSkill.id] = battle.player.turnsTaken;

    if(!battle.playerUsedSkills.find(s => s.id === controlSkill.id)){

        battle.playerUsedSkills.push(controlSkill);

    }

    renderUsedSkillsUI(battle.prefix);

    runControlledSkillsQueue(resolvedSkills, 0, consumesPlayerTurn);

}


// ينفّذ المهارات المُسيطر عليها المختارة واحدة تلو الأخرى (فوريًا)، ثم
// يُسلِّم الدور للخصم (أو يُحدّث الأزرار) مرة واحدة فقط بعد انتهاء الدفعة
// بالكامل. كل مهارة مُسيطر عليها تُستخدم تُسجَّل فورًا في تهدئة اللاعب.
function runControlledSkillsQueue(queue, index, consumesPlayerTurn){

    if(index >= queue.length){

        if(checkBattleEnd()) return;

        if(consumesPlayerTurn){

            pveEndTurn("player");

        } else {

            renderSkillButtons(battle.prefix);

        }

        return;

    }

    let targetSkill = queue[index];

    // تسجيل المهارة المُسيطر عليها فورًا في تهدئة اللاعب، بحيث لا يمكن
    // إعادة السيطرة عليها واستخدامها حتى تنتهي تهدئتها
    battle.player.cooldownUsedAt[targetSkill.id] = battle.player.turnsTaken;

    // المهارة المُسيطر عليها تدخل أيضًا في تهدئة الخصم نفسه: بمجرد سيطرة
    // اللاعب عليها، لا يستطيع الخصم استخدامها مجددًا حتى تنتهي تهدئتها
    battle.enemy.cooldownUsedAt[targetSkill.id] = battle.enemy.turnsTaken;

    if(!battle.playerUsedSkills.find(s => s.id === targetSkill.id)){

        battle.playerUsedSkills.push(targetSkill);

    }

    renderUsedSkillsUI(battle.prefix);

    if(targetSkill.type === "defense"){

        // مهارة دفاع مُسيطر عليها: تُستخدم فورًا على نفسك فقط (لا هدف يُختار)
        let snapshot = battle.player.lastHitSnapshot;

        if(snapshot && !snapshot.consumed){

            battle.player.hp = snapshot.hpBefore;

            snapshot.consumed = true;

            if(snapshot.attackerLifestealHeal > 0){

                battle.enemy.hp = Math.max(0, battle.enemy.hp - snapshot.attackerLifestealHeal);

            }

            let enduranceHits = Math.max(1, Number(targetSkill.damage) || 1);

            battle.player.shieldCharges = (battle.player.shieldCharges || 0) + (enduranceHits - 1);

            updateBattleScreen();

            addBattleLog(
            enduranceHits > 1
            ? `${battle.player.name} سيطر على "${targetSkill.name}" وألغى الضربة! (يتحمّل ${enduranceHits - 1} ضربات إضافية تلقائيًا)`
            : `${battle.player.name} سيطر على "${targetSkill.name}" وألغى الضربة!`
            );

        } else {

            alert(`مهارة "${targetSkill.name}" المُسيطر عليها دفاعية: لا تُلغي إلا ضررًا موجودًا حاليًا عليك، ولا يوجد ضرر لصده الآن`);

            addBattleLog(`لا يوجد ضرر حالي لصده بمهارة "${targetSkill.name}" المُسيطر عليها`);

        }

        runControlledSkillsQueue(queue, index + 1, consumesPlayerTurn);

        return;

    }

    if(targetSkill.effect === "reflect"){

        if(!battle.player.lastHitSnapshot || battle.player.lastHitSnapshot.consumed){

            addBattleLog(`لا يوجد ضرر حالٍ ليعكسه الانعكاس بمهارة "${targetSkill.name}" المُسيطر عليها`);

            runControlledSkillsQueue(queue, index + 1, consumesPlayerTurn);

            return;

        }

        let reflectDmg = retroReflectNow(battle.player, targetSkill);

        updateBattleScreen();

        addBattleLog(`${battle.player.name} عكسَ آخر ضربة بالسيطرة على "${targetSkill.name}"! (ضرر ${reflectDmg})`);

        showBattleEffectBanner(battle.prefix, `🔁 عكستَ آخر ضربة بالسيطرة عليها! (ضرر ${reflectDmg})`, "reflect");

        runControlledSkillsQueue(queue, index + 1, consumesPlayerTurn);

        return;

    }

    if(isNewBuffEffect(targetSkill.effect)){

        let logLine = applyPveBuff(battle.player, targetSkill);

        updateBattleScreen();

        if(logLine) addBattleLog(`سيطرتَ على "${targetSkill.name}"! ` + logLine);

        runControlledSkillsQueue(queue, index + 1, consumesPlayerTurn);

        return;

    }

    if(targetSkill.effect === "delay_cooldown" || targetSkill.effect === "shadow"){

        addBattleLog(`لا يمكن استخدام "${targetSkill.name}" المُسيطر عليها في هذه المعركة، تم تخطّيها`);

        runControlledSkillsQueue(queue, index + 1, consumesPlayerTurn);

        return;

    }

    // السيطرة تُستخدم فورًا: اللاعب يختار الهدف في نفس اللحظة
    openStealTargetMenu(targetSkill, (target) => {

        let defender = (target === "self") ? battle.player : battle.enemy;

        resolveAction(battle.player, defender, targetSkill, false);

        addBattleLog(`${battle.player.name} سيطر على مهارة "${targetSkill.name}" واستخدمها!`);

        runControlledSkillsQueue(queue, index + 1, consumesPlayerTurn);

    }, () => {

        addBattleLog(`تم تخطّي استخدام "${targetSkill.name}" المُسيطر عليها`);

        runControlledSkillsQueue(queue, index + 1, consumesPlayerTurn);

    }, "المُسيطر عليها");

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

            alert(`لا توجد مهارة بهذا الاسم ظهرت من الخصم: "${name}"`);

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

    // إذا استُخدمت هذه الدفعة كفعل دور اللاعب فعلاً (لا خارج دوره)، ولم
    // تحتوِ على أي مهارة دفاع أو انعكاس من ضمن ما سُرق (أي لن يتعامل أحد
    // مع الضربة السابقة بأي شكل ضمن هذه الدفعة نفسها)، فهو بذلك تنازل عن
    // نافذة الدفاع عن أي ضربة سابقة لم يلغِها بعد. أما إن كانت إحدى
    // المهارات المسروقة دفاعًا أو انعكاسًا، فتُترك الضربة كما هي ليتولّى
    // ذلك الدفاع إلغاءها أو الانعكاس عكسَها بنفسه داخل الطابور أدناه
    let consumesPlayerTurn = (battle.turnOwner === "player");

    let batchHandlesDefense =
    resolvedSkills.some(s => s.type === "defense" || s.effect === "reflect");

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

            pveEndTurn("player");

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

            // لو كانت الضربة المُلغاة من نوع امتصاص، يُسترجع الشفاء الذي
            // كسبه المهاجم (الخصم) منها
            if(snapshot.attackerLifestealHeal > 0){

                battle.enemy.hp = Math.max(0, battle.enemy.hp - snapshot.attackerLifestealHeal);

            }

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

    if(targetSkill.effect === "reflect"){

        if(!battle.player.lastHitSnapshot || battle.player.lastHitSnapshot.consumed){

            addBattleLog(`لا يوجد ضرر حالٍ ليعكسه الانعكاس بمهارة "${targetSkill.name}" المسروقة`);

            runStolenSkillsQueue(queue, index + 1, consumesPlayerTurn);

            return;

        }

        let reflectDmg = retroReflectNow(battle.player, targetSkill);

        updateBattleScreen();

        addBattleLog(`${battle.player.name} عكسَ آخر ضربة بمهارة "${targetSkill.name}" المسروقة! (ضرر ${reflectDmg})`);

        showBattleEffectBanner(battle.prefix, `🔁 عكستَ آخر ضربة بمهارة مسروقة! (ضرر ${reflectDmg})`, "reflect");

        runStolenSkillsQueue(queue, index + 1, consumesPlayerTurn);

        return;

    }

    if(isNewBuffEffect(targetSkill.effect)){

        // مهارة ذاتية مسروقة (تعزيز/امتصاص/أدوار متتالية): تُطبَّق على اللاعب
        // مباشرة دون اختيار هدف
        let logLine = applyPveBuff(battle.player, targetSkill);

        updateBattleScreen();

        if(logLine) addBattleLog(`استخدمتَ "${targetSkill.name}" المسروقة! ` + logLine);

        runStolenSkillsQueue(queue, index + 1, consumesPlayerTurn);

        return;

    }

    if(targetSkill.effect === "delay_cooldown" || targetSkill.effect === "shadow"
    || targetSkill.effect === "control"){

        // مهارات تتطلب قوائم اختيار معقدة: تُتخطّى عند سرقتها/نسخها في PvE
        addBattleLog(`لا يمكن استخدام "${targetSkill.name}" المسروقة في هذه المعركة، تم تخطّيها`);

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

    let batchHandlesDefense =
    resolvedSkills.some(s => s.type === "defense" || s.effect === "reflect");

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

            pveEndTurn("player");

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

            // لو كانت الضربة المُلغاة من نوع امتصاص، يُسترجع الشفاء الذي
            // كسبه المهاجم (الخصم) منها
            if(snapshot.attackerLifestealHeal > 0){

                battle.enemy.hp = Math.max(0, battle.enemy.hp - snapshot.attackerLifestealHeal);

            }

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

    if(targetSkill.effect === "reflect"){

        if(!battle.player.lastHitSnapshot || battle.player.lastHitSnapshot.consumed){

            addBattleLog(`لا يوجد ضرر حالٍ ليعكسه الانعكاس بمهارة "${targetSkill.name}" المنسوخة`);

            runCopiedSkillsQueue(queue, index + 1, consumesPlayerTurn);

            return;

        }

        let reflectDmg = retroReflectNow(battle.player, targetSkill);

        updateBattleScreen();

        addBattleLog(`${battle.player.name} عكسَ آخر ضربة بمهارة "${targetSkill.name}" المنسوخة! (ضرر ${reflectDmg})`);

        showBattleEffectBanner(battle.prefix, `🔁 عكستَ آخر ضربة بمهارة منسوخة! (ضرر ${reflectDmg})`, "reflect");

        runCopiedSkillsQueue(queue, index + 1, consumesPlayerTurn);

        return;

    }

    if(isNewBuffEffect(targetSkill.effect)){

        // مهارة ذاتية منسوخة (تعزيز/امتصاص/أدوار متتالية): تُطبَّق على اللاعب
        // مباشرة دون اختيار هدف
        let logLine = applyPveBuff(battle.player, targetSkill);

        updateBattleScreen();

        if(logLine) addBattleLog(`استخدمتَ "${targetSkill.name}" المنسوخة! ` + logLine);

        runCopiedSkillsQueue(queue, index + 1, consumesPlayerTurn);

        return;

    }

    if(targetSkill.effect === "delay_cooldown" || targetSkill.effect === "shadow"
    || targetSkill.effect === "control"){

        // مهارات تتطلب قوائم اختيار معقدة: تُتخطّى عند نسخها في PvE
        addBattleLog(`لا يمكن استخدام "${targetSkill.name}" المنسوخة في هذه المعركة، تم تخطّيها`);

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

    if(battle.turnOwner !== "player" && battle.player.hp > 0){
        alert("ليس دورك الآن");
        return;
    }

    if(battle.finished) return;
    // ...

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

    // نفس قائمة السرقة تمامًا: تُعرض كل المهارات التي كشفها الخصم في أي
    // وقت (بما فيها النزالات السابقة ضد هذا الخصم) وغير المختومة مسبقًا
    // (لا فائدة من ختم ما هو مختوم فعلًا) — بالإضافة إلى مهارة دفاع
    // الخصم التي تبقى قابلة للختم دائمًا حتى لو لم يستخدمها في أي نزال،
    // فالدفاع مهارة أساسية لدى أي مقاتل ويجب أن يبقى ممكنًا منعُه
    let sealableSkills =
    battle.enemyUsedSkills.filter(s => !isSkillSealed(battle.enemy, s) && Number(s.slot) !== 1);

    let enemyDefenseSkill =
    battle.enemy.skills.find(s => s.type === "defense");

    if(enemyDefenseSkill
    && Number(enemyDefenseSkill.slot) !== 1
    && !isSkillSealed(battle.enemy, enemyDefenseSkill)
    && !sealableSkills.find(s => s.id === enemyDefenseSkill.id)){

        sealableSkills.push(enemyDefenseSkill);

    }

    let usedListHtml = sealableSkills.length > 0
    ? sealableSkills
        .map(s => `<button class="steal-option" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`)
        .join("")
    : "<p>لم تظهر أي مهارة من الخصم بعد لتُختم</p>";

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
        battle.enemyUsedSkills.find(s => s.name.trim() === name)
        // مهارة الدفاع قابلة للختم حتى لو لم يظهرها الخصم من قبل أبدًا
        || battle.enemy.skills.find(s => s.type === "defense" && s.name.trim() === name);

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

    // الختم فعل غير انعكاس يستهلك الدور: يُسقط نافذة عكس أي ضربة سابقة
    // تلقّاها اللاعب (مطابقة لمنطق السيرفر في PvP)
    if(battle.player.lastHitSnapshot && !battle.player.lastHitSnapshot.consumed){

        battle.player.lastHitSnapshot.consumed = true;

    }

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

    pveEndTurn("player");

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

    let mySealedSkills =
    (battle.player.sealedSkillIds || [])
        .map(id => battle.player.skills.find(s => s.id === id))
        .filter(Boolean);

    // لو لم تكن أي مهارة من مهارات اللاعب مختومة، فمهارة فك الختم لا فائدة
    // منها إطلاقًا — نُعلِم اللاعب ونلغي الفعل دون أي ضرر أو استهلاك دور
    if(mySealedSkills.length === 0){

        alert("لا توجد أي مهارة مختومة لديك لفك ختمها — هذه المهارة بلا فائدة الآن");

        return;

    }

    let maxUnseal = Math.max(1, Number(unsealSkill.damage) || 1);

    let selectedNames = [];

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

    // فك الختم فعل غير انعكاس يستهلك الدور: يُسقط نافذة عكس أي ضربة سابقة
    // تلقّاها اللاعب (مطابقة لمنطق السيرفر في PvP)
    if(battle.player.lastHitSnapshot && !battle.player.lastHitSnapshot.consumed){

        battle.player.lastHitSnapshot.consumed = true;

    }

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

    pveEndTurn("player");

}


// ========================================
// مؤقت الدور (3 دقائق)
// ========================================

function startTurnTimer(){

    clearTurnTimer();

    // مؤقّت يعتمد على موعد انتهاء ثابت (Date.now()) بدل إنقاص عداد داخل
    // setInterval — فالمتصفحات تخنق المؤقّتات في التبويبات الخلفية، وإنقاص
    // عداد لكل نبضة قد يجعل العداد يتأخر أو يتجمد فيبقى الدور عالقًا حتى
    // بعد وصوله للصفر. الحساب من الموعد الحقيقي يضمن أنه متى ما مرّ الوقت
    // الفعلي تُنفَّذ النقلة تلقائيًا في أول نبضة تالية مهما تأخّرت.
    let deadline = Date.now() + 60000;

    let tick = () => {

        if(battle.finished){ clearTurnTimer(); return; }

        let remaining = Math.max(0, deadline - Date.now());

        updateTimerDisplay(Math.ceil(remaining / 1000));

        if(remaining <= 0){

            clearTurnTimer();

            addBattleLog("انتهى الوقت! تم تخطي دورك");

            battle.turnOwner = "enemy";

            processTurn();

        }

    };

    tick();

    battle.turnInterval = setInterval(tick, 1000);

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

    // نفس قاعدة السيرفر (pvp_use_skill): إذا وصل المدافع إلى صفر من ضربة
    // قابلة للصد (ليست "لا تُصد") وعنده مهارة دفاع جاهزة (غير مختومة وليست
    // في التهدئة) ولم يستهلك لقطة الضربة، فلا تنتهي المعركة — ينجو على صفر
    // ويتاح له الدفاع في دوره (يسترجع صحته إلى hpBefore). هذا يمنع موت الوحش
    // من ضربة كان بمقدوره صدّها
    if(battle.enemy.hp <= 0 && fighterCanBlockLastHit(battle.enemy)){
        battle.enemy.hp = 0;
        addBattleLog(`🛡️ ${battle.enemy.name} صمد عند صفر صحة ولديه دفاع جاهز!`);
        return false;
    }

    if(battle.enemy.hp <= 0){

        endBattle(true);

        return true;

    }

    if(battle.player.hp <= 0 && fighterCanBlockLastHit(battle.player)){

        battle.player.hp = 0;

        addBattleLog(`🛡️ ${battle.player.name} صمد عند صفر صحة ولديه دفاع جاهز!`);

        return false;

    }

    if(battle.player.hp <= 0){

        endBattle(false);

        return true;

    }

    return false;

}

// هل يستطيع المقاتل صدّ آخر ضربة قاتلة وردّ نفسه للحياة؟ يُستدعى قبل إنهاء
// المعركة: إذا كانت الضربة قابلة للصد (ليست "لا تُصد") وألحقت ضررًا فعليًا
// (لم تُمتص أو تُحجب) وعنده دفاع جاهز، فينجو على صفر صحة وينتظر دوره ليُفعّل
// الدفاع (يسترجع hpBefore). مطابق لمنطق السيرفر pvp_has_ready_defense
function fighterCanBlockLastHit(fighter){

    let snapshot = fighter.lastHitSnapshot;

    if(!snapshot || snapshot.consumed) return false;

    if((snapshot.dmgDealt || 0) <= 0) return false;

    let unblockable = !!snapshot.unblockable;

    // الوحش (الخصم في PvE) يحتفظ بسلوكه السابق: ينجو عند صفر فقط إن كان لديه
    // دفاع جاهز — وليس انعكاس/امتصاص، لأن العدو لا يستخدمها فعليًا لإنقاذ
    // نفسه فيبقى معلّقًا على صفر بلا نهاية. توسعة النجاة بالانعكاس/الامتصاص/
    // السرقة/النسخ تنطبق على اللاعب فقط
    if(fighter !== battle.player){

        let defenseSkill = fighter.skills.find(s => s.type === "defense");

        if(!defenseSkill) return false;

        if(!isSkillReady(fighter, defenseSkill)) return false;

        if(isSkillSealed(fighter, defenseSkill)) return false;

        return true;

    }

    let opponent = battle.enemy;

    // مهارات امتصاص جاهزة عند المقاتل نفسه (امتصاص → صحة أو قوة)
    let hasAbsorb =
    fighter.skills.some(s =>
        (s.effect === "absorb_atk" || s.effect === "absorb_hp")
        && isSkillReady(fighter, s)
        && !isSkillSealed(fighter, s));

    // هل يستطيع الحصول على مهارة امتصاص من الخصم عبر سرقة/نسخ/سيطرة جاهزة؟
    let canObtainAbsorb =
    !!opponent
    && opponent.skills.some(s => s.effect === "absorb_atk" || s.effect === "absorb_hp")
    && fighter.skills.some(s =>
        (s.effect === "steal" || s.effect === "copy" || s.effect === "control")
        && isSkillReady(fighter, s)
        && !isSkillSealed(fighter, s));

    // الضربة "لا تُصد": لا يمكن صدّها إلا بدرع امتصاص (صحة أو قوة) متوفر
    // لديه أو يمكنه الحصول عليه بالسرقة/النسخ/السيطرة من الخصم
    if(unblockable){

        return hasAbsorb || canObtainAbsorb;

    }

    // الضربة العادية القابلة للصد: تُصد بالدفاع أو الانعكاس أو الامتصاص
    let hasBlock =
    fighter.skills.some(s =>
        ((s.type === "defense") || (s.effect === "reflect"))
        && isSkillReady(fighter, s)
        && !isSkillSealed(fighter, s));

    return hasBlock || hasAbsorb || canObtainAbsorb;

}


function endBattle(playerWon){

    battle.finished = true;

    battle.phase = "finished";

    clearTurnTimer();

    // انتصار اللاعب: يُضاف الوحش المهزوم إلى مخزون الظل ليُستدعى لاحقًا
    // بمهارة "الظل" في نزالات قادمة
    if(playerWon && battle.enemy){

        pveAddDefeatedToShadowPool(battle.enemy);

    }

    renderSkillButtons(battle.prefix);

    addBattleLog(playerWon ? "لقد فزت بالمعركة!" : "لقد خسرت المعركة");

    showBattleResult(playerWon);

}


function showBattleResult(playerWon){

    hideBattleResult(battle.prefix);

    let arena =
    document.querySelector("#" + battle.prefix + "-battle-screen .battle-arena");

    if(!arena) return;

    let inDungeon = !!battle.dungeonId;

    let isLastMonster = inDungeon && (battle.dungeonIndex >= battle.dungeonMonsterIds.length - 1);

    let overlay = document.createElement("div");

    overlay.className = "battle-result-overlay";

    // زنزانة: هزم اللاعب الوحش الأخير — سلم الجائزة من السيرفر
    if(playerWon && inDungeon && isLastMonster){

        overlay.innerHTML = `

            <h2>🏆 أكملت الزنزانة!</h2>

            <p id="dungeon-reward-line">جاري تسليم الجائزة...</p>

            <button id="battle-result-back-btn">العودة إلى البوابات</button>

        `;

        arena.appendChild(overlay);

        overlay.querySelector("#battle-result-back-btn").onclick = () => {

            overlay.remove();

            clearDungeonState();

            openScreen("gate-screen");

            loadGates();

        };

        dungeonClaimReward(battle.dungeonId)

        .then(result => {

            let line = document.getElementById("dungeon-reward-line");

            if(line && result && result.status === "success"){

                line.textContent = `🪙 +${result.gold_added} ذهب`;

                if(typeof updatePlayerInfo === "function") updatePlayerInfo();

            } else if(line && result && result.error){

                line.textContent = result.error;

            }

        })

        .catch(err => {

            let line = document.getElementById("dungeon-reward-line");

            if(line) line.textContent = (err && err.message) ? err.message : "تعذر تسليم الجائزة";

        });

        return;

    }

    // زنزانة: هزم اللاعب الوحش الحالي ويبقى التالي — زر للانتقال للوحش التالي
    if(playerWon && inDungeon && !isLastMonster){

        overlay.innerHTML = `

            <h2>✅ هزمت الوحش!</h2>

            <p>الوحش التالي قادم...</p>

            <button id="dungeon-next-btn">الوحش التالي (${battle.dungeonIndex + 1}/${battle.dungeonMonsterIds.length})</button>

        `;

        arena.appendChild(overlay);

        overlay.querySelector("#dungeon-next-btn").onclick = () => {

            overlay.remove();

            battle.dungeonIndex++;

            let nextId = battle.dungeonMonsterIds[battle.dungeonIndex];

            startDungeonMonster(nextId);

        };

        return;

    }

    // معركة عادية أو هزيمة في زنزانة
    let title = playerWon ? "🏆 فزت!" : "💀 خسرت";

    let isSoloPve = playerWon && !inDungeon;

    overlay.innerHTML = `

        <h2>${title}</h2>

        ${isSoloPve ? '<p id="pve-reward-line">جاري تسليم الجائزة...</p>' : ""}

        <button id="battle-result-back-btn">${inDungeon ? "العودة إلى البوابات" : "العودة"}</button>

    `;

    arena.appendChild(overlay);

    // فوز في معركة PvE مفردة: تسليم جائزة الذهب (مع الحد اليومي) من السيرفر
    if(isSoloPve && battle.monsterId){

        pveClaimReward(battle.monsterId)

        .then(result => {

            let line = document.getElementById("pve-reward-line");

            if(line && result && result.status === "success"){

                let txt = `🪙 +${result.gold_added} ذهب`;

                if(result.remaining > 0) txt += ` · متبقي اليوم ${result.remaining}`;

                line.textContent = txt;

                if(typeof updatePlayerInfo === "function") updatePlayerInfo();

            } else if(line && result && result.error){

                line.textContent = result.error;

            }

        })

        .catch(err => {

            let line = document.getElementById("pve-reward-line");

            if(line) line.textContent = (err && err.message) ? err.message : "تعذر تسليم الجائزة";

        });

    }

    overlay
    .querySelector("#battle-result-back-btn")
    .onclick = () => {

        overlay.remove();

        clearDungeonState();

        openScreen(inDungeon ? "gate-screen" : "solo-battle-screen");

        if(inDungeon) loadGates();

    };

}


// إعادة تهيئة حالة الزنزانة عند مغادرتها (هزيمة أو إكمال أو خروج)
function clearDungeonState(){

    battle.dungeonId = null;

    battle.dungeonName = null;

    battle.dungeonGrade = null;

    battle.dungeonGoldPrize = 0;

    battle.dungeonMonsterIds = [];

    battle.dungeonIndex = 0;

}


function hideBattleResult(prefix){

    let overlay =
    document.querySelector("#" + prefix + "-battle-screen .battle-result-overlay");

    if(overlay) overlay.remove();

}



// ========================================
// تأثيرات بصرية (اهتزاز + رقم داميج طائر)
// ========================================

function showDamagePopup(targetPrefix, amount, isHeal, isUnblockable){

    let img = document.getElementById(targetPrefix + "-image");

    if(!img) return;

    let wrapper = img.closest(".battle-card");

    if(!wrapper) return;

    wrapper.style.position = "relative";

    let popup = document.createElement("div");

    popup.className = "damage-popup" + (isHeal ? " heal" : "") + (isUnblockable ? " unblockable" : "");

    popup.textContent = (isHeal ? "+" : "-") + amount;

    popup.style.left = "50%";

    popup.style.top = "10px";

    popup.style.transform = "translateX(-50%)";

    wrapper.appendChild(popup);

    setTimeout(() => popup.remove(), 1000);

}


function playHitEffect(prefix, isUnblockable){

    let arena =
    document.querySelector("#" + prefix + "-battle-screen .battle-arena");

    if(!arena) return;

    if(isUnblockable){

        // ضربة "لا تُصد": اهتزاز أقوى + وميض برتقالي-أحمر واضح يختلف
        // بصريًا عن الضربة العادية البيضاء حتى يميزها اللاعب فورًا
        arena.classList.add("shake", "unblockable-flash");

        setTimeout(() => {

            arena.classList.remove("shake", "unblockable-flash");

        }, 420);

    } else {

        arena.classList.add("shake", "hit-flash");

        setTimeout(() => {

            arena.classList.remove("shake", "hit-flash");

        }, 350);

    }

}


function applyDamageEffect(prefix, targetPrefix, amount, isHeal, isUnblockable){

    playHitEffect(prefix, isUnblockable);

    showDamagePopup(targetPrefix, amount, isHeal, isUnblockable);

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


