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

    loadAdminPlayers();
    
    loadCharacterRequests();
    
}


        if(screenId === "admin-my-characters-screen"){

    loadAdminMyCharacters();

}

    }

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
            .from("characters")
            .select("*")
            .eq("is_monster", true);

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


    // إنهاء جلسة اللاعب فعليًا في قاعدة البيانات ثم مسحها من هذا الجهاز
    let playerToken = localStorage.getItem("player_token");

    if(playerToken){

        supabaseClient.rpc("player_logout_session", {
            p_token: playerToken
        });

    }

    localStorage.removeItem(
        "player_token"
    );


    localStorage.removeItem(
        "player_id"
    );


    localStorage.removeItem(
        "username"
    );


    localStorage.removeItem(
        "character_id"
    );


    localStorage.removeItem(
        "character_name"
    );


    // إنهاء جلسة الأدمن فعليًا في قاعدة البيانات (لا تُترك صالحة بالخلفية)
    // ثم مسحها من هذا الجهاز
    let adminToken = localStorage.getItem("admin_token");

    if(adminToken){

        supabaseClient.rpc("admin_logout_session", {
            p_token: adminToken
        });

    }

    localStorage.removeItem(
        "admin_token"
    );



    openScreen(
        "login-screen"
    );



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
    .single();


    if(charError ||
    !characterData){


        box.innerHTML =
        "لا توجد شخصية مختارة";


        return;

    }




    let character = characterData;





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
    let {data:character}=

    await supabaseClient
    .rpc("get_my_active_character", { p_token: localStorage.getItem("player_token") })
    .single();


    if(!character){


        box.innerHTML =
        "لا توجد شخصية";


        return;

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


    🔥 نقاط التطوير:
    ${character.available_points || 0}



    `;



}






// ========================================
// تطوير الشخصية
// ========================================

async function upgradeCharacter(){


    // نستخدم دالة upgrade_player_character الآمنة بدل الكتابة المباشرة
    // (جدول player_characters لا يسمح بـ UPDATE عبر RLS للحماية من التلاعب)
    // نرسل رمز الجلسة، والدالة على الخادم تتحقق بنفسها من الشخصية النشطة
    // ومن وجود نقاط تطوير متاحة قبل أي تعديل — لا حاجة لقراءة مسبقة هنا
    let upgrade_token = localStorage.getItem("player_token");

    if(!upgrade_token){
        alert("انتهت صلاحية الجلسة، الرجاء تسجيل الدخول من جديد");
        logout();
        return;
    }

    let {error:upgradeError} =

    await supabaseClient
    .rpc("upgrade_player_character", {

        p_token: upgrade_token

    });

    if(upgradeError){

        alert(upgradeError.message);

        return;

    }




    alert(
    "تم تطوير الشخصية"
    );



    loadUpgradeScreen();


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


    let realCharacters = adminCharactersCache.filter(c => !c.is_monster);

    let monsters = adminCharactersCache.filter(c => c.is_monster);


    box.innerHTML = renderAdminCharacterCards(realCharacters, "لا توجد شخصيات بعد");

    if(monsterBox){

        monsterBox.innerHTML = renderAdminCharacterCards(monsters, "لا توجد وحوش بعد");

    }
    
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

                <p class="admin-character-stats">❤️ ${character.hp || 0} &nbsp;·&nbsp; ⚔️ ${character.atk || 0} &nbsp;·&nbsp; LV ${character.level || 1}</p>

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

async function uploadCharacterImage(fileInputId, textInputId, statusId){

    let fileInput = document.getElementById(fileInputId);

    let textInput = document.getElementById(textInputId);

    let statusBox = document.getElementById(statusId);

    let file = fileInput.files[0];

    if(!file) return;


    let adminToken = localStorage.getItem("admin_token");

    if(!adminToken){

        if(statusBox) statusBox.textContent = "❌ يجب تسجيل الدخول كأدمن لرفع صورة";

        return;

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

}



// ========================================
// إدارة اللاعبين (تعديل الذهب)
// ========================================

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
    .select("page_index, image_url")
    .eq("character_id", character_id);

    if(error || !data) return {};

    let map = {};

    data.forEach(row => {

        if(row.image_url) map[row.page_index] = row.image_url;

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
    await uploadCharacterImage(
        "page-bg-file-" + pageIndex,
        "page-bg-" + pageIndex,
        "page-bg-status-" + pageIndex
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


// الشخصية المفتوحة حاليًا في نافذة التعديل — نستخدمها لمسح كاش مهاراتها
// بعد أي تعديل حتى تظهر التغييرات فورًا في ساحة المعركة
let currentEditCharacterId = null;

async function openEditCharacterModal(characterId){

    let character = adminCharactersCache.find(c => c.id === characterId);

    if(!character) return;

    currentEditCharacterId = characterId;

    closeEditCharacterModal();

    let skills = await loadCharacterSkillsForAdmin(characterId);

    // خلفيات صفحات المهارات الحالية (كل 4 مهارات = صفحة) ليُعرض كل رابط
    // في صندوقه، ويُحدَّث فورًا عند تغييره (بدون انتظار كاش المعارك)
    let pageBgs = await loadSkillPageBackgroundsForAdmin(characterId);

    let numPages = Math.max(1, Math.ceil(skills.length / 4));

    let pageBgsHtml = Array.from({length: numPages}, (_, p) => `

        <div class="admin-skill-edit-row admin-page-bg-row">

            <span class="admin-page-bg-label">🎨 صفحة ${p + 1}</span>

            <input type="text" id="page-bg-${p}" value="${escapeHtml(pageBgs[p] || '')}" placeholder="رابط صورة خلفية هذه الصفحة (اختياري)">

            <button onclick="saveSkillPageBackground('${characterId}', ${p})">حفظ</button>

            <button onclick="clearSkillPageBackground('${characterId}', ${p})">🗑️</button>

            <span id="page-bg-status-${p}" class="upload-status"></span>

            <label class="admin-page-bg-upload">
                📷 صورة من جهازي
                <input type="file" id="page-bg-file-${p}" accept="image/*" onchange="uploadPageBackground('${characterId}', ${p})">
            </label>

        </div>

    `).join("");

    let skillsHtml = skills.length > 0
    ? skills.map(s => `

        <div class="admin-skill-edit-row">

            <input type="text" id="skill-name-${s.id}" class="admin-skill-name-input" value="${escapeHtml(s.name || '')}" placeholder="اسم المهارة">

            <select id="skill-type-${s.id}" onchange="updateSkillNumberLabelFor('${s.id}')">
                ${skillTypeOptionsHtml(skillFieldsToTypeChoice(s))}
            </select>

            <input type="number" id="skill-damage-${s.id}" value="${s.damage || 0}" placeholder="${skillNumberFieldLabel(s)}">

            <input type="number" id="skill-cooldown-${s.id}" value="${s.cooldown || 0}" placeholder="التهدئة">

            <textarea id="skill-desc-${s.id}" class="admin-skill-desc-input" placeholder="وصف المهارة (يظهر عند الضغط المطوّل)">${escapeHtml(s.description || '')}</textarea>

            <label class="admin-color-row skill-color-row">
                🎨 لون اسم المهارة
                <input type="color" id="skill-color-${s.id}" value="${(s.color && /^#[0-9A-Fa-f]{6}$/.test(s.color)) ? s.color : '#ffffff'}">
            </label>

            <button onclick="saveSkillEdit('${s.id}')">حفظ</button>

            <button onclick="removeSkillFromCharacter('${characterId}','${s.id}')">🗑️</button>

        </div>

    `).join("")
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

                <input id="edit-char-image-file" type="file" accept="image/*" onchange="uploadCharacterImage('edit-char-image-file','edit-char-image','edit-image-status')">

                <p id="edit-image-status" class="upload-status"></p>

                <input id="edit-char-hp" type="number" value="${character.hp || 0}" placeholder="نقاط الحياة">

                <input id="edit-char-atk" type="number" value="${character.atk || 0}" placeholder="قوة الهجوم">

                <input id="edit-char-level" type="number" value="${character.level || 1}" placeholder="المستوى">

                <input id="edit-char-power-name" type="text" value="${character.power_name || ''}" placeholder="اسم القوة الخاصة">

                <textarea id="edit-char-power-desc" placeholder="وصف القوة الخاصة">${character.power_description || ''}</textarea>

                <input id="edit-char-quote" type="text" value="${character.quote || ''}" placeholder="الاقتباس">

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

                <textarea id="new-skill-description" placeholder="وصف المهارة (يظهر للاعب عند الضغط المطوّل على الزر)"></textarea>

                <label class="admin-color-row skill-color-row">
                    🎨 لون اسم المهارة
                    <input id="new-skill-color" type="color" value="#ffffff">
                </label>

                <button onclick="addSkillToCharacter('${characterId}')">إضافة المهارة</button>

            </div>

            <div class="steal-modal-buttons">

                <button id="save-character-edit-btn">💾 حفظ التعديلات</button>

                <button id="cancel-character-edit-btn">إلغاء</button>

            </div>

        </div>

    `;

    document.body.appendChild(modal);

    updateNewSkillNumberLabel();

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

    }

    return {type, effect, unblockable};

}


