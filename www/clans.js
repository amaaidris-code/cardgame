// ========================================
// العصابة (Clans)
// ========================================
// إنشاء عصابة / انضمام / مغادرة / إدارة الأعضاء / محادثة خاصة بالعصابة.
// القائد والمشرفون فقط يمكنهم تعديل اسم وصورة العصابة.
// كل الوصول عبر RPC برمز player_token (نفس نمط الدردخة والأصدقاء).
// جميع الدوال SECURITY DEFINER، ولا نقرأ الجداول مباشرة إطلاقًا.

const Clans = (function(){

    let timer = null;

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

    function getPlayerId(){
        return localStorage.getItem("player_id");
    }

    function box(){
        return document.getElementById("clans-content");
    }

    function isOpen(){
        const s = document.getElementById("clans-screen");
        return s && s.classList.contains("active");
    }

    // ---------- open / close ----------
    function open(){
        openScreen("clans-screen");
        load();
    }

    // ---------- main load : my clan or create/search ----------
    // ---------- main load : my clan(s) or create/search ----------
    let currentClanId = null;

    async function load(){
        const b = box();
        if(!b) return;
        b.innerHTML = '<div class="chat-loading">جاري التحميل...</div>';
        try{
            const { data, error } = await supabaseClient.rpc("clan_my_clan", { p_token: getToken() });
            if(error) throw error;
            if(!data || !data.length){
                currentClanId = null;
                renderNoClan();
            }else{
                if(!currentClanId || !data.some(c => String(c.clan_id) === String(currentClanId))){
                    currentClanId = data[0].clan_id;
                }
                const clan = data.find(c => String(c.clan_id) === String(currentClanId)) || data[0];
                renderClan(clan, data);
                pollClanChat();
            }
        }catch(e){
            b.innerHTML = '<div class="chat-empty">تعذر تحميل بيانات العصابة</div>';
        }
    }

    function switchClan(clanId){
        currentClanId = clanId;
        load();
    }

    // ---------- no clan : tabs (create / join) ----------
    let noClanTab = "join";
    function renderNoClan(){
        const b = box();
        b.innerHTML = `
            <div class="friends-tabs">
                <button id="clan-ntab-join" class="friends-tab ${noClanTab==='join'?'active':''}" onclick="Clans.switchNoTab('join')">انضم لعصابة</button>
                <button id="clan-ntab-create" class="friends-tab ${noClanTab==='create'?'active':''}" onclick="Clans.switchNoTab('create')">أنشئ عصابة</button>
            </div>
            <div id="clans-tab-content"></div>`;
        noTabRender();
    }

    function switchNoTab(t){
        noClanTab = t;
        const b = box();
        b.innerHTML = "";
        renderNoClan();
    }

    function noTabRender(){
        const c = document.getElementById("clans-tab-content");
        if(!c) return;
        if(noClanTab === "create"){ renderCreate(c); }
        else { renderJoin(c); }
    }

    function renderCreate(c){
        c.innerHTML = `
            <div class="form-box">
                <input id="clan-create-name" type="text" placeholder="اسم العصابة (فريد)" autocomplete="off">
                <div class="friends-search-row">
                    <button class="friend-accept-btn" onclick="Clans.createClan()">⬅️ أنشئ العصابة</button>
                </div>
                <p class="upload-status" id="clan-create-status"></p>
            </div>`;
    }

    function renderJoin(c){
        c.innerHTML = `
            <div class="friends-search-row">
                <input id="clans-search-input" type="text" placeholder="ابحث عن عصابة..." autocomplete="off">
                <button onclick="Clans.doSearch()">بحث</button>
            </div>
            <div class="form-box">
                <input id="clan-join-name" type="text" placeholder="أو اكتب الاسم مباشرة للانضمام" autocomplete="off">
                <div class="friends-search-row">
                    <button class="friend-accept-btn" onclick="Clans.joinByName()">انضم</button>
                </div>
                <p class="upload-status" id="clan-join-status"></p>
            </div>
            <div id="clans-search-results" class="friends-search-results"></div>`;
    }

    async function doSearch(){
        const input = document.getElementById("clans-search-input");
        const results = document.getElementById("clans-search-results");
        if(!input || !results) return;
        const q = input.value.trim();
        if(!q){ results.innerHTML = "<div class='chat-empty'>اكتب اسم عصابة للبحث</div>"; return; }
        results.innerHTML = '<div class="chat-loading">جاري البحث...</div>';
        try{
            const { data, error } = await supabaseClient.rpc("clan_search", { p_token: getToken(), p_query: q });
            if(error) throw error;
            const rows = data || [];
            if(!rows.length){
                results.innerHTML = "<div class='chat-empty'>لا توجد عصابات مطابقة</div>";
                return;
            }
            results.innerHTML = rows.map(r => `
                <div class="friend-row">
                    <div class="friend-avatar">🛡️</div>
                    <div class="friend-meta">
                        <div class="friend-name">${escapeHtml(r.name)}</div>
                        <div class="friend-status">${r.member_count} عضو${r.is_member ? " • أنت عضو" : ""}</div>
                    </div>
                    <div class="friend-actions">
                        <button class="friend-accept-btn" onclick="Clans.joinById('${r.clan_id}')">انضم</button>
                    </div>
                </div>`).join("");
        }catch(e){
            results.innerHTML = "<div class='chat-empty'>تعذر البحث</div>";
        }
    }

    // ---------- actions ----------
    async function createClan(){
        const input = document.getElementById("clan-create-name");
        const status = document.getElementById("clan-create-status");
        const name = input.value.trim();
        if(!name){ if(status) status.textContent = "✍️ اكتب اسمًا أولًا"; return; }
        if(status) status.textContent = "⏳ جاري الإنشاء...";
        try{
            const { data, error } = await supabaseClient.rpc("clan_create", { p_token: getToken(), p_name: name, p_image_url: null });
            if(error) throw error;
            load();
        }catch(e){
            if(status) status.textContent = "❌ " + (e.message || e);
        }
    }

    async function joinByName(){
        const status = document.getElementById("clan-join-status");
        const input = document.getElementById("clan-join-name");
        const name = input.value.trim();
        if(!name){ if(status) status.textContent = "✍️ اكتب اسم العصابة"; return; }
        if(status) status.textContent = "⏳ جاري البحث...";
        try{
            const { data, error } = await supabaseClient.rpc("clan_search", { p_token: getToken(), p_query: name });
            if(error) throw error;
            const rows = (data || []).filter(r => r.name.toLowerCase() === name.toLowerCase());
            if(!rows.length){
                if(status) status.textContent = "❌ لا توجد عصابة بهذا الاسم";
                return;
            }
            await supabaseClient.rpc("clan_join", { p_token: getToken(), p_clan_id: rows[0].clan_id });
            load();
        }catch(e){
            if(status) status.textContent = "❌ " + (e.message || e);
        }
    }

    async function joinById(clanId){
        try{
            const { error } = await supabaseClient.rpc("clan_join", { p_token: getToken(), p_clan_id: clanId });
            if(error) throw error;
            load();
        }catch(e){ alert(e.message || "تعذر الانضمام"); }
    }

    async function leaveClan(){
        if(!confirm("هل تريد مغادرة العصابة؟")) return;
        try{
            const { error } = await supabaseClient.rpc("clan_leave", { p_token: getToken(), p_clan_id: currentClanId });
            if(error) throw error;
            load();
        }catch(e){ alert(e.message || "تعذر المغادرة"); }
    }

    async function promote(playerId){
        try{
            const { error } = await supabaseClient.rpc("clan_promote", { p_token: getToken(), p_clan_id: currentClanId, p_player_id: playerId });
            if(error) throw error;
            load();
        }catch(e){ alert(e.message || e); }
    }

    async function demote(playerId){
        try{
            const { error } = await supabaseClient.rpc("clan_demote", { p_token: getToken(), p_clan_id: currentClanId, p_player_id: playerId });
            if(error) throw error;
            load();
        }catch(e){ alert(e.message || e); }
    }

    async function kick(playerId){
        if(!confirm("هل تريد طرد هذا العضو؟")) return;
        try{
            const { error } = await supabaseClient.rpc("clan_kick", { p_token: getToken(), p_clan_id: currentClanId, p_player_id: playerId });
            if(error) throw error;
            load();
        }catch(e){ alert(e.message || e); }
    }

    // ---------- edit name / image (leader + admin only) ----------
    async function editName(){
        const cur = prompt("الاسم الحالي: اكتب الاسم الجديد للعصابة");
        if(cur === null) return;
        const name = cur.trim();
        if(!name){ alert("الاسم لا يمكن أن يكون فارغًا"); return; }
        try{
            const { error } = await supabaseClient.rpc("clan_update", { p_token: getToken(), p_clan_id: currentClanId, p_name: name, p_image_url: null });
            if(error) throw error;
            load();
        }catch(e){ alert(e.message || e); }
    }

    function pickImage(){
        const fi = document.getElementById("clan-image-file");
        if(fi) fi.click();
    }

    async function sendImage(fileInput){
        const status = document.getElementById("clans-edit-status");
        const file = fileInput && fileInput.files && fileInput.files[0];
        if(!file){ if(status) status.textContent = ""; return; }
        if(file.size > 5 * 1024 * 1024){
            if(status) status.textContent = "❌ الصورة أكبر من 5MB";
            fileInput.value = "";
            return;
        }
        if(status) status.textContent = "⏳ جاري رفع الصورة...";
        const token = getToken();
        const safeName = token + "/clan_" + Date.now() + "_" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        try{
            const { error: upError } = await supabaseClient.storage.from("chat-images").upload(safeName, file, { cacheControl: "3600", upsert: false });
            if(upError) throw upError;
            const { data } = supabaseClient.storage.from("chat-images").getPublicUrl(safeName);
            const { error } = await supabaseClient.rpc("clan_update", { p_token: token, p_clan_id: currentClanId, p_name: null, p_image_url: data.publicUrl });
            if(error) throw error;
            fileInput.value = "";
            if(status) status.textContent = "";
            load();
        }catch(e){
            if(status) status.textContent = "❌ " + (e.message || e);
            fileInput.value = "";
        }
    }

    // ---------- render clan view ----------
    async function renderClan(clan, allClans){
        const me = getPlayerId();
        const canEdit = clan.my_role === "leader" || clan.my_role === "admin";
        let membersHtml = "";
        try{
            const { data, error } = await supabaseClient.rpc("clan_list_members", { p_token: getToken(), p_clan_id: clan.clan_id });
            if(!error && data){
                membersHtml = data.map(m => memberRow(m, clan.my_role, me)).join("");
            }
        }catch(e){ membersHtml = ""; }

        const img = clan.image_url ? `<img class="clan-banner" src="${escapeHtml(clan.image_url)}" alt="صورة العصابة">` : "";
        const editControls = canEdit ? `
            <div class="clan-edit-row">
                <button onclick="Clans.editName()">✏️ تعديل الاسم</button>
                <button onclick="Clans.pickImage()">🖼️ تغيير الصورة</button>
                <input type="file" id="clan-image-file" accept="image/*" style="display:none;" onchange="Clans.sendImage(this)">
                <span class="upload-status" id="clans-edit-status"></span>
            </div>` : "";

        const b = box();
        const switchTabs = (allClans && allClans.length > 1) ? `
            <div class="friends-tabs">
                ${allClans.map(c => `
                    <button class="friends-tab ${String(c.clan_id)===String(clan.clan_id)?'active':''}" onclick="Clans.switchClan('${c.clan_id}')">🛡️ ${escapeHtml(c.name)}</button>
                `).join("")}
            </div>` : "";
        b.innerHTML = `
            ${switchTabs}
            <div class="clan-header">
                ${img}
                <div class="clan-title">🛡️ ${escapeHtml(clan.name)}</div>
                <div class="friend-status">${clan.member_count} عضو • دوري: ${roleLabel(clan.my_role)}</div>
                ${editControls}
            </div>

            <div class="friends-group-title">الأعضاء (${membersHtml.length ? "" : ""})</div>
            ${membersHtml || '<div class="chat-empty">لا يوجد أعضاء</div>'}

            <div class="clan-chat-title">💬 دردشة العصابة</div>
            <div id="clan-chat-box" class="chat-box">
                <div id="clan-chat-messages" class="chat-messages">
                    <div class="chat-loading">جاري تحميل الرسائل...</div>
                </div>
                <div id="clan-chat-emoji" class="chat-emoji-panel hidden"></div>
                <div class="chat-input-row">
                    <button class="chat-tool-btn" onclick="Clans.toggleEmoji()" title="إيموجي">😊</button>
                    <button class="chat-tool-btn" onclick="Clans.pickChatImage()" title="إرسال صورة">🖼️</button>
                    <input type="file" id="clan-chat-image-file" accept="image/*" style="display:none;" onchange="Clans.sendChatImage(this)">
                    <input id="clan-chat-input" type="text" placeholder="اكتب رسالة لفرقة العصابة..." autocomplete="off">
                    <button onclick="Clans.send()">إرسال</button>
                </div>
                <p id="clan-chat-status" class="upload-status"></p>
            </div>

            <div class="clans-leave-row">
                <button onclick="Clans.leaveClan()" class="friend-rm-btn">🚪 مغادرة العصابة</button>
            </div>`;

        lastClanMessageId = null;
        loadClanChat();
    }

    function memberRow(m, myRole, me){
        const isMe = String(m.player_id) === String(me);
        let actions = "";
        if(myRole === "leader" && !isMe){
            if(m.role === "admin"){
                actions = `<button class="friend-decline-btn" title="إزالة مشرف" onclick="Clans.demote('${m.player_id}')">↘</button>`;
            }else{
                actions = `<button class="friend-accept-btn" title="رفع مشرف" onclick="Clans.promote('${m.player_id}')">↗</button>`;
            }
            actions += `<button class="friend-rm-btn" title="طرد" onclick="Clans.kick('${m.player_id}')">🗑️</button>`;
        }else if((myRole === "leader" || myRole === "admin") && !isMe && m.role !== "leader" && m.role !== "admin"){
            actions = `<button class="friend-rm-btn" title="طرد" onclick="Clans.kick('${m.player_id}')">🗑️</button>`;
        }
        return `
            <div class="friend-row">
                <div class="friend-avatar">${m.role === "leader" ? "👑" : m.role === "admin" ? "🛡️" : "⚔️"}</div>
                <div class="friend-meta">
                    <div class="friend-name">${escapeHtml(m.username)} ${isMe ? "(أنت)" : ""}</div>
                    <div class="friend-status">${roleLabel(m.role)}</div>
                </div>
                <div class="friend-actions">${actions}</div>
            </div>`;
    }

    // ---------- clan chat ----------
    let lastClanMessageId = null;

    function stopPolling(){
        if(timer){ clearInterval(timer); timer = null; }
    }

    function pollClanChat(){
        // استطلاع الرسائل أثناء بقاء شاشة العصابة مفتوحة
        stopPolling();
        timer = setInterval(function(){
            if(!isOpen()){ stopPolling(); return; }
            const msgs = document.getElementById("clan-chat-messages");
            if(msgs) loadClanChat(false);
        }, 3000);
    }

    async function loadClanChat(forceScroll){
        const msgs = document.getElementById("clan-chat-messages");
        if(!msgs) return;
        try{
            const { data, error } = await supabaseClient.rpc("clan_get_messages", { p_token: getToken(), p_clan_id: currentClanId });
            if(error) throw error;
            const list = data || [];
            if(!list.length){
                msgs.innerHTML = '<div class="chat-empty">لا توجد رسائل بعد، ابدأ الدردشة! 💬</div>';
                lastClanMessageId = null;
                return;
            }
            const newest = list[list.length - 1];
            if(!forceScroll && lastClanMessageId && newest && newest.id === lastClanMessageId) return;
            const me = getPlayerId();
            msgs.innerHTML = list.map(m => {
                const mine = String(m.sender_id) === String(me);
                let body = "";
                if(m.message) body += '<div class="chat-text">' + escapeHtml(m.message) + '</div>';
                if(m.image_url) body += '<img class="chat-image" loading="lazy" src="' + escapeHtml(m.image_url) + '" alt="صورة">';
                return '<div class="chat-msg ' + (mine ? "mine" : "theirs") + '">' +
                        '<div class="chat-bubble"><div class="chat-meta">' + escapeHtml(m.sender_username) + ' • ' + formatTime(m.created_at) + '</div>' + body + '</div>' +
                       '</div>';
            }).join("");
            msgs.scrollTop = msgs.scrollHeight;
            lastClanMessageId = newest ? newest.id : null;
        }catch(e){
            msgs.innerHTML = '<div class="chat-empty">يجب أن تكون عضوًا في العصابة لرؤية الدردشة</div>';
        }
    }

    async function send(){
        const input = document.getElementById("clan-chat-input");
        const status = document.getElementById("clan-chat-status");
        const text = (input.value || "").trim();
        if(!text){ if(status) status.textContent = "✍️ اكتب رسالة أولًا"; return; }
        if(status) status.textContent = "⏳ جاري الإرسال...";
        try{
            const { error } = await supabaseClient.rpc("clan_send_message", { p_token: getToken(), p_clan_id: currentClanId, p_message: text, p_image_url: null });
            if(error) throw error;
            input.value = "";
            if(status) status.textContent = "";
            loadClanChat(true);
        }catch(e){
            if(status) status.textContent = "❌ " + (e.message || e);
        }
    }

    function pickChatImage(){
        const fi = document.getElementById("clan-chat-image-file");
        if(fi) fi.click();
    }

    async function sendChatImage(fileInput){
        const status = document.getElementById("clan-chat-status");
        const file = fileInput && fileInput.files && fileInput.files[0];
        if(!file){ if(status) status.textContent = ""; return; }
        if(file.size > 5 * 1024 * 1024){
            if(status) status.textContent = "❌ الصورة أكبر من 5MB";
            fileInput.value = "";
            return;
        }
        if(status) status.textContent = "⏳ جاري رفع الصورة...";
        const token = getToken();
        const safeName = token + "/clanchat_" + Date.now() + "_" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        try{
            const { error: upError } = await supabaseClient.storage.from("chat-images").upload(safeName, file, { cacheControl: "3600", upsert: false });
            if(upError) throw upError;
            const { data } = supabaseClient.storage.from("chat-images").getPublicUrl(safeName);
            const { error } = await supabaseClient.rpc("clan_send_message", { p_token: token, p_clan_id: currentClanId, p_message: null, p_image_url: data.publicUrl });
            if(error) throw error;
            fileInput.value = "";
            if(status) status.textContent = "";
            loadClanChat(true);
        }catch(e){
            if(status) status.textContent = "❌ " + (e.message || e);
            fileInput.value = "";
        }
    }

    function toggleEmoji(){
        const panel = document.getElementById("clan-chat-emoji");
        if(!panel) return;
        if(panel.classList.contains("hidden")){
            if(!panel.children.length){
                let html = "";
                for(const e of EMOJIS){
                    html += '<button class="chat-emoji" type="button" onclick="Clans.insertEmoji(\'' + e + '\')">' + e + '</button>';
                }
                panel.innerHTML = html;
            }
            panel.classList.remove("hidden");
        }else{
            panel.classList.add("hidden");
        }
    }

    function insertEmoji(emoji){
        const input = document.getElementById("clan-chat-input");
        if(input){ input.value += emoji; input.focus(); }
    }

    // ---------- helpers ----------
    function roleLabel(role){
        if(role === "leader") return "👑 قائد";
        if(role === "admin") return "🛡️ مشرف";
        return "⚔️ عضو";
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

    return {
        open,
        stopPolling,
        switchClan,
        switchNoTab,
        createClan,
        doSearch,
        joinByName,
        joinById,
        leaveClan,
        promote,
        demote,
        kick,
        editName,
        pickImage,
        sendImage,
        send,
        pickChatImage,
        sendChatImage,
        toggleEmoji,
        insertEmoji
    };

})();

window.Clans = Clans;