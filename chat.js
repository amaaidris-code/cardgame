// ========================================
// الدردشة العامة (Messenger)
// ========================================
// رسائل نصية + صور، بترتيب تصاعدي (الأقدم أولًا)، تُحذف تلقائيًا بعد 7 أيام
// (الحذف يتم على الخادم داخل chat_get_messages عند كل جلب).
// كل الوصول يمر عبر دوال RPC (SECURITY DEFINER) برمز player_token،
// تمامًا مثل باقي اللعبة — لا يُقرأ الجدول مباشرة من العميل إطلاقًا.

const Chat = (function(){

    let timer = null;
    let lastMessageId = null;

    const EMOJIS = [
        "😀","😁","😂","🤣","😊","😍","😘","😜","🤪","😎",
        "🤩","🥳","😏","😢","😭","😡","🤬","🥺","😴","🤔",
        "😅","🙂","😉","😇","🤗","🤭","🫣","😱","😳","🥵",
        "👋","👍","👎","👏","🙏","💪","🤝","✌️","🤞","🫶",
        "❤️","💔","💯","🔥","⚡","🎉","✨","🎁","🏆","💎",
        "🍀","⚔️","🛡️","💀","👹","😈","🤡","🎮","🎴","🃏"
    ];

    function getToken(){
        return localStorage.getItem("player_token");
    }

    // وقت آخر رسالة شاهدناها (نقرأ منها لمعرفة الجديد)
    function getLastSeen(){
        return localStorage.getItem("chat_last_seen") || null;
    }

    function setLastSeen(iso){
        if(iso) localStorage.setItem("chat_last_seen", iso);
    }

    function badgeEl(){
        return document.getElementById("chat-notify-badge");
    }

    function clearBadge(){
        const el = badgeEl();
        if(el) el.style.display = "none";
    }

    function showBadge(count){
        const el = badgeEl();
        if(!el) return;
        el.textContent = count;
        el.style.display = count > 0 ? "inline-flex" : "none";
    }

    // شارة "رسالة جديدة" على زر الدردشة في القائمة الرئيسية، تعمل حتى
    // عندما تكون الدردشة مغلقة (مثل شارة طلبات المهارات في لوحة الإدارة)
    async function tickBadge(){
        const el = badgeEl();
        if(!el) return;

        const token = getToken();
        if(!token){ clearBadge(); return; }

        // أثناء فتح الدردشة تُحدَّث كُلما وصلت رسالة جديدة، فلا تظهر شارة
        if(isChatOpen()){ clearBadge(); return; }

        try{
            const { data, error } = await supabaseClient.rpc("chat_unread", {
                p_token: token,
                p_since: getLastSeen()
            });
            if(error) throw error;
            const row = data && data[0];
            const unread = row ? Number(row.unread) : 0;
            // نُحدّث "آخر مشاهدة" بأحدث رسالة فقط إن لم يتبقَّ جديد (لا نسجّل
            // القراءة قبل أن يفتح اللاعب الدردشة فعليًا)
            if(unread === 0 && row && row.latest){
                setLastSeen(row.latest);
            }
            showBadge(unread);
        }catch(e){
            console.log("chat badge error", e);
            clearBadge();
        }
    }

    function isChatOpen(){
        const s = document.getElementById("chat-screen");
        return s && s.classList.contains("active");
    }

    function openChat(){
        openScreen("chat-screen");
        // عند فتح الدردشة نُعتبر كل شيء مقروءًا فورًا ونخفي الشارة
        clearBadge();
        startChat();
    }

    function stopChat(){
        if(timer){
            clearInterval(timer);
            timer = null;
        }
    }

    function startChat(){
        lastMessageId = null;
        refreshChat();
        stopChat();
        timer = setInterval(function(){
            if(isChatOpen()){
                refreshChat();
            }else{
                stopChat();
            }
        }, 3000);
    }

    // شارة الرسائل تُحدَّث دوريًا حتى عندما تكون الدردشة مغلقة
    setInterval(function(){
        tickBadge();
    }, 5000);

    async function refreshChat(){
        const token = getToken();
        if(!token) return;

        const statusEl = document.getElementById("chat-status");
        if(statusEl) statusEl.textContent = "";

        try{
            const { data, error } = await supabaseClient.rpc("chat_get_messages", {
                p_token: token
            });

            if(error) throw error;
            renderMessages(data || []);
        }catch(e){
            console.log("chat refresh error", e);
        }
    }

    function renderMessages(messages){
        const box = document.getElementById("chat-messages");
        if(!box) return;

        if(!messages.length){
            box.innerHTML = '<div class="chat-empty">لا توجد رسائل بعد، كن أول من يكتب! 💬</div>';
            lastMessageId = null;
            return;
        }

        const me = localStorage.getItem("player_id");

        // إذا لم تتغير آخر رسالة، لا نعيد بناء القائمة (نتجنّب قفز الصفحة أثناء القراءة)
        const newest = messages[messages.length - 1];
        if(lastMessageId && newest && newest.id === lastMessageId){
            return;
        }

        // أثناء فتح الدردشة نتقدّم بآخر مشاهدة ونخفي الشارة
        if(isChatOpen() && newest){
            setLastSeen(newest.created_at);
            clearBadge();
        }

        let html = "";
        for(const m of messages){
            html += messageHtml(m, me);
        }

        const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 60;
        const ownLatest = newest.player_id === me;
        box.innerHTML = html;

        // أول تحميل أو وصول رسالة جديدة: انزل للأسفل. عند قراءة أقدم لا نحرّك قسرًا.
        if(!lastMessageId || atBottom || ownLatest){
            box.scrollTop = box.scrollHeight;
        }

        lastMessageId = newest ? newest.id : null;
    }

    function messageHtml(m, me){
        const mine = m.player_id === me;
        const time = formatTime(m.created_at);

        let body = "";
        if(m.message){
            body += '<div class="chat-text">' + escapeHtml(m.message) + '</div>';
        }
        if(m.image_url){
            body += '<img class="chat-image" loading="lazy" src="' + escapeHtml(m.image_url) + '" alt="صورة">';
        }

        return '<div class="chat-msg ' + (mine ? "mine" : "theirs") + '" data-mid="' + m.id + '">' +
                    '<div class="chat-bubble">' +
                        '<div class="chat-meta">' + escapeHtml(m.username) + ' · ' + time + '</div>' +
                        body +
                    '</div>' +
                '</div>';
    }

    function appendMessage(m){
        const me = localStorage.getItem("player_id");
        const box = document.getElementById("chat-messages");
        if(!box) return [];

        if(box.querySelector(".chat-empty")){
            box.innerHTML = "";
        }

        box.insertAdjacentHTML("beforeend", messageHtml(m, me));
        box.scrollTop = box.scrollHeight;
        lastMessageId = m.id;
        return [m];
    }

    function formatTime(iso){
        try{
            const d = new Date(iso);
            const now = new Date();
            const sameDay = d.toDateString() === now.toDateString();
            if(sameDay){
                return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
            }
            return d.getDate() + "/" + (d.getMonth() + 1) + " " +
                   d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
        }catch(e){
            return "";
        }
    }

    function escapeHtml(s){
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    async function sendChatMessage(){
        const input = document.getElementById("chat-input");
        const text = (input.value || "").trim();
        const statusEl = document.getElementById("chat-status");

        if(!text){
            if(statusEl) statusEl.textContent = "✍️ اكتب رسالة أولًا";
            return;
        }

        const token = getToken();
        if(!token){
            if(statusEl) statusEl.textContent = "❌ سجّل الدخول أولًا";
            return;
        }

        if(statusEl) statusEl.textContent = "⏳ جاري الإرسال...";
        try{
            const { data, error } = await supabaseClient.rpc("chat_send_message", {
                p_token: token,
                p_message: text
            });

            if(error) throw error;

            input.value = "";
            if(statusEl) statusEl.textContent = "";

            // حدّث فورًا بالرسالة المرسلة ثم تُعيد الجلبة الدورية التأكد
            if(data && data.length){
                renderMessages(appendMessage(data[0]));
            }
            refreshChat();
        }catch(e){
            if(statusEl) statusEl.textContent = "❌ فشل الإرسال: " + (e.message || e);
        }
    }

    // ============ الإيموجي ============
    function toggleChatEmojiPanel(){
        const panel = document.getElementById("chat-emoji-panel");
        if(!panel) return;
        if(panel.classList.contains("hidden")){
            if(!panel.children.length){
                let html = "";
                for(const e of EMOJIS){
                    html += '<button class="chat-emoji" type="button" onclick="Chat.insertEmoji(\'' + e + '\')">' + e + '</button>';
                }
                panel.innerHTML = html;
            }
            panel.classList.remove("hidden");
        }else{
            panel.classList.add("hidden");
        }
    }

    function insertEmoji(emoji){
        const input = document.getElementById("chat-input");
        if(input){
            input.value += emoji;
            input.focus();
        }
    }

    // ============ الصور ============
    async function sendChatImage(fileInput){
        const statusEl = document.getElementById("chat-status");
        const file = fileInput && fileInput.files && fileInput.files[0];
        if(!file){
            if(statusEl) statusEl.textContent = "";
            return;
        }

        const token = getToken();
        if(!token){
            if(statusEl) statusEl.textContent = "❌ سجّل الدخول أولًا";
            return;
        }

        if(file.size > 5 * 1024 * 1024){
            if(statusEl) statusEl.textContent = "❌ الصورة أكبر من 5MB";
            fileInput.value = "";
            return;
        }

        if(statusEl) statusEl.textContent = "⏳ جاري رفع الصورة...";

        // الرمز أول جزء من المسار؛ سياسة التخزين تتحقق من صلاحيته فعليًا قبل القبول
        const safeName =
            token + "/" + Date.now() + "_" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

        try{
            const { error: upError } = await supabaseClient
                .storage
                .from("chat-images")
                .upload(safeName, file, { cacheControl: "3600", upsert: false });

            if(upError) throw upError;

            const { data } = supabaseClient
                .storage
                .from("chat-images")
                .getPublicUrl(safeName);

            const imgUrl = data.publicUrl;

            const { data: row, error } = await supabaseClient.rpc("chat_send_message", {
                p_token: token,
                p_message: null,
                p_image_url: imgUrl
            });

            if(error) throw error;

            fileInput.value = "";
            if(statusEl) statusEl.textContent = "";

            if(row && row.length){
                renderMessages(appendMessage(row[0]));
            }
            refreshChat();
        }catch(e){
            if(statusEl) statusEl.textContent = "❌ فشل رفع الصورة: " + (e.message || e);
            fileInput.value = "";
        }
    }

    return {
        openChat,
        stopChat,
        sendChatMessage,
        toggleChatEmojiPanel,
        insertEmoji,
        sendChatImage,
        updateBadge: tickBadge,
        clearBadge
    };

})();

window.openChat = Chat.openChat;
window.stopChat = Chat.stopChat;
window.sendChatMessage = Chat.sendChatMessage;
window.toggleChatEmojiPanel = Chat.toggleChatEmojiPanel;
window.insertEmoji = Chat.insertEmoji;
window.sendChatImage = Chat.sendChatImage;
window.updateChatBadge = Chat.updateBadge;
window.clearChatBadge = Chat.clearBadge;

// تحقّق فوري بعد التحميل: لو كانت الدردشة مغلقة تظهر الشارة مباشرة
setTimeout(function(){ Chat.updateBadge(); }, 800);