// الاتجاه المعاكس: من كائن مهارة (كما يُقرأ من قاعدة البيانات) إلى قيمة
// قائمة النوع، لعرض قائمة النوع في نموذج التعديل على قيمتها الحالية
function skillFieldsToTypeChoice(skill){

    if(skill.unblockable) return "unblockable";

    if(skill.effect === "steal") return "steal";

    if(skill.effect === "copy") return "copy";

    if(skill.effect === "freeze") return "freeze";

    if(skill.effect === "lifesteal") return "lifesteal";

    if(skill.effect === "reflect") return "reflect";

    if(skill.effect === "seal") return "seal";

    if(skill.effect === "unseal") return "unseal";

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
        ["unblockable", "💥 ضربة لا تُصد"],
        ["freeze", "🧊 تجميد (شلل دور كامل)"],
        ["lifesteal", "🩸 امتصاص (شفاء بقدر الضرر)"],
        ["reflect", "🔁 انعكاس (المرة القادمة يعكس المهاجمُ عليه هجومَه السابق)"],
        ["seal", "🔒 ختم (منع مهارة استخدمها الخصم حتى نهاية النزال)"],
        ["unseal", "🔓 فك الختم (إزالة ختم عن مهارة من مهاراتك)"]
    ];

    return options.map(([val, label]) =>
        `<option value="${val}"${val === selected ? " selected" : ""}>${label}</option>`
    ).join("");

}


