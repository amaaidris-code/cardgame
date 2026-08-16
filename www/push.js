// ========================================
// Push notifications (local + server)
// ========================================
// يستخدم إضافة @capacitor/push-notifications داخل تطبيق APK فقط. عند تسجيل
// الدخول نسجّل رمز الجهاز (FCM token) لدى الخادم عبر push_register_token،
// وعند الخروج نحذفه عبر push_remove_token. الخادم (Database Triggers +
// Edge Function send-push) يرسل إشعارًا للجهاز حتى لو كان اللاعب خارج اللعبة.
// ========================================

var pushModule = (function(){

    function isNative(){
        return !!(window.Capacitor
            && window.Capacitor.isNativePlatform
            && window.Capacitor.isNativePlatform()
            && window.Capacitor.Plugins
            && window.Capacitor.Plugins.PushNotifications);
    }

    // تسجيل الجهاز لدى الخادم (يربط الرمز بحساب اللاعب الحالي)
    function registerServerToken(deviceToken){
        if(!deviceToken) return;
        const pToken = localStorage.getItem("player_token");
        if(!pToken) return;
        supabaseClient.rpc("push_register_token", {
            p_token: pToken,
            p_device_token: deviceToken,
            p_platform: "android"
        }).then(function(){}, function(){});
    }

    function registerServerTokenFor(pToken, deviceToken){
        if(!deviceToken) return;
        supabaseClient.rpc("push_register_token", {
            p_token: pToken,
            p_device_token: deviceToken,
            p_platform: "android"
        }).then(function(){}, function(){});
    }

    // حذف رمز الجهاز من الخادم
    function removeServerToken(deviceToken){
        if(!deviceToken) return;
        const pToken = localStorage.getItem("player_token");
        if(!pToken) return;
        supabaseClient.rpc("push_remove_token", {
            p_token: pToken,
            p_device_token: deviceToken
        }).then(function(){}, function(){});
    }

    function removeServerTokenFor(pToken, deviceToken){
        if(!deviceToken) return;
        supabaseClient.rpc("push_remove_token", {
            p_token: pToken,
            p_device_token: deviceToken
        }).then(function(){}, function(){});
    }

    var lastDeviceToken = "";

    function requestPermission(){
        if(!isNative()) return;
        const PushNotifications = window.Capacitor.Plugins.PushNotifications;

        PushNotifications.addListener("registration", function(token){
            lastDeviceToken = token.value || "";
            // إن كان هناك حساب مسجَّل، اربط الرمز فورًا
            const pToken = localStorage.getItem("player_token");
            if(pToken) registerServerTokenFor(pToken, lastDeviceToken);
        });

        PushNotifications.addListener("registrationError", function(err){
            console.error("Push registration error", err);
        });

        PushNotifications.addListener("pushNotificationReceived", function(notification){
            // إشعار أثناء فتح التطبيق — لا نعرض شيئًا هنا نتركه لنظام Android
        });

        PushNotifications.addListener("pushNotificationActionPerformed", function(notification){
        });

        PushNotifications.requestPermissions().then(function(perm){
            if(perm && perm.receive === "granted"){
                PushNotifications.register();
            }
        }).catch(function(){});
    }

    // يُستدعى بعد نجاح تسجيل الدخول
    function onLogin(pToken){
        if(!isNative()) return;
        // إن لم يكن لدينا رمز بعد (لم يُطلق permission بعد)، نفعّل التسجيل
        if(!lastDeviceToken){
            requestPermission();
        }else{
            registerServerTokenFor(pToken, lastDeviceToken);
        }
    }

    // يُستدعى عند تسجيل الخروج
    function onLogout(pToken){
        if(!isNative()) return;
        if(pToken && lastDeviceToken){
            removeServerTokenFor(pToken, lastDeviceToken);
        }
    }

    return {
        requestPermission: requestPermission,
        onLogin: onLogin,
        onLogout: onLogout
    };

})();