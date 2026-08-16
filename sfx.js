// ========================================
// Sfx — مؤثرات صوتية مركّبة بالكامل عبر Web Audio API
// -------------------------------------------------
// لا تتطلب أي ملفات صوتية / CDN / تحميل: كل صوت يُنتج برمجيًا لحظيًا
// (مذبذبات + ضوضاء بيضاء + أغلفة). تعمل دون اتصال وفي Android WebView.
// تتضمن موسيقى خلفية إجرائية بسيطة تُشغَّل أثناء المعارك.
//
// الاستخدام (عام):
//   Sfx.play("hit")            { name, volume? } — حدد الصوت
//   Sfx.tone(freq, dur, ...)   — توليد نغمة مخصصة
//   Sfx.startMusic() / Sfx.stopMusic()
//   Sfx.setMuted(bool) / Sfx.setVolume(0..1) / Sfx.isMuted()
//   Sfx.toggle()               — إرجاع الحالة الجديدة
//
// الإعدادات تُحفظ في localStorage. يجب استدعاء Sfx.unlock() بعد أول
// تفاعل لمس/نقر من المستخدم حتى تُمكَّن مناظر الصوت.
// ========================================

var Sfx = (function(){

    var ac = null;          // AudioContext (يُنشأ عند أول unlock)
    var master = null;      // gain رئيسي يتحكم بمستوى الصوت
    var musicGain = null;   // gain منفصل للموسيقى لنخرج عنها ناعمًا
    var musicTimer = null;  // مؤقّت مُخلِق نغمات الموسيقى
    var musicNext = null;   // time التالي لنغم الموسيقى
    var noiseBuf = null;    // مخزن ضوضاء بيضاء مشترك

    var KEY_MUTED = "sfx_muted";
    var KEY_VOL = "sfx_volume";

    // صار الصوت موثوقًا بمجرد أول تفاعل حر (نقر/لمس). قبل ذلك لا ننشئ
    // AudioContext أصلًا حتى لا يعترضه Chrome (autoplay policy) بصمت/تحذير.
    var gestureUnlocked = false;
    // يُسجَّل الطلب إذا جاءت الموسيقى قبل أول تفاعل، فتُشغَّل بعده مباشرة
    var musicPending = null;

    function storedMuted(){
        try{ return localStorage.getItem(KEY_MUTED) === "1"; }catch(e){ return false; }
    }
    function storedVol(){
        var v = parseFloat(localStorage.getItem(KEY_VOL));
        if(isNaN(v)) return 1;
        return Math.max(0, Math.min(1, v));
    }

    // إنشاء الـ AudioContext مع التأقلم مع أي بادئة قديمة — لا يُنشأ إلا بعد
    // أول تفاعل حر من المستخدم (autoplay policy في المتصفحات/التطبيق)
    function ensureCtx(){
        if(!gestureUnlocked) return null;
        if(ac) return ac;
        var AC = window.AudioContext || window.webkitAudioContext;
        if(!AC) return null;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = storedVol();
        master.connect(ac.destination);
        musicGain = ac.createGain();
        musicGain.gain.value = 0;
        musicGain.connect(master);
        // مخزن ضوضاء بيضاء واحد يُعاد استخدامه لكل الأصوات
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        var data = noiseBuf.getChannelData(0);
        for(var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        return ac;
    }

    // يجب استدعاؤها من تفاعل المستخدم الأول (نقر/لمس/زر): يفتح الغلق، ينشئ
    // المنظر، يكمله التأكيد، ثم يبدأ أي موسيقى كانت معلّقة
    function unlock(){
        gestureUnlocked = true;
        var ctx = ensureCtx();
        if(ctx && ctx.state === "suspended") ctx.resume().catch(function(){});
        if(musicPending){
            var mode = musicPending;
            musicPending = null;
            startMusic(mode);
        }
    }

    function isMuted(){ return storedMuted(); }

    function outLevel(){ return isMuted() ? 0 : storedVol(); }

    // مساعد: نغمة واحدة (ص) → وتر/تتابع
    function playTone(opts){
        var ctx = ensureCtx();
        if(!ctx || isMuted()) return;
        var freq = opts.freq || 440;
        var dur = opts.dur || 0.15;
        var vol = (opts.vol !== undefined ? opts.vol : 1) * (opts.volume !== undefined ? opts.volume : 1);
        if(vol <= 0) return;
        var type = opts.type || "sine";
        var when = ctx.currentTime + (opts.delay || 0);
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, when);
        // نغم الموسيقى يُمرَّر عبر musicGain (للبهت/التحكم)، والباقي عبر master مباشرة
        var dest = opts.route === "music" ? musicGain : master;
        var relLevel = (dest && dest.gain) ? (dest.gain.value || 1) : 1;
        g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * relLevel), when + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        osc.connect(g); g.connect(dest);
        // اهتزاز طفيف في التردد لمزيد من الواقعية
        if(opts.glideTo){
            osc.frequency.exponentialRampToValueAtTime(opts.glideTo, when + dur);
        }
        osc.start(when); osc.stop(when + dur + 0.02);
    }

    // صوت "ضجيج" قصير (يرتد جيدًا للضربات/الانفجارات) مع مرشّح تمرير
    function playNoise(opts){
        var ctx = ensureCtx();
        if(!ctx || isMuted()) return;
        var dur = opts.dur || 0.25;
        var vol = (opts.vol || 1) * (opts.volume || 1);
        if(vol <= 0) return;
        var when = ctx.currentTime + (opts.delay || 0);
        var src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        // حلقة: عيّن طول التشغيل بإنشاء مخزن قصير عبر slice من الضوضاء
        var sample = ctx.sampleRate * dur;
        var sub = ctx.createBuffer(1, sample, ctx.sampleRate);
        var sd = sub.getChannelData(0);
        var nd = noiseBuf.getChannelData(0);
        var start = Math.floor(Math.random() * (noiseBuf.length - sample));
        for(var i = 0; i < sample; i++) sd[i] = nd[start + i];
        src.buffer = sub;
        var filter = ctx.createBiquadFilter();
        filter.type = opts.filterType || "lowpass";
        filter.frequency.value = opts.freq || 3000;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(vol * master.gain.value, when + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        src.connect(filter); filter.connect(g); g.connect(master);
        src.start(when); src.stop(when + dur + 0.02);
    }

    // ---------- أسماء الأصوات المتاحة ----------
    var VOICES = {
        // بطاقات
        card:      function(o){ playNoise({dur:0.06, freq:4500, vol:0.5, volume:o.volume}); playTone({freq:300, glideTo:500, dur:0.06, type:"triangle", vol:0.3, volume:o.volume}); },
        // معركة
        hit:       function(o){ playNoise({dur:0.18, freq:1600, vol:0.8, volume:o.volume}); playTone({freq:180, glideTo:80, dur:0.16, type:"square", vol:0.4, volume:o.volume}); },
        crit:      function(o){ playNoise({dur:0.28, freq:900, vol:1, volume:o.volume}); playTone({freq:880, glideTo:120, dur:0.25, type:"sawtooth", vol:0.5, volume:o.volume}); playTone({freq:440, dur:0.12, type:"square", vol:0.3, volume:o.volume}); },
        heal:      function(o){ playTone({freq:520, glideTo:780, dur:0.2, type:"sine", vol:0.5, volume:o.volume}); playTone({freq:780, glideTo:1040, dur:0.25, type:"sine", vol:0.4, volume:o.volume, delay:0.08}); },
        shield:    function(o){ playTone({freq:240, glideTo:360, dur:0.18, type:"triangle", vol:0.4, volume:o.volume}); playNoise({dur:0.1, freq:2400, vol:0.4, volume:o.volume}); },
        skill:     function(o){ playTone({freq:600, dur:0.12, type:"sawtooth", vol:0.4, volume:o.volume}); playTone({freq:900, dur:0.15, type:"sawtooth", vol:0.4, volume:o.volume, delay:0.07}); playTone({freq:1200, dur:0.2, type:"sawtooth", vol:0.4, volume:o.volume, delay:0.14}); },
        block:     function(o){ playTone({freq:200, dur:0.1, type:"square", vol:0.4, volume:o.volume}); playNoise({dur:0.08, freq:1200, vol:0.5, volume:o.volume}); },
        monsterGrowl: function(o){ playTone({freq:120, glideTo:70, dur:0.45, type:"sawtooth", vol:0.5, volume:o.volume}); playNoise({dur:0.4, freq:500, vol:0.25, volume:o.volume, delay:0.05}); },
        fireball:  function(o){ playTone({freq:300, glideTo:900, dur:0.25, type:"sawtooth", vol:0.5, volume:o.volume}); playNoise({dur:0.3, freq:2500, vol:0.5, volume:o.volume}); },
        // نتيجة المعركة
        victory:   function(o){ var seq=[523,659,784,1047]; for(var i=0;i<seq.length;i++) playTone({freq:seq[i], dur:0.28, type:"triangle", vol:0.6, volume:o.volume, delay:i*0.15}); playTone({freq:1319, dur:0.5, type:"triangle", vol:0.6, volume:o.volume, delay:0.6}); },
        defeat:    function(o){ var seq=[330,262,196]; for(var j=0;j<seq.length;j++) playTone({freq:seq[j], dur:0.45, type:"triangle", vol:0.5, volume:o.volume, delay:j*0.22}); },
        draw:      function(o){ playTone({freq:440, dur:0.2, type:"triangle", vol:0.4, volume:o.volume}); playTone({freq:330, dur:0.2, type:"triangle", vol:0.4, volume:o.volume, delay:0.2}); },
        // واجهة / تنقّل
        click:     function(o){ playTone({freq:520, glideTo:780, dur:0.045, type:"triangle", vol:0.28, volume:o.volume}); },
        open:      function(o){ playTone({freq:500, glideTo:700, dur:0.08, type:"triangle", vol:0.3, volume:o.volume}); },
        close:     function(o){ playTone({freq:700, glideTo:500, dur:0.08, type:"triangle", vol:0.3, volume:o.volume}); },
        coin:      function(o){ playTone({freq:880, dur:0.08, type:"square", vol:0.4, volume:o.volume}); playTone({freq:1320, dur:0.14, type:"square", vol:0.4, volume:o.volume, delay:0.07}); },
        notify:    function(o){ playTone({freq:1000, dur:0.09, type:"sine", vol:0.35, volume:o.volume}); playTone({freq:1500, dur:0.12, type:"sine", vol:0.3, volume:o.volume, delay:0.09}); },
        // نكهة
        levelup:   function(o){ var s=[523,659,784,1047,1319]; for(var i=0;i<s.length;i++) playTone({freq:s[i], dur:0.15, type:"triangle", vol:0.5, volume:o.volume, delay:i*0.08}); },
        equip:     function(o){ playTone({freq:400, glideTo:800, dur:0.18, type:"triangle", vol:0.4, volume:o.volume}); },
        achievement: function(o){ playTone({freq:660, dur:0.12, type:"triangle", vol:0.45, volume:o.volume}); playTone({freq:880, dur:0.12, type:"triangle", vol:0.45, volume:o.volume, delay:0.1}); playTone({freq:1320, dur:0.3, type:"triangle", vol:0.5, volume:o.volume, delay:0.2}); }
    };

    // ---------- واجهة عامة ----------
    function play(name, opts){
        var o = opts || {};
        if(o.volume === undefined) o.volume = 1;
        unlock();
        var voice = VOICES[name];
        if(voice){ try{ voice(o); }catch(e){} }
    }

    // نغمة مخصصة (تستخدم بواسطة الموسيقى وغيرها)
    function tone(freq, durSec, opts){
        playTone(Object.assign({freq:freq, dur:durSec, vol:0.3}, opts||{}));
    }

    // ---------- موسيقى خلفية إجرائية ----------
    // تتابع وتر بسيط هادئ — تُمرَّر عبر musicGain (لبهتٍ سلس وليستجيب للمستوى).
    var BASS = [110.0, 130.8, 87.31, 98.0];     // A, C, F, G
    var ARP  = [220, 261.6, 329.6, 220, 261.6, 392]; // كسر بسيط
    var musicMode = "menu";   // "menu" أهدأ | "battle" أوضح قليلًا

    function musicLevel(){
        if(isMuted()) return 0;
        return musicMode === "battle" ? 0.22 : 0.14;
    }

    function startMusic(mode){
        var ctx = ensureCtx();
        if(!ctx){
            // ما زال قبل أول تفاعل حر: سجّل الطلب ليبدأ بمجرد فتح الصوت
            musicPending = mode || "menu";
            return;
        }
        if(mode) musicMode = mode;
        // أعد فتح منظر الصوت إن كان معلّقًا (مهم في التبويبات الخلفية)
        if(ctx.state === "suspended") ctx.resume().catch(function(){});
        if(musicTimer){
            fadeMusicTo(musicLevel());
            return;
        }
        musicNext = ctx.currentTime + 0.15;
        musicTimer = setInterval(scheduleMusicStep, 120);
        fadeMusicTo(musicLevel());
    }

    function scheduleMusicStep(){
        var ctx = ensureCtx();
        if(!ctx || isMuted()){ return; }
        var now = ctx.currentTime;
        var step = musicMode === "battle" ? 0.26 : 0.34; // أبطأ قليلًا في القائمة
        var count = 0;
        while(musicNext < now + 0.6 && count < 20){
            var barStep = Math.floor(musicNext / step);
            var ii = barStep % ARP.length;
            playTone({freq: ARP[ii], dur: step * 0.9, type:"triangle", vol:0.20, route:"music"});
            // نغم الباص عند بداية كل "وتر" (كل 4 خطوات)
            if(barStep % 4 === 0){
                var bassIdx = Math.floor(barStep / 4) % BASS.length;
                playTone({freq: BASS[bassIdx], dur: step * 3, type:"sine", vol:0.32, route:"music"});
            }
            musicNext += step;
            count++;
        }
    }

    function stopMusic(){
        if(musicTimer){ clearInterval(musicTimer); musicTimer = null; }
        fadeMusicTo(0);
    }

    function fadeMusicTo(target){
        var ctx = ensureCtx();
        if(!ctx || !musicGain) return;
        var now = ctx.currentTime;
        if(isMuted()) target = 0;
        musicGain.gain.cancelScheduledValues(now);
        musicGain.gain.setValueAtTime(musicGain.gain.value, now);
        musicGain.gain.linearRampToValueAtTime(target, now + 0.6);
    }

    // تطبيق كتم/رفع الصوت الحالي
    function applySettings(){
        var ctx = ensureCtx();
        if(!ctx) return;
        if(master) master.gain.value = outLevel();
        if(musicGain && musicTimer){ fadeMusicTo(musicLevel()); }
    }

    function setMuted(m){
        try{ localStorage.setItem(KEY_MUTED, m ? "1" : "0"); }catch(e){}
        applySettings();
    }

    function setVolume(v){
        v = Math.max(0, Math.min(1, v));
        try{ localStorage.setItem(KEY_VOL, String(v)); }catch(e){}
        applySettings();
    }

    function toggle(){
        unlock();
        var next = !storedMuted();
        setMuted(next);
        if(next) stopMusic(); // لا نترك الموسيقى تدور بصمت
        return next;
    }

    // ---------- ربط زر كتم عام ----------
    // يبحث عن #sfx-toggle-btn ويعرض الأيقونة حسب الحالة إن وُجد
    function initToggleBtn(btn){
        if(!btn) return;
        var apply = function(){
            btn.textContent = storedMuted() ? "🔇" : "🔊";
        };
        btn.addEventListener("click", function(){
            toggle();
            apply();
        });
        apply();
    }

    // استمع لأي فتح/إغلاق موسيقى حسب الشاشة النشطة (اختياري، يُشغَّل من game.js)
    function bindMusicToScreens(enabled){
        if(!enabled) return;
        var muted = document.getElementById("sfx-toggle-btn");
        if(muted) initToggleBtn(muted);
    }

    return {
        play: play,
        tone: tone,
        unlock: unlock,
        isMuted: isMuted,
        setMuted: setMuted,
        setVolume: setVolume,
        toggle: toggle,
        initToggleBtn: initToggleBtn,
        startMusic: startMusic,
        stopMusic: stopMusic,
        volume: storedVol
    };

})();