// ========================================
// CARD GAME
// game.js
// ========================================


// ========================================
// تهريب النصوص قبل إدراجها في innerHTML — حماية من XSS
// أي بيانات واردة من الخادم قد يحملها مستخدم عادي (اسم مستخدم، طلبات
// شخصيات، أسماء في الردهة) تُمرَّر عبر هذه الدالة قبل أي عرض
// ========================================

function escapeHtml(value){

    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}

// نسخة مخصصة لإدراجها داخل onclick="...": تهرب كل المحارف الخطرة في سياق
// سلسلة JavaScript داخل خاصية HTML
function escapeJsAttr(value){

    return String(value == null ? "" : value)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/"/g, "\\\"")
        .replace(/</g, "\\u003C")
        .replace(/>/g, "\\u003E")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r");

}

// ========================================
// نظام إشعارات احترافي (Toast) بديل عن alert() الأبيض الافتراضي
// نفس طريقة الاستدعاء تماماً: showToast("رسالة") بدل alert("رسالة")،
// فقط شكل العرض تغيّر ليصير بطاقة داكنة متحركة بدل نافذة المتصفح الراكدة
// ========================================

function getToastContainer(){

    let box = document.getElementById("toast-container");

    if(!box){

        box = document.createElement("div");
        box.id = "toast-container";
        document.body.appendChild(box);

    }

    return box;

}

function classifyToastType(message){

    let text = String(message);

    let errorWords = ["خطأ","فشل","غير مصرح","غير صحيح","غير صحيحة","لا يمكن","تعذّر","تعذر","لا يوجد","ممتلئ","مرفوض"];
    let successWords = ["تم ","نجح","أهلاً","مرحباً","مرحبا"];

    if(errorWords.some(w => text.includes(w))) return "error";
    if(successWords.some(w => text.includes(w))) return "success";

    return "info";

}

function showToast(message){

    let container = getToastContainer();

    let type = classifyToastType(message);

    if(container.children.length >= 3){
        let oldest = container.firstChild;
        if(oldest){
            oldest.classList.remove("show");
            oldest.classList.add("hide");
            setTimeout(() => oldest.remove(), 250);
        }
    }

    let toast = document.createElement("div");
    toast.className = "app-toast " + type;

    let icon =
    type === "error" ? "⚠️" :
    type === "success" ? "✅" : "ℹ️";

    toast.innerHTML =
    `<span class="app-toast-icon">${icon}</span><span class="app-toast-text"></span>`;

    toast.querySelector(".app-toast-text").textContent = String(message);

    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("show"));

    let remove = () => {

        toast.classList.remove("show");
        toast.classList.add("hide");

        setTimeout(() => toast.remove(), 250);

    };

    toast.addEventListener("click", remove);

    setTimeout(remove, 3400);

}

// بديل موحّد لـ alert() الافتراضي بالمتصفح في كل أنحاء اللعبة
function alert(message){

    showToast(message);

}


// ========================================
// معرّف الجهاز + بصمة الجهاز (لمنع أكثر من حساب لكل جهاز)
// ========================================

// 1) معرّف الجهاز:
//    - داخل تطبيق APK (Capacitor): نستخدم معرّف Android الحقيقي (ANDROID_ID)
//      عبر إضافة @capacitor/device — فريد فعليًا لكل جهاز مادي، حتى لو كان
//      هاتفين من نفس الموديل بالضبط (بعكس بصمة المتصفح).
//    - في متصفح الويب العادي: نرجع لمعرّف عشوائي مخزَّن في localStorage
//      (يبقى موجود ما لم يمسح المستخدم بيانات الموقع).
let cachedDeviceId = null;

async function getDeviceId(){

    if(cachedDeviceId) return cachedDeviceId;

    // نكتشف تلقائيًا إذا كنا داخل تطبيق Capacitor وإذا كانت إضافة
    // Device مضافة ومسجَّلة (window.Capacitor.Plugins.Device)
    if(window.Capacitor
    && window.Capacitor.isNativePlatform
    && window.Capacitor.isNativePlatform()
    && window.Capacitor.Plugins
    && window.Capacitor.Plugins.Device){

        try{
            let info = await window.Capacitor.Plugins.Device.getId();
            // info.identifier = ANDROID_ID على أندرويد — فريد لكل جهاز مادي
            if(info && info.identifier){
                cachedDeviceId = "native:" + info.identifier;
                return cachedDeviceId;
            }
        }catch(e){
            console.log("تعذّر جلب معرّف الجهاز الأصلي، استخدام البديل", e);
        }
    }

    // البديل (متصفح ويب عادي، أو فشل جلب المعرّف الأصلي)
    let id = localStorage.getItem("device_id");
    if(!id){
        id = (crypto.randomUUID ? crypto.randomUUID() :
            "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                const v = c === "x" ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            }));
        localStorage.setItem("device_id", id);
    }
    cachedDeviceId = "web:" + id;
    return cachedDeviceId;
}

// 2) بصمة جهاز مبنية من خصائص ثابتة (لا تعتمد على أي تخزين)
//    تبقى شبه ثابتة حتى لو مسح المستخدم بيانات المتصفح
async function getDeviceFingerprint(){
    const parts = [];

    parts.push(navigator.userAgent || "");
    parts.push(navigator.platform || "");
    parts.push(navigator.language || "");
    parts.push(String(navigator.hardwareConcurrency || ""));
    parts.push(String(navigator.deviceMemory || ""));
    parts.push(String(screen.width) + "x" + String(screen.height));
    parts.push(String(screen.colorDepth || ""));
    parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || "");

    // بصمة الرسم (canvas) — تختلف حسب الجهاز/المتصفح/تعريف الشاشة
    try{
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        ctx.textBaseline = "top";
        ctx.font = "14px Arial";
        ctx.fillText("device-fp-🎮-card-game", 2, 2);
        parts.push(canvas.toDataURL());
    }catch(e){ parts.push("no-canvas"); }

    // بصمة WebGL (نوع كرت الشاشة)
    try{
        const gl = document.createElement("canvas").getContext("webgl");
        const dbgInfo = gl.getExtension("WEBGL_debug_renderer_info");
        if(dbgInfo){
            parts.push(gl.getParameter(dbgInfo.UNMASKED_VENDOR_WEBGL));
            parts.push(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL));
        }
    }catch(e){ parts.push("no-webgl"); }

    const raw = parts.join("|||");

    // تجزئة (hash) القيمة النهائية إلى SHA-256
    const enc = new TextEncoder().encode(raw);
    const hashBuffer = await crypto.subtle.digest("SHA-256", enc);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}


// ========================================
// تغيير الشاشة
// ========================================

function openScreen(screenId){

    const screens =
    document.getElementsByClassName("screen");


    for(let i = 0; i < screens.length; i++){

        screens[i].classList.remove("active");

    }


    const screen =
    document.getElementById(screenId);



    if(screen){

        screen.classList.add("active");


        // حماية حقيقية على مستوى التنقّل نفسه: حتى لو انضغط أي زر يفتح
        // شاشات الإدارة (بالخطأ، أو عبر console المتصفح مباشرة)، يُمنع
        // الدخول فعليًا بدون رمز جلسة أدمن صالح — الاعتماد على إخفاء
        // الزر فقط لا يكفي كحماية
        if(screenId === "admin-panel-screen" || screenId === "admin-my-characters-screen"){

            if(!localStorage.getItem("admin_token")){

                screen.classList.remove("active");

                alert("غير مصرح لك بالدخول إلى لوحة الإدارة");

                return;

    }

}

        if(screenId === "collection-screen"){

            loadCollection();

        }


        if(screenId === "character-profile-screen"){

            loadCharacterProfile();

        }


        if(screenId === "upgrade-screen"){

            loadUpgradeScreen();

        }


        if (screenId === "admin-panel-screen") {
    
    loadAdminStats();
    
    loadAdminPanel();

    loadAdminDungeons();

    populateDungeonMonsterSelect();

    loadAdminPlayers();
    
    loadCharacterRequests();

    loadAdminMyCharacters();

    loadAdminUpgradeConfig();

    loadAdminSkillRules();

    updateSkillOrderBadge();
    
    showAdminTab("admin-tab-home");
    
}


        if(screenId === "gate-screen"){

    loadGates();

}


        if(screenId === "admin-my-characters-screen"){

    loadAdminMyCharacters();

}

    }

}


// تغيير التبويب النشط داخل لوحة الإدارة
function showAdminTab(tabId){

    let btns = document.querySelectorAll(".admin-tab-btn");
    btns.forEach(b => b.classList.remove("active"));

    document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));

    let tab = document.getElementById(tabId);

    if(tab) tab.classList.add("active");

    let selectedBtn = document.querySelector('.admin-tab-btn[data-admin-tab="' + tabId + '"]');

    if(selectedBtn) selectedBtn.classList.add("active");

    if(tabId === "admin-tab-notifications") loadAdminNotifications();

    if(tabId === "admin-tab-rules") loadAdminSkillRules();

}


function applyPageColor(pageIndex){
    const colorInput = document.getElementById("page-color-" + pageIndex);
    const strokeColorInput = document.getElementById("page-stroke-color-" + pageIndex);
    const strokeWidthInput = document.getElementById("page-stroke-width-" + pageIndex);
    if(!colorInput) return;
    const color = colorInput.value;
    const strokeColor = strokeColorInput ? strokeColorInput.value : '#000000';
    const strokeWidth = strokeWidthInput ? Number(strokeWidthInput.value) || 0 : 0;
    const pageSkills = currentEditSkills.slice(pageIndex * 4, pageIndex * 4 + 4);
    pageSkills.forEach(skill => {
        const skillColorInput = document.getElementById("skill-color-" + skill.id);
        if(skillColorInput) skillColorInput.value = color;
        const skillStrokeColorInput = document.getElementById("skill-stroke-color-" + skill.id);
        if(skillStrokeColorInput) skillStrokeColorInput.value = strokeColor;
        const skillStrokeWidthInput = document.getElementById("skill-stroke-width-" + skill.id);
        if(skillStrokeWidthInput) skillStrokeWidthInput.value = strokeWidth;
    });
}


// ========================================
// تحديث بيانات اللاعب
// ========================================

function updatePlayerInfo(){

    let username =
    localStorage.getItem("username");


    let box =
    document.getElementById("player-name");


    if(username && box){

        box.textContent = username;

    }


    let goldBox =
    document.getElementById("player-gold");


    if(goldBox){

        let token = localStorage.getItem("player_token");

        let storedGold = localStorage.getItem("player_gold");

        if(storedGold !== null){
            goldBox.textContent = "🪙 " + storedGold;
        }

        if(token){

            supabaseClient
            .rpc("get_my_player", { p_token: token })
            .single()
            .then(res => {

                if(res && res.data && res.data.gold !== undefined && res.data.gold !== null){

                    localStorage.setItem("player_gold", res.data.gold);

                    let box2 = document.getElementById("player-gold");

                    if(box2) box2.textContent = "🪙 " + res.data.gold;

                }

            })
            .catch(() => {});

        }

    }


    let adminBtn = document.getElementById("home-admin-panel-btn");

    if(adminBtn){

        adminBtn.style.display =
        localStorage.getItem("admin_token") ? "block" : "none";

    }

}



// ========================================
// إنشاء حساب (محدثة - تشفير عبر قاعدة البيانات)
// ========================================

// ========================================
// إنشاء حساب — يتطلب تحقق بريد إلكتروني عبر رمز OTP
// (نفس آلية OTP المستخدمة لدخول الأدمن، لكن لأي بريد يدخله المستخدم)
// ========================================

let pendingRegisterData = null;

const REGISTER_OTP_COOLDOWN_SECONDS = 60;
let registerOtpCooldownUntil = 0;
let registerOtpCooldownTimer = null;


async function startRegisterOtp(){

    let username = document.getElementById("register-username").value.trim();
    let email = document.getElementById("register-email").value.trim();
    let password = document.getElementById("register-password").value.trim();

    if(username === "" || email === "" || password === ""){
        alert("اكتب اسم المستخدم والبريد الإلكتروني وكلمة المرور");
        return;
    }

    if(username.toLowerCase() === "admin"){
        alert("هذا الاسم غير متاح");
        return;
    }

    let btn = document.getElementById("register-submit-btn");
    if(btn){ btn.disabled = true; btn.textContent = "جارٍ الإرسال..."; }

    const deviceId = await getDeviceId();
    const fingerprint = await getDeviceFingerprint();

    pendingRegisterData = { username, email, password, deviceId, fingerprint };

    let error = await sendRegisterOtp(email);

    if(btn){ btn.disabled = false; btn.textContent = "إنشاء الحساب"; }

    if(error){
        let waitSeconds = extractRateLimitSeconds(error);
        alert(waitSeconds
            ? `انتظر ${waitSeconds} ثانية قبل طلب رمز جديد`
            : "تعذّر إرسال رمز التحقق، تأكد من صحة البريد وحاول لاحقًا");
        return;
    }

    openRegisterOtpModal();
}


async function sendRegisterOtp(email){

    let {error} =
    await supabaseClient.auth.signInWithOtp({
        email: email,
        options: { shouldCreateUser: true }
    });

    if(!error){
        registerOtpCooldownUntil = Date.now() + (REGISTER_OTP_COOLDOWN_SECONDS * 1000);
    }

    return error;
}


