// ===== الزنازين (Dungeons) / البوابات =====

let gatesCache = [];
let gatesMonsterCache = [];
let dungeonMonsterOrder = [];
let currentDungeonId = null;

function dungeonToken() {
    return localStorage.getItem("player_token");
}

function dungeonAdminToken() {
    return localStorage.getItem("admin_token");
}

async function ensureGatesMonsterCache() {
    if (gatesMonsterCache.length) return;
    try {
        let { data } = await supabaseClient
            .from("characters")
            .select("id,name")
            .eq("is_monster", true);
        gatesMonsterCache = data || [];
    } catch (e) {
        gatesMonsterCache = [];
    }
}

// ===== شاشة البوابات (قائمة الزنازين المتاحة للاعب) =====

async function loadGates() {
    let box = document.getElementById("gate-list");
    if (!box) return;
    box.innerHTML = "جاري تحميل الزنازين...";
    let token = dungeonToken();
    if (!token) {
        box.innerHTML = "<p class='empty-card'>يجب تسجيل الدخول أولاً</p>";
        return;
    }
    try {
        await ensureGatesMonsterCache();
        let { data, error } = await supabaseClient.rpc("dungeon_list_public", {
            p_token: token
        });
        if (error) throw error;
        gatesCache = data || [];
        if (gatesCache.length === 0) {
            box.innerHTML = "<p class='empty-card'>لا توجد زنازين متاحة حاليًا</p>";
            return;
        }
        let html = "";
        gatesCache.forEach(d => {
            let names = (d.monster_ids || []).map(id => {
                let m = gatesMonsterCache.find(x => x.id === id);
                return m ? escapeHtml(m.name) : "؟";
            });
            let repeatLabel =
                d.repeat_type === "daily" ? `يوميًا (${d.max_attempts})` :
                (d.repeat_type === "total" ? `إجماليًا (${d.max_attempts})` : "غير محدود");
            html += `
            <div class="character-card dungeon-card">
                <div class="admin-character-info">
                    <h3>${escapeHtml(d.name)} <span class="dungeon-grade">${escapeHtml(d.grade)}</span></h3>
                    <p class="admin-character-anime">${names.length} وحوش: ${names.join(" → ")}</p>
                    <p class="admin-character-stats">🪙 ${d.gold_prize} ذهب · 🔁 ${repeatLabel}</p>
                </div>
                <div class="admin-character-actions">
                    <button onclick="startDungeon('${d.id}')">🚪 دخول</button>
                </div>
            </div>`;
        });
        box.innerHTML = html;
    } catch (e) {
        console.log("loadGates error", e);
        box.innerHTML = "<p class='empty-card'>حدث خطأ في تحميل الزنازين</p>";
    }
}

function startDungeon(dungeonId) {
    let d = (gatesCache || []).find(x => x.id === dungeonId);
    if (!d) {
        alert("الزنزانة غير متاحة");
        return;
    }
    startDungeonBattle(d);
}

async function dungeonClaimReward(dungeonId) {
    let token = dungeonToken();
    if (!token) throw new Error("يجب تسجيل الدخول");
    let { data, error } = await supabaseClient.rpc("dungeon_claim_reward", {
        p_token: token,
        p_dungeon_id: dungeonId
    });
    if (error) throw error;
    if (data && data.length) return data[0];
    return { status: "success", gold_added: 0, remaining: -1 };
}

// تسليم جائزة قتل وحش فردي في PvE (ذهب + حد يومي)
async function pveClaimReward(monsterId) {
    let token = dungeonToken();
    if (!token) throw new Error("يجب تسجيل الدخول");
    let { data, error } = await supabaseClient.rpc("pve_claim_reward", {
        p_token: token,
        p_monster_id: monsterId
    });
    if (error) throw error;
    if (data && data.length) return data[0];
    return { status: "success", gold_added: 0, remaining: -1 };
}

// ===== لوحة الإدارة: إدارة الزنازين =====

async function loadAdminDungeons() {
    let box = document.getElementById("admin-dungeons-content");
    if (!box) return;
    box.innerHTML = "جاري تحميل الزنازين...";
    try {
        let { data, error } = await supabaseClient.rpc("admin_list_dungeons", {
            p_admin_token: dungeonAdminToken()
        });
        if (error) throw error;
        let list = data || [];
        if (list.length === 0) {
            box.innerHTML = "<p>لا توجد زنازين بعد</p>";
            return;
        }
        box.innerHTML = list.map(d => `
            <div class="admin-character-card">
                <div class="admin-character-info">
                    <h3>${escapeHtml(d.name)} <span class="dungeon-grade">${escapeHtml(d.grade)}</span></h3>
                    <p class="admin-character-stats">🪙 ${d.gold_prize} · 🔁 ${d.repeat_type} (${d.max_attempts})</p>
                    <p class="admin-character-owner">${d.monster_ids.length} وحوش ${d.active ? "· مفعّلة" : "· غير مفعّلة"}</p>
                </div>
                <div class="admin-character-actions">
                    <button onclick="openEditDungeon('${d.id}')">✏️ تعديل</button>
                    <button onclick="deleteDungeon('${d.id}')">🗑️ حذف</button>
                </div>
            </div>`).join("");
    } catch (e) {
        console.log("loadAdminDungeons error", e);
        box.innerHTML = "<p>حدث خطأ في تحميل الزنازين</p>";
    }
}

async function populateDungeonMonsterSelect() {
    let sel = document.getElementById("dungeon-monster-select");
    if (!sel) return;
    await ensureGatesMonsterCache();
    sel.innerHTML =
        '<option value="">اختر وحشًا...</option>' +
        gatesMonsterCache.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("");
}