function skillTypeLabel(skill){

    if(skill.unblockable) return "ضربة لا تُصد";

    if(skill.effect === "steal") return "مفترس";

    if(skill.effect === "copy") return "نسخ";

    if(skill.effect === "freeze") return "تجميد";

    if(skill.effect === "lifesteal") return "امتصاص";

    if(skill.effect === "reflect") return "انعكاس";

    if(skill.effect === "seal") return "ختم";

    if(skill.effect === "unseal") return "فك الختم";

    if(skill.type === "defense") return "دفاع";

    return "هجوم";

}


// يحدّد ما يمثّله الحقل الرقمي للمهارة (بدل "الضرر" دائمًا)، لأن الضرر لا
// فائدة له في مهارات السرقة/الدفاع/التجميد — كل نوع له معنى مختلف للرقم
function skillNumberFieldLabel(skill){

    if(skill.effect === "steal") return "عدد المهارات القابلة للسرقة والاستخدام الفوري";

    if(skill.effect === "copy") return "عدد المهارات القابلة للنسخ والاستخدام الفوري";

    if(skill.type === "defense") return "عدد الضربات الممكن تحمّلها";

    if(skill.effect === "freeze") return "عدد أدوار الشلل";

    if(skill.effect === "lifesteal") return "الضرر (= الشفاء)";

    if(skill.effect === "reflect") return "مضاعف ارتداد الضرر";

    if(skill.effect === "seal") return "عدد المهارات القابلة للختم (من مهارات الخصم المستخدمة)";

    if(skill.effect === "unseal") return "عدد المهارات القابلة لفك الختم عنها (من مهاراتك المختومة)";

    return "الضرر";

}


// نفس فكرة skillNumberFieldLabel لكن اعتمادًا على اختيار نوع المهارة في
// نموذج "إضافة مهارة جديدة" (قبل أن يُنشأ أي كائن مهارة فعلي)
function newSkillNumberFieldLabel(typeChoice){

    if(typeChoice === "steal") return "عدد المهارات القابلة للسرقة والاستخدام الفوري";

    if(typeChoice === "copy") return "عدد المهارات القابلة للنسخ والاستخدام الفوري";

    if(typeChoice === "defense") return "عدد الضربات الممكن تحمّلها";

    if(typeChoice === "freeze") return "عدد أدوار الشلل";

    if(typeChoice === "lifesteal") return "الضرر (= الشفاء)";

    if(typeChoice === "reflect") return "مضاعف ارتداد الضرر";

    if(typeChoice === "seal") return "عدد المهارات القابلة للختم (من مهارات الخصم المستخدمة)";

    if(typeChoice === "unseal") return "عدد المهارات القابلة لفك الختم عنها (من مهاراتك المختومة)";

    return "الضرر";

}