function openRegisterOtpModal(){

    closeRegisterOtpModal();

    let modal = document.createElement("div");
    modal.id = "register-otp-modal";
    modal.className = "steal-modal";

    modal.innerHTML = `
        <div class="steal-modal-box">
            <h3>🔐 تأكيد البريد الإلكتروني</h3>
            <p class="skill-desc-text">تم إرسال رمز تحقق إلى بريدك. أدخله لإتمام إنشاء الحساب.</p>
            <input id="register-otp-input" type="text" inputmode="numeric" maxlength="10" placeholder="رمز التحقق" autocomplete="one-time-code">
            <div class="steal-modal-buttons">
                <button id="register-otp-confirm-btn">تأكيد</button>
                <button id="register-otp-resend-btn">إعادة إرسال الرمز</button>
            </div>
            <p class="steal-or" style="margin-top:12px;">
                <button id="register-otp-cancel-btn">إلغاء</button>
            </p>
        </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector("#register-otp-confirm-btn").onclick = confirmRegisterOtp;
    modal.querySelector("#register-otp-cancel-btn").onclick = cancelRegisterOtp;

    modal.querySelector("#register-otp-resend-btn").onclick = async () => {

        let btn = modal.querySelector("#register-otp-resend-btn");
        btn.disabled = true;
        btn.textContent = "جارٍ الإرسال...";

        let error = await sendRegisterOtp(pendingRegisterData.email);

        if(error){
            btn.disabled = false;
            btn.textContent = "إعادة إرسال الرمز";
            let waitSeconds = extractRateLimitSeconds(error);
            alert(waitSeconds
                ? `انتظر ${waitSeconds} ثانية قبل طلب رمز جديد`
                : "تعذّر إرسال الرمز، حاول لاحقًا");
            return;
        }

        alert("تم إرسال رمز جديد، استخدم آخر رمز وصلك فقط");
        startRegisterOtpCooldownCountdown();
    };

    let input = modal.querySelector("#register-otp-input");
    if(input) input.focus();

    startRegisterOtpCooldownCountdown();
}


function startRegisterOtpCooldownCountdown(){

    let btn = document.getElementById("register-otp-resend-btn");
    if(!btn) return;

    if(registerOtpCooldownTimer) clearInterval(registerOtpCooldownTimer);

    let tick = () => {

        btn = document.getElementById("register-otp-resend-btn");

        if(!btn){
            clearInterval(registerOtpCooldownTimer);
            return;
        }

        let remaining = Math.ceil((registerOtpCooldownUntil - Date.now()) / 1000);

        if(remaining > 0){
            btn.disabled = true;
            btn.textContent = `إعادة إرسال الرمز (${remaining})`;
        } else {
            btn.disabled = false;
            btn.textContent = "إعادة إرسال الرمز";
            clearInterval(registerOtpCooldownTimer);
        }
    };

    tick();
    registerOtpCooldownTimer = setInterval(tick, 1000);
}


function closeRegisterOtpModal(){

    if(registerOtpCooldownTimer){
        clearInterval(registerOtpCooldownTimer);
        registerOtpCooldownTimer = null;
    }

    let modal = document.getElementById("register-otp-modal");
    if(modal) modal.remove();
}


function cancelRegisterOtp(){
    pendingRegisterData = null;
    closeRegisterOtpModal();
}


async function confirmRegisterOtp(){

    let input = document.getElementById("register-otp-input");
    let code = input ? input.value.trim() : "";

    if(!code){
        alert("اكتب رمز التحقق المرسل إلى بريدك");
        return;
    }

    if(!pendingRegisterData){
        alert("انتهت صلاحية المحاولة، ابدأ التسجيل من جديد");
        closeRegisterOtpModal();
        return;
    }

    let {error} =
    await supabaseClient.auth.verifyOtp({
        email: pendingRegisterData.email,
        token: code,
        type: "email"
    });

    if(error){
        let retry =
        await supabaseClient.auth.verifyOtp({
            email: pendingRegisterData.email,
            token: code,
            type: "recovery"
        });
        error = retry.error;
    }

    if(error){
        console.log(error);
        alert("رمز التحقق غير صحيح أو منتهي الصلاحية");
        return;
    }

    // نجح تأكيد البريد: الآن نستدعي register_user وجلسة Supabase Auth
    // المؤقتة لا تزال فعّالة بنفس البريد — الدالة تتحقق من هذا التطابق
    let {data:user, error:registerError} =
    await supabaseClient
    .rpc("register_user", {
        p_username: pendingRegisterData.username,
        p_password: pendingRegisterData.password,
        p_device_id: pendingRegisterData.deviceId,
        p_fingerprint: pendingRegisterData.fingerprint,
        p_email: pendingRegisterData.email
    })
    .single();

    // جلسة supabase auth كانت مؤقتة فقط لتأكيد البريد، لا حاجة لإبقائها
    await supabaseClient.auth.signOut();

    if(registerError){
        alert(registerError.message);
        return;
    }

    pendingRegisterData = null;
    closeRegisterOtpModal();

    alert("تم إنشاء الحساب");
    openScreen("login-screen");
}




// ========================================
// تسجيل الدخول (محدثة - تشفير عبر قاعدة البيانات)
// ========================================

async function login(){


    let username =
    document
    .getElementById("login-username")
    .value
    .trim();



    let password =
    document
    .getElementById("login-password")
    .value
    .trim();



    if(username === "" || password === ""){


        alert("اكتب اسم المستخدم وكلمة المرور");

        return;

    }



    // دخول الأدمن — نتعرف على اسم الأدمن بأي حالة أحرف (Admin/admin)
    // ليتمكن من الدخول مهما كتب. الأهم: إذا فشل دخول الأدمن لأي سبب (كلمة
    // مرور خاطئة، قفل مؤقت بسبب محاولات فاشلة، انقطاع شبكة...) نعرض الخطأ
    // الحقيقي ونخرج فورًا ولا ننتقل أبدًا إلى دخول اللاعب — كانت الرسالة
    // الناتجة "اسم المستخدم أو كلمة المرور خاطئة" تخفي السبب الفعلي

    if(username.toLowerCase() === "admin"){


        let {data:admin,error:adminError}=

        await supabaseClient
        .rpc("login_admin", {

            p_username:username,

            p_password:password

        })
        .single();



        if(adminError){

            // PGRST116 = لا يوجد صف مرتجع من الدالة، أي كلمة المرور/الاسم
            // غير متطابقين. أي خطأ آخر (قفل الحساب، الشبكة...) نعرض رسالته
            if(adminError.code === "PGRST116"){

                alert("اسم المستخدم أو كلمة مرور الأدمن غير صحيحة");

            } else {

                alert(adminError.message || "تعذّر تسجيل دخول الإدارة");

            }

            return;

        }

        if(!admin){

            alert("اسم المستخدم أو كلمة مرور الأدمن غير صحيحة");

            return;

        }

        // لا نمنح الدخول فورًا: نرسل أولاً رمز تحقق إلى البريد الإداري
        // ولا نُدخل لوحة الإدارة إلا بعد التحقق من الرمز
        pendingAdminId = admin.id;

        let otpBtn = document.getElementById("login-btn");

        if(otpBtn) otpBtn.disabled = true;

        let otpError = await sendAdminOtp();

        if(otpBtn) otpBtn.disabled = false;

        if(otpError){

            console.log(otpError);

            alert("تعذّر إرسال رمز التحقق إلى البريد الإداري، حاول لاحقًا");

            pendingAdminId = null;

            return;

        }

        openAdminOtpModal();

        return;

    }



    // دخول اللاعب


    // نستخدم دالة موحّدة تُرجع بيانات المستخدم واللاعب معًا في نداء واحد،
    // بدل قراءة جدول players مباشرة (لم يعد قابلاً للقراءة العامة لحماية
    // بيانات كل اللاعبين من أي شخص يملك anon key)
    let {data:user,error}=

    await supabaseClient
    .rpc("login_user_and_get_player", {

        p_username:username,

        p_password:password

    })
    .single();



    if(error || !user || !user.player_id){


        alert("اسم المستخدم أو كلمة المرور خاطئة");

        return;

    }



    localStorage.setItem(
        "username",
        user.username
    );

    // إصلاح ثغرة أمان: نمسح أي رمز جلسة أدمن قديم متبقٍ من جلسة سابقة على
    // نفس الجهاز، حتى لو لم يتم تسجيل الخروج رسميًا قبل دخول لاعب عادي
    localStorage.removeItem(
        "admin_token"
    );



    localStorage.setItem(
        "player_id",
        user.player_id
    );

    // رمز الجلسة الآن يُعاد مباشرة ضمن login_user_and_get_player نفسها
    // (بعد أن أثبتت هويتك عبر كلمة المرور)، بدل نداء منفصل كان بإمكان أي
    // شخص يملك anon key استدعاءه بأي player_id لانتحال أي حساب آخر.
    if(user.token){
        localStorage.setItem("player_token", user.token);
    }



    alert("تم تسجيل الدخول");



    if(user.has_character === true){


        openScreen("home-screen");


    }else{


        openScreen(
            "character-choice-screen"
        );


        loadAvailableCharacters();

    }



    updatePlayerInfo();

}


// ========================================
// تحقق ثنائي (2FA) لدخول لوحة الإدارة عبر البريد
// ========================================
// آلية العمل: نستخدم Supabase Auth لإرسال رمز تحقق (OTP) من 6 أرقام إلى
// بريد الإدارة الثابت عبر signInWithOtp، ثم نتحقق منه عبر verifyOtp قبل
// منح الدخول الفعلي للوحة الإدارة (admin_id). هذا لا يحتاج أي خدمة بريد
// خارجية أو مفتاح API، لكنه يتطلب تعديلًا بسيطًا لمرة واحدة في لوحة تحكم
// Supabase حتى تُرسل الرسالة كرمز رقمي بدل رابط:
// Authentication > Email Templates > Magic Link
// عدّل محتوى الرسالة بحيث يحتوي المتغير {{ .Token }} مثلاً:
//   <h2>رمز الدخول للوحة الإدارة</h2>
//   <p>رمز التحقق: {{ .Token }}</p>

const ADMIN_OTP_EMAIL = "amaaidris@gmail.com";

let pendingAdminId = null;

// Supabase يفرض مدة انتظار ~60 ثانية بين كل طلب رمز والثاني لنفس البريد،
// وأي رمز جديد يُلغي صلاحية الرمز السابق تلقائيًا. لهذا نتتبع وقت آخر
// إرسال وندير عدّاد تنازلي بدل ما نخلي المستخدم يضغط "إعادة إرسال" بسرعة
// ويفشل بصمت أو يستخدم رمز قديم انتهت صلاحيته
const ADMIN_OTP_COOLDOWN_SECONDS = 60;

let adminOtpCooldownUntil = 0;

let adminOtpCooldownTimer = null;


async function sendAdminOtp(){

    let {error} =
    await supabaseClient.auth.signInWithOtp({

        email: ADMIN_OTP_EMAIL,

        options: { shouldCreateUser: true }

    });

    if(!error){

        adminOtpCooldownUntil = Date.now() + (ADMIN_OTP_COOLDOWN_SECONDS * 1000);

    }

    return error;

}


// يستخرج عدد الثواني المتبقية من رسالة خطأ حد الإرسال (429) إن وُجدت،
// حتى لو حدث هذا الخطأ رغم العدّاد المحلي (مثلاً بسبب فرق ساعة الجهاز)
function extractRateLimitSeconds(error){

    if(!error || !error.message) return null;

    let match = error.message.match(/(\d+)\s*second/);

    return match ? parseInt(match[1], 10) : null;

}


function openAdminOtpModal(){

    closeAdminOtpModal();

    let modal = document.createElement("div");

    modal.id = "admin-otp-modal";

    modal.className = "steal-modal";

    modal.innerHTML = `

        <div class="steal-modal-box">

            <h3>🔐 تحقق دخول الإدارة</h3>

            <p class="skill-desc-text">تم إرسال رمز تحقق إلى البريد الإداري. أدخله لإتمام الدخول.</p>

            <input id="admin-otp-input" type="text" inputmode="numeric" maxlength="10" placeholder="رمز التحقق" autocomplete="one-time-code">

            <div class="steal-modal-buttons">

                <button id="admin-otp-confirm-btn">تأكيد</button>

                <button id="admin-otp-resend-btn">إعادة إرسال الرمز</button>

            </div>

            <p class="steal-or" style="margin-top:12px;">

                <button id="admin-otp-cancel-btn">إلغاء</button>

            </p>

        </div>

    `;

    document.body.appendChild(modal);

    modal.querySelector("#admin-otp-confirm-btn").onclick = confirmAdminOtp;

    modal.querySelector("#admin-otp-cancel-btn").onclick = cancelAdminOtp;

    modal.querySelector("#admin-otp-resend-btn").onclick = async () => {

        let btn = modal.querySelector("#admin-otp-resend-btn");

        btn.disabled = true;

        btn.textContent = "جارٍ الإرسال...";

        let error = await sendAdminOtp();

        if(error){

            btn.disabled = false;

            btn.textContent = "إعادة إرسال الرمز";

            let waitSeconds = extractRateLimitSeconds(error);

            alert(waitSeconds
                ? `انتظر ${waitSeconds} ثانية قبل طلب رمز جديد`
                : "تعذّر إرسال الرمز، حاول لاحقًا");

            return;

        }

        alert("تم إرسال رمز جديد إلى البريد الإداري، استخدم آخر رمز وصلك فقط");

        startAdminOtpCooldownCountdown();

    };

    let input = modal.querySelector("#admin-otp-input");

    if(input) input.focus();

    // العدّاد يبدأ فورًا لأن فتح هذه النافذة يعني أنه تم إرسال رمز للتو
    startAdminOtpCooldownCountdown();

}


function startAdminOtpCooldownCountdown(){

    let btn = document.getElementById("admin-otp-resend-btn");

    if(!btn) return;

    if(adminOtpCooldownTimer) clearInterval(adminOtpCooldownTimer);

    let tick = () => {

        btn = document.getElementById("admin-otp-resend-btn");

        if(!btn){

            clearInterval(adminOtpCooldownTimer);

            return;

        }

        let remaining = Math.ceil((adminOtpCooldownUntil - Date.now()) / 1000);

        if(remaining > 0){

            btn.disabled = true;

            btn.textContent = `إعادة إرسال الرمز (${remaining})`;

        } else {

            btn.disabled = false;

            btn.textContent = "إعادة إرسال الرمز";

            clearInterval(adminOtpCooldownTimer);

        }

    };

    tick();

    adminOtpCooldownTimer = setInterval(tick, 1000);

}


function closeAdminOtpModal(){

    if(adminOtpCooldownTimer){

        clearInterval(adminOtpCooldownTimer);

        adminOtpCooldownTimer = null;

    }

    let modal = document.getElementById("admin-otp-modal");

    if(modal) modal.remove();

}


function cancelAdminOtp(){

    pendingAdminId = null;

    closeAdminOtpModal();

}


async function confirmAdminOtp(){

    let input = document.getElementById("admin-otp-input");

    let code = input ? input.value.trim() : "";

    if(!code){

        alert("اكتب رمز التحقق المرسل إلى البريد");

        return;

    }

    if(!pendingAdminId){

        alert("انتهت صلاحية محاولة الدخول، سجّل الدخول من جديد");

        closeAdminOtpModal();

        return;

    }

    // نتحقق أولاً كنوع "email" (تدفق magiclink)، ولو فشل نجرب "recovery":
    // Supabase يوجّه المستخدم المؤكَّد مسبقًا تلقائيًا عبر تدفق recovery
    // داخليًا (حتى مع signInWithOtp)، فيجب التحقق بنفس النوع وإلا يظهر
    // الرمز كأنه خاطئ رغم أنه صحيح
    let {error} =
    await supabaseClient.auth.verifyOtp({

        email: ADMIN_OTP_EMAIL,

        token: code,

        type: "email"

    });

    if(error){

        let retry =
        await supabaseClient.auth.verifyOtp({

            email: ADMIN_OTP_EMAIL,

            token: code,

            type: "recovery"

        });

        error = retry.error;

    }

    if(error){

        console.log(error);

        alert("رمز التحقق غير صحيح أو منتهي الصلاحية");

        return;

    }

    // نجح التحقق: ننشئ جلسة أدمن برمز مؤقت (صالحة لمدة محدودة) بدل حفظ
    // admin_id نفسه بشكل دائم — هذا يمنع استخدام أي admin_id متسرب لاحقًا
    // بلا نهاية، لأن الرمز نفسه ينتهي وليس هو الهوية المباشرة للأدمن
    let {data: sessionToken, error: sessionError} =
    await supabaseClient.rpc("create_admin_session", {
        p_admin_id: pendingAdminId
    });

    if(sessionError || !sessionToken){

        console.log(sessionError);

        alert("تعذّر إنشاء جلسة الإدارة، حاول من جديد");

        return;

    }

    localStorage.setItem("admin_token", sessionToken);

    pendingAdminId = null;

    closeAdminOtpModal();

    // جلسة supabase auth كانت مؤقتة فقط لإرسال الرمز، لا حاجة لإبقائها
    await supabaseClient.auth.signOut();

    alert("تم دخول الإدارة");

    openScreen("admin-panel-screen");

}


// ========================================
// قائمة اختيار الوحش في PvE
// ========================================

function renderMonsterList(monsters){

    let box = document.getElementById("pve-monster-list");

    if(!box) return;

    if(!monsters || monsters.length === 0){

        box.innerHTML = "<p>لا توجد وحوش متاحة حاليًا</p>";

        return;

    }

    box.innerHTML = "";

    monsters.forEach(monster => {

        let card = document.createElement("div");

        card.className = "character-card";

        card.innerHTML = `

        <div class="character-info">

            <h3>${escapeHtml(monster.name)}</h3>

            <p>❤️ ${monster.hp || 0} &nbsp;·&nbsp; ⚔️ ${monster.atk || 0}</p>

            ${(monster.gold_prize || 0) > 0
                ? `<p>🪙 الجائزة: ${monster.gold_prize} ذهب · متبقي اليوم: ${monster.remaining_today}</p>`
                : `<p>لا جائزة ذهب لهذا الوحش</p>`}

        </div>

        <button>⚔️ قاتل</button>

        `;

        card.querySelector("button").onclick = () => startPVEBattle(monster.id);

        box.appendChild(card);

    });

}

async function loadMonsterList(){

    let box = document.getElementById("pve-monster-list");

    if(!box) return;

    if(!GameCache.getStale("monster_list")){
        box.innerHTML = "جاري تحميل الوحوش...";
    }

    // بيانات الوحوش (اسم/صحة/هجوم للعرض) للقراءة فقط ومتاحة للجميع أصلاً،
    // لذا تُعرض فورًا من الكاش إن وُجد (يعمل حتى أوفلاين) ثم تُحدَّث بصمت
    // في الخلفية إذا كان هناك اتصال. مدة الصلاحية 5 دقائق قبل إعادة الجلب.
    await GameCache.fetchWithCache(
        "monster_list",
        async () => {
            let {data:monsters, error} =
            await supabaseClient
            .rpc("pve_list_monsters", {
                p_token: localStorage.getItem("player_token")
            });

            if(error) throw error;
            return monsters;
        },
        (monsters) => renderMonsterList(monsters),
        () => { box.innerHTML = "لا يوجد اتصال بالإنترنت ولا توجد بيانات محفوظة"; },
        5 * 60 * 1000
    );

}



// ========================================
// تحميل الشخصيات المتاحة
// ========================================

async function loadAvailableCharacters(){


    let box =
    document.getElementById(
        "available-characters"
    );


    if(!box)
    return;



    box.innerHTML =
    "جاري تحميل الشخصيات...";



    let {data:characters,error}=

    await supabaseClient
    .from("characters")
    .select("*")
    .eq("available",true)
    .eq("admin_only",false)
    .eq("is_monster",false)
    .is("owner_id",null);



    if(error){


        console.log(error);


        box.innerHTML =
        "حدث خطأ في تحميل الشخصيات";


        return;

    }




    box.innerHTML = "";



    if(!characters ||
    characters.length === 0){


        box.innerHTML =
        "لا توجد شخصيات متاحة حاليا";


        return;

    }





    characters.forEach(character=>{


        let card =
        document.createElement("div");



        card.className =
        "character-card";



        card.innerHTML = `


        <div class="character-info">

            <h3>
            ${escapeHtml(character.name)}
            </h3>


            <p>
            ${escapeHtml(character.anime)}
            </p>


            <p>
            LV ${character.level}
            </p>


        </div>



        <button>
        اختيار
        </button>


        `;




        let button =
        card.querySelector("button");



        button.onclick = ()=>{


            chooseCharacter(
                character.id
            );


        };



        box.appendChild(card);



    });



}





// ========================================
// اختيار الشخصية
// ========================================

async function chooseCharacter(character_id){


    let player_id =
    localStorage.getItem(
        "player_id"
    );



    if(!player_id){


        alert(
        "يجب تسجيل الدخول"
        );


        return;

    }





    let {data:character,error}=

    await supabaseClient
    .from("characters")
    .select("*")
    .eq("id",character_id)
    .single();





    if(error || !character){


        alert(
        "لم يتم العثور على الشخصية"
        );


        return;

    }







    // نستخدم دالة claim_character الآمنة في قاعدة البيانات (SECURITY DEFINER)
    // بدل الكتابة المباشرة على الجداول، لأن جداول characters/player_characters/players
    // لا تملك صلاحيات INSERT/UPDATE عامة عبر RLS (وهذا مقصود لأسباب أمنية).
    // نرسل رمز الجلسة (token) وليس player_id مباشرة، حتى لا يستطيع أحد
    // انتحال حساب لاعب آخر بمجرد معرفة معرّفه.
    let player_token = localStorage.getItem("player_token");

    if(!player_token){
        alert("انتهت صلاحية الجلسة، الرجاء تسجيل الدخول من جديد");
        logout();
        return;
    }

    let {error:claimError} =

    await supabaseClient
    .rpc("claim_character", {

        p_token: player_token,

        p_character_id: character_id

    });


    if(claimError){


        alert(
        claimError.message
        );


        return;

    }






    localStorage.setItem(
        "character_id",
        character_id
    );


    localStorage.setItem(
        "character_name",
        character.name
    );





    alert(
    "تم اختيار " + character.name
    );



    openScreen(
        "home-screen"
    );



}





// ========================================
// إرسال طلب شخصية
// ========================================

function showCharacterRequest(){
    openScreen("character-request-screen");
}

function submitCharacterRequest(){
    sendCharacterRequest();
}

async function sendCharacterRequest(){


    let player_id =
    localStorage.getItem(
        "player_id"
    );


    let name =
    document
    .getElementById(
        "request-character-name"
    )
    .value
    .trim();



    let anime =
    document
    .getElementById(
        "request-anime-name"
    )
    .value
    .trim();



    let note =
    document
    .getElementById(
        "request-note"
    )
    .value
    .trim();





    if(name==="" || anime===""){


        alert(
        "اكتب اسم الشخصية والأنمي"
        );


        return;

    }






    let {error}=

    await supabaseClient
    .from("character_requests")
    .insert([{

        player_id:player_id,

        character_name:name,

        anime_name:anime,

        notes:note

    }]);






    if(error){


        alert(
        error.message
        );


        return;

    }






    alert(
    "تم إرسال الطلب"
    );



}
// ========================================
// تسجيل الخروج
// ========================================

function logout(){

    // أي خطأ أثناء إنهاء الجلسة في الخلفية يجب ألا يمنع تسجيل الخروج محليًا
    // أو الانتقال لشاشة الدخول، لذلك نلف كل الخطوات في محاولة آمنة

    stopPlayerPresence();

    try{

        // إنهاء جلسة اللاعب فعليًا في قاعدة البيانات ثم مسحها من هذا الجهاز
        let playerToken = localStorage.getItem("player_token");

        if(playerToken){

            supabaseClient.rpc("player_logout_session", {
                p_token: playerToken
            }).then(() => {}, () => {});

        }

    }catch(e){
        console.error("player logout session failed", e);
    }

    try{
        localStorage.removeItem("player_token");
    }catch(e){}


    try{
        localStorage.removeItem("player_id");
    }catch(e){}


    try{
        localStorage.removeItem("username");
    }catch(e){}


    try{
        localStorage.removeItem("character_id");
    }catch(e){}


    try{
        localStorage.removeItem("character_name");
    }catch(e){}


    try{

        // إنهاء جلسة الأدمن فعليًا في قاعدة البيانات (لا تُترك صالحة بالخلفية)
        // ثم مسحها من هذا الجهاز
        let adminToken = localStorage.getItem("admin_token");

        if(adminToken){

            supabaseClient.rpc("admin_logout_session", {
                p_token: adminToken
            }).then(() => {}, () => {});

        }

    }catch(e){
        console.error("admin logout session failed", e);
    }

    try{
        localStorage.removeItem("admin_token");
    }catch(e){}



    try{
        openScreen("login-screen");
    }catch(e){
        console.error("logout: openScreen failed", e);
    }



}





// ========================================
// فحص اللاعب عند فتح اللعبة
// ========================================

async function checkPlayer(){


    let player_id =
    localStorage.getItem(
        "player_id"
    );



    if(!player_id){


        openScreen(
            "login-screen"
        );


        return;

    }


    let cacheName = "player_row_" + player_id;
    let cachedPlayer = GameCache.getStale(cacheName);
    let player_token = localStorage.getItem("player_token");


    // إن كنا أوفلاين ولدينا نسخة محفوظة من قبل، نعرض الشاشة المناسبة فورًا
    // بدل تعليق اللاعب على شاشة تحميل لا تنتهي. لا يزال تسجيل الدخول الأول
    // (عندما لا يوجد player_id بعد) يتطلب اتصالاً بالإنترنت كالمعتاد.
    if(!GameCache.isOnline() && cachedPlayer){

        renderPlayerScreen(cachedPlayer);
        return;

    }

    if(!player_token){

        if(cachedPlayer){
            renderPlayerScreen(cachedPlayer);
            return;
        }

        logout();
        return;

    }


    // نقرأ بيانات اللاعب عبر RPC آمنة بدل قراءة جدول players مباشرة
    // (لم يعد قابلاً للقراءة العامة لحماية بيانات كل اللاعبين)
    let {data:player,error}=

    await supabaseClient
    .rpc("get_my_player", { p_token: player_token })
    .single();


    if(error || !player){

        // فشل الاتصال (وليس بالضرورة خطأ في الحساب) ولدينا نسخة محفوظة؟
        // نعرضها بدل تسجيل خروج اللاعب بسبب انقطاع مؤقت في الشبكة.
        if(cachedPlayer && !GameCache.isOnline()){
            renderPlayerScreen(cachedPlayer);
            return;
        }

        logout();


        return;

    }


    GameCache.set(cacheName, player);

    renderPlayerScreen(player);


}


function renderPlayerScreen(player){

    if(player.has_character === true){


        openScreen(
            "home-screen"
        );


    }else{


        openScreen(
            "character-choice-screen"
        );


        loadAvailableCharacters();


    }



    updatePlayerInfo();

    // أبقِ اللاعب "متصلًا" في قائمة PvP واستقبل تحدّيات أي لاعب آخر من أي شاشة
    startPlayerPresence();

}






// ========================================
// حضور اللاعب في اللعبة + إشعار التحدّيات الواردة
// ========================================

let presenceTimer = null;
let challengePollTimer = null;

// نبضة نشاط خفيفة تُبقي اللاعب "متصلًا" في قائمة PvP حتى لو لم يكن على
// تبويب PvP، ونفحص دوريًا إن كان هناك تحدٍّ وارد بانتظار الرد لنعرض لافتة
// قبوله من أي شاشة داخل اللعبة.
function startPlayerPresence(){
    try{
        if(presenceTimer){ clearInterval(presenceTimer); presenceTimer = null; }
        if(challengePollTimer){ clearInterval(challengePollTimer); challengePollTimer = null; }

        // نبضة نشاط كل 10 ثوانٍ: نُبقي اللاعب "متصلًا" في قائمة PvP حتى لو
        // لم يكن على تبويب PvP. نبضة متكررة وقصيرة جدًا بحيث يبقى ضمن نافذة
        // الاتصال الواسعة حتى لو أخّر المتصفح الموقّت (تبويب في الخلفية).
        let presencePing = () => {
            let token = pvpGetToken();
            if(!token) return;
            supabaseClient.rpc("pvp_presence_ping", { p_token: token }).then(() => {}, () => {});
        };
        presenceTimer = setInterval(presencePing, 10000);

        // عند عودة اللاعب للتبويب (من خلفية/قفل الشاشة) ننبض فورًا بدل انتظار
        // الدورة التالية، حتى يظهر متصلًا لحظيًا في ردهة الخصم. وننبض مرة
        // أولى عند التشغيل مباشرة لضمان رؤية سريعة من الطرف الآخر.
        document.addEventListener("visibilitychange", () => {
            if(!document.hidden) presencePing();
        });
        presencePing();

        challengePollTimer = setInterval(() => {
            let token = pvpGetToken();
            if(!token) return;
            // نتأكد أن نبضة الحضور استمرت حتى في الخلفية، ثم نفحص التحدي الوارد
            supabaseClient.rpc("pvp_presence_ping", { p_token: token }).then(() => {}, () => {});
            supabaseClient.rpc("pvp_get_incoming_challenge", { p_token: token })
            .then(({ data, error }) => {
                if(error) return;
                let inc = (data && data.length > 0) ? data[0] : null;
                renderGlobalChallengeBanner(inc);
            }, () => {});
        }, 8000);
    }catch(e){}
}

function stopPlayerPresence(){
    if(presenceTimer){ clearInterval(presenceTimer); presenceTimer = null; }
    if(challengePollTimer){ clearInterval(challengePollTimer); challengePollTimer = null; }
    hideGlobalChallengeBanner();
}

function renderGlobalChallengeBanner(inc){
    let box = document.getElementById("global-challenge-banner");
    if(!box) return;

    // داخل ردهة PvP أو نزال فعلي: الردهة تعرض التحدي الوارد بنفسها، فلا
    // نعرض اللافتة المكررة
    let active = document.querySelector(".screen.active");
    let activeId = active ? active.id : "";
    if(activeId === "pvp-lobby-screen" || activeId === "pvp-battle-screen"){
        hideGlobalChallengeBanner();
        return;
    }

    if(!inc){
        hideGlobalChallengeBanner();
        return;
    }

    box.classList.remove("hidden");
    let safeName = escapeHtml(inc.challenger_name || "لاعب");
    box.innerHTML =
        `<span class="gcb-text">⚔️ لديك تحدي من ${safeName}</span>` +
        `<button class="gcb-accept">قبول</button>` +
        `<button class="gcb-dismiss">لاحقًا</button>`;
    box.querySelector(".gcb-accept").onclick = () => {
        box.classList.add("hidden");
        try{ pvpRespondChallenge(inc.match_id, true); }catch(e){}
    };
    box.querySelector(".gcb-dismiss").onclick = () => hideGlobalChallengeBanner();
}

function hideGlobalChallengeBanner(){
    let box = document.getElementById("global-challenge-banner");
    if(box) box.classList.add("hidden");
}

// ========================================
// تشغيل اللعبة
// ========================================

window.addEventListener(
"load",
function(){


    let player_id =
    localStorage.getItem(
        "player_id"
    );



    if(!player_id){


        openScreen(
            "login-screen"
        );


        return;


    }



    checkPlayer();


});


// عند عودة الاتصال بالإنترنت، نعيد التحقق من بيانات اللاعب بصمت
// لتحديث أي شيء تغيّر أثناء انقطاع الاتصال (لا يُعيد فتح شاشة جديدة،
// فقط يحدّث البيانات في الخلفية)
window.addEventListener("online", function(){

    let player_id = localStorage.getItem("player_id");

    if(player_id){
        checkPlayer();
    }

});






// ========================================
// مجموعة اللاعب
// ========================================


function openCollection(){


    openScreen(
        "collection-screen"
    );


}






async function loadCollection(){


    let player_id =
    localStorage.getItem(
        "player_id"
    );



    let box =
    document.getElementById(
        "my-characters"
    );



    if(!box)
    return;




    if(!player_id){


        box.innerHTML =
        "يجب تسجيل الدخول";


        return;

    }




    box.innerHTML =
    "جاري تحميل المجموعة...";





    let {data:characters,error}=

    await supabaseClient
    .rpc("get_my_characters", { p_token: localStorage.getItem("player_token") });






    if(error){


        console.log(error);


        box.innerHTML =
        "حدث خطأ في تحميل المجموعة";


        return;

    }





    if(!characters ||
    characters.length===0){


        box.innerHTML =
        "لا توجد شخصيات";


        return;


    }






    box.innerHTML="";





    characters.forEach(item=>{


        let character = {
            name: item.name,
            anime: item.anime
        };


        let card =
        document.createElement(
            "div"
        );



        card.className =
        "character-card";


        let effectiveColor =
        (item.custom_glow_color && /^#[0-9A-Fa-f]{6}$/.test(item.custom_glow_color))
        ? item.custom_glow_color
        : ((item.glow_color && /^#[0-9A-Fa-f]{6}$/.test(item.glow_color)) ? item.glow_color : "#3b82ff");


        let colorControlHtml = item.glow_locked
        ? `<p class="glow-locked-note">🔒 اللون مقفول من الإدارة</p>`
        : `<label class="glow-picker-row">
                🎨 لون التوهج
                <input type="color" class="glow-color-input" value="${effectiveColor}">
           </label>`;


        card.innerHTML = `


        <div class="character-info">


        <h3>
        ${escapeHtml(character.name)}
        </h3>


        <p>
        ${escapeHtml(character.anime)}
        </p>


        <p>
        ⭐ LV ${item.level}
        </p>


        <p>
        ❤️ HP ${item.hp}
        </p>


        <p>
        ⚔️ ATK ${item.atk}
        </p>


        ${colorControlHtml}


        </div>


        `;


        if(!item.glow_locked){

            let colorInput = card.querySelector(".glow-color-input");

            colorInput.onchange = () => setMyGlowColor(item.character_id, colorInput.value);

        }


        box.appendChild(card);



    });



}


// ========================================
// تغيير لون توهج إحدى شخصياتي (يُرفض تلقائيًا من الخادم لو كانت مقفولة)
// ========================================

async function setMyGlowColor(characterId, color){

    let player_token = localStorage.getItem("player_token");

    if(!player_token){

        alert("يجب تسجيل الدخول");

        return;

    }

    let {error} =

    await supabaseClient
    .rpc("player_set_glow_color", {

        p_token: player_token,

        p_character_id: characterId,

        p_color: color

    });

    if(error){

        alert(error.message);

    }

    loadCollection();

}
// ========================================
// تحميل ملف الشخصية
// ========================================

async function loadCharacterProfile(){


    let player_id =
    localStorage.getItem(
        "player_id"
    );



    let box =
    document.getElementById(
        "character-profile"
    );



    if(!box)
    return;




    box.innerHTML =
    "جاري تحميل الشخصية...";






    // نقرأ الشخصية النشطة عبر RPC آمنة واحدة بدل قراءتين مباشرتين من
    // player_characters/players (لم تعودا قابلتين للقراءة العامة)
    let {data:characterData,error:charError}=

    await supabaseClient
    .rpc("get_my_active_character", { p_token: localStorage.getItem("player_token") })
    .maybeSingle();


    if(charError ||
    !characterData){


        box.innerHTML =
        "لا توجد شخصية مختارة";


        return;

    }




    let character = characterData;

    // مهارات الشخصية (عرض فقط، لا تعديل): تُقرأ من البيانات المرجعية العامة
    let skills = [];
    try{
        skills = await loadCharacterSkills(characterData.character_id) || [];
    }catch(e){ skills = []; }

    // الضرر الفعلي (بعد تطوير ATK) لتظهر المهارات كما تُلحق ضررًا فعلًا في المعارك
    let scaledDamageMap = {};
    try{
        if(typeof computeScaledAttackDamages === "function" && characterData.atk){
            scaledDamageMap = computeScaledAttackDamages(characterData.atk, skills) || {};
        }
    }catch(e){}

    let skillsHtml = skills.length > 0
    ? `
    <h3>⚔️ المهارات</h3>
    <div class="character-skills-list">
    ${skills.map(s => {
        let isDmgSkill = (s.type === "attack" || s.type === "special") && s.effect !== "shadow";
        let scaled = (isDmgSkill && scaledDamageMap[s.id] !== undefined) ? scaledDamageMap[s.id] : null;
        let dmgText = isDmgSkill ? (scaled != null ? scaled : (s.damage || 0)) : "-";
        return `
        <div class="character-skill-item">
            <div class="character-skill-head">
                <strong>${escapeHtml(s.name || "")}</strong>
                <span class="skill-badge">${escapeHtml(s.type || "")}</span>
            </div>
            <div class="character-skill-meta">
                <span>⚔️ الضرر: ${escapeHtml(String(dmgText))}</span>
                <span>⏳ التهدئة: ${s.cooldown || 0}</span>
            </div>
            <p class="character-skill-desc">${escapeHtml(s.description || "")}</p>
        </div>`;
    }).join("")}
    </div>
    `
    : `<p>لا توجد مهارات</p>`;





    box.innerHTML = `



    <img

    src="${escapeHtml(character.identity_image || '')}"

    class="character-image"

    >



    <h2>

    ${escapeHtml(character.name)}

    </h2>



    <p>

    ${escapeHtml(character.anime)}

    </p>






    <p>

    ⭐ المستوى:
    ${characterData.level}

    </p>





    <p>

    ❤️ HP:
    ${characterData.hp}

    </p>





    <p>

    ⚔️ ATK:
    ${characterData.atk}

    </p>





    <hr>





    <h3>

    ${escapeHtml(character.power_name || "القوة الخاصة")}

    </h3>





    <p>

    ${escapeHtml(character.power_description || "")}

    </p>





    <p>

    "${escapeHtml(character.quote || "")}"

    </p>



    ${skillsHtml}

    `;



}








// ========================================
// تحميل شاشة التطوير
// ========================================

async function loadUpgradeScreen(){



    let box =
    document.getElementById(
        "upgrade-character-info"
    );



    let player_id =
    localStorage.getItem(
        "player_id"
    );



    if(!box || !player_id)
    return;






    // نقرأ الشخصية النشطة عبر RPC آمنة واحدة بدل قراءتين مباشرتين
    let {data:character, error: charError}=

    await supabaseClient
    .rpc("get_my_active_character", { p_token: localStorage.getItem("player_token") })
    .maybeSingle();
if(charError || !character){


        box.innerHTML =
        "لا توجد شخصية";


        return;

    }

    // سعر الترقية القادمة من الذهب + مقدار الرصيد والحد الأقصى للمستوى
    let quote = null;
    let upgradeToken = localStorage.getItem("player_token");
    if(upgradeToken){
        try {
            let { data: q } = await supabaseClient
                .rpc("get_player_level_up_quote", { p_token: upgradeToken })
                .maybeSingle();
            quote = q || null;
        } catch(e) { quote = null; }
    }

    let goldDisplay = quote ? ("🪙 الذهب: " + quote.gold) : "";
    let maxLevelDisplay = quote ? ("الحد الأقصى: " + quote.max_level) : "";
    let costDisplay = "—";
    if(quote){
        costDisplay = quote.at_max ? "وصلت لأقصى مستوى" :
            (quote.next_cost > 0 ? (quote.next_cost + " 🪙") : "مجانًا");
    }

    box.innerHTML = `


    ⭐ المستوى:
    ${character.level}


    <br>


    ❤️ HP:
    ${character.hp}


    <br>

⚔️ ATK:
    ${character.atk}


    <br>

    ${goldDisplay}


    <br>

    ${maxLevelDisplay}


    <br>

    💰 تكلفة الترقية القادمة:
    ${costDisplay}


    `;

    // توزيع الـ200 نقطة: يُعاد للافتراضي 100/100 عند فتح الشاشة
    upgradeSplit.hp = 100;
    upgradeSplit.atk = 100;
    updateSplitUI();

    // إظهار أدوات توزيع النقاط بين HP وATK حتى يستطيع اللاعب التحكم في التقسيم
    let splitBox = document.getElementById("upgrade-split-box");
    if(splitBox){
        splitBox.style.display = (quote && quote.at_max) ? "none" : "block";
    }

}






// ========================================
// تطوير الشخصية
// ========================================

// توزيع الـ200 نقطة بين HP وATK عند كل تطوير (بدفعات 50، ولا تقل صفة عن 50)
let upgradeSplit = { hp: 100, atk: 100 };

// يحدّث العرض الرقمي وعلامة المجموع في شاشة التطوير
function updateSplitUI(){
    let hpEl = document.getElementById("split-hp-gain");
    let atkEl = document.getElementById("split-atk-gain");
    let totalEl = document.getElementById("split-total-label");
    if(hpEl) hpEl.textContent = upgradeSplit.hp;
    if(atkEl) atkEl.textContent = upgradeSplit.atk;
    if(totalEl) totalEl.textContent = "المجموع: " + (upgradeSplit.hp + upgradeSplit.atk) + " / 200";
}

// تعديل نصيب HP (الزيادة تُخصم من ATK والعكس) ضمن الحدود المسموحة
function splitAdjustHp(delta){
    let newHp = upgradeSplit.hp + delta;
    // كل صفة بين 50 و150 بخطوات 50، والمجموع ثابت 200
    if(newHp < 50) newHp = 50;
    if(newHp > 150) newHp = 150;
    upgradeSplit.hp = newHp;
    upgradeSplit.atk = 200 - newHp;
    updateSplitUI();
}

// تعديل نصيب ATK (الزيادة تُخصم من HP والعكس) ضمن الحدود المسموحة
function splitAdjustAtk(delta){
    let newAtk = upgradeSplit.atk + delta;
    if(newAtk < 50) newAtk = 50;
    if(newAtk > 150) newAtk = 150;
    upgradeSplit.atk = newAtk;
    upgradeSplit.hp = 200 - newAtk;
    updateSplitUI();
}

async function upgradeCharacter(){


    // سيُعاد بناء دالة الترقية بالكامل في نظام الترقية بالذهب (الخطوة 4)
    // (جدول player_characters لا يسمح بـ UPDATE عبر RLS للحماية من التلاعب)
    let upgrade_token = localStorage.getItem("player_token");

    if(!upgrade_token){
        alert("انتهت صلاحية الجلسة، الرجاء تسجيل الدخول من جديد");
        logout();
        return;
    }

    let hpGain = Number(upgradeSplit.hp || 100);
    let atkGain = Number(upgradeSplit.atk || 100);

    if(hpGain + atkGain !== 200){
        alert("يجب أن يكون مجموع النقاط 200 تمامًا");
        return;
    }
    if(hpGain < 50 || atkGain < 50){
        alert("يجب رفع كل من HP وATK بما لا يقل عن 50");
        return;
    }
    if(hpGain % 50 !== 0 || atkGain % 50 !== 0){
        alert("يجب أن تكون الزيادات مضاعفات 50");
        return;
    }

    let {error:upgradeError} =

    await supabaseClient
    .rpc("upgrade_player_character", {

        p_token: upgrade_token,
        p_hp_gain: hpGain,
        p_atk_gain: atkGain

    });

    if(upgradeError){

        alert(upgradeError.message);

        return;

    }




    alert(
    "تم تطوير الشخصية"
    );



    loadUpgradeScreen();

    // تحديث الذهب المعروض في أعلى يسار اللعبة فورًا بعد الترقية
    updatePlayerInfo();


}
// ========================================
// شخصيات الأدمن الخاصة (لا يراها أي لاعب آخر)
// ========================================

async function loadAdminMyCharacters(){

    let box = document.getElementById("admin-my-characters-content");

    if(!box) return;

    box.innerHTML = "جاري التحميل...";

    let {data:list, error} =

    await supabaseClient
    .from("characters")
    .select("*")
    .eq("admin_only", true);

    if(error){

        console.log(error);

        box.innerHTML = "حدث خطأ في التحميل";

        return;

    }

    box.innerHTML = renderAdminCharacterCards(list, "لم تصمم أي شخصية خاصة بعد. اذهب للوحة الإدارة الرئيسية وفعّل خانة 🔒 عند الإضافة");

    let screenBox = document.getElementById("admin-my-characters-screen-content");

    if(screenBox && screenBox !== box) screenBox.innerHTML = box.innerHTML;

}


async function playAdminCharacter(characterId){

    let admin_token = localStorage.getItem("admin_token");

    if(!admin_token){

        alert("يجب تسجيل دخول الإدارة أولاً");

        return;

    }

    let {data, error} =

    await supabaseClient
    .rpc("admin_play_character", {

        p_admin_token: admin_token,

        p_character_id: characterId

    })
    .single();

    if(error || !data){

        alert(error ? error.message : "تعذّر تشغيل الشخصية");

        return;

    }

    localStorage.setItem("player_id", data.player_id);

    // رمز الجلسة الآن يُعاد مباشرة ضمن admin_play_character نفسها (بعد أن
    // أثبتت هويتك عبر admin_token)، بدل نداء منفصل إلى create_player_session
    // كان بإمكان أي شخص يملك anon key استدعاءه بأي player_id لانتحال أي
    // حساب آخر — بما فيها حسابات اللاعبين العاديين.
    if(!data.player_token){

        alert("تعذّر إنشاء جلسة اللعب بهذه الشخصية، حاول مرة أخرى");

        return;

    }

    localStorage.setItem("player_token", data.player_token);

    localStorage.setItem("username", "🛠️ وضع الأدمن");

    localStorage.setItem("character_id", characterId);

    localStorage.setItem("character_name", data.character_name);

    alert("جاري اللعب بـ " + data.character_name);

    updatePlayerInfo();

    openScreen("home-screen");

}



// ========================================
// تحميل لوحة الأدمن
// ========================================

let adminCharactersCache = [];


async function loadAdminPanel() {
    
    let box =
        document.getElementById("admin-content");

    let monsterBox =
        document.getElementById("admin-monsters-content");
    
    
    if (!box)
        return;
    
    
    box.innerHTML =
        "جاري تحميل لوحة الإدارة...";

    if(monsterBox) monsterBox.innerHTML = "جاري تحميل الوحوش...";
    
    
    let { data: characterList, error } =
    
    await supabaseClient
        .from("characters")
        .select("*");
    
    
    
    if (error) {
        
        console.log(error);
        
        box.innerHTML =
            "حدث خطأ في تحميل الشخصيات";
        
        return;
    }


    adminCharactersCache = characterList || [];

    // اجلب الإحصاءات المطوَّرة الحالية لكل شخصية يملكها لاعب (من
    // player_characters) وعرضها بدل قيم characters الأساسية الثابتة — حتى
    // تظهر في لوحة الأدمن نفس الأرقام المحدّثة التي يراها اللاعب.
    try {
        let { data: statRows } =
        await supabaseClient
        .rpc("admin_get_current_character_stats", {
            p_admin_token: localStorage.getItem("admin_token")
        });
        let statMap = {};
        (statRows || []).forEach(s => { statMap[s.character_id] = s; });
        adminCharactersCache = adminCharactersCache.map(c => {
            let s = statMap[c.id];
            if(!s) return c;
            return Object.assign({}, c, {
                current_level: s.level,
                current_hp: s.hp,
                current_atk: s.atk
            });
        });
    }catch(e){
        console.log("admin current character stats error", e);
    }


    let realCharacters = adminCharactersCache.filter(c => !c.is_monster);

    let monsters = adminCharactersCache.filter(c => c.is_monster);


    box.innerHTML = renderAdminCharacterCards(realCharacters, "لا توجد شخصيات بعد");

    if(monsterBox){

        monsterBox.innerHTML = renderAdminCharacterCards(monsters, "لا توجد وحوش بعد");

    }
    
}


// يعيد تحميل كل قوائم الشخصيات المعتمدة على قاعدة البيانات دفعة واحدة
// بعد أي إضافة أو تعديل أو حذف، حتى لا تضطر إلى الخروج والعودة لترى التغييرات
async function refreshAdminViews(){
    loadAdminPanel();
    loadAdminMyCharacters();
    loadAvailableCharacters();
    populateDungeonMonsterSelect();
    // إلغاء كاش قائمة الوحوش حتى يظهر الوحش الجديد فورًا في قسم PvE
    GameCache.clear("monster_list");
    loadMonsterList();
}


// حمّالة تبويب التطوير (تُعبَّأ بالكامل في خطوة نظام التطوير بالذهب)
async function loadAdminUpgradeConfig(){
    let box = document.getElementById("admin-upgrade-content");
    if(!box) return;
    box.innerHTML = "جاري التحميل...";
    let admin_token = localStorage.getItem("admin_token");
    try {
        let { data: config, error: cErr } = await supabaseClient.rpc("admin_get_game_config", { p_admin_token: admin_token });
        if(cErr) throw cErr;
        let { data: costs, error: kErr } = await supabaseClient.rpc("admin_get_level_costs", { p_admin_token: admin_token });
        if(kErr) throw kErr;

        let cfgRows = "";
        (config || []).forEach(c => {
            cfgRows += `
                <div class="admin-player-gold-edit">
                    <span>${escapeHtml(c.label)}</span>
                    <input id="cfg-${c.config_key}" type="number" min="0" value="${c.config_value}" style="flex:1;">
                    <button type="button" onclick="saveGameConfig('${c.config_key}')">💾 حفظ</button>
                </div>`;
        });

        let costRows = "";
        // نعرض المستويات حتى الحد الأقصى فقط، دون حذف أي سجل محفوظ
        // (تُخزَّن قيم المستويات الأعلى وتعود للظهور لو رُفع الحد لاحقًا).
        let maxLevel = 50;
        (config || []).forEach(c => {
            if(c.config_key === "max_level") maxLevel = Number(c.config_value) || 50;
        });
        (costs || []).filter(r => Number(r.level) <= Number(maxLevel)).forEach(r => {
            let reward = r.skill_reward === "normal" ? "normal" : (r.skill_reward === "unique" ? "unique" : "none");
            costRows += `
                <div class="admin-player-gold-edit">
                    <span>المستوى ${r.level} ← ${r.level + 1}</span>
                    <input id="cost-${r.level}" type="number" min="0" value="${r.gold_cost}" style="width:120px;">
                    <label style="display:flex; align-items:center; gap:4px; flex:1;">
                        مكافأة المهارة
                        <select id="reward-${r.level}" style="flex:1;">
                            <option value="none"${reward === "none" ? " selected" : ""}>بدون</option>
                            <option value="normal"${reward === "normal" ? " selected" : ""}>عادية (اللاعب يختار هجوم/دفاع)</option>
                            <option value="unique"${reward === "unique" ? " selected" : ""}>فريدة (الأدمن يختار النوع)</option>
                        </select>
                    </label>
                    <button type="button" onclick="saveLevelCost(${r.level})">💾 حفظ الذهب</button>
                    <button type="button" onclick="saveLevelSkillReward(${r.level})">💾 حفظ المكافأة</button>
                </div>`;
        });

        box.innerHTML = `
            <p>إعدادات الترقية بالذهب والحدود اليومية (تُدرَّج بالصعود لكل مستوى). الحقل بمعنى "الذهب المطلوب للصعود من مستوى إلى التالي". مكافأة المهارة تحدد ما يستلمه اللاعب عند بلوغ المستوى التالي.</p>
            <div class="form-box">${cfgRows}</div>
            <h4>تكلفة الذهب ومكافأة المهارة لكل مستوى</h4>
            <div class="form-box">${costRows}</div>`;
    } catch(e) {
        box.innerHTML = "حدث خطأ في تحميل الإعدادات";
    }
}

async function saveGameConfig(key){
    let el = document.getElementById("cfg-" + key);
    let value = el ? (parseInt(el.value) || 0) : 0;
    let { error } = await supabaseClient.rpc("admin_set_game_config", {
        p_admin_token: localStorage.getItem("admin_token"),
        p_key: key,
        p_value: value
    });
    if(error){ alert(error.message); return; }
    alert("تم الحفظ");
    loadAdminUpgradeConfig();
}

async function saveLevelCost(level){
    let el = document.getElementById("cost-" + level);
    let value = el ? (parseInt(el.value) || 0) : 0;
    let { error } = await supabaseClient.rpc("admin_set_level_cost", {
        p_admin_token: localStorage.getItem("admin_token"),
        p_level: level,
        p_gold_cost: value
    });
    if(error){ alert(error.message); return; }
    alert("تم الحفظ");
    loadAdminUpgradeConfig();
}

// يحفظ نوع مكافأة المهارة لمستوى محدد (بدون / عادية / فريدة)
async function saveLevelSkillReward(level){
    let el = document.getElementById("reward-" + level);
    let value = el ? el.value : "none";
    let { error } = await supabaseClient.rpc("admin_set_level_skill_reward", {
        p_admin_token: localStorage.getItem("admin_token"),
        p_level: level,
        p_skill_reward: value
    });
    if(error){ alert(error.message); return; }
    alert("تم حفظ المكافأة");
    loadAdminUpgradeConfig();
}


// تبويب المهارات: يعرض طلبات المهارات المعلّقة من اللاعبين ليقرّر
// الأدمن قبولها (تُنشئ مهارة تُربط بالشخصية تلقائيًا) أو رفضها.
async function loadAdminSkillRules(){
    let box = document.getElementById("admin-skill-rules-content");
    if(!box) return;
    box.innerHTML = "جاري تحميل طلبات المهارات...";

    let admin_token = localStorage.getItem("admin_token");
    if(!admin_token){
        box.innerHTML = "يجب تسجيل دخول الأدمن أولاً.";
        return;
    }

    try{

        let {data:reqs, error} =
        await supabaseClient.rpc("admin_list_skill_requests", { p_admin_token: admin_token });

        if(error) throw error;

        let all = reqs || [];
        let pending = all.filter(r => r.status === "pending");

        if(pending.length === 0){
            box.innerHTML =
                '<p class="admin-hint">لا توجد طلبات مهارات معلّقة الآن.' +
                (all.length ? ` تمت معالجة ${all.length} طلب سابقًا.` : "") + '</p>';
            return;
        }

        box.innerHTML =
            '<p class="admin-hint">طلبات مهارات معلّقة من اللاعبين. عند الموافقة تُنشأ مهارة جديدة وتُربط بالشخصية تلقائيًا.</p>' +
            pending.map(renderSkillRequestCard).join("");

    }catch(e){
        console.error(e);
        box.innerHTML = "حدث خطأ في تحميل الطلبات";
    }
}

// يُحدّث شارة عدد طلبات المهارات المعلقة على زر "المهارات" في لوحة الإدارة
async function updateSkillOrderBadge(){
    let badge = document.getElementById("admin-skill-order-count");
    if(!badge) return;
    let admin_token = localStorage.getItem("admin_token");
    if(!admin_token){ badge.style.display = "none"; return; }
    try{
        let {data:reqs, error} = await supabaseClient.rpc("admin_list_skill_requests", { p_admin_token: admin_token });
        if(error) throw error;
        let pending = (reqs || []).filter(r => r.status === "pending").length;
        badge.textContent = pending;
        badge.style.display = pending > 0 ? "inline-block" : "none";
    }catch(e){
        console.error(e);
        badge.style.display = "none";
    }
}

// تحديث دوري للشارة كي تظهر الطلبات الجديدة دون إعادة فتح اللوحة
setInterval(updateSkillOrderBadge, 20000);

// يحوّل اختيار نوع المهارة إلى المعامل effect المطلوب لإنشاء المهارة
function typeChoiceToEffect(choice){
    switch(choice){
        case "attack":
        case "defense":
            return null;
        case "unblockable":
            return null;
        default:
            return choice;
    }
}

// يعرض بطاقة لطلب مهارة معلق مع نموذج الموافقة
function renderSkillRequestCard(r){
    let isNormal = r.reward_type === "normal";
    let lockedType = r.skill_type === "defense" ? "defense" : "attack";
    let typeSelectHtml = isNormal
        ? `<span class="admin-hint">${r.skill_type === "defense" ? "🛡️ دفاع" : "⚔️ هجوم عادي"} (مقفل من اختيار اللاعب)</span>`
        : `<select id="sk-req-type-${r.request_id}">${skillTypeOptionsHtml()}</select>`;
    let typeLabel = isNormal
        ? (r.skill_type === "defense" ? "🛡️ دفاع" : "⚔️ هجوم عادي")
        : r.skill_type || "متقدم";
    let damagePh = isNormal ? (lockedType === "defense" ? 0 : 150) : 0;

    return `
    <div class="admin-card" id="sk-req-card-${r.request_id}" style="margin-bottom:10px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
            <strong>مهارة لشخصية: ${escapeHtml(r.character_name || "")}</strong>
            <span class="admin-hint">بواسطة ${escapeHtml(r.username || "")}</span>
        </div>
        <div class="admin-hint">
            النوع المطلوب: ${typeLabel} · المستوى ${Number(r.level) || 0} · ${new Date(r.created_at).toLocaleString()}
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:6px;">
            <input type="text" id="sk-req-name-${r.request_id}" placeholder="اسم المهارة">
            <input type="number" id="sk-req-damage-${r.request_id}" value="${damagePh}" placeholder="الضرر">
            <input type="number" id="sk-req-cooldown-${r.request_id}" value="0" placeholder="التهدئة">
            ${typeSelectHtml}
            <label style="display:flex; align-items:center; gap:6px;">
                <input id="sk-req-unblockable-${r.request_id}" type="checkbox">
                💥 لا تُصد
            </label>
        </div>
        <div style="margin-top:8px;">
            <button class="admin-btn" onclick="approveSkillRequest('${r.request_id}')">✅ اعتماد</button>
            <button class="admin-btn" style="background:#7f1d1d;" onclick="denySkillRequest('${r.request_id}')">❌ رفض</button>
        </div>
    </div>`;
}

// اعتماد طلب مهارة: ينشئ المهارة ويربطها بالشخصية
async function approveSkillRequest(requestId){
    let admin_token = localStorage.getItem("admin_token");
    let name = document.getElementById("sk-req-name-" + requestId).value.trim();
    if(!name){ alert("اكتب اسم المهارة"); return; }

    let damage = Number(document.getElementById("sk-req-damage-" + requestId).value) || 0;
    let cooldown = Number(document.getElementById("sk-req-cooldown-" + requestId).value) || 0;
    let typeEl = document.getElementById("sk-req-type-" + requestId);
    let type = typeEl ? typeEl.value : null;
    let unblockable = document.getElementById("sk-req-unblockable-" + requestId).checked;

    if(unblockable){
        type = "attack";
    }

    let effect = (type === "unblockable") ? null : typeChoiceToEffect(type);

    let {error} = await supabaseClient.rpc("admin_approve_skill_request", {
        p_admin_token: admin_token,
        p_request_id: requestId,
        p_name: name,
        p_type: type,
        p_damage: damage,
        p_cooldown: cooldown,
        p_effect: effect,
        p_unblockable: !!unblockable
    });

    if(error){ alert(error.message); return; }

    alert("تم اعتماد المهارة وربطها بالشخصية");

    // أعد ضبط كاشات مهارات الشخصيات كي تُظهر المهارة الجديدة فورًا
    try{
        let keysToRemove = [];
        for(let i = 0; i < localStorage.length; i++){
            let k = localStorage.key(i);
            if(k && k.indexOf("character_skills_") !== -1) keysToRemove.push(k);
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
    }catch(e){ /* تجاهل */ }

    loadAdminSkillRules();
    updateSkillOrderBadge();
}

// رفض طلب مهارة
async function denySkillRequest(requestId){
    let admin_token = localStorage.getItem("admin_token");
    let {error} = await supabaseClient.rpc("admin_deny_skill_request", {
        p_admin_token: admin_token,
        p_request_id: requestId
    });
    if(error){ alert(error.message); return; }
    alert("تم رفض الطلب");
    loadAdminSkillRules();
    updateSkillOrderBadge();
}


function renderAdminCharacterCards(list, emptyMessage){

    if(!list || list.length === 0){

        return `<p>${emptyMessage}</p>`;

    }

    let html = "";

    list.forEach(character => {

        // أسماء الشخصيات/الأنمي من قاعدة البيانات — تُهرب قبل العرض (XSS)
        let safeName = escapeHtml(character.name);

        let safeAnime = escapeHtml(character.anime);

        html += `

        <div class="admin-character-card">

            <div class="admin-thumb-wrap">
                <img class="admin-thumb" src="${escapeHtml(character.identity_image || '')}" onerror="this.style.visibility='hidden'">
            </div>

            <div class="admin-character-info">

                <h3>${safeName}</h3>

                <p class="admin-character-anime">${safeAnime}</p>

                <p class="admin-character-stats">❤️ ${character.current_hp != null ? character.current_hp : (character.hp || 0)} &nbsp;·&nbsp; ⚔️ ${character.current_atk != null ? character.current_atk : (character.atk || 0)} &nbsp;·&nbsp; LV ${character.current_level != null ? character.current_level : (character.level || 1)}</p>

                <p class="admin-character-owner">${character.admin_only ? "🔒 خاصة بالأدمن" : (character.is_monster ? "👹 وحش PvE" : (character.owner_id ? "🔴 مأخوذة (لدى لاعب)" : "🟢 متاحة للاختيار"))}</p>

            </div>

            <div class="admin-character-actions">

                ${character.admin_only ? `<button onclick="playAdminCharacter('${character.id}')">🎮 العب بها</button>` : ""}

                <button onclick="openEditCharacterModal('${character.id}')">✏️ تعديل</button>

                <button onclick="deleteCharacter('${character.id}')">🗑️ حذف</button>

            </div>

        </div>

        `;

    });

    return html;

}



// ========================================
// رفع صورة شخصية من الجهاز (Supabase Storage)
// ========================================

async function uploadCharacterImage(fileInputId, textInputId, statusId, cropOptions){

    let fileInput = document.getElementById(fileInputId);

    let textInput = document.getElementById(textInputId);

    let statusBox = document.getElementById(statusId);

    let file = fileInput ? fileInput.files[0] : null;

    if(!file) return;


    let adminToken = localStorage.getItem("admin_token");

    if(!adminToken){

        if(statusBox) statusBox.textContent = "❌ يجب تسجيل الدخول كأدمن لرفع صورة";

        return;

    }


    // إذا طُلب الاقتصاص، اعرض نافذة الاقتصاص أولًا، وعند التأكيد نرفع النتيجة
    if(cropOptions && cropOptions.crop !== false){

        try{

            let croppedBlob = await openCropModal(file, cropOptions);

            if(!croppedBlob) return; // أُلغيت

            file = new File([croppedBlob], file.name, { type: croppedBlob.type || file.type });

        }catch(e){

            console.log("فشل الاقتصاص", e);

            if(statusBox) statusBox.textContent = "❌ فشل معالجة الصورة: " + (e && e.message || e);

            return;

        }

    }


    if(statusBox) statusBox.textContent = "⏳ جاري رفع الصورة...";


    // نضع رمز جلسة الأدمن كأول جزء من مسار الملف؛ سياسة التخزين على
    // الخادم تتحقق من صلاحية هذا الرمز فعليًا قبل قبول أي رفع (بدل السماح
    // للجميع بالرفع كما كان سابقًا)
    let safeName =
    adminToken + "/" + Date.now() + "_" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");


    let {error:uploadError} =

    await supabaseClient
    .storage
    .from("character-images")
    .upload(safeName, file, {

        cacheControl: "3600",

        upsert: false

    });


    if(uploadError){

        // خطأ RLS من سياسة التخزين يعني عادة أن رمز جلسة الأدمن انتهت صلاحيته
        // (الجلسات صالحة ساعتين فقط). نعرض رسالة واضحة بدل رسالة البوليصة
        // التقنية التي لا تفيد الأدمن، ونطلب منه إعادة تسجيل الدخول.
        let message = String(uploadError.message || "");

        let isRls = message.includes("row-level security policy")
                 || message.includes("row security policy")
                 || message.includes("Rls")
                 || (uploadError.code && String(uploadError.code) === "42501");

        if(isRls){
            if(statusBox) statusBox.textContent = "❌ انتهت صلاحية جلسة الإدارة، سجّل الدخول من جديد ثم أعد الرفع";
            setTimeout(() => logout(), 2500);
            return;
        }

        if(statusBox) statusBox.textContent = "❌ فشل الرفع: " + uploadError.message;

        return;

    }


    let {data} =

    supabaseClient
    .storage
    .from("character-images")
    .getPublicUrl(safeName);


    textInput.value = data.publicUrl;

    if(statusBox) statusBox.textContent = "✅ تم رفع الصورة بنجاح";

    if(fileInput) fileInput.value = "";

}


// ========================================
// نافذة الاقتصاص (قصّ الصورة داخل اللعبة)
// ========================================
//
// تُعرض الصورة داخل نافذة مع صندوق قصّ يمكن سحبه وتغيير حجمه والحفاظ على
// نسبة أبعاد محددة. عند التأكيد تُرجع الصورة المقتصَّة كـ Blob.

let _cropState = null;

function openCropModal(file, options){

    options = options || {};

    return new Promise(function(resolve, reject){

        let url = URL.createObjectURL(file);

        let img = new Image();

        img.onload = function(){

            // أبعاد الشاشة الفعلية لعرض النافذة
            let viewW = Math.min(window.innerWidth - 40, 440);

            let viewH = Math.min(window.innerHeight - 180, 480);

            // نسبة الأبعاد المطلوبة للقص (افتراضي 1:1 مربّع)
            let aspect = options.aspectRatio || 1;

            let cropW = 220;

            let cropH = cropW / aspect;

            if(cropH > viewH - 120){ cropH = viewH - 120; cropW = cropH * aspect; }

            // مقياس العرض داخل النافذة مع مساحة بيضاء (عرض) ومساحة بيضاء (ارتفاع)
            let fitScale = Math.min((viewW - 24) / img.width, (viewH - 24) / img.height);

            let dispW = Math.round(img.width * fitScale);

            let dispH = Math.round(img.height * fitScale);

            _cropState = {
                img: img,
                file: file,
                dispW: dispW,
                dispH: dispH,
                scale: fitScale,
                aspect: aspect,
                cropW: cropW,
                cropH: cropH,
                cropX: Math.round((dispW - cropW) / 2),
                cropY: Math.round((dispH - cropH) / 2),
                imgOffX: 0,
                imgOffY: 0,
                zoom: 1,
                resolve: resolve,
                reject: reject
            };

            buildCropModal(_cropState);

            URL.revokeObjectURL(url);

        };

        img.onerror = function(){ reject(new Error("تعذّر قراءة الصورة")); };

        img.src = url;

    });

}


function buildCropModal(state){

    let existing = document.getElementById("crop-modal");

    if(existing) existing.remove();

    let modal = document.createElement("div");

    modal.id = "crop-modal";

    modal.className = "crop-modal";

    modal.innerHTML =
        "<div class=\"crop-modal-box\">" +
            "<h2>قصّ الصورة</h2>" +
            "<div class=\"crop-stage\" id=\"crop-stage\">" +
                "<canvas id=\"crop-canvas\"></canvas>" +
                "<div class=\"crop-box\" id=\"crop-box\">" +
                    "<div class=\"crop-box-hint\"></div>" +
                    "<span class=\"crop-handle crop-nw\"></span>" +
                    "<span class=\"crop-handle crop-ne\"></span>" +
                    "<span class=\"crop-handle crop-sw\"></span>" +
                    "<span class=\"crop-handle crop-se\"></span>" +
                "</div>" +
            "</div>" +
            "<div class=\"crop-toolbar\">" +
                "<label>النسبة:</label>" +
                "<select id=\"crop-aspect\">" +
                    "<option value=\"1\">مربّع 1:1</option>" +
                    "<option value=\"1.25\">4:5 (عمودي)</option>" +
                    "<option value=\"0.75\">3:4 (رأسي)</option>" +
                    "<option value=\"1.78\">16:9 (عريض)</option>" +
                "</select>" +
                "<button id=\"crop-zoom-in\">+ تكبير</button>" +
                "<button id=\"crop-zoom-out\">− تصغير</button>" +
            "</div>" +
            "<div class=\"crop-actions\">" +
                "<button id=\"crop-confirm\" class=\"crop-confirm-btn\">تأكيد</button>" +
                "<button id=\"crop-cancel\" class=\"crop-cancel-btn\">إلغاء</button>" +
            "</div>" +
        "</div>";

    document.body.appendChild(modal);

    let stage = document.getElementById("crop-stage");

    let canvas = document.getElementById("crop-canvas");

    canvas.width = state.dispW;

    canvas.height = state.dispH;

    stage.style.width = state.dispW + "px";

    stage.style.height = state.dispH + "px";

    let box = document.getElementById("crop-box");

    box.style.width = state.cropW + "px";

    box.style.height = state.cropH + "px";

    box.style.left = state.cropX + "px";

    box.style.top = state.cropY + "px";

    box.style.display = "block";

    drawCropCanvas(state);

    let aspectSel = document.getElementById("crop-aspect");

    aspectSel.value = String(state.aspect);

    aspectSel.addEventListener("change", function(){
        applyAspect(state, parseFloat(aspectSel.value));
    });

    document.getElementById("crop-zoom-in")
        .addEventListener("click", function(){ setCropZoom(state, state.zoom + 0.25); });

    document.getElementById("crop-zoom-out")
        .addEventListener("click", function(){ setCropZoom(state, state.zoom - 0.25); });

    document.getElementById("crop-confirm")
        .addEventListener("click", function(){ confirmCrop(state); });

    document.getElementById("crop-cancel")
        .addEventListener("click", function(){
            let m = document.getElementById("crop-modal");
            if(m) m.remove();
            state.reject(new Error("أُلغيت"));
        });

    // تفاعلات السحب على الصندوق والمقابض
    setupCropDrag(state, box);

}


function drawCropCanvas(state){

    let canvas = document.getElementById("crop-canvas");

    if(!canvas) return;

    let ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // رسم الصورة مع نسبة الزوم المطبق
    let drawW = state.dispW * state.zoom;

    let drawH = state.dispH * state.zoom;

    let drawX = (state.dispW - drawW) / 2 + state.imgOffX;

    let drawY = (state.dispH - drawH) / 2 + state.imgOffY;

    ctx.drawImage(state.img, drawX, drawY, drawW, drawH);

    // عتامة خارج صندوق القص
    ctx.fillStyle = "rgba(0,0,0,0.6)";

    ctx.beginPath();

    ctx.rect(0, 0, canvas.width, canvas.height);

    ctx.rect(state.cropX, state.cropY, state.cropW, state.cropH);

    ctx.fill("evenodd");

}


function setupCropDrag(state, box){

    let stage = document.getElementById("crop-stage");

    let canvas = document.getElementById("crop-canvas");

    let dragging = null;

    function toStageCoords(e){
        let r = stage.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function clampBox(){
        state.cropX = Math.max(0, Math.min(state.dispW - state.cropW, state.cropX));
        state.cropY = Math.max(0, Math.min(state.dispH - state.cropH, state.cropY));
    }

    // سحب الصندوق (تحريك موضعه)
    box.addEventListener("pointerdown", function(e){
        e.preventDefault();
        dragging = { type: "move", sx: e.clientX, sy: e.clientY, ox: state.cropX, oy: state.cropY };
        box.setPointerCapture(e.pointerId);
    });

    // مقابض تغيير الحجم
    ["nw", "ne", "sw", "se"].forEach(function(handle){
        let el = box.querySelector(".crop-handle.crop-" + handle);
        el.addEventListener("pointerdown", function(e){
            e.preventDefault();
            e.stopPropagation();
            dragging = { type: "resize", handle: handle, sx: e.clientX, sy: e.clientY,
                         ox: state.cropX, oy: state.cropY, ow: state.cropW, oh: state.cropH };
            el.setPointerCapture(e.pointerId);
        });
    });

    stage.addEventListener("pointermove", function(e){
        if(!dragging) return;
        let dx = e.clientX - dragging.sx;
        let dy = e.clientY - dragging.sy;

        if(dragging.type === "move"){
            state.cropX = dragging.ox + dx;
            state.cropY = dragging.oy + dy;
            clampBox();
        }else if(dragging.type === "resize"){
            let aspect = state.aspect;
            // الحجم الجديد يُقيَّد بنسبة الأبعاد
            let newW = dragging.ow;
            let newH = dragging.oh;
            if(dragging.handle.indexOf("e") !== -1){ newW = dragging.ow + dx; }
            if(dragging.handle.indexOf("s") !== -1){ newH = dragging.oh + dy; }
            if(dragging.handle.indexOf("w") !== -1){ newW = dragging.ow - dx; }
            if(dragging.handle.indexOf("n") !== -1){ newH = dragging.oh - dy; }

            newW = Math.max(40, Math.min(state.dispW, newW));
            let hByAspect = newW / aspect;
            if(hByAspect > state.dispH){ hByAspect = state.dispH; newW = hByAspect * aspect; }
            newH = hByAspect;
            if(newH < 40){ newH = 40; newW = newH * aspect; if(newW > state.dispW) newW = state.dispW; }

            state.cropW = newW;
            state.cropH = newH;

            // إبقاء الحواف المثبّتة (nw/sw تثبّت اليمين، ne/se تثبّت اليسار...)
            if(dragging.handle.indexOf("e") !== -1){
                // يثبّت اليسار: اليسار = ox
                state.cropX = dragging.ox;
            }else if(dragging.handle.indexOf("w") !== -1){
                state.cropX = dragging.ox + dragging.ow - newW;
            }
            if(dragging.handle.indexOf("s") !== -1){
                state.cropY = dragging.oy;
            }else if(dragging.handle.indexOf("n") !== -1){
                state.cropY = dragging.oy + dragging.oh - newH;
            }
            clampBox();
        }

        applyCropBox(state);
    });

    function endDrag(e){
        dragging = null;
    }

    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);

}


function applyCropBox(state){

    let box = document.getElementById("crop-box");

    if(!box) return;

    box.style.left = state.cropX + "px";

    box.style.top = state.cropY + "px";

    box.style.width = state.cropW + "px";

    box.style.height = state.cropH + "px";

    drawCropCanvas(state);

}


function applyAspect(state, aspect){

    state.aspect = aspect;

    // تحويل الصندوق الحالي مع الحفاظ على المنتصف
    let cx = state.cropX + state.cropW / 2;

    let cy = state.cropY + state.cropH / 2;

    let newW = state.cropW;

    let newH = newW / aspect;

    if(newH > state.dispH){ newH = state.dispH; newW = newH * aspect; }
    if(newW > state.dispW){ newW = state.dispW; newH = newW / aspect; }
    if(newH < 40){ newH = 40; newW = newH * aspect; if(newW > state.dispW) newW = state.dispW; }

    state.cropW = newW;

    state.cropH = newH;

    state.cropX = Math.round(cx - newW / 2);

    state.cropY = Math.round(cy - newH / 2);

    state.cropX = Math.max(0, Math.min(state.dispW - state.cropW, state.cropX));

    state.cropY = Math.max(0, Math.min(state.dispH - state.cropH, state.cropY));

    applyCropBox(state);

}


function setCropZoom(state, zoom){

    state.zoom = Math.max(1, Math.min(3, zoom));

    state.imgOffX = 0;

    state.imgOffY = 0;

    drawCropCanvas(state);

}


function confirmCrop(state){

    let canvas = document.createElement("canvas");

    let outW = 800;

    let outH = Math.round(outW / state.aspect);

    canvas.width = outW;

    canvas.height = outH;

    let ctx = canvas.getContext("2d");

    // نسبة أبعاد المعاينة إلى الصورة الأصلية
    let sx = (state.cropX - ((state.dispW - state.dispW * state.zoom) / 2 + state.imgOffX)) / (state.dispW * state.zoom) * state.img.width;
    let sy = (state.cropY - ((state.dispH - state.dispH * state.zoom) / 2 + state.imgOffY)) / (state.dispH * state.zoom) * state.img.height;
    let sw = state.cropW / (state.dispW * state.zoom) * state.img.width;
    let sh = state.cropH / (state.dispH * state.zoom) * state.img.height;

    ctx.drawImage(state.img, sx, sy, sw, sh, 0, 0, outW, outH);

    let m = document.getElementById("crop-modal");

    if(m) m.remove();

    canvas.toBlob(function(blob){
        if(blob){
            state.resolve(blob);
        }else{
            state.reject(new Error("تعذّر إنشاء الصورة"));
        }
    }, "image/png");

}



// ========================================
// إدارة اللاعبين (تعديل الذهب)
// ========================================

async function loadAdminNotifications(){

    let box =
    document.getElementById("admin-notifications");

    if(!box) return;

    box.innerHTML = "جاري تحميل الإشعارات...";

    let {data:notifs, error} =

    await supabaseClient
    .rpc("admin_list_notifications", { p_admin_token: localStorage.getItem("admin_token") });

    if(error){

        console.log(error);

        box.innerHTML = "حدث خطأ في تحميل الإشعارات";

        return;

    }

    if(!notifs || notifs.length === 0){

        box.innerHTML = "لا توجد إشعارات.";

        return;

    }

    box.innerHTML = notifs.map(n => {

    let approveBtn = n.ref_request_id
        ? `<button class="admin-btn" onclick="openSkillRequestFromNotification('${n.ref_request_id}')">🗡️ اعتماد/مراجعة الطلب</button>`
        : (n.is_read ? "" : `<button class="admin-btn" onclick="markNotificationRead('${n.notification_id}')">✓ كمُقروء</button>`);

    return `
        <div class="admin-card" style="${n.is_read ? 'opacity:0.65;' : ''}">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px;">
                <div>
                    <strong>${escapeHtml(n.message || "")}</strong>
                    <div class="admin-hint">${n.category || "عام"} · ${new Date(n.created_at).toLocaleString()}</div>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    ${approveBtn}
                    ${(n.is_read || n.ref_request_id) ? "" : `<button class="admin-btn" onclick="markNotificationRead('${n.notification_id}')">✓ كمُقروء</button>`}
                </div>
            </div>
        </div>`;
    }).join("");

}

// يفتح تبويب المهارات ويركّز على بطاقة طلب المهارة المحدد لاعتمادها/تعديلها
async function openSkillRequestFromNotification(requestId){
    showAdminTab("admin-tab-rules");
    await loadAdminSkillRules();
    updateSkillOrderBadge();
    let card = document.getElementById("sk-req-card-" + requestId);
    if(card){
        card.scrollIntoView({ behavior:"smooth", block:"center" });
        card.style.outline = "2px solid #3b82ff";
        card.style.outlineOffset = "2px";
        setTimeout(() => { card.style.outline = ""; }, 4000);
    }
}

async function markNotificationRead(notificationId){

    let {error} =

    await supabaseClient
    .rpc("admin_mark_notification_read", {
        p_admin_token: localStorage.getItem("admin_token"),
        p_notification_id: notificationId
    });

    if(error){ alert(error.message); return; }

    loadAdminNotifications();

}

async function loadAdminPlayers(){

    let box =
    document.getElementById("admin-players");

    if(!box) return;

    box.innerHTML = "جاري تحميل اللاعبين...";


    let {data:players, error} =

    await supabaseClient
    .rpc("admin_list_players", { p_admin_token: localStorage.getItem("admin_token") });


    if(error){

        console.log(error);

        box.innerHTML = "حدث خطأ في تحميل اللاعبين";

        return;

    }


    if(!players || players.length === 0){

        box.innerHTML = "<p>لا يوجد لاعبون بعد</p>";

        return;

    }


    let html = "";

    players.forEach(player => {

        // اسم المستخدم من إدخال اللاعب نفسه — يُهرب قبل العرض (innerHTML)
        // وقبل إدراجه داخل onclick لمنع حقن سكربت (XSS) في لوحة الأدمن
        let username = player.username || "غير معروف";

        let safeUsername = escapeHtml(username);

        let jsSafeUsername = escapeJsAttr(username);

        html += `

        <div class="admin-player-card">

            <div class="admin-player-info">

                <h3>${safeUsername}</h3>

                <p class="admin-player-sub">${player.has_character ? "🎴 يملك شخصية" : "بدون شخصية"}</p>

                ${player.character_name
                    ? `<p class="admin-player-sub">🎭 ${escapeHtml(player.character_name)} · ⭐ LV ${player.char_level || 0} · ❤️ ${player.char_hp || 0} · ⚔️ ${player.char_atk || 0}</p>`
                    : ""}

            </div>

            <div class="admin-player-gold-edit">

                <input type="number" id="player-gold-${player.player_id}" value="${player.gold || 0}">

                <button onclick="savePlayerGold('${player.player_id}')">💾 حفظ</button>

                <button onclick="deletePlayerAdmin('${player.player_id}', '${jsSafeUsername}')" class="admin-danger-btn">🗑️ حذف</button>

            </div>

        </div>

        `;

    });


    box.innerHTML = html;

}


async function deletePlayerAdmin(playerId, username){

    let confirmed = confirm("هل أنت متأكد من حذف اللاعب \"" + username + "\"؟ لا يمكن التراجع عن هذا الإجراء، وستعود أي شخصية يملكها متاحة للاختيار من جديد.");

    if(!confirmed) return;

    let {error} =

    await supabaseClient
    .rpc("admin_delete_player", {

        p_admin_token: localStorage.getItem("admin_token"),

        p_player_id: playerId

    });

    if(error){

        alert(error.message);

        return;

    }

    loadAdminPlayers();

}


async function savePlayerGold(playerId){

    let input = document.getElementById("player-gold-" + playerId);

    let gold = Number(input.value);

    if(isNaN(gold) || gold < 0){

        alert("اكتب رقمًا صحيحًا للذهب");

        return;

    }


    let admin_token = localStorage.getItem("admin_token");

    let {error} =

    await supabaseClient
    .rpc("admin_set_player_gold", {

        p_admin_token: admin_token,

        p_player_id: playerId,

        p_gold: gold

    });


    if(error){

        alert(error.message);

        return;

    }


    alert("تم تحديث الذهب");

    updatePlayerInfo();

}



// ========================================
// تعديل شخصية موجودة (بيانات + صورة + مهاراتها)
// ========================================

async function loadCharacterSkillsForAdmin(character_id){

    let {data, error} =

    await supabaseClient
    .from("character_skills")
    .select(`

        slot,

        skills (*)

    `)
    .eq("character_id", character_id)
    .order("slot");

    if(error || !data) return [];

    return data
    .filter(row => row.skills)
    .map(row => ({...row.skills, slot: row.slot}));

}


// يقرأ خلفيات صفحات المهارات مباشرة من قاعدة البيانات (بدون كاش) لتعرض
// آخر قيمة محفوظة في لوحة الإدارة فورًا عند فتح نافذة التعديل
async function loadSkillPageBackgroundsForAdmin(character_id){

    let {data, error} =

    await supabaseClient
    .from("character_skill_page_backgrounds")
    .select("page_index, image_url, skill_scale")
    .eq("character_id", character_id);

    if(error || !data) return {};

    let map = {};

    data.forEach(row => {

        map[row.page_index] = {
            url: row.image_url || "",
            scale: Number(row.skill_scale) > 0 ? Number(row.skill_scale) : 1
        };

    });

    return map;

}


// يرفع صورة خلفية صفحة مهارات من جهاز الأدمن إلى Supabase Storage ثم
// يحفظ الرابط الناتج تلقائيًا — يعيد استخدام نفس آلية رفع صور الشخصيات
// (نفس الحاوية character-images ونفس فحص رمز جلسة الأدمن على الخادم)
async function uploadPageBackground(characterId, pageIndex){

    let fileInput = document.getElementById("page-bg-file-" + pageIndex);

    let file = fileInput ? fileInput.files[0] : null;

    if(!file) return;

    // نرفع الصورة ونضع الرابط في حقل النص ثم نحفظه (مثل زر حفظ تمامًا)
    // نسبة الاقتصاص 1:1 (مربع) لتطابق حاوية العرض في شاشة المعركة التي
    // هي مربعة أيضًا (aspect-ratio: 1/1). لو اقتصصناها 16:9 (أعرض من الأطول)
    // فإن background-size: cover في الحاوية المربعة يكبّر الصورة بحيث تملأ
    // العرض ويقصّ الأعلى والأسفل، فلا تظهر إلا قطعة صغيرة من منتصف الصورة.
    await uploadCharacterImage(
        "page-bg-file-" + pageIndex,
        "page-bg-" + pageIndex,
        "page-bg-status-" + pageIndex,
        { aspectRatio: 1, crop: true }
    );

    let input = document.getElementById("page-bg-" + pageIndex);

    if(input && input.value.trim()){
        await saveSkillPageBackground(characterId, pageIndex);
    }

    // نسمح باختيار نفس الصورة مرة أخرى بعد المحاولة
    fileInput.value = "";

}


// يحفظ/يحدّث خلفية صفحة مهارات عبر دالة السيرفر الآمنة، ويمسح كاش
// المعارك لهذه الشخصية حتى يظهر التغيير في المباراة التالية مباشرة
async function saveSkillPageBackground(characterId, pageIndex){

    let input = document.getElementById("page-bg-" + pageIndex);

    let url = input ? input.value.trim() : "";

    let admin_token = localStorage.getItem("admin_token");

    let {error} =

    await supabaseClient
    .rpc("admin_set_character_skill_page_background", {

        p_admin_token: admin_token,

        p_character_id: characterId,

        p_page_index: pageIndex,

        p_image_url: url

    });

    let status = document.getElementById("page-bg-status-" + pageIndex);

    if(error){

        if(status) status.textContent = "";

        alert(error.message || "تعذر حفظ الخلفية");

        return;

    }

    if(status) status.textContent = url ? "✓ حُفظت الخلفية" : "✓ أُزيلت الخلفية";

    GameCache.clear("skill_page_bgs_" + characterId);

}


async function clearSkillPageBackground(characterId, pageIndex){

    let input = document.getElementById("page-bg-" + pageIndex);

    if(input) input.value = "";

    await saveSkillPageBackground(characterId, pageIndex);

}


// يحفظ حجم أزرار مهارات الصفحة عبر دالة السيرفر الآمنة، ويمسح كاش
// المعارك لهذه الشخصية حتى يظهر الحجم الجديد في المباراة التالية مباشرة
async function saveSkillPageScale(characterId, pageIndex){

    let input = document.getElementById("page-scale-" + pageIndex);

    let scale = input ? parseFloat(input.value) : 1;

    if(isNaN(scale) || scale <= 0) scale = 1;

    if(scale > 3) scale = 3;

    if(scale < 0.5) scale = 0.5;

    if(input) input.value = scale;

    let admin_token = localStorage.getItem("admin_token");

    let {error} =

    await supabaseClient
    .rpc("admin_set_character_skill_page_scale", {

        p_admin_token: admin_token,

        p_character_id: characterId,

        p_page_index: pageIndex,

        p_skill_scale: scale

    });

    let status = document.getElementById("page-bg-status-" + pageIndex);

    if(error){

        if(status) status.textContent = "";

        alert(error.message || "تعذر حفظ حجم المهارات");

        return;

    }

    if(status) status.textContent = "✓ حُفظ الحجم";

    GameCache.clear("skill_page_bgs_" + characterId);

}


// الشخصية المفتوحة حاليًا في نافذة التعديل — نستخدمها لمسح كاش مهاراتها
// بعد أي تعديل حتى تظهر التغييرات فورًا في ساحة المعركة
let currentEditCharacterId = null;

// مهارات وATK الشخصية المفتوحة حاليًا — تُستخدم لربط الضرر "الفعلي" القابل
// للتعديل بالضرر الأساسي (القاعدة) عند حفظ مهارات الهجوم
let currentEditSkills = [];
let currentEditAtk = 100;

async function openEditCharacterModal(characterId){

    let character = adminCharactersCache.find(c => c.id === characterId);

    if(!character) return;

    currentEditCharacterId = characterId;

    closeEditCharacterModal();

    // الإحصاءات الحالية الفعلية (بعد الترقيات من player_characters إذا كانت
    // الشخصية مملوكة) لتُعرض وتُحرَّر في نافذة التعديل، بدل قيم characters
    // الأساسية الثابتة — حتى تطابق ما يراه اللاعب في اللعبة.
    let eff = {
        level: character.current_level != null ? character.current_level : (character.level || 1),
        hp: character.current_hp != null ? character.current_hp : (character.hp || 0),
        atk: character.current_atk != null ? character.current_atk : (character.atk || 0)
    };

    let skills = await loadCharacterSkillsForAdmin(characterId);

    currentEditSkills = skills || [];
    currentEditAtk = Number(eff.atk) || 100;

    // خلفيات صفحات المهارات الحالية (كل 4 مهارات = صفحة) ليُعرض كل رابط
    // في صندوقه، ويُحدَّث فورًا عند تغييره (بدون انتظار كاش المعارك)
    let pageBgs = await loadSkillPageBackgroundsForAdmin(characterId);

    let numPages = Math.max(1, Math.ceil(skills.length / 4));

    let pageBgsHtml = Array.from({length: numPages}, (_, p) => {
        let pageSkills = skills.slice(p * 4, p * 4 + 4);
        let firstSkillColor = (pageSkills.length > 0 && pageSkills[0].color && /^#[0-9A-Fa-f]{6}$/.test(pageSkills[0].color))
            ? pageSkills[0].color
            : '#ffffff';
        return `

        <div class="admin-skill-edit-row admin-page-bg-row">

            <span class="admin-page-bg-label">🎨 صفحة ${p + 1}</span>

            <input type="text" id="page-bg-${p}" value="${escapeHtml(pageBgs[p] ? pageBgs[p].url : '')}" placeholder="رابط صورة خلفية هذه الصفحة (اختياري)">

            <button onclick="saveSkillPageBackground('${characterId}', ${p})">حفظ</button>

            <button onclick="clearSkillPageBackground('${characterId}', ${p})">🗑️</button>

            <span id="page-bg-status-${p}" class="upload-status"></span>

            <label class="admin-color-row skill-page-color-row" style="margin-top:8px;">
                🎨 لون مهارات الصفحة (يطبق على 4 مهارات)
                <input type="color" id="page-color-${p}" value="${firstSkillColor}">
            </label>

            <label class="admin-color-row skill-page-color-row">
                ✏️ لون حد مهارات الصفحة
                <input type="color" id="page-stroke-color-${p}" value="${(pageSkills.length > 0 && pageSkills[0].stroke_color && /^#[0-9A-Fa-f]{6}$/.test(pageSkills[0].stroke_color)) ? pageSkills[0].stroke_color : '#000000'}">
            </label>

            <label class="admin-color-row skill-page-color-row">
                📏 سماكة حد مهارات الصفحة
                <input type="number" id="page-stroke-width-${p}" value="${(pageSkills.length > 0) ? (pageSkills[0].stroke_width || 0) : 0}" min="0" max="10" step="0.1" style="width:60px;">
            </label>

            <label class="admin-color-row skill-page-color-row">
                🔍 حجم مهارات الصفحة (1 = عادي، 1.3 = أكبر)
                <input type="number" id="page-scale-${p}" value="${pageBgs[p] && pageBgs[p].scale ? pageBgs[p].scale : 1}" min="0.5" max="3" step="0.1" style="width:70px;" onchange="saveSkillPageScale('${characterId}', ${p})">
            </label>

            <button onclick="applyPageColor(${p})" class="admin-page-color-apply-btn">تطبيق اللون والحد على جميع المهارات</button>

            <label class="admin-page-bg-upload">
                📷 صورة من جهازي
                <input type="file" id="page-bg-file-${p}" accept="image/*" onchange="uploadPageBackground('${characterId}', ${p})">
            </label>

        </div>

    `;
    }).join("");

    // الضرر الفعلي (بعد تطبيق نظام التوسّع مع ATK الحالي) لكل مهارة هجوم،
    // ليظهر في لوحة الإدارة نفس الضرر الذي سيُلحق في المعارك فعلًا
    let scaledDamageMap = {};
    try{
        if(typeof computeScaledAttackDamages === "function" && eff.atk){
            scaledDamageMap = computeScaledAttackDamages(eff.atk, skills) || {};
        }
    }catch(e){}

    let skillsHtml = skills.length > 0
    ? skills.map(s => {
        let scaledDmg = (scaledDamageMap[s.id] !== undefined) ? scaledDamageMap[s.id] : null;
        let effectiveField = (scaledDmg !== null && s.effect !== "shadow")
            ? ` <input type="number" id="skill-effective-${s.id}" class="admin-skill-effective-input" value="${scaledDmg}" placeholder="الفعلي" onchange="syncEffectiveToBase('${s.id}')" title="الضرر الفعلي بعد التطوير (قابل للتعديل)">`
            : "";
        return `

        <div class="admin-skill-edit-row">

            <input type="text" id="skill-name-${s.id}" class="admin-skill-name-input" value="${escapeHtml(s.name || '')}" placeholder="اسم المهارة">

            <select id="skill-type-${s.id}" onchange="updateSkillNumberLabelFor('${s.id}')">
                ${skillTypeOptionsHtml(skillFieldsToTypeChoice(s))}
            </select>

            <input type="number" id="skill-damage-${s.id}" value="${s.damage || 0}" placeholder="${skillNumberFieldLabel(s)}" onchange="syncBaseToEffective('${s.id}')" style="${s.effect === 'shadow' ? 'display:none;' : ''}">

            ${effectiveField}

            <input type="number" id="skill-cooldown-${s.id}" value="${s.cooldown || 0}" placeholder="التهدئة">

            <input type="number" id="skill-poison-turns-${s.id}" value="${(s.params && s.params.poison_turns) || 2}" placeholder="عدد أدوار السُم" style="${s.effect === 'poison' ? '' : 'display:none;'}">

            <textarea id="skill-desc-${s.id}" class="admin-skill-desc-input" placeholder="وصف المهارة (يظهر عند الضغط المطوّل)">${escapeHtml(s.description || '')}</textarea>

            <input type="text" id="skill-params-${s.id}" class="admin-skill-params-input" value="${escapeHtml(JSON.stringify(s.params || {}))}" placeholder="معاملات JSON — مثل {&quot;amount&quot;:50}">

            <div id="skill-shadow-list-section-${s.id}" style="display:${s.effect === 'shadow' ? 'block' : 'none'};">
                <label style="font-weight:bold; margin-top:8px; display:block;">🌑 قائمة شخصيات الظل</label>
                <p class="admin-hint">شخصيات تظهر في قائمة الاستدعاء (تُدمج مع المهزومة)</p>
                <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px;">
                    <select id="shadow-list-dropdown-${s.id}" style="flex:1;">
                        <option value="">— اختر شخصية —</option>
                    </select>
                    <button type="button" onclick="addCharToShadowList('${s.id}', null, true)">إضافة</button>
                </div>
                <div id="shadow-list-tags-${s.id}" style="display:flex; flex-wrap:wrap; gap:4px;"></div>
            </div>

            <label class="admin-color-row skill-color-row">
                🎨 لون اسم المهارة
                <input type="color" id="skill-color-${s.id}" value="${(s.color && /^#[0-9A-Fa-f]{6}$/.test(s.color)) ? s.color : '#ffffff'}">
            </label>

            <label class="admin-color-row skill-color-row">
                ✏️ لون الحد للمهارة
                <input type="color" id="skill-stroke-color-${s.id}" value="${(s.stroke_color && /^#[0-9A-Fa-f]{6}$/.test(s.stroke_color)) ? s.stroke_color : '#000000'}">
            </label>

            <label class="admin-color-row skill-color-row">
                📏 سماكة الحد
                <input type="number" id="skill-stroke-width-${s.id}" value="${s.stroke_width || 0}" min="0" max="10" step="0.1" style="width:60px;">
            </label>

            <button onclick="saveSkillEdit('${s.id}')">حفظ</button>

            <button onclick="removeSkillFromCharacter('${characterId}','${s.id}')">🗑️</button>

        </div>

        `;
    }).join("")
    : "<p>لا توجد مهارات مرتبطة بهذه الشخصية</p>";


    let modal = document.createElement("div");

    modal.id = "edit-character-modal";

    modal.className = "steal-modal";

    modal.innerHTML = `

        <div class="steal-modal-box admin-edit-box">

            <h3>✏️ تعديل ${character.name}</h3>

            <div class="form-box">

                <input id="edit-char-name" type="text" value="${character.name || ''}" placeholder="الاسم">

                <input id="edit-char-anime" type="text" value="${character.anime || ''}" placeholder="الأنمي">

                <input id="edit-char-image" type="text" value="${character.identity_image || ''}" placeholder="رابط الصورة (أو ارفع من الجهاز)">

                <input id="edit-char-image-file" type="file" accept="image/*" onchange="uploadCharacterImage('edit-char-image-file','edit-char-image','edit-image-status',{aspectRatio:1,crop:true})">

                <p id="edit-image-status" class="upload-status"></p>

                <input id="edit-char-hp" type="number" value="${eff.hp}" placeholder="نقاط الحياة">

                <input id="edit-char-atk" type="number" value="${eff.atk}" placeholder="قوة الهجوم">

                <input id="edit-char-level" type="number" value="${eff.level}" placeholder="المستوى">

                <input id="edit-char-power-name" type="text" value="${character.power_name || ''}" placeholder="اسم القوة الخاصة">

                <textarea id="edit-char-power-desc" placeholder="وصف القوة الخاصة">${character.power_description || ''}</textarea>

                <input id="edit-char-quote" type="text" value="${character.quote || ''}" placeholder="الاقتباس">

                <input id="edit-char-gold-prize" type="number" min="0" value="${character.gold_prize || 0}" placeholder="جائزة الذهب عند هزيمته في PvE">

                <label class="admin-checkbox-label">
                    <input id="edit-char-is-monster" type="checkbox" ${character.is_monster ? "checked" : ""}>
                    هذا وحش خاص بـ PvE
                </label>

                <label class="admin-checkbox-label">
                    <input id="edit-char-admin-only" type="checkbox" ${character.admin_only ? "checked" : ""}>
                    🔒 شخصية خاصة بي فقط
                </label>

                <label class="admin-color-row">
                    🎨 لون التوهج
                    <input id="edit-char-glow-color" type="color" value="${(character.glow_color && /^#[0-9A-Fa-f]{6}$/.test(character.glow_color)) ? character.glow_color : '#3b82ff'}">
                </label>

                <label class="admin-checkbox-label">
                    <input id="edit-char-glow-locked" type="checkbox" ${character.glow_locked ? "checked" : ""}>
                    🔒 قفل اللون (يمنع اللاعب من تغييره)
                </label>

            </div>

            <hr>

            <h4>🗡️ مهارات الشخصية</h4>

            <div class="admin-skills-edit-list">
                ${skillsHtml}
            </div>

            <hr>

            <h4>🎨 خلفيات صفحات المهارات</h4>

            <p class="admin-hint">كل صفحة تعرض حتى 4 مهارات. الرابط يظهر خلف أزرار المهارات في ساحة المعركة. اترك الرابط فارغًا ثم احفظ لإزالة الخلفية.</p>

            <div class="admin-skills-edit-list">
                ${pageBgsHtml}
            </div>

            <hr>

            <h4>➕ إضافة مهارة جديدة</h4>

            <div class="form-box admin-add-skill-form">

                <input id="new-skill-name" type="text" placeholder="اسم المهارة">

                <select id="new-skill-type" onchange="updateNewSkillNumberLabel()">
                    ${skillTypeOptionsHtml("attack")}
                </select>

                <input id="new-skill-damage" type="number" placeholder="الضرر" value="0">

                <input id="new-skill-cooldown" type="number" placeholder="التهدئة (بالأدوار)" value="0">

                <input id="new-skill-poison-turns" type="number" placeholder="عدد أدوار السُم" value="2" style="display:none;">

                <textarea id="new-skill-description" placeholder="وصف المهارة (يظهر للاعب عند الضغط المطوّل على الزر)"></textarea>

                <input id="new-skill-params" type="text" placeholder="معاملات إضافية بصيغة JSON — مثل {&quot;amount&quot;:50} (اختياري)">

                <div id="new-skill-shadow-list-section" style="display:none;">
                    <label style="font-weight:bold; margin-top:8px; display:block;">🌑 قائمة شخصيات الظل</label>
                    <p class="admin-hint">اختر شخصياتًا تظهر في قائمة استدعاء الظل لهذه المهارة (تُدمج مع الشخصيات المهزومة)</p>
                    <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px;">
                        <select id="new-skill-shadow-list-dropdown" style="flex:1;">
                            <option value="">— اختر شخصية —</option>
                        </select>
                        <button type="button" onclick="addCharToShadowList('new', null, false)">إضافة</button>
                    </div>
                    <div id="new-skill-shadow-list-tags" style="display:flex; flex-wrap:wrap; gap:4px;"></div>
                </div>

                <label class="admin-color-row skill-color-row">
                    🎨 لون اسم المهارة
                    <input id="new-skill-color" type="color" value="#ffffff">
                </label>

                <label class="admin-color-row skill-color-row">
                    ✏️ لون الحد
                    <input id="new-skill-stroke-color" type="color" value="#000000">
                </label>

                <label class="admin-color-row skill-color-row">
                    📏 سماكة الحد
                    <input id="new-skill-stroke-width" type="number" value="0" min="0" max="10" step="0.1" style="width:60px;">
                </label>

                <button onclick="addSkillToCharacter('${characterId}')">إضافة المهارة</button>

            </div>

            <div class="steal-modal-buttons">

                <button id="save-character-edit-btn">💾 حفظ التعديلات</button>

                <button id="cancel-character-edit-btn">إلغاء</button>

            </div>

        </div>

    `;

    document.querySelector("#edit-character-modal")?.remove();

    document.body.appendChild(modal);

    updateNewSkillNumberLabel();

    _initShadowListInModal();

    // Ensure damage/cooldown fields are hidden for existing shadow skills on initial render
    if(currentEditSkills){
        currentEditSkills.forEach(s => {
            if(s.effect === "shadow"){
                updateSkillNumberLabelFor(s.id);
            }
        });
    }

    document.getElementById("cancel-character-edit-btn").onclick = closeEditCharacterModal;

    document.getElementById("save-character-edit-btn").onclick = () => saveCharacterEdit(characterId);

}


// يحوّل اختيار نوع المهارة في قوائم النوع (إضافة/تعديل) إلى الحقول الفعلية
// type/effect/unblockable كما هي مخزّنة في جدول skills
function skillTypeChoiceToFields(typeChoice){

    let type = "attack";

    let effect = null;

    let unblockable = false;

    if(typeChoice === "defense"){

        type = "defense";

    } else if(typeChoice === "steal"){

        type = "special";

        effect = "steal";

    } else if(typeChoice === "copy"){

        type = "special";

        effect = "copy";

    } else if(typeChoice === "control"){

        type = "special";

        effect = "control";

    } else if(typeChoice === "unblockable"){

        type = "special";

        unblockable = true;

    } else if(typeChoice === "freeze"){

        type = "special";

        effect = "freeze";

    } else if(typeChoice === "lifesteal"){

        type = "special";

        effect = "lifesteal";

    } else if(typeChoice === "reflect"){

        type = "special";

        effect = "reflect";

    } else if(typeChoice === "seal"){

        type = "special";

        effect = "seal";

    } else if(typeChoice === "unseal"){

        type = "special";

        effect = "unseal";

    } else if(typeChoice === "consecutive_turns"){

        type = "special";

        effect = "consecutive_turns";

    } else if(typeChoice === "absorb_atk"){

        type = "special";

        effect = "absorb_atk";

    } else if(typeChoice === "absorb_hp"){

        type = "special";

        effect = "absorb_hp";

    } else if(typeChoice === "hp_boost"){

        type = "special";

        effect = "hp_boost";

    } else if(typeChoice === "atk_boost"){

        type = "special";

        effect = "atk_boost";

    } else if(typeChoice === "poison"){

        type = "special";

        effect = "poison";

    } else if(typeChoice === "delay_cooldown"){

        type = "special";

        effect = "delay_cooldown";

    } else if(typeChoice === "shadow"){

        type = "special";

        effect = "shadow";

    }

    return {type, effect, unblockable};

}


// الاتجاه المعاكس: من كائن مهارة (كما يُقرأ من قاعدة البيانات) إلى قيمة
// قائمة النوع، لعرض قائمة النوع في نموذج التعديل على قيمتها الحالية
function skillFieldsToTypeChoice(skill){

    if(skill.unblockable) return "unblockable";

    if(skill.effect === "steal") return "steal";

    if(skill.effect === "copy") return "copy";

    if(skill.effect === "control") return "control";

    if(skill.effect === "freeze") return "freeze";

    if(skill.effect === "lifesteal") return "lifesteal";

    if(skill.effect === "reflect") return "reflect";

    if(skill.effect === "seal") return "seal";

    if(skill.effect === "unseal") return "unseal";

    if(skill.effect === "consecutive_turns") return "consecutive_turns";

    if(skill.effect === "absorb_atk") return "absorb_atk";

    if(skill.effect === "absorb_hp") return "absorb_hp";

    if(skill.effect === "hp_boost") return "hp_boost";

    if(skill.effect === "atk_boost") return "atk_boost";

    if(skill.effect === "poison") return "poison";

    if(skill.effect === "delay_cooldown") return "delay_cooldown";

    if(skill.effect === "shadow") return "shadow";

    if(skill.type === "defense") return "defense";

    return "attack";

}


// خيارات قائمة نوع المهارة (مشتركة بين نموذجي الإضافة والتعديل)
function skillTypeOptionsHtml(selected){

    const options = [
        ["attack", "⚔️ هجوم عادي"],
        ["defense", "🛡️ دفاع"],
        ["steal", "🗡️ مفترس (سرقة مهارة)"],
        ["copy", "📋 نسخ (نسخ مهارة الخصم واستخدامها)"],
        ["control", "🎛️ سيطرة (استخدام مهارة الخصم وتدخل في التهدئة)"],
        ["unblockable", "💥 ضربة لا تُصد"],
        ["freeze", "🧊 تجميد (شلل دور كامل)"],
        ["lifesteal", "🩸 امتصاص (شفاء بقدر الضرر)"],
        ["reflect", "🔁 انعكاس (المرة القادمة يعكس المهاجمُ عليه هجومَه السابق)"],
        ["seal", "🔒 ختم (منع مهارة استخدمها الخصم حتى نهاية النزال)"],
        ["unseal", "🔓 فك الختم (إزالة ختم عن مهارة من مهاراتك)"],
        ["consecutive_turns", "⚡ أدوار متتالية (مهارة تعطيك أدوارًا إضافية متتالية)"],
        ["absorb_atk", "🧲 امتصاص → قوة (تحويل الضربات القادمة إلى قوة هجوم مؤقتة)"],
        ["absorb_hp", "🩵 امتصاص → شفاء (تحويل الضربات القادمة إلى صحة مسترجعة)"],
        ["hp_boost", "❤️ استرجاع الصحة (شفاء فوري دون تغيير الحد الأقصى)"],
        ["atk_boost", "⚔️ رفع القوة (قوة هجوم مؤقتة تُضاف لضرر كل ضربة)"],
        ["poison", "☠️ سُم (ضرر فوري + ضرر مستمر للأدوار التالية)"],
        ["delay_cooldown", "⏳ تأجيل التهدئة (تأخير تهدئة مهارة يملكها الخصم)"],
        ["shadow", "🌑 الظل (استدعاء مهارة شخصية من قائمة الظل المؤهلة)"]
    ];

    return options.map(([val, label]) =>
        `<option value="${val}"${val === selected ? " selected" : ""}>${label}</option>`
    ).join("");

}


function skillTypeLabel(skill){

    if(skill.unblockable) return "ضربة لا تُصد";

    if(skill.effect === "steal") return "مفترس";

    if(skill.effect === "copy") return "نسخ";

    if(skill.effect === "control") return "سيطرة";

    if(skill.effect === "freeze") return "تجميد";

    if(skill.effect === "lifesteal") return "امتصاص";

    if(skill.effect === "reflect") return "انعكاس";

    if(skill.effect === "seal") return "ختم";

    if(skill.effect === "unseal") return "فك الختم";

    if(skill.effect === "consecutive_turns") return "أدوار متتالية";

    if(skill.effect === "absorb_atk") return "امتصاص → قوة";

    if(skill.effect === "absorb_hp") return "امتصاص → صحة";

    if(skill.effect === "hp_boost") return "استرجاع الصحة";

    if(skill.effect === "atk_boost") return "رفع القوة";

    if(skill.effect === "poison") return "سُم";

    if(skill.effect === "delay_cooldown") return "تأجيل التهدئة";

    if(skill.effect === "shadow") return "الظل";

    if(skill.type === "defense") return "دفاع";

    return "هجوم";

}


// يحدّد ما يمثّله الحقل الرقمي للمهارة (بدل "الضرر" دائمًا)، لأن الضرر لا
// فائدة له في مهارات السرقة/الدفاع/التجميد — كل نوع له معنى مختلف للرقم
function skillNumberFieldLabel(skill){

    if(skill.effect === "steal") return "عدد المهارات القابلة للسرقة والاستخدام الفوري";

    if(skill.effect === "copy") return "عدد المهارات القابلة للنسخ والاستخدام الفوري";

    if(skill.effect === "control") return "عدد المهارات القابلة للسيطرة والاستخدام الفوري";

    if(skill.type === "defense") return "عدد الضربات الممكن تحمّلها";

    if(skill.effect === "freeze") return "عدد أدوار الشلل";

    if(skill.effect === "lifesteal") return "الضرر (= الشفاء)";

    if(skill.effect === "reflect") return "مضاعف ارتداد الضرر";

    if(skill.effect === "seal") return "عدد المهارات القابلة للختم (من مهارات الخصم المستخدمة)";

    if(skill.effect === "unseal") return "عدد المهارات القابلة لفك الختم عنها (من مهاراتك المختومة)";

    if(skill.effect === "consecutive_turns") return "عدد الأدوار الإضافية المتتالية (أو عيّن extra_turns في المعاملات)";

    if(skill.effect === "absorb_atk") return "عدد الضربات الممتصة (أو عيّن absorb_hits في المعاملات)";

    if(skill.effect === "absorb_hp") return "عدد الضربات الممتصة (أو عيّن absorb_hits في المعاملات)";

    if(skill.effect === "hp_boost") return "قيمة الصحة المسترجعة (أو عيّن amount في المعاملات)";

    if(skill.effect === "atk_boost") return "قيمة رفع القوة (أو عيّن amount في المعاملات)";

    if(skill.effect === "poison") return "الضرر (ضرر السُم لكل دور)";

    if(skill.effect === "delay_cooldown") return "عدد أدوار التأجيل (أو عيّن delay في المعاملات)";

    if(skill.effect === "shadow") return "لا يُستخدم (تُدار عبر قائمة الظل)";

    return "الضرر";

}


// نفس فكرة skillNumberFieldLabel لكن اعتمادًا على اختيار نوع المهارة في
// نموذج "إضافة مهارة جديدة" (قبل أن يُنشأ أي كائن مهارة فعلي)
function newSkillNumberFieldLabel(typeChoice){

    if(typeChoice === "steal") return "عدد المهارات القابلة للسرقة والاستخدام الفوري";

    if(typeChoice === "copy") return "عدد المهارات القابلة للنسخ والاستخدام الفوري";

    if(typeChoice === "control") return "عدد المهارات القابلة للسيطرة والاستخدام الفوري";

    if(typeChoice === "defense") return "عدد الضربات الممكن تحمّلها";

    if(typeChoice === "freeze") return "عدد أدوار الشلل";

    if(typeChoice === "lifesteal") return "الضرر (= الشفاء)";

    if(typeChoice === "reflect") return "مضاعف ارتداد الضرر";

    if(typeChoice === "seal") return "عدد المهارات القابلة للختم (من مهارات الخصم المستخدمة)";

    if(typeChoice === "unseal") return "عدد المهارات القابلة لفك الختم عنها (من مهاراتك المختومة)";

    if(typeChoice === "consecutive_turns") return "عدد الأدوار الإضافية المتتالية (أو عيّن extra_turns في المعاملات)";

    if(typeChoice === "absorb_atk") return "عدد الضربات الممتصة (أو عيّن absorb_hits في المعاملات)";

    if(typeChoice === "absorb_hp") return "عدد الضربات الممتصة (أو عيّن absorb_hits في المعاملات)";

    if(typeChoice === "hp_boost") return "قيمة الصحة المسترجعة (أو عيّن amount في المعاملات)";

    if(typeChoice === "atk_boost") return "قيمة رفع القوة (أو عيّن amount في المعاملات)";

    if(typeChoice === "poison") return "الضرر (ضرر السُم لكل دور)";

    if(typeChoice === "delay_cooldown") return "عدد أدوار التأجيل (أو عيّن delay في المعاملات)";

    if(typeChoice === "shadow") return "لا يُستخدم (تُدار عبر قائمة الظل)";

    return "الضرر";

}


function updateNewSkillNumberLabel(){

    let select = document.getElementById("new-skill-type");

    let input = document.getElementById("new-skill-damage");

    let poisonTurnsInput = document.getElementById("new-skill-poison-turns");

    let shadowSection = document.getElementById("new-skill-shadow-list-section");

    if(!select || !input) return;

    let isShadow = select.value === "shadow";

    input.placeholder = newSkillNumberFieldLabel(select.value);

    input.style.display = isShadow ? "none" : "";

    if(poisonTurnsInput) poisonTurnsInput.style.display = select.value === "poison" ? "" : "none";

    if(shadowSection) shadowSection.style.display = isShadow ? "" : "none";

    if(isShadow && shadowSection){
        populateShadowListDropdown("new", false);
    }

}


// نسخة لنموذج تعديل مهارة موجودة: تحدّث تسمية حقل الضرر عند تغيير نوع المهارة
function updateSkillNumberLabelFor(skillId){

    let select = document.getElementById("skill-type-" + skillId);

    let input = document.getElementById("skill-damage-" + skillId);

    let poisonTurnsInput = document.getElementById("skill-poison-turns-" + skillId);

    let shadowSection = document.getElementById("skill-shadow-list-section-" + skillId);

    if(!select || !input) return;

    let isShadow = select.value === "shadow";

    input.placeholder = newSkillNumberFieldLabel(select.value);

    input.style.display = isShadow ? "none" : "";

    if(poisonTurnsInput) poisonTurnsInput.style.display = select.value === "poison" ? "" : "none";

    if(shadowSection) shadowSection.style.display = isShadow ? "block" : "none";

    if(isShadow && shadowSection){
        populateShadowListDropdown(skillId, true);
    }

}


// يقرأ حقل المعاملات JSON (إن وُجد) ويعيد كائن params آمنًا يُمرَّر إلى
// admin_add_skill / admin_update_skill. أي صيغة خاطئة تُسقط بصمت مع {}.
function parseSkillParams(input){

    let raw = input ? input.value.trim() : "";

    if(!raw) return {};

    try{

        let obj = JSON.parse(raw);

        if(obj && typeof obj === "object" && !Array.isArray(obj)){

            return obj;

        }

        return {};

    }catch(e){

        return {};

    }

}


// ── Shadow list helpers ──
let _shadowCharsCache = null;

async function loadAllCharactersForShadow(){
    if(_shadowCharsCache) return _shadowCharsCache;
    let {data, error} = await supabaseClient
        .from("characters")
        .select("id, name, identity_image")
        .order("name");
    if(error || !data) return [];
    _shadowCharsCache = data;
    return data;
}

function _getShadowList(skillId, isEdit){
    if(isEdit){
        let skill = (currentEditSkills || []).find(s => String(s.id) === String(skillId));
        return (skill && skill.params && Array.isArray(skill.params.shadow_list)) ? skill.params.shadow_list : [];
    }
    let tagsContainer = document.getElementById("new-skill-shadow-list-tags");
    if(!tagsContainer) return [];
    return Array.from(tagsContainer.querySelectorAll("[data-char-id]")).map(el => el.dataset.charId);
}

function _saveShadowListToParams(skillId, charIds, isEdit){
    if(isEdit){
        let skill = (currentEditSkills || []).find(s => String(s.id) === String(skillId));
        if(skill){
            if(!skill.params) skill.params = {};
            skill.params.shadow_list = charIds;
        }
    }
}

async function populateShadowListDropdown(skillId, isEdit){
    let dropdownId = isEdit ? ("shadow-list-dropdown-" + skillId) : "new-skill-shadow-list-dropdown";
    let dropdown = document.getElementById(dropdownId);
    if(!dropdown) return;

    let chars = await loadAllCharactersForShadow();
    let currentList = _getShadowList(skillId, isEdit);
    let selfId = null;
    try { selfId = window.adminCharactersCache && currentEditCharacterId ? currentEditCharacterId : null; } catch(e){}

    dropdown.innerHTML = '<option value="">— اختر شخصية —</option>';
    chars.forEach(c => {
        if(selfId && String(c.id) === String(selfId)) return;
        if(currentList.includes(String(c.id))) return;
        let opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = (c.identity_image ? "🖼️ " : "") + (c.name || c.id);
        dropdown.appendChild(opt);
    });
}

async function addCharToShadowList(skillId, charId, isEdit){
    let dropdownId = isEdit ? ("shadow-list-dropdown-" + skillId) : "new-skill-shadow-list-dropdown";
    let dropdown = document.getElementById(dropdownId);
    let selectedId = charId || (dropdown ? dropdown.value : "");
    if(!selectedId) return;

    let chars = await loadAllCharactersForShadow();
    let char = chars.find(c => String(c.id) === String(selectedId));
    let charName = char ? char.name : selectedId;

    let tagsId = isEdit ? ("shadow-list-tags-" + skillId) : "new-skill-shadow-list-tags";
    let tagsContainer = document.getElementById(tagsId);
    if(!tagsContainer) return;

    // Prevent duplicates
    if(tagsContainer.querySelector(`[data-char-id="${selectedId}"]`)) return;

    let tag = document.createElement("span");
    tag.className = "admin-shadow-tag";
    tag.dataset.charId = selectedId;
    tag.style.cssText = "display:inline-flex;align-items:center;gap:4px;background:#334155;color:#e2e8f0;padding:3px 8px;border-radius:12px;font-size:13px;";
    tag.innerHTML = `${escapeHtml(charName)} <button type="button" onclick="removeCharFromShadowList('${skillId}','${selectedId}',${isEdit})" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:14px;line-height:1;">&times;</button>`;
    tagsContainer.appendChild(tag);

    if(dropdown) dropdown.value = "";
    await populateShadowListDropdown(skillId, isEdit);

    // Update hidden params field if edit mode
    if(isEdit) _syncShadowListToParamsField(skillId);
}

