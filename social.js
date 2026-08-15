// ========================================
// الأصدقاء والرسائل الخاصة (Friends + Private Chat)
// ========================================
// طلب صداقة → قبول/رفض → أصدقاء → محادثة خاصة.
// كل الوصول عبر RPC برمز player_token (نفس نمط الدردشة العامة).
// الجرايات كلها SECURITY DEFINER، ولا نقرأ الجداول مباشرة إطلاقًا.

const Social = (function(){

    let badgeTimer = null;
    let dmTimer = null;
    let dmPeerId = null;

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

    function isOpen(){
        const s = document.getElementById("friends-screen");
        return s && s.classList.contains("active");
    }

    // ---------- badge ----------
    function badgeEl(){
        return document.getElementById("friends-notify-badge");
    }

    function showBadge(count){
        const el = badgeEl();
        if(!el) return;
        el.textContent = count;
        el.style.display = count > 0 ? "inline-flex" : "none";
    }

    function clearBadge(){
        const el = badgeEl();
        if(el) el.style.display = "none";
    }

    // عدد الرسائل الخاصة غير المقروءة + الطلبات الواردة المعلقة
    async function tickBadge(){
        const el = badgeEl();
        if(!el) return;
        if(isOpen()){ clearBadge(); return; }
        const token = getToken();
        if(!token){ clearBadge(); return; }
        try{
            const [dmRes, reqRes] = await Promise.all([
                supabaseClient.rpc("dm_unread", { p_token: token }),
                supabaseClient.rpc("friend_list_requests", { p_token: token })
            ]);
            let total = 0;
            if(dmRes && dmRes.data && dmRes.data.length){
                total += dmRes.data.reduce((a, r) => a + Number(r.unread || 0), 0);
            }
            if(reqRes && reqRes.data && Array.isArray(reqRes.data)){
                total += reqRes.data.filter(r => r.direction === "incoming").length;
            }
            showBadge(total);
        }catch(e){
            clearBadge();
        }
    }

    setInterval(function(){
        tickBadge();
    }, 6000);

    // ---------- open / close ----------
    function open(){
        openScreen("friends-screen");
        Social.switchTab(getCurrentTab());
        loadRequestsAndFriends();
        startBadgePolling();
    }

    let currentTab = "list";
    function getCurrentTab(){ return currentTab; }
    function setTab(t){ currentTab = t; }

    function startBadgePolling(){
        stopBadgePolling();
        badgeTimer = setInterval(function(){
            if(isOpen()){ clearBadge(); loadRequestsAndFriends(); }
            else stopBadgePolling();
        }, 5000);
    }
    function stopBadgePolling(){
        if(badgeTimer){ clearInterval(badgeTimer); badgeTimer = null; }
    }

    function switchTab(tab){
        setTab(tab);
        document.querySelectorAll(".friends-tab").forEach(btn =>
            btn.classList.toggle("active", btn.id === "tab-friends-" + tab));
        closeDm();
        if(tab === "list") loadFriends();
        else if(tab === "requests") loadRequestsAndFriends();
        else if(tab === "search") renderSearch();
    }

    // ---------- list ----------
    async function loadFriends(){
        const box = document.getElementById("friends-content");
        if(!box) return;
        box.innerHTML = '<div class="chat-loading">جاري التحميل...</div>';
        try{
            const { data, error } = await supabaseClient.rpc("friend_list", { p_token: getToken() });
            if(error) throw error;
            const friends = data || [];
            if(!friends.length){
                box.innerHTML = '<div class="chat-empty">لا يوجد أصدقاء بعد. 🫡 ابحث عن لاعبين من تبويب "بحث".</div>';
                return;
            }
            box.innerHTML = friends.map(f => `
                <div class="friend-row">
                    <div class="friend-avatar">${f.is_online ? '🟢' : '⚪'}</div>
                    <div class="friend-meta">
                        <div class="friend-name">${escapeHtml(f.username)}</div>
                        <div class="friend-status">${f.is_online ? "متصل الآن" : "غير متصل"}</div>
                    </div>
                    <div class="friend-actions">
                        <button class="friend-msg-btn" onclick="Social.openDm('${f.friend_id}','${escapeAttr(f.username)}')">💬</button>
                        <button class="friend-rm-btn" onclick="Social.removeFriend('${f.friend_id}')">🗑️</button>
                    </div>
                </div>`).join("");
        }catch(e){
            box.innerHTML = '<div class="chat-empty">تعذر جلب قائمة الأصدقاء</div>';
        }
    }

    // ---------- requests ----------
    async function loadRequestsAndFriends(){
        const box = document.getElementById("friends-content");
        if(!box) return;
        if(getCurrentTab() !== "requests") return;
        box.innerHTML = '<div class="chat-loading">جاري التحميل...</div>';
        try{
            const { data, error } = await supabaseClient.rpc("friend_list_requests", { p_token: getToken() });
            if(error) throw error;
            const reqs = (data || []).filter(r => r.direction === "incoming");
            const outs = (data || []).filter(r => r.direction === "outgoing");
            let html = "";

            if(reqs.length){
                html += '<div class="friends-group-title">طلبات واردة</div>';
                reqs.forEach(r => {
                    html += `
                        <div class="friend-row">
                            <div class="friend-avatar">👤</div>
                            <div class="friend-meta">
                                <div class="friend-name">${escapeHtml(r.peer_username)}</div>
                                <div class="friend-status">يريد إضافتك صديقًا</div>
                            </div>
                            <div class="friend-actions">
                                <button class="friend-accept-btn" onclick="Social.respond('${r.request_id}', true)">قبول</button>
                                <button class="friend-decline-btn" onclick="Social.respond('${r.request_id}', false)">رفض</button>
                            </div>
                        </div>`;
                });
            }

            if(outs.length){
                html += '<div class="friends-group-title">طلبات مرسلة</div>';
                outs.forEach(r => {
                    html += `
                        <div class="friend-row">
                            <div class="friend-avatar">👤</div>
                            <div class="friend-meta">
                                <div class="friend-name">${escapeHtml(r.peer_username)}</div>
                                <div class="friend-status">بانتظار القبول</div>
                            </div>
                            <div class="friend-actions">
                                <button class="friend-cancel-btn" onclick="Social.cancelRequest('${r.peer_id}')">إلغاء</button>
                            </div>
                        </div>`;
                });
            }

            if(!html){
                html = '<div class="chat-empty">لا توجد طلبات صداقة معلقة حاليًا</div>';
            }
            box.innerHTML = html;
        }catch(e){
            box.innerHTML = '<div class="chat-empty">تعذر تحميل الطلبات</div>';
        }
    }

    // ---------- search ----------
    function renderSearch(){
        const box = document.getElementById("friends-content");
        if(!box) return;
        box.innerHTML = `
            <div class="friends-search-row">
                <input id="friends-search-input" type="text" placeholder="اكتب اسم لاعب للبحث..." autocomplete="off">
                <button onclick="Social.doSearch()">بحث</button>
            </div>
            <div id="friends-search-results" class="friends-search-results"></div>`;
    }

    async function doSearch(){
        const input = document.getElementById("friends-search-input");
        const results = document.getElementById("friends-search-results");
        if(!input || !results) return;
        const q = input.value.trim();
        if(!q){ results.innerHTML = ""; return; }
        results.innerHTML = '<div class="chat-loading">جاري البحث...</div>';
        try{
            const { data, error } = await supabaseClient.rpc("friend_search", { p_token: getToken(), p_query: q });
            if(error) throw error;
            const rows = data || [];
            if(!rows.length){
                results.innerHTML = '<div class="chat-empty">لا توجد نتائج مطابقة</div>';
                return;
            }
            results.innerHTML = rows.map(r => `
                <div class="friend-row">
                    <div class="friend-avatar">👤</div>
                    <div class="friend-meta">
                        <div class="friend-name">${escapeHtml(r.username)}</div>
                        <div class="friend-status">${r.is_friend ? "أنتم أصدقاء" : "لاعب"}</div>
                    </div>
                    <div class="friend-actions">
                        ${r.is_friend
                            ? `<button class="friend-msg-btn" onclick="Social.openDm('${r.player_id}','${escapeAttr(r.username)}')">💬</button>`
                            : (r.outgoing_request_id
                                ? `<button class="friend-cancel-btn" onclick="Social.cancelRequest('${r.player_id}')">إلغاء الطلب</button>`
                                : `<button class="friend-accept-btn" onclick="Social.sendRequest('${r.player_id}')">إضافة</button>`)}
                    </div>
                </div>`).join("");
        }catch(e){
            results.innerHTML = '<div class="chat-empty">تعذر البحث</div>';
        }
    }

    async function sendRequest(playerId){
        try{
            await supabaseClient.rpc("friend_send_request", { p_token: getToken(), p_to_player_id: playerId });
            doSearch();
        }catch(e){ alert(e.message || "تعذر إرسال الطلب"); }
    }

    async function cancelRequest(peerId){
        try{
            await supabaseClient.rpc("friend_cancel_request", { p_token: getToken(), p_target_player_id: peerId });
            loadRequestsAndFriends();
            doSearch();
        }catch(e){ alert(e.message || "تعذر إلغاء الطلب"); }
    }

    async function respond(requestId, accept){
        try{
            await supabaseClient.rpc("friend_respond_request", { p_token: getToken(), p_request_id: requestId, p_accept: accept });
            loadRequestsAndFriends();
            if(accept){
                setTab("list");
                document.querySelectorAll(".friends-tab").forEach(btn =>
                    btn.classList.toggle("active", btn.id === "tab-friends-list"));
                loadFriends();
            }
        }catch(e){ alert(e.message || "تعذر تنفيذ العملية"); }
    }

    async function removeFriend(friendId){
        if(!confirm("هل تريد حذف هذا الصديق؟")) return;
        try{
            await supabaseClient.rpc("friend_remove", { p_token: getToken(), p_friend_id: friendId });
            loadFriends();
        }catch(e){ alert(e.message || "تعذر حذف الصديق"); }
    }

    // ---------- private chat ----------
    function openDm(peerId, peerName){
        dmPeerId = peerId;
        const wrap = document.getElementById("friends-dm-wrap");
        const content = document.getElementById("friends-content");
        if(wrap) wrap.classList.remove("hidden");
        if(content) content.style.display = "none";
        const title = document.getElementById("friends-dm-title");
        if(title) title.textContent = "💬 " + (peerName || "محادثة");
        loadDmMessages();
        startDmPolling();
    }

    function closeDm(){
        stopDmPolling();
        dmPeerId = null;
        const wrap = document.getElementById("friends-dm-wrap");
        const content = document.getElementById("friends-content");
        if(wrap) wrap.classList.add("hidden");
        if(content) content.style.display = "";
        const input = document.getElementById("friends-dm-input");
        if(input) input.value = "";
        const emoji = document.getElementById("friends-dm-emoji");
        if(emoji) emoji.classList.add("hidden");
    }

    function startDmPolling(){
        stopDmPolling();
        dmTimer = setInterval(function(){
            if(dmPeerId && isOpen()){
                loadDmMessages(false);
            }else{
                stopDmPolling();
            }
        }, 3000);
    }
    function stopDmPolling(){
        if(dmTimer){ clearInterval(dmTimer); dmTimer = null; }
    }

    let lastDmMessageId = null;

    async function loadDmMessages(forceScroll){
        const box = document.getElementById("friends-dm-messages");
        if(!box || !dmPeerId) return;
        try{
            const { data, error } = await supabaseClient.rpc("dm_get_messages", {
                p_token: getToken(), p_other_player_id: dmPeerId
            });
            if(error) throw error;
            renderDmMessages(data || [], forceScroll);
        }catch(e){
            box.innerHTML = '<div class="chat-empty">هذه المحادثة متاحة للأصدقاء فقط</div>';
        }
    }

    function renderDmMessages(messages, forceScroll){
        const box = document.getElementById("friends-dm-messages");
        if(!box) return;
        if(!messages.length){
            box.innerHTML = '<div class="chat-empty">لا توجد رسائل بعد، ابدأ المحادثة! 💬</div>';
            lastDmMessageId = null;
            return;
        }
        const me = localStorage.getItem("player_id");
        const newest = messages[messages.length - 1];
        if(!forceScroll && lastDmMessageId && newest && newest.id === lastDmMessageId) return;

        let html = "";
        for(const m of messages){
            html += dmMessageHtml(m, me);
        }
        box.innerHTML = html;
        box.scrollTop = box.scrollHeight;
        lastDmMessageId = newest ? newest.id : null;
    }

    function dmMessageHtml(m, me){
        const mine = String(m.sender_id) === String(me);
        const time = formatTime(m.created_at);
        let body = "";
        if(m.message) body += '<div class="chat-text">' + escapeHtml(m.message) + '</div>';
        if(m.image_url) body += '<img class="chat-image" loading="lazy" src="' + escapeHtml(m.image_url) + '" alt="صورة">';
        return '<div class="chat-msg ' + (mine ? "mine" : "theirs") + '" data-mid="' + m.id + '">' +
                '<div class="chat-bubble"><div class="chat-meta">' + time + '</div>' + body + '</div>' +
               '</div>';
    }

    async function send(){
        const input = document.getElementById("friends-dm-input");
        const statusEl = document.getElementById("friends-dm-status");
        const text = (input.value || "").trim();
        if(!text){ if(statusEl) statusEl.textContent = "✍️ اكتب رسالة أولًا"; return; }
        if(!dmPeerId){ if(statusEl) statusEl.textContent = "اختر صديقًا أولًا"; return; }
        if(statusEl) statusEl.textContent = "⏳ جاري الإرسال...";
        try{
            const { error } = await supabaseClient.rpc("dm_send_message", {
                p_token: getToken(), p_to_player_id: dmPeerId, p_message: text
            });
            if(error) throw error;
            input.value = "";
            if(statusEl) statusEl.textContent = "";
            loadDmMessages(true);
        }catch(e){
            if(statusEl) statusEl.textContent = "❌ " + (e.message || e);
        }
    }

    function toggleEmoji(){
        const panel = document.getElementById("friends-dm-emoji");
        if(!panel) return;
        if(panel.classList.contains("hidden")){
            if(!panel.children.length){
                let html = "";
                for(const e of EMOJIS){
                    html += '<button class="chat-emoji" type="button" onclick="Social.insertEmoji(\'' + e + '\')">' + e + '</button>';
                }
                panel.innerHTML = html;
            }
            panel.classList.remove("hidden");
        }else{
            panel.classList.add("hidden");
        }
    }

    function insertEmoji(emoji){
        const input = document.getElementById("friends-dm-input");
        if(input){ input.value += emoji; input.focus(); }
    }

    function pickImage(){
        const fileInput = document.getElementById("friends-dm-image-file");
        if(fileInput) fileInput.click();
    }

    async function sendImage(fileInput){
        const statusEl = document.getElementById("friends-dm-status");
        const file = fileInput && fileInput.files && fileInput.files[0];
        if(!file){ if(statusEl) statusEl.textContent = ""; return; }
        if(!dmPeerId){ if(statusEl) statusEl.textContent = "اختر صديقًا أولًا"; return; }
        if(file.size > 5 * 1024 * 1024){
            if(statusEl) statusEl.textContent = "❌ الصورة أكبر من 5MB";
            fileInput.value = "";
            return;
        }
        if(statusEl) statusEl.textContent = "⏳ جاري رفع الصورة...";
        const token = getToken();
        const safeName = token + "/" + Date.now() + "_" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        try{
            const { error: upError } = await supabaseClient.storage.from("chat-images").upload(safeName, file, { cacheControl: "3600", upsert: false });
            if(upError) throw upError;
            const { data } = supabaseClient.storage.from("chat-images").getPublicUrl(safeName);
            const { error } = await supabaseClient.rpc("dm_send_message", {
                p_token: token, p_to_player_id: dmPeerId, p_message: null, p_image_url: data.publicUrl
            });
            if(error) throw error;
            fileInput.value = "";
            if(statusEl) statusEl.textContent = "";
            loadDmMessages(true);
        }catch(e){
            if(statusEl) statusEl.textContent = "❌ " + (e.message || e);
            fileInput.value = "";
        }
    }

    function formatTime(iso){
        try{
            const d = new Date(iso);
            const now = new Date();
            if(d.toDateString() === now.toDateString()){
                return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
            }
            return d.getDate() + "/" + (d.getMonth() + 1) + " " +
                   d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
        }catch(e){ return ""; }
    }

    function escapeHtml(s){
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function escapeAttr(s){
        return String(s == null ? "" : s).replace(/'/g, "&#39;").replace(/"/g, "&quot;");
    }

    return {
        open,
        switchTab,
        sendRequest,
        cancelRequest,
        respond,
        removeFriend,
        doSearch,
        openDm,
        closeDm,
        send,
        toggleEmoji,
        insertEmoji,
        pickImage,
        sendImage,
        stopDmPolling,
        updateBadge: tickBadge,
        clearBadge
    };

})();

window.Social = Social;

// تحقق فوري بعد التحميل: ظهور شارة الأصدقاء إذا كانت مغلقة
setTimeout(function(){ Social.updateBadge(); }, 900);