function updateNewSkillNumberLabel(){

    let select = document.getElementById("new-skill-type");

    let input = document.getElementById("new-skill-damage");

    if(!select || !input) return;

    input.placeholder = newSkillNumberFieldLabel(select.value);

}


// نسخة لنموذج تعديل مهارة موجودة: تحدّث تسمية حقل الضرر عند تغيير نوع المهارة
function updateSkillNumberLabelFor(skillId){

    let select = document.getElementById("skill-type-" + skillId);

    let input = document.getElementById("skill-damage-" + skillId);

    if(!select || !input) return;

    input.placeholder = newSkillNumberFieldLabel(select.value);

}


async function addSkillToCharacter(characterId){

    let name = document.getElementById("new-skill-name").value.trim();

    let typeChoice = document.getElementById("new-skill-type").value;

    let damage = Number(document.getElementById("new-skill-damage").value) || 0;

    let cooldown = Number(document.getElementById("new-skill-cooldown").value) || 0;

    let description = document.getElementById("new-skill-description").value.trim();

    let colorInput = document.getElementById("new-skill-color");

    let color = colorInput && colorInput.value ? colorInput.value : null;

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

        p_color: color

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


    if(name === "" || anime === ""){

        alert("اكتب اسم الشخصية والأنمي");

        return;

    }


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


async function saveSkillEdit(skillId){

    let nameInput = document.getElementById("skill-name-" + skillId);

    let typeSelect = document.getElementById("skill-type-" + skillId);

    let damageInput = document.getElementById("skill-damage-" + skillId);

    let cooldownInput = document.getElementById("skill-cooldown-" + skillId);

    let descInput = document.getElementById("skill-desc-" + skillId);

    let colorInput = document.getElementById("skill-color-" + skillId);

    let name = nameInput ? nameInput.value.trim() : "";

    let typeChoice = typeSelect ? typeSelect.value : "attack";

    let damage = Number(damageInput.value) || 0;

    let cooldown = Number(cooldownInput.value) || 0;

    let description = descInput ? descInput.value.trim() : "";

    let color = colorInput && colorInput.value ? colorInput.value : null;

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

        p_color: color

    });


    if(error){

        alert(error.message);

        return;

    }


    alert("تم حفظ المهارة");

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



    loadAdminPanel();



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



    let name =
    document
    .getElementById(
        "admin-character-name"
    )
    .value
    .trim();




    let anime =
    document
    .getElementById(
        "admin-character-anime"
    )
    .value
    .trim();




    let image =
    document
    .getElementById(
        "admin-character-image"
    )
    .value
    .trim();




    let hp =
    Number(
    document
    .getElementById(
        "admin-character-hp"
    )
    .value
    );




    let atk =
    Number(
    document
    .getElementById(
        "admin-character-atk"
    )
    .value
    );




    let power =
    document
    .getElementById(
        "admin-power-name"
    )
    .value
    .trim();




    let description =
    document
    .getElementById(
        "admin-power-description"
    )
    .value
    .trim();




    let quote =
    document
    .getElementById(
        "admin-character-quote"
    )
    .value
    .trim();


    let isMonster =
    document
    .getElementById(
        "admin-character-is-monster"
    )
    .checked;


    let isAdminOnly =
    document
    .getElementById(
        "admin-character-admin-only"
    )
    .checked;


    let glowColor =
    document
    .getElementById(
        "admin-character-glow-color"
    )
    .value;


    let glowLocked =
    document
    .getElementById(
        "admin-character-glow-locked"
    )
    .checked;







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


    loadAdminPanel();


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
// حماية تحميل الصفحة
// ========================================

window.addEventListener(
"load",
function(){


    let player_id =
    localStorage.getItem(
        "player_id"
    );



    if(player_id){


        checkPlayer();


    }else{


        openScreen(
            "login-screen"
        );


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

async function refreshGame(){


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