function removeCharFromShadowList(skillId, charId, isEdit){
    let tagsId = isEdit ? ("shadow-list-tags-" + skillId) : "new-skill-shadow-list-tags";
    let tagsContainer = document.getElementById(tagsId);
    if(!tagsContainer) return;
    let tag = tagsContainer.querySelector(`[data-char-id="${charId}"]`);
    if(tag) tag.remove();

    populateShadowListDropdown(skillId, isEdit);
    if(isEdit) _syncShadowListToParamsField(skillId);
}

function _syncShadowListToParamsField(skillId){
    let tagsId = "shadow-list-tags-" + skillId;
    let tagsContainer = document.getElementById(tagsId);
    if(!tagsContainer) return;
    let ids = Array.from(tagsContainer.querySelectorAll("[data-char-id]")).map(el => el.dataset.charId);
    let paramsInput = document.getElementById("skill-params-" + skillId);
    if(!paramsInput) return;
    let params = {};
    try { params = JSON.parse(paramsInput.value || "{}"); } catch(e){ params = {}; }
    if(ids.length > 0){
        params.shadow_list = ids;
    } else {
        delete params.shadow_list;
    }
    paramsInput.value = JSON.stringify(params);
}

function _initShadowListInModal(){
    if(!currentEditSkills) return;
    currentEditSkills.forEach(s => {
        if(s.effect === "shadow" && s.params && Array.isArray(s.params.shadow_list) && s.params.shadow_list.length > 0){
            _renderShadowListTags(s.id, s.params.shadow_list);
            populateShadowListDropdown(s.id, true);
            _syncShadowListToParamsField(s.id);
        }
    });
}