function addMonsterToDungeonOrder() {
    let sel = document.getElementById("dungeon-monster-select");
    let v = sel ? sel.value : "";
    if (!v) { alert("اختر وحشًا أولاً"); return; }
    if (dungeonMonsterOrder.includes(v)) { alert("هذا الوحش مضاف بالفعل"); return; }
    dungeonMonsterOrder.push(v);
    renderDungeonMonsterOrder();
}

function renderDungeonMonsterOrder() {
    let box = document.getElementById("dungeon-monster-order");
    if (!box) return;
    if (dungeonMonsterOrder.length === 0) {
        box.innerHTML = "<p>لم تُضف وحوش بعد</p>";
        return;
    }
    box.innerHTML = dungeonMonsterOrder.map((id, i) => {
        let m = gatesMonsterCache.find(x => x.id === id);
        let name = m ? escapeHtml(m.name) : "؟";
        return `
        <div class="dungeon-order-chip">
            <span>${i + 1}. ${name}</span>
            <button type="button" onclick="moveDungeonMonster(${i}, -1)">▲</button>
            <button type="button" onclick="moveDungeonMonster(${i}, 1)">▼</button>
            <button type="button" onclick="removeDungeonMonster(${i})">✕</button>
        </div>`;
    }).join("");
}

function moveDungeonMonster(index, dir) {
    let j = index + dir;
    if (j < 0 || j >= dungeonMonsterOrder.length) return;
    let t = dungeonMonsterOrder[index];
    dungeonMonsterOrder[index] = dungeonMonsterOrder[j];
    dungeonMonsterOrder[j] = t;
    renderDungeonMonsterOrder();
}

function removeDungeonMonster(index) {
    dungeonMonsterOrder.splice(index, 1);
    renderDungeonMonsterOrder();
}

function resetDungeonForm() {
    currentDungeonId = null;
    dungeonMonsterOrder = [];
    let g = document.getElementById("dungeon-grade");
    if (g) g.value = "C";
    let name = document.getElementById("dungeon-name"); if (name) name.value = "";
    let gold = document.getElementById("dungeon-gold"); if (gold) gold.value = "";
    let repeat = document.getElementById("dungeon-repeat"); if (repeat) repeat.value = "unlimited";
    let maxA = document.getElementById("dungeon-max-attempts"); if (maxA) maxA.value = "";
    let active = document.getElementById("dungeon-active"); if (active) active.checked = true;
    renderDungeonMonsterOrder();
}

async function saveDungeon() {
    let name = (document.getElementById("dungeon-name").value || "").trim();
    if (!name) { alert("اكتب اسم الزنزانة"); return; }
    let grade = document.getElementById("dungeon-grade").value || "C";
    let gold = parseInt(document.getElementById("dungeon-gold").value) || 0;
    let repeat = document.getElementById("dungeon-repeat").value || "unlimited";
    let maxAttempts = parseInt(document.getElementById("dungeon-max-attempts").value) || 0;
    let active = document.getElementById("dungeon-active").checked;
    if (dungeonMonsterOrder.length === 0) { alert("أضف وحشًا واحدًا على الأقل"); return; }
    try {
        if (currentDungeonId) {
            let { error } = await supabaseClient.rpc("admin_save_dungeon", {
                p_admin_token: dungeonAdminToken(),
                p_dungeon_id: currentDungeonId,
                p_name: name,
                p_grade: grade,
                p_gold_prize: gold,
                p_repeat_type: repeat,
                p_max_attempts: maxAttempts,
                p_monster_ids: dungeonMonsterOrder,
                p_active: active
            });
            if (error) throw error;
        } else {
            let { error } = await supabaseClient.rpc("admin_add_dungeon", {
                p_admin_token: dungeonAdminToken(),
                p_name: name,
                p_grade: grade,
                p_gold_prize: gold,
                p_repeat_type: repeat,
                p_max_attempts: maxAttempts,
                p_monster_ids: dungeonMonsterOrder
            });
            if (error) throw error;
        }
        resetDungeonForm();
        loadAdminDungeons();
    } catch (e) {
        alert((e && e.message) ? e.message : "حدث خطأ في الحفظ");
    }
}

async function openEditDungeon(dungeonId) {
    let d = null;
    try {
        let { data } = await supabaseClient.rpc("admin_list_dungeons", {
            p_admin_token: dungeonAdminToken()
        });
        d = (data || []).find(x => x.id === dungeonId);
    } catch (e) {}
    if (!d) { alert("تعذر تحميل الزنزانة"); return; }
    currentDungeonId = d.id;
    document.getElementById("dungeon-name").value = d.name || "";
    document.getElementById("dungeon-grade").value = d.grade || "C";
    document.getElementById("dungeon-gold").value = d.gold_prize || 0;
    document.getElementById("dungeon-repeat").value = d.repeat_type || "unlimited";
    document.getElementById("dungeon-max-attempts").value = d.max_attempts || 0;
    document.getElementById("dungeon-active").checked = !!d.active;
    dungeonMonsterOrder = (d.monster_ids || []).slice();
    renderDungeonMonsterOrder();
    window.scrollTo(0, document.body.scrollHeight);
}

async function deleteDungeon(dungeonId) {
    if (!confirm("حذف هذه الزنزانة؟")) return;
    try {
        let { error } = await supabaseClient.rpc("admin_delete_dungeon", {
            p_admin_token: dungeonAdminToken(),
            p_dungeon_id: dungeonId
        });
        if (error) throw error;
        loadAdminDungeons();
    } catch (e) {
        alert((e && e.message) ? e.message : "حدث خطأ في الحذف");
    }
}
