// ========================================
// طبقة التخزين المؤقت المحلي (Cache Layer)
// ========================================
// القاعدة الأمنية: هذا الملف يُستخدم فقط لتخزين بيانات "قراءة فقط" وعامة
// (مثل بيانات الوحوش، المهارات، الشخصيات المتاحة للعرض) — وهي بيانات
// يمكن لأي شخص يملك anon key الوصول إليها أصلاً عبر الشبكة، لذلك تخزينها
// محليًا لا يضيف أي خطورة أمنية جديدة.
//
// هذا الملف لا يُستخدم ولا يجب استخدامه أبدًا لتخزين نتائج معارك أو مكافآت
// (ذهب، خبرة، ترقيات) بشكل موثوق — أي حفظ دائم لتلك الأمور يجب أن يمر عبر
// دالة RPC على الخادم (SECURITY DEFINER) تعيد التحقق من كل شيء بنفسها،
// وليس عبر ما يُرسله العميل أو ما هو مخزّن محليًا.

const GameCache = (function(){

    const PREFIX = "cg_cache_";
    const VERSION = "v1"; // غيّر هذا الرقم إذا تغيّر شكل البيانات المخزنة مستقبلاً لإبطال كل الكاش القديم دفعة واحدة

    function key(name){
        return PREFIX + VERSION + "_" + name;
    }

    function isOnline(){
        return typeof navigator !== "undefined" ? navigator.onLine !== false : true;
    }

    function readRaw(name){
        try{
            let raw = localStorage.getItem(key(name));
            if(!raw) return null;
            return JSON.parse(raw);
        }catch(e){
            return null;
        }
    }

    function writeRaw(name, data){
        try{
            localStorage.setItem(key(name), JSON.stringify({
                data: data,
                savedAt: Date.now()
            }));
        }catch(e){
            // التخزين ممتلئ أو غير متاح (مثلاً وضع تصفح خاص) — تجاهل بصمت،
            // اللعبة تستمر بالعمل بدون كاش وليس هناك ضرر
        }
    }

    // الحصول على نسخة مخزنة (مهما كان عمرها) — تُستخدم للعرض الفوري أوفلاين
    function getStale(name){
        let entry = readRaw(name);
        return entry ? entry.data : null;
    }

    // هل النسخة المخزنة ما زالت "طازجة" ضمن مدة معينة (بالمللي ثانية)؟
    function isFresh(name, maxAgeMs){
        let entry = readRaw(name);
        if(!entry) return false;
        return (Date.now() - entry.savedAt) < maxAgeMs;
    }

    function set(name, data){
        writeRaw(name, data);
    }

    function clear(name){
        try{ localStorage.removeItem(key(name)); }catch(e){}
    }

    /**
     * نمط "اعرض من الكاش فورًا ثم حدّث في الخلفية" (stale-while-revalidate)
     *
     * name        : اسم فريد لهذه البيانات
     * fetchFn     : async function() تُرجع البيانات الحقيقية من Supabase
     * onData      : function(data, isFromCache) تُستدعى لعرض البيانات — تُستدعى مرة فورًا
     *               من الكاش إن وُجد، ثم مرة أخرى بعد نجاح الجلب من الشبكة إن كانت البيانات مختلفة
     * onError     : function() تُستدعى فقط إذا لم يوجد كاش وفشل الاتصال بالشبكة أيضًا
     * maxAgeMs    : (اختياري) إذا كانت النسخة المخزنة أحدث من هذه المدة، لا داعي لإعادة الجلب من الشبكة فورًا
     */
    async function fetchWithCache(name, fetchFn, onData, onError, maxAgeMs){

        let cached = getStale(name);
        let renderedFromCache = false;

        if(cached){
            onData(cached, true);
            renderedFromCache = true;
        }

        // إن كانت النسخة طازجة بما فيه الكفاية ولا حاجة ملحّة للتحديث، ولسنا متصلين، توقف هنا
        if(!isOnline() && renderedFromCache){
            return;
        }

        if(maxAgeMs && isFresh(name, maxAgeMs) && renderedFromCache){
            return; // النسخة ما زالت حديثة، لا داعي لإرهاق الشبكة الآن
        }

        try{
            let fresh = await fetchFn();
            if(fresh !== null && fresh !== undefined){
                set(name, fresh);
                onData(fresh, false);
            }else if(!renderedFromCache){
                onError && onError();
            }
        }catch(e){
            console.log("fetchWithCache network error for " + name, e);
            if(!renderedFromCache){
                onError && onError();
            }
            // إن كان هناك كاش، نكتفي بما تم عرضه بالفعل ولا نزعج المستخدم بخطأ
        }
    }

    return {
        isOnline,
        getStale,
        isFresh,
        set,
        clear,
        fetchWithCache
    };

})();