function _renderShadowListTags(skillId, charIds){
    let tagsId = "shadow-list-tags-" + skillId;
    let tagsContainer = document.getElementById(tagsId);
    if(!tagsContainer) return;
    tagsContainer.innerHTML = "";
    charIds.forEach(charId => {
        let tag = document.createElement("span");
        tag.className = "admin-shadow-tag";
        tag.dataset.charId = charId;
        tag.style.cssText = "display:inline-flex;align-items:center;gap:4px;background:#334155;color:#e2e8f0;padding:3px 8px;border-radius:12px;font-size:13px;";
        tag.innerHTML = `${escapeHtml(charId)} <button type="button" onclick="removeCharFromShadowList('${skillId}','${charId}',true)" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:14px;line-height:1;">&times;</button>`;
        tagsContainer.appendChild(tag);
    });
}


async function addSkillToCharacter(characterId){

    let name = document.getElementById("new-skill-name").value.trim();

    let typeChoice = document.getElementById("new-skill-type").value;

    let damage = Number(document.getElementById("new-skill-damage").value) || 0;

    if((typeChoice === "attack" || typeChoice === "unblockable") && damage % 50 !== 0){

        alert("ضرر مهارات الهجوم يجب أن يكون مضاعفًا للعدد 50 (مثل: 100, 150, 200...)");

        return;

    }

    let cooldown = Number(document.getElementById("new-skill-cooldown").value) || 0;

    let description = document.getElementById("new-skill-description").value.trim();

    let colorInput = document.getElementById("new-skill-color");

    let color = colorInput && colorInput.value ? colorInput.value : null;

    let strokeColorInput = document.getElementById("new-skill-stroke-color");

    let strokeColor = strokeColorInput && strokeColorInput.value ? strokeColorInput.value : null;

    let strokeWidthInput = document.getElementById("new-skill-stroke-width");

    let strokeWidth = strokeWidthInput ? Number(strokeWidthInput.value) || 0 : 0;

    let params = parseSkillParams(document.getElementById("new-skill-params"));

    // مهارات السيطرة لا تملك ضررًا (تُدار عبر عدد المهارات القابلة للسيطرة).
    // يُخزَّن العدد في control_count ضمن المعاملات ويُثبَّت الضرر على صفر.
    if(typeChoice === "control"){
        params = Object.assign({}, params, {control_count: damage});
        damage = 0;
    }

    if(typeChoice === "poison"){

        let poisonTurnsInput = document.getElementById("new-skill-poison-turns");

        let poisonTurns = Number(poisonTurnsInput ? poisonTurnsInput.value : 2) || 2;

        params = Object.assign({}, params, {poison_turns: poisonTurns});

    }

    if(typeChoice === "shadow"){
        let shadowTags = document.querySelectorAll("#new-skill-shadow-list-tags [data-char-id]");
        let shadowIds = Array.from(shadowTags).map(el => el.dataset.charId);
        if(shadowIds.length > 0){
            params = Object.assign({}, params, {shadow_list: shadowIds});
        }
    }

    if(name === ""){

        alert("اكتب اسم المهارة");

        return;

    }

    let {type, effect, unblockable} = skillTypeChoiceToFields(typeChoice);


    let admin_token = localStorage.getItem("admin_token");

    // دالة admin_add_skill الآمنة تنشئ المهارة وتربطها بالشخصية في الفتحة (slot) التالية تلقائيًا
    let {error} =

    await supabaseClient
    .rpc("admin_add_skill", {

        p_admin_token: admin_token,

        p_character_id: characterId,

        p_name: name,

        p_type: type,

        p_damage: damage,

        p_cooldown: cooldown,

        p_effect: effect,

        p_unblockable: unblockable,

        p_description: description,

        p_color: color,

        p_params: params,

        p_stroke_color: strokeColor,

        p_stroke_width: strokeWidth

    });


    if(error){

        alert(error.message);

        return;

    }


    alert("تمت إضافة المهارة");

    GameCache.clear("character_skills_" + characterId);

    openEditCharacterModal(characterId);

}


async function removeSkillFromCharacter(characterId, skillId){

    let ok = confirm("هل تريد إزالة هذه المهارة من الشخصية؟");

    if(!ok) return;

    let admin_token = localStorage.getItem("admin_token");

    let {error} =

    await supabaseClient
    .rpc("admin_remove_character_skill", {

        p_admin_token: admin_token,

        p_character_id: characterId,

        p_skill_id: skillId

    });

    GameCache.clear("character_skills_" + characterId);

    openEditCharacterModal(characterId);

}


function closeEditCharacterModal(){

    let modal = document.getElementById("edit-character-modal");

    if(modal) modal.remove();

}


async function saveCharacterEdit(characterId){

    let name = document.getElementById("edit-char-name").value.trim();

    let anime = document.getElementById("edit-char-anime").value.trim();

    let image = document.getElementById("edit-char-image").value.trim();

    let hp = Number(document.getElementById("edit-char-hp").value) || 0;

    let atk = Number(document.getElementById("edit-char-atk").value) || 0;

    let level = Number(document.getElementById("edit-char-level").value) || 1;

    let powerName = document.getElementById("edit-char-power-name").value.trim();

    let powerDesc = document.getElementById("edit-char-power-desc").value.trim();

    let quote = document.getElementById("edit-char-quote").value.trim();

    let isMonster = document.getElementById("edit-char-is-monster").checked;

    let isAdminOnly = document.getElementById("edit-char-admin-only").checked;

    let glowColor = document.getElementById("edit-char-glow-color").value;

    let glowLocked = document.getElementById("edit-char-glow-locked").checked;

    let goldEl = document.getElementById("edit-char-gold-prize");

    let goldPrize = goldEl ? (parseInt(goldEl.value) || 0) : 0;

    if(name === "" || anime === ""){

        alert("اكتب اسم الشخصية والأنمي");

        return;

    }


    // حفظ كل المهارات (الألوان، المعاملات، قوائم الظل) قبل حفظ الشخصية
    _silentlySavingSkills = true;
    await saveAllSkillEdits(characterId);
    _silentlySavingSkills = false;
    GameCache.clear("character_skills_" + characterId);
    currentEditSkills = await loadCharacterSkillsForAdmin(characterId);

    let admin_token = localStorage.getItem("admin_token");

    // دالة admin_save_character الآمنة تحدّث الشخصية (بما فيها رابط الصورة identity_image)
    // وتزامن hp/atk مع كل اللاعبين الذين يملكون هذه الشخصية حاليًا داخل نفس العملية
    let {error} =

    await supabaseClient
    .rpc("admin_save_character", {

        p_admin_token: admin_token,

        p_character_id: characterId,

        p_name: name,

        p_anime: anime,

        p_image: image,

        p_hp: hp,

        p_atk: atk,

        p_level: level,

        p_power_name: powerName,

        p_power_description: powerDesc,

        p_quote: quote,

        p_is_monster: isMonster,

        p_gold_prize: goldPrize,

        p_admin_only: isAdminOnly,

        p_glow_color: glowColor,

        p_glow_locked: glowLocked

    });


    if(error){

        alert(error.message);

        return;

    }


    alert("تم حفظ التعديلات وتحديث كل اللاعبين الذين يملكون هذه الشخصية حاليًا");

    closeEditCharacterModal();

    loadAdminPanel();

}


let _silentlySavingSkills = false;

async function saveAllSkillEdits(characterId){
    if(!currentEditSkills) return;
    for(let s of currentEditSkills){
        _silentlySavingSkills = true;
        await saveSkillEdit(s.id);
        _silentlySavingSkills = false;
    }
}


// كمّ النقاط (+50 لكل boost) الممنوح لمهارة هجوم معيّنة (بنفس منطق
// computeScaledAttackDamages) — يُستخدم لربط الضرر الفعلي بالضرر الأساسي
function scaledBoostForSkill(skillId){
    try{
        if(typeof computeScaledAttackDamages !== "function") return 0;
        const map = computeScaledAttackDamages(currentEditAtk, currentEditSkills);
        const s = (currentEditSkills || []).find(x => x.id === skillId);
        const base = s ? (Number(s.damage) || 0) : 0;
        if(map[skillId] === undefined) return 0;
        return Math.max(0, map[skillId] - base);
    }catch(e){
        return 0;
    }
}

// عند تعديل الضرر الأساسي: يُحدَّث الضرر الفعلي تلقائيًا
function syncBaseToEffective(skillId){
    const baseInp = document.getElementById("skill-damage-" + skillId);
    const effInp = document.getElementById("skill-effective-" + skillId);
    if(!baseInp || !effInp) return;
    const base = Number(baseInp.value) || 0;
    effInp.value = base + scaledBoostForSkill(skillId);
}

// عند تعديل الضرر الفعلي: يُحسب الضرر الأساسي اللازم ليُلحق ذلك القدر الفعلي
function syncEffectiveToBase(skillId){
    const baseInp = document.getElementById("skill-damage-" + skillId);
    const effInp = document.getElementById("skill-effective-" + skillId);
    if(!baseInp || !effInp) return;
    const eff = Number(effInp.value) || 0;
    const boost = scaledBoostForSkill(skillId);
    baseInp.value = Math.max(0, eff - boost);
}


async function saveSkillEdit(skillId){

    let nameInput = document.getElementById("skill-name-" + skillId);

    let typeSelect = document.getElementById("skill-type-" + skillId);

    let damageInput = document.getElementById("skill-damage-" + skillId);

    let cooldownInput = document.getElementById("skill-cooldown-" + skillId);

    let descInput = document.getElementById("skill-desc-" + skillId);

    let colorInput = document.getElementById("skill-color-" + skillId);

    let strokeColorInput = document.getElementById("skill-stroke-color-" + skillId);

    let strokeWidthInput = document.getElementById("skill-stroke-width-" + skillId);

    // For shadow skills, sync shadow list tags to params before parsing
    if(typeSelect && typeSelect.value === "shadow"){
        _syncShadowListToParamsField(skillId);
    }

    let params = parseSkillParams(document.getElementById("skill-params-" + skillId));

    let name = nameInput ? nameInput.value.trim() : "";

    let typeChoice = typeSelect ? typeSelect.value : "attack";

    if(typeChoice === "poison"){

        let poisonTurnsInput = document.getElementById("skill-poison-turns-" + skillId);

        let poisonTurns = Number(poisonTurnsInput ? poisonTurnsInput.value : 2) || 2;

        params = Object.assign({}, params, {poison_turns: poisonTurns});

    }

    if(typeChoice === "shadow"){
        let shadowTags = document.querySelectorAll("#shadow-list-tags-" + skillId + " [data-char-id]");
        let shadowIds = Array.from(shadowTags).map(el => el.dataset.charId);
        if(shadowIds.length > 0){
            params = Object.assign({}, params, {shadow_list: shadowIds});
        } else {
            delete params.shadow_list;
        }
    }

    let damage = Number(damageInput.value) || 0;

    if((typeChoice === "attack" || typeChoice === "unblockable") && damage % 50 !== 0){

        alert("ضرر مهارات الهجوم يجب أن يكون مضاعفًا للعدد 50 (مثل: 100, 150, 200...)");

        return;

    }

    // مهارات السيطرة لا تملك ضررًا (تِدار عبر عدد المهارات القابلة للسيطرة).
    // يُخزَّن العدد في control_count ضمن المعاملات ويُثبَّت الضرر على صفر.
    if(typeChoice === "control"){
        params = Object.assign({}, params, {control_count: damage});
        damage = 0;
    }

    let cooldown = Number(cooldownInput.value) || 0;

    let description = descInput ? descInput.value.trim() : "";

    let color = colorInput && colorInput.value ? colorInput.value : null;

    let strokeColor = strokeColorInput && strokeColorInput.value ? strokeColorInput.value : null;

    let strokeWidth = strokeWidthInput ? Number(strokeWidthInput.value) || 0 : 0;

    if(name === ""){

        alert("اكتب اسم المهارة");

        return;

    }

    let {type, effect, unblockable} = skillTypeChoiceToFields(typeChoice);

    let admin_token = localStorage.getItem("admin_token");

    let {error} =

    await supabaseClient
    .rpc("admin_update_skill", {

        p_admin_token: admin_token,

        p_skill_id: skillId,

        p_name: name,

        p_type: type,

        p_damage: damage,

        p_cooldown: cooldown,

        p_effect: effect,

        p_unblockable: unblockable,

        p_description: description,

        p_color: color,

        p_params: params,

        p_stroke_color: strokeColor,

        p_stroke_width: strokeWidth

    });


    if(error){

        alert(error.message);

        return;

    }


    if(!_silentlySavingSkills) alert("تم حفظ المهارة");

    if(currentEditCharacterId) GameCache.clear("character_skills_" + currentEditCharacterId);

}
// ========================================
// تحميل طلبات الشخصيات
// ========================================

async function loadCharacterRequests(){


    let box =
    document.getElementById(
        "admin-requests"
    );



    if(!box)
    return;




    box.innerHTML =
    "جاري تحميل الطلبات...";







    let {data:requests,error}=

    await supabaseClient
    .from("character_requests")
    .select("*");







    if(error){


        box.innerHTML =
        "حدث خطأ";


        return;

    }






    if(!requests ||
    requests.length === 0){


        box.innerHTML =
        "لا توجد طلبات";


        return;

    }






    box.innerHTML = "";






    requests.forEach(req=>{


        let div =
        document.createElement(
            "div"
        );



        div.className =
        "admin-card";




        // بيانات الطلب من اللاعب نفسه — تُهرب قبل العرض لمنع XSS في لوحة الأدمن
        let safeCharName = escapeHtml(req.character_name);

        let safeAnimeName = escapeHtml(req.anime_name);

        let safeNotes = escapeHtml(req.notes || "");

        div.innerHTML = `



        <h3>
        ${safeCharName}
        </h3>



        <p>
        الأنمي:
        ${safeAnimeName}
        </p>



        <p>
        ملاحظات:
        ${safeNotes}
        </p>




        <button onclick="
        deleteRequest('${req.id}')
        ">

        حذف الطلب

        </button>



        `;






        box.appendChild(div);



    });



}







// ========================================
// حذف شخصية
// ========================================

async function deleteCharacter(id){


    let ok =
    confirm(
    "هل تريد حذف الشخصية؟"
    );



    if(!ok)
    return;






    let admin_token = localStorage.getItem("admin_token");

    let {error}=

    await supabaseClient
    .rpc("admin_delete_character", {

        p_admin_token: admin_token,

        p_character_id: id

    });





    if(error){


        alert(
        error.message
        );


        return;

    }






    alert(
    "تم حذف الشخصية"
    );



    refreshAdminViews();



}








// ========================================
// حذف طلب
// ========================================

async function deleteRequest(id){


    let admin_token = localStorage.getItem("admin_token");

    await supabaseClient
    .rpc("admin_delete_request", {

        p_admin_token: admin_token,

        p_request_id: id

    });



    loadCharacterRequests();


}








// ========================================
// إضافة شخصية جديدة
// ========================================

async function addCharacter(){



    let nameEl =
    document.getElementById("admin-character-name");
    let name = nameEl ? nameEl.value.trim() : "";




    let animeEl =
    document.getElementById("admin-character-anime");
    let anime = animeEl ? animeEl.value.trim() : "";




    let imageEl =
    document.getElementById("admin-character-image");
    let image = imageEl ? imageEl.value.trim() : "";




    let hpEl =
    document.getElementById("admin-character-hp");
    let hp = hpEl ? Number(hpEl.value) : 0;




    let atkEl =
    document.getElementById("admin-character-atk");
    let atk = atkEl ? Number(atkEl.value) : 0;




    let powerEl =
    document.getElementById("admin-power-name");
    let power = powerEl ? powerEl.value.trim() : "";




    let descEl =
    document.getElementById("admin-power-description");
    let description = descEl ? descEl.value.trim() : "";




    let quoteEl =
    document.getElementById("admin-character-quote");
    let quote = quoteEl ? quoteEl.value.trim() : "";


    let monsterEl =
    document.getElementById("admin-character-is-monster");
    let isMonster = monsterEl ? monsterEl.checked : false;


    let adminOnlyEl =
    document.getElementById("admin-character-admin-only");
    let isAdminOnly = adminOnlyEl ? adminOnlyEl.checked : false;


    let glowEl =
    document.getElementById("admin-character-glow-color");
    let glowColor = glowEl ? glowEl.value : "#3b82ff";


    let glowLockedEl =
    document.getElementById("admin-character-glow-locked");
    let glowLocked = glowLockedEl ? glowLockedEl.checked : false;


    let goldEl =
    document.getElementById("admin-character-gold-prize");
    let goldPrize = goldEl ? (parseInt(goldEl.value) || 0) : 0;







    if(name === "" || anime === ""){


        alert(
        "اكتب اسم الشخصية والأنمي"
        );


        return;

    }







    let admin_token = localStorage.getItem("admin_token");

    let {error}=

    await supabaseClient
    .rpc("admin_add_character", {

        p_admin_token: admin_token,

        p_name: name,

        p_anime: anime,

        p_image: image,

        p_hp: hp || 100,

        p_atk: atk || 100,

        p_power_name: power,

        p_power_description: description,

        p_quote: quote,

        p_is_monster: isMonster,

        p_gold_prize: goldPrize,

        p_admin_only: isAdminOnly,

        p_glow_color: glowColor,

        p_glow_locked: glowLocked

    });


    if(error){


        alert(
        error.message
        );


        return;

    }






    alert(
    "تمت إضافة الشخصية"
    );


    document.getElementById("admin-character-name").value = "";
    document.getElementById("admin-character-anime").value = "";
    document.getElementById("admin-character-image").value = "";
    document.getElementById("admin-character-hp").value = "";    document.getElementById("admin-character-atk").value = "";
    document.getElementById("admin-power-name").value = "";
    document.getElementById("admin-power-description").value = "";
    document.getElementById("admin-character-quote").value = "";
    document.getElementById("admin-character-glow-color").value = "#3b82ff";
    document.getElementById("admin-character-glow-locked").checked = false;


    refreshAdminViews();


}

// إضافة شخصية من شاشة "شخصياتي الخاصة" — تستخدم معرّفات فريدة (my-char-*)
async function addMyCharacter(){

    let name = (document.getElementById("my-char-name") || {}).value;
    name = name ? name.trim() : "";

    let animeEl = document.getElementById("my-char-anime");
    let anime = animeEl ? animeEl.value.trim() : "";

    let imageEl = document.getElementById("my-char-image");
    let image = imageEl ? imageEl.value.trim() : "";

    let hpEl = document.getElementById("my-char-hp");
    let hp = hpEl ? Number(hpEl.value) : 0;

    let atkEl = document.getElementById("my-char-atk");
    let atk = atkEl ? Number(atkEl.value) : 0;

    let powerEl = document.getElementById("my-power-name");
    let power = powerEl ? powerEl.value.trim() : "";

    let descEl = document.getElementById("my-power-description");
    let description = descEl ? descEl.value.trim() : "";

    let quoteEl = document.getElementById("my-char-quote");
    let quote = quoteEl ? quoteEl.value.trim() : "";

    let monsterEl = document.getElementById("my-char-is-monster");
    let isMonster = monsterEl ? monsterEl.checked : false;

    let adminOnlyEl = document.getElementById("my-char-admin-only");
    let isAdminOnly = adminOnlyEl ? adminOnlyEl.checked : false;

    let glowEl = document.getElementById("my-char-glow-color");
    let glowColor = glowEl ? glowEl.value : "#3b82ff";

    let glowLockedEl = document.getElementById("my-char-glow-locked");
    let glowLocked = glowLockedEl ? glowLockedEl.checked : false;

    if(name === "" || anime === ""){ alert("اكتب اسم الشخصية والأنمي"); return; }

    let admin_token = localStorage.getItem("admin_token");

    let {error} = await supabaseClient.rpc("admin_add_character", {
        p_admin_token: admin_token,
        p_name: name,
        p_anime: anime,
        p_image: image,
        p_hp: hp || 100,
        p_atk: atk || 100,
        p_power_name: power,
        p_power_description: description,
        p_quote: quote,
        p_is_monster: isMonster,
        p_gold_prize: 0,
        p_admin_only: isAdminOnly,
        p_glow_color: glowColor,
        p_glow_locked: glowLocked
    });

    if(error){ alert(error.message); return; }

    alert("تمت إضافة الشخصية");

    document.getElementById("my-char-name").value = "";
    document.getElementById("my-char-anime").value = "";
    document.getElementById("my-char-image").value = "";
    document.getElementById("my-char-hp").value = "";
    document.getElementById("my-char-atk").value = "";
    document.getElementById("my-power-name").value = "";
    document.getElementById("my-power-description").value = "";
    document.getElementById("my-char-quote").value = "";
    document.getElementById("my-char-glow-color").value = "#3b82ff";
    document.getElementById("my-char-glow-locked").checked = false;

    refreshAdminViews();

}
// ========================================
// زر Enter
// ========================================

document.addEventListener(
"keydown",
function(event){


    if(event.key !== "Enter")
    return;



    let loginScreen =
    document.getElementById(
        "login-screen"
    );



    let registerScreen =
    document.getElementById(
        "register-screen"
    );




    if(loginScreen &&
    loginScreen.classList.contains("active")){


        if(document.activeElement.id === "login-password"){


            login();


        }


    }





    if(registerScreen &&
    registerScreen.classList.contains("active")){


        if(document.activeElement.id === "register-password"
        || document.activeElement.id === "register-email"){


            startRegisterOtp();


        }


    }



});











// ========================================
// فتح لوحة الإدارة يدوياً
// ========================================

function openAdminPanel(){


    let admin_token =
    localStorage.getItem(
        "admin_token"
    );



    if(!admin_token){


        alert(
        "غير مصرح بالدخول"
        );


        return;

    }



    openScreen(
        "admin-panel-screen"
    );



}






// ========================================
// تحديث بيانات اللاعب بعد أي تغيير
// ========================================

function refreshGame(){


    updatePlayerInfo();


    let screen =
    document.querySelector(
        ".screen.active"
    );



    if(!screen)
    return;




    if(screen.id === "collection-screen"){


        loadCollection();


    }




    if(screen.id === "character-profile-screen"){


        loadCharacterProfile();


    }




    if(screen.id === "upgrade-screen"){


        loadUpgradeScreen();


    }



}







console.log(
"game.js loaded successfully"
);

// ========================================
// إحصائيات لوحة الإدارة
// ========================================

async function loadAdminStats(){

    let box =
    document.getElementById("admin-stats");


    if(!box) return;



    box.innerHTML =
    "جاري تحميل الإحصائيات...";



    // نستخدم RPC إدارية واحدة موحّدة للإحصائيات الثلاث
    // (جدول players لم يعد قابلاً للقراءة العامة المباشرة)
    let {data:stats, error:statsError} =
    await supabaseClient
    .rpc("admin_get_stats", { p_admin_token: localStorage.getItem("admin_token") })
    .single();


    if(statsError || !stats){

        box.innerHTML =
        "حدث خطأ في تحميل الإحصائيات";

        return;

    }

    let playersCount = stats.players_count;
    let charactersCount = stats.characters_count;
    let requestsCount = stats.requests_count;



    box.innerHTML = `

    <h3>📊 الإحصائيات</h3>

    <p>
    👤 عدد اللاعبين:
    ${playersCount || 0}
    </p>


    <p>
    🎴 عدد الشخصيات:
    ${charactersCount || 0}
    </p>


    <p>
    📩 عدد الطلبات:
    ${requestsCount || 0}
    </p>


    `;


}

// ========================================
// زر الرجوع العام
// ========================================

function goBack(){

    let active =
    document.querySelector(".screen.active");


    if(!active)
    return;


    let id = active.id;


    switch(id){


        case "character-profile-screen":

        case "upgrade-screen":

        case "collection-screen":

        case "battle-screen":

        case "story-screen":

        case "pvp-screen":

        case "shop-screen":

            openScreen("home-screen");

        break;



        case "admin-panel-screen":

            openScreen("login-screen");

        break;


        case "admin-my-characters-screen":

            openScreen("admin-panel-screen");

        break;



        case "character-choice-screen":

            openScreen("login-screen");

        break;



        default:

            openScreen("home-screen");

    }

}

// ========================================
// التحقق التلقائي من إصدار التطبيق (تحديث APK)
// ========================================

const UPDATE_MANIFEST_URL = "https://cardgame-5nv.pages.dev/version.json";

async function checkForAppUpdate(){

    // يعمل فقط داخل تطبيق Capacitor (APK)، وليس في متصفح الويب
    if(!window.Capacitor
    || !window.Capacitor.isNativePlatform
    || !window.Capacitor.isNativePlatform()
    || !window.Capacitor.Plugins
    || !window.Capacitor.Plugins.App){
        return;
    }

    try{

        // قراءة إصدار التطبيق المثبَّت حاليًا (versionCode)
        let info = await window.Capacitor.Plugins.App.getInfo();
        let installedVersion = parseInt(info.build, 10);
        if(isNaN(installedVersion)){
            installedVersion = 0;
        }

        // جلب آخر إصدار متاح من السيرفر. ملاحظة: لا نضيف أي query string هنا
        // لأن Cloudflare Pages يفسّر الإضافة بوجود استعلام على أنه مسار SPA
        // ويعيد index.html بدل ملف JSON (cache: no-store يكفي لتفادي تخزين
        // العميل، ويُمنع التخزين الطرفي عبر www/_headers)
        let res = await fetch(UPDATE_MANIFEST_URL, { cache: "no-store" });
        if(!res.ok) return;
        let manifest = await res.json();

        let latestVersion = parseInt(manifest.version, 10);
        if(isNaN(latestVersion)) return;

        // الإصدار الأحدث والمطلوب إجبارًا؟ (required = true)
        let isRequired = manifest.required === true || String(manifest.required) === "true";

        // إذا كان هناك إصدار أحدث → اعرض نافذة التحديث فقط إذا كان إلزاميًا
        if(latestVersion > installedVersion && isRequired){
            showUpdatePrompt(manifest, installedVersion, latestVersion, true);
        }else if(latestVersion > installedVersion){
            // تحديث اختياري: لا نعرض أي رسالة (يُحدَّث تلقائيًا لاحقًا عند الإصدار الإجباري)
            console.log("يتوفر تحديث اختياري (" + latestVersion + ") - لا حاجة للإلزام");
        }

    }catch(e){
        console.log("فشل التحقق من التحديث", e);
    }

}

function showUpdatePrompt(manifest, installedVersion, latestVersion, isRequired){

    let existing = document.getElementById("update-modal");
    if(existing && existing.style.display !== "none") return;

    let notes = (manifest.releaseNotes || "").trim()
        ? "<div class=\"update-notes\">" + manifest.releaseNotes + "</div>"
        : "";

    // رسالة واضحة حسب نوع التحديث
    let message = isRequired
        ? "هناك تحديث إلزامي مهم للعبة. يجب تحديث التطبيق للاستمرار والحصول على أحدث الميزات."
        : "يتوفر إصدار جديد من اللعبة. ننصحك بتحديث التطبيق الآن للاستفادة من أحدث الميزات والتحسينات.";

    // التحديث الإلزامي: زر واحد فقط للتحميل (لا يوجد "لاحقًا")
    let actions = isRequired
        ? "<div class=\"update-actions\">" +
              "<button id=\"update-download-btn\" class=\"update-download-btn\">تحميل التحديث الآن</button>" +
          "</div>"
        : "<div class=\"update-actions\">" +
              "<button id=\"update-download-btn\" class=\"update-download-btn\">تحميل التحديث</button>" +
              "<button id=\"update-later-btn\" class=\"update-later-btn\">لاحقًا</button>" +
          "</div>";

    let modal = document.createElement("div");
    modal.id = "update-modal";
    modal.className = "update-modal" + (isRequired ? " update-modal-required" : "");
    modal.innerHTML =
        "<div class=\"update-modal-box\">" +
            "<h2>تحديث متاح</h2>" +
            "<p>" + message + "</p>" +
            notes +
            actions +
        "</div>";

    document.body.appendChild(modal);

    document.getElementById("update-download-btn")
        .addEventListener("click", function(){
            // داخل تطبيق Capacitor: افتح الرابط في متصفح النظام لتنزيل ملف APK.
            // window.open(url, "_system", ...) هو أسلوب Cordova ولا يعمل في Capacitor.
            var url = manifest.downloadUrl;
            if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser){
                window.Capacitor.Plugins.Browser.open({ url: url });
            }else{
                window.open(url, "_blank", "noopener");
            }
        });

    let laterBtn = document.getElementById("update-later-btn");
    if(laterBtn){
        laterBtn.addEventListener("click", function(){
            modal.style.display = "none";
        });
    }

    // التحديث الإلزامي: منع إغلاق النافذة نهائيًا حتى التحديث
    if(isRequired){
        modal.addEventListener("click", function(e){
            if(e.target === modal) return; // لا يغلق عند الضغط على الخلفية
        });
    }

}

// تشغيل فحص التحديث بعد تحميل الصفحة
if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", function(){
        setTimeout(checkForAppUpdate, 1500);
    });
}else{
    setTimeout(checkForAppUpdate, 1500);
}


// ========================================
// إعادة تحميل اللعبة
// ========================================
// زر التجديد في الشريط العلوي: يُحدِّث محتوى اللعبة من الخادم دون الحاجة
// لإنهاء التطبيق. الجلسة محفوظة في localStorage فيتم استعادتها تلقائيًا بعد
// إعادة التحميل، وتبقى على الشاشة الحالية.
function reloadGame(){

    if(!confirm("إعادة تحميل اللعبة؟")) return;

    location.reload();

}


