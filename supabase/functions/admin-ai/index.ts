import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// قوائم النماذج المتاحة عند كل مزوّد. نجرّب النموذج المضبوط في الإعدادات أولًا
// ثم نتنقل إلى نماذج أخرى، ثم إلى مزوّد آخر (Gemini → Groq → Cerebras).
const GEMINI_MODELS = [
  Deno.env.get("GEMINI_MODEL"),
  "gemini-3.6-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash"
].filter((m): m is string => !!m && m.trim() !== "");

const GROQ_MODELS = [
  Deno.env.get("GROQ_MODEL"),
  "openai/gpt-oss-120b",
  "groq/compound-mini"
].filter((m): m is string => !!m && m.trim() !== "");

const CEREBRAS_MODELS = [
  Deno.env.get("CEREBRAS_MODEL"),
  "llama-3.3-70b",
  "llama-3.1-8b-instant"
].filter((m): m is string => !!m && m.trim() !== "");

const SCHEMAS = {
  character: '{"name":"string","anime":"string","hp":"number 40..1000","atk":"number 40..1000","level":"number 1..1000 (default 1)","quote":"string","power_name":"string","power_description":"string","gold_prize":"number 0..5000","glow_color":"hex color string like #ff0000 (optional)","skills":[{"name":"string","type":"attack|defense|special","damage":"number 0..999","cooldown":"number of turns 0..20","effect":"control|reflect|absorb|heal|shield|poison|steal|copy|freeze|seal|unseal|shadow|unblockable|lifesteal| empty string","description":"string optional"}]}',
  monster: '{"name":"string","anime":"string","hp":"number 100..2000","atk":"number 80..1000","level":"number 1..1000 (default 1)","quote":"string","power_name":"string","power_description":"string","gold_prize":"number 0..5000","glow_color":"hex color string like #ff0000 (optional)","skills":[{"name":"string","type":"attack|defense|special","damage":"number 0..999","cooldown":"number of turns 0..20","effect":"control|reflect|absorb|heal|shield|poison|steal|copy|freeze|seal|unseal|shadow|unblockable|lifesteal| empty string","description":"string optional"}]}',
  weapon: '{"name":"string","description":"string","price":"number 100..10000","max_durability":"number 1..200","skills":[{"name":"string","type":"attack|defense|special","damage":"number 0..999","cooldown":"number of turns 0..20","effect":"control|reflect|absorb|heal|shield|poison|steal|copy|freeze|seal|unseal|shadow|unblockable|lifesteal| empty string","description":"string optional"}]}',
  companion: '{"name":"string","description":"string","price":"number 0..20000","base_hp":"number 50..500","base_atk":"number 20..300","skills":[{"name":"string","type":"attack|defense|special","damage":"number 0..999","cooldown":"number of turns 0..20","effect":"control|reflect|absorb|heal|shield|poison|steal|copy|freeze|seal|unseal|shadow|unblockable|lifesteal| empty string","description":"string optional"}]}',
  potion: '{"name":"string","description":"string","effect_type":"heal|heal_percent|reset_cooldown|atk_boost|shield|skill","effect_value":"number 0..10000","price":"number 0..5000"}'
};

function systemPrompt(entityType: string, isEdit: boolean): string {
  const schema = SCHEMAS[entityType] || SCHEMAS.character;
  const skillRules =
    "SKILL NUMBER RULES (apply these defaults on every skill):\n" +
    "- Non-damage/effect skills — control, steal, copy, freeze/stun, seal, unseal, reflect, unblockable_reflect, shadow, delay_cooldown, hp_boost, atk_boost: their 'damage' field is a COUNT and the system forces it to exactly 1.\n" +
    "- Damage skills — normal attack, unblockable, poison, lifesteal/absorb, special: their 'damage' must be at least 100 (default 100 if unspecified) and a multiple of 50.\n" +
    "- Defense/block skills: 'damage' = how many attacks it can block, the system forces it to exactly 1.\n" +
    "- 'cooldown' is measured in TURNS, not seconds (cooldown 1 = reusable after the fighter takes 1 of their own turns).\n" +
    "- If the admin EXPLICITLY asks for a specific skill type or effect (poison, lifesteal/absorb, steal, copy, control, freeze/stun, reflect, seal, shadow, unblockable, defense, etc.), you MUST honor it exactly: set exactly those values in the skill's 'effect' and 'type' and give the skill a matching name/description. NEVER turn an explicitly requested effect into a plain attack with an empty 'effect'.\n";
  const charDefaults =
    (entityType === "character" && !isEdit)
      ? "\n\nNEW CHARACTER DEFAULT TEMPLATE (apply these ONLY when the admin does not specify the stats or the " +
        "skills for a brand-new character; override them ONLY if the admin explicitly asks for different numbers):\n" +
        "- Stats: hp = 100, atk = 100, level = 1. Do NOT invent higher stats.\n" +
        "- EVERY text value MUST be written in ARABIC: the character name (transliterate Latin names, e.g. Goku → غوكو), anime title, quote, power_name, power_description, and every skill name & description. Only the technical fields stay in English ('type', 'damage', 'cooldown', 'effect').\n" +
        "- Always return exactly 3 skills, in this order:\n" +
        "  1. A basic normal attack: type \"attack\", damage 100, cooldown 0, with a short natural name/description for this character.\n" +
        "  2. A block/defense skill: type \"defense\", damage 1 (it blocks 1 incoming attack), cooldown 2, with a natural name/description.\n" +
"  3. ONE unique signature skill of this character — the famous ability it truly uses in its anime/manhwa/manga. " +
        "     It MUST be a real effect skill with a non-empty 'effect' value. Give it EITHER a damaging effect " +
        "     (poison, lifesteal, unblockable — the system forces its damage to 150) OR a non-damaging effect " +
        "     (steal, copy, control, freeze/stun, reflect, seal, shadow, atk_boost, hp_boost — the system forces its damage to 1). " +
        "     Pick the effect that matches the character: e.g. Kakashi → Sharingan Copy (copy), Asta → unblockable attack, " +
        "     Shinobu → poison, Sung Jin-woo → Monarch's Domain (shadow), a vampire/healer → lifesteal. " +
        "     NEVER a plain normal attack, NEVER a plain block (those are slots 1 and 2), and NEVER an empty 'effect'. " +
        "     ALSO NEVER a plain normal attack (slot 1), NEVER a plain block/defense (slot 2), NEVER 'shield' — those are ordinary effects used elsewhere and do NOT qualify as this character's signature ability. " +
        "     The signature effect must be one of the distinctive ones listed above (poison, lifesteal, unblockable, steal, copy, control, freeze/stun, reflect, seal, shadow, atk_boost, hp_boost). " +
        "     The skill's NAME and DESCRIPTION must come from the character's REAL famous ability (use the WEB INFO above when available) — e.g. Kakashi → Sharingan Copy, Asta → an unblockable sword strike, Sung Jin-woo → Monarch's Domain, Shinobu → a poison blade. " +
        "     NEVER invent generic names like 'القوة الخارقة' or 'درع الجدار'; name it after the character's actual technique. " +
        "     If the admin EXPLICITLY requests a specific effect for this slot (poison, lifesteal, steal, copy, freeze, reflect, shadow, ...), use EXACTLY that effect. " +
        "     Its 'cooldown' is forced to 2; choose its type and effect to match that ability, " +
        "     and write its name/description from the anime. " +
        "     If the WEB INFO names a specific weapon, sword, or technique, use THAT exact weapon/technique name translated into Arabic as the skill name (e.g. Asta → 'سيف السحر الأسود' أو 'ممتص السحر'، Ichigo → 'زانغيتسو'، Zoro → 'سانتورييو'). " +
        "     NEVER reduce it to a generic description like 'هجوم قوي' أو 'ضربة سيف' — name the actual move or weapon.\n" +
        "- Every skill name and description must match the character's real abilities from the anime/manhwa.\n"
      : "";
  if (isEdit) {
    return (
      "You are the assistant for a mobile card-battle game. The admin gives you the CURRENT data of an " +
      "existing " + entityType + " (below) and a request about how to adjust it (name, stats, skills) in " +
      "Arabic or English. Reply with ONLY valid JSON matching the requested type. Do NOT wrap in markdown. " +
      "Do NOT invent fields outside the schema.\n" + skillRules +
      "If the admin asks to add/change skills, include them in the 'skills' array (works for characters, monsters, " +
      "weapons and companions). " +
      "Keep every field from the CURRENT data that the request " +
      "does not change — only change the fields implied by the request. If a field is missing from current " +
      "data, keep the same key name with a sensible value. Text fields may be in the same language as the request.\n\n" +
      "Requested type: " + entityType + "\nSchema (use these keys):\n" + schema
    );
  }
  return (
    "You are the assistant for a mobile card-battle game. The admin gives you a short " +
    "description (name, stats, skills) in Arabic or English. You must reply with ONLY valid JSON " +
    "matching the requested type. Do NOT wrap in markdown. Do NOT invent fields outside the schema. " +
    "Use sensible balanced numbers.\n" + skillRules + charDefaults +
    "Write ALL human-readable text fields (name, anime, quote, power name/description, skill names & descriptions) in Arabic unless the admin clearly requests another language.\n" +
    "If the admin asks for skills (attacks/block/abilities), ALWAYS include them in the 'skills' array — " +
    "this works for characters, monsters, weapons and companions alike. " +
    "Text fields may be in the same language as the request.\n\n" +
    "Requested type: " + entityType + "\nSchema (use these keys):\n" + schema
  );
}

// يبني النص الكامل للنموذج (تعليمات + السياق الحالي عند التعديل + الطلب)
function buildFullPrompt(prompt: string, entityType: string, isEdit: boolean, existing: any): string {
  if (isEdit && existing) {
    return "CURRENT DATA of the existing " + entityType + ":\n" +
      JSON.stringify(existing) + "\n\nRequest:\n" + prompt;
  }
  return prompt;
}

// ينادي Gemini API (بروتوكول توليد المحتوى الخاص بـ Google)
async function callGemini(apiKey: string, systemText: string, fullPrompt: string): Promise<string> {
  const body = {
    contents: [{ role: "user", parts: [{ text: systemText + "\n\n" + fullPrompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048, responseMimeType: "application/json" },
    // Grounding with Google Search: يبحث جوجل فعليًا قبل توليد الإجابة ليستطيع
    // المساعد معرفة قدرات الشخصيات الحقيقية بدل الاعتماد على ذاكرته فقط.
    tools: [{ googleSearch: {} }]
  };
  let lastErr = "";
  const attempts: string[] = [];
  for (const model of GEMINI_MODELS) {
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text();
        attempts.push("gemini:" + model + " -> HTTP " + res.status + ": " + text.slice(0, 300));
        lastErr = "Gemini " + res.status + " (" + model + "): " + text;
        // نموذج غير موجود أو تم إيقافه أو بلغت الحصة القصوى → جرّب النموذج التالي
        if (res.status === 404 || res.status === 429 || /not found|deprecated|disabled/i.test(text)) continue;
        break;
      }
      const json = await res.json();
      const out = (json && json.candidates && json.candidates[0] && json.candidates[0].content &&
        json.candidates[0].content.parts && json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text) || "";
      if (out) return out;
      attempts.push("gemini:" + model + " -> empty response");
      lastErr = "Gemini returned empty response";
      continue;
    } catch (err) {
      attempts.push("gemini:" + model + " -> " + ((err && err.message) ? err.message : String(err)).slice(0, 300));
      lastErr = (err && err.message) ? err.message : String(err);
      continue;
    }
  }
  throw new Error((lastErr || "كل نماذج Gemini غير متاحة حاليًا") + " || Attempts: " + JSON.stringify(attempts));
}

// ينادي أي مزوّد متوافق مع بروتوكول OpenAI Chat Completions (Groq / Cerebras)
async function callOpenAICompat(provider: string, apiKey: string, baseUrl: string, models: string[], systemText: string, fullPrompt: string): Promise<string> {
  const body = {
    model: "",
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: fullPrompt }
    ],
    temperature: 0.7,
    max_tokens: 2048,
    response_format: { type: "json_object" }
  };
  let lastErr = "";
  const attempts: string[] = [];
  for (const model of models) {
    body.model = model;
    try {
      const res = await fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text();
        attempts.push(provider + ":" + model + " -> HTTP " + res.status + ": " + text.slice(0, 300));
        lastErr = provider + " " + res.status + " (" + model + "): " + text;
        if (res.status === 404 || res.status === 429 || res.status === 400 || /not found|model/i.test(text)) continue;
        break;
      }
      const json = await res.json();
      const out = (json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || "";
      if (out) return out;
      attempts.push(provider + ":" + model + " -> empty response");
      lastErr = provider + " returned empty response";
      continue;
    } catch (err) {
      attempts.push(provider + ":" + model + " -> " + ((err && err.message) ? err.message : String(err)).slice(0, 300));
      lastErr = (err && err.message) ? err.message : String(err);
      continue;
    }
  }
  throw new Error((lastErr || provider + " غير متاح") + " || Attempts: " + JSON.stringify(attempts));
}

// يجرب المزوّدين بالترتيب: Gemini ثم Groq ثم Cerebras، ويعيد أول نص ناجح
async function generateText(systemText: string, fullPrompt: string): Promise<string> {
  const attempts: string[] = [];
  const errors: string[] = [];

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (geminiKey) {
    try { return await callGemini(geminiKey, systemText, fullPrompt); }
    catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      errors.push(msg);
      attempts.push("gemini");
    }
  }

  const groqKey = Deno.env.get("GROQ_API_KEY");
  if (groqKey) {
    try { return await callOpenAICompat("groq", groqKey, "https://api.groq.com/openai/v1", GROQ_MODELS, systemText, fullPrompt); }
    catch (e) {
      errors.push((e && e.message) ? e.message : String(e));
      attempts.push("groq");
    }
  }

  const cerebrasKey = Deno.env.get("CEREBRAS_API_KEY");
  if (cerebrasKey) {
    try { return await callOpenAICompat("cerebras", cerebrasKey, "https://api.cerebras.ai/v1", CEREBRAS_MODELS, systemText, fullPrompt); }
    catch (e) {
      errors.push((e && e.message) ? e.message : String(e));
      attempts.push("cerebras");
    }
  }

  throw new Error(
    "لم ينجح أي مزوّد (" + (attempts.join(", ") || "لا مزوّدات مكوّنة") + ")." +
    " | Details: " + JSON.stringify(errors)
  );
}

function extractJson(text: string): any {
  let clean = text.trim();
  const fence = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) clean = fence[1].trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) clean = clean.slice(start, end + 1);
  const attempt = (s: string) => {
    try { return JSON.parse(s); } catch { return undefined; }
  };
  const first = attempt(clean);
  if (first !== undefined) return first;
  const fixed = clean
    .replace(/([{,]\s*)'([^']+)'\s*:/g, "$1\"$2\":")
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/:\s*'([^']*)'/g, ':"$1"');
  const second = attempt(fixed);
  if (second !== undefined) return second;
  const err: any = new Error("خطأ في تحليل JSON: " + clean.slice(0, 300));
  err.details = clean.slice(0, 1000);
  throw err;
}

// يفرض القالب الافتراضي للشخصيات الجديدة برمجيًا على أي JSON قادم من النموذج،
// حتى لو تجاهل المساعد التعليمات: يضمن 3 مهارات بالترتيب الصحيح —
// 1) هجوم عادي (attack، ضرر 100، تهدئة 0)  2) دفاع/صد (defense، صدّ 1، تهدئة 2)
// 3) مهارة مميزة يختارها المساعد لتناسب الشخصية: إمّا مهارة ضرر (special/unblockable/poison
//    تُفرض على 150) أو مهارة تأثير/عدّ تناسب الشخصية (copy/reflect/control/steal... تُفرض على 1).
// تُطبَّق على أول 3 مهارات فقط، وتصحّح فقط الخانات التي أخطأ النموذج في نوعها —
// فلو طلب الأدمن مهارات مختلفة صراحة تُحترم (لا نفرض الضرر/التقليل على مهارة ليست من النوع المتوقع).
function enforceDefaultCharacterTemplate(fields: any): any {
  if (!fields || typeof fields !== "object" || !Array.isArray(fields.skills)) return fields;
  const skills = fields.skills;
  if (skills.length < 3) return fields;
  const norm = (sk: any) => (sk && typeof sk === "object") ? Object.assign({}, sk) : {};
  const skill1 = norm(skills[0]);
  const t1 = String(skill1.type || "").trim().toLowerCase();
  if (t1 === "attack" || t1 === "") {
    Object.assign(skill1, { type: "attack", damage: 100, cooldown: 0, effect: skill1.effect || "" });
  }
  const skill2 = norm(skills[1]);
  const t2 = String(skill2.type || "").trim().toLowerCase();
  if (t2 === "defense" || t2 === "block" || t2 === "") {
    Object.assign(skill2, { type: "defense", damage: 1, cooldown: 2, effect: "" });
  }
  let skill3 = norm(skills[2]);
  const t3 = String(skill3.type || "").trim().toLowerCase();
  const e3 = String(skill3.effect || "").trim().toLowerCase();
  // الحظر الوحيد للخانة الثالثة: مهارة الهجوم العادي (slot 1) أو مهارة الصد/الدفاع العادي (slot 2).
  // أي شيء آخر (shield, heal, absorb, defense مع تأثير، إلخ) مسموح به كمهارة مميزة.
  const countEffects: Record<string, boolean> = {
    control: true, steal: true, copy: true, freeze: true, "stun": true,
    seal: true, unseal: true, reflect: true, shadow: true,
    delay_cooldown: true, hp_boost: true, atk_boost: true,
    consecutive_turns: true, absorb_atk: true, absorb_hp: true,
    unblockable_reflect: true
  };
  const sigDamageEffects: Record<string, boolean> = { poison: true, lifesteal: true, unblockable: true };
  const divisionTypes: Record<string, boolean> = { defense: true, block: true };
  const isPlainAttack = (t3 === "attack" || t3 === "") && e3 === "";
  const isPlainBlock = (t3 === "defense" || t3 === "block") && e3 === "";
  if (isPlainAttack || isPlainBlock) {
    // هجوم عادي أو دفاع/صد عادي — لا تصلح كمهارة مميزة (هذه الخانتان 1 و 2).
    // نستبدلها تلقائيًا بتأثير مميز حقيقي ذي ضرر قوي.
    skill3 = Object.assign({}, skill3, { type: "special" });
    const fallbackEffects = ["poison", "lifesteal", "unblockable"];
    const chosen = fallbackEffects[Math.floor(Math.random() * fallbackEffects.length)];
    if (chosen === "unblockable") { skill3.unblockable = true; skill3.effect = ""; }
    else skill3.effect = chosen;
    skill3.damage = 150;
  } else if (countEffects[e3] || countEffects[t3] || divisionTypes[e3] || divisionTypes[t3]) {
    // مهارة تأثير/عدّ تليق بالشخصية (كاكاشي → copy، أستا → reflect...):
    // نحتفظ بالتأثير ونُفرض عددها على 1 بالضبط (ليست 150).
    skill3.damage = 1;
  } else if (isSigDamage) {
    // مهارة ضرر مميزة (special/unblockable/poison/هجوم قوي): تُفرض على 150،
    // والهجوم العادي أو النوع الفارغ يُرقّى إلى special ليظل مهارة مميزة.
    skill3.damage = 150;
    if (t3 === "attack" || t3 === "") skill3.type = "special";
  } else {
    // انتهت المهارة بلا تأثير مميز (ضرر صافي بلا تأثير أو نوع فارغ): نختار
    // تلقائيًا تأثير ضرر حقيقيًا من تأثيرات النظام ليتمايز عن الهجوم العادي.
    skill3 = Object.assign({}, skill3, { type: "special" });
    const fallbackEffects = ["poison", "lifesteal", "unblockable"];
    const chosen = fallbackEffects[Math.floor(Math.random() * fallbackEffects.length)];
    if (chosen === "unblockable") { skill3.unblockable = true; skill3.effect = ""; }
    else skill3.effect = chosen;
    skill3.damage = 150;
  }
  skill3.cooldown = 2;
  fields.skills = [skill1, skill2, skill3];
  return fields;
}

// يفرض قواعد أرقام المهارات على أي JSON قادم من النموذج مهما قال المساعد:
// مهارات التأثير/العدّ (control/steal/copy/freeze/reflect/defense...) = 1 بالضبط،
// ومهارات الضرر (هجوم/خاص/سم...) = 100 على الأقل ومضاعفات 50.
function normalizeSkillNumbers(fields: any): any {
  if (!fields || !Array.isArray(fields.skills)) return fields;
  const countEffects: Record<string, boolean> = {
    control: true, steal: true, copy: true, freeze: true, "stun": true,
    seal: true, unseal: true, reflect: true, shadow: true,
    delay_cooldown: true, hp_boost: true, atk_boost: true,
    consecutive_turns: true, absorb_atk: true, absorb_hp: true,
    unblockable_reflect: true
  };
  const divisionTypes: Record<string, boolean> = { defense: true, block: true };
  fields.skills = fields.skills.map((s: any) => {
    const sk = s && typeof s === "object" ? s : {};
    const eff = String(sk.effect || "").trim().toLowerCase();
    const typ = String(sk.type || "").trim().toLowerCase();
    let damage = Number(sk.damage);
    if (sk.damage == null || sk.damage === "" || !isFinite(damage)) damage = 0;
    damage = Math.max(0, Math.round(damage));
    if (divisionTypes[eff] || divisionTypes[typ]) {
      damage = 1;
    } else if (countEffects[eff] || countEffects[typ]) {
      damage = 1;
    } else {
      damage = Math.max(100, damage);
      damage = Math.round(damage / 50) * 50;
    }
    return Object.assign({}, sk, { damage });
  });
  return fields;
}

// خريطة كلمات الطلب → تأثير المهارة. keywords تشمل العربية والإنجليزية.
const EFFECT_HINTS: { effect: string; isDamage: boolean; keywords: string[] }[] = [
  { effect: "unblockable", isDamage: true,  keywords: ["unblockable", "لا يصد", "لا تُصد", "لا يمكن صد", "غير قابل للصد"] },
  { effect: "poison",      isDamage: true,  keywords: ["poison", "تسميم", "سم", "سموم"] },
  { effect: "lifesteal",   isDamage: true,  keywords: ["lifesteal", "life steal", "leech", "امتصاص", "شفاء بالضرب", "سرقة حياة"] },
  { effect: "steal",       isDamage: false, keywords: ["steal", "سرقة", "مفترس"] },
  { effect: "copy",        isDamage: false, keywords: ["copy", "نسخ", "تقليد"] },
  { effect: "control",     isDamage: false, keywords: ["control", "سيطرة", "تحكم", "توجيه الخصم"] },
  { effect: "freeze",      isDamage: false, keywords: ["freeze", "stun", "تجميد", "شلل", "تثبيت"] },
  { effect: "reflect",     isDamage: false, keywords: ["reflect", "انعكاس", "صد الضرر"] },
  { effect: "seal",        isDamage: false, keywords: ["seal", "ختم"] },
  { effect: "shadow",      isDamage: false, keywords: ["shadow", "الظل", "ظلال"] },
  { effect: "absorb_atk",  isDamage: false, keywords: ["امتصاص قوة", "امتصاص الهجوم"] },
  { effect: "absorb_hp",   isDamage: false, keywords: ["امتصاص صحة", "امتصاص الدم"] },
  { effect: "atk_boost",   isDamage: false, keywords: ["رفع القوة", "زيادة الهجوم", "atk boost"] },
  { effect: "hp_boost",    isDamage: false, keywords: ["استرجاع الصحة", "تعافي", "شفاء ذاتي"] }
];

// يبحث في طلب الأدمن عن كلمات تطلب نوع تأثير محدد لمهارة مميزة
function detectRequestedEffects(prompt: string): { effect: string; isDamage: boolean }[] {
  const text = (prompt || "").toLowerCase();
  const found: { effect: string; isDamage: boolean }[] = [];
  for (const hint of EFFECT_HINTS) {
    const matched = hint.keywords.some(k => text.includes(k.toLowerCase()));
    if (matched) found.push({ effect: hint.effect, isDamage: hint.isDamage });
  }
  return found;
}

// يطبّق التأثير الذي طلبه الأدمن على المهارة (افتراضيًا الخانة الثالثة المميزة)
function applyRequestedEffectToSkill(fields: any, slotIndex: number, hint: { effect: string; isDamage: boolean }): void {
  if (!fields || !Array.isArray(fields.skills) || !fields.skills[slotIndex]) return;
  const sk = fields.skills[slotIndex] && typeof fields.skills[slotIndex] === "object"
    ? Object.assign({}, fields.skills[slotIndex])
    : { name: "هجوم الظل", description: "" };
  if (hint.effect === "unblockable") {
    sk.unblockable = true;
    sk.effect = "";
    sk.damage = 150;
    sk.type = "special";
  } else {
    sk.effect = hint.effect;
    sk.unblockable = false;
    sk.type = "special";
    sk.damage = hint.isDamage ? 150 : 1;
  }
  fields.skills[slotIndex] = sk;
}

// هل النص أغلب أحرفه لاتينية (اكتشاف أسماء المهارات والوصف الإنجليزي)
function isLatinDominant(s: any): boolean {
  const t = String(s || "");
  const arabic = (t.match(/[\u0600-\u06FF]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  return latin > arabic && latin > 3;
}

// يستخرج اسمًا لاتينيًا محتملًا من طلب الأدمن (مثل Goku أو Sung Jin-woo)
// نأخذ أول كلمة ليست كلمة ربط بترتيب ورودها في النص (الاسم عادةً يسبقه تعديلات)
function extractName(prompt: string): string | null {
  const words = (prompt || "").match(/[A-Za-z][A-Za-z0-9\-']{1,}(?:\s+[A-Za-z][A-Za-z0-9\-']{1,}){0,2}/g) || [];
  const stop = /^(character|create|from|make|skill|type|attack|defense|special|with|the|hero|villain|anime|manhwa|manga|of|for|in|monster|his|her|and|fight|powers|called|named|known|shows|series|clover)$/i;
  const names = words.map(w => w.trim()).filter(w => w.length >= 2 && !stop.test(w));
  return names[0] || null;
}

// يبحث عن معلومات حقيقية عن الشخصية في ويكيبيديا (عربي ثم إنجليزي) ليعرف
// المساعد قدراتها الفعلية بدل الاعتماد على ذاكرته فقط.
async function researchCharacterInfo(prompt: string): Promise<string | null> {
  const name = extractName(prompt);
  // نجرّب اسم الشخصية أولًا (صفحتها الخاصة أدق من صفحة العمل/الأنمي)، ثم النص الكامل
  const queries: string[] = [name, prompt, name].filter((q): q is string => !!q && q.trim() !== "").filter((q, i, a) => a.indexOf(q) === i);
  for (const q of queries) {
    if (!q) continue;
    for (const wiki of ["ar", "en"]) {
      try {
        const url = "https://" + wiki + ".wikipedia.org/w/api.php?action=query&list=search&srsearch=" +
          encodeURIComponent(q) + "&srnamespace=0&srlimit=1&format=json";
        const res = await fetch(url, { headers: { "User-Agent": "CardGameAdminAI/1.0" } });
        if (!res.ok) continue;
        const j = await res.json();
        const hit = j && j.query && j.query.search && j.query.search[0];
        if (!hit || !hit.title) continue;
        const rest = "https://" + wiki + ".wikipedia.org/api/rest_v1/page/summary/" +
          encodeURIComponent(String(hit.title).replace(/ /g, "_"));
        const r2 = await fetch(rest, { headers: { "User-Agent": "CardGameAdminAI/1.0" } });
        if (!r2.ok) continue;
        const s = await r2.json();
        const extract = s && (s.extract || "").trim();
        if (!extract || extract.length < 80) continue;
        return (s.title || hit.title) + ": " + extract.slice(0, 1200);
      } catch { }
    }
  }
  return null;
}

// يضمن أن كل النصوص القابلة للقراءة عربية: لو ظهرت نصوص لاتينية (أسماء مهارات
// إنجليزية مثلًا) نعيد توليد الحقول النصية نفسها بالعربية مع الحفاظ الحرفي
// على الأرقام والأنواع (type/damage/cooldown/effect) دون إضافة أو حذف مهارات.
async function arabicizeFields(fields: any): Promise<any> {
  if (!fields || typeof fields !== "object") return fields;
  const latinTexts: string[] = [];
  const push = (v: any) => { if (isLatinDominant(v)) latinTexts.push(String(v)); };
  push(fields.name); push(fields.anime); push(fields.quote);
  push(fields.power_name); push(fields.power_description);
  if (Array.isArray(fields.skills)) {
    for (const sk of fields.skills) {
      if (sk && typeof sk === "object") { push(sk.name); push(sk.description); }
    }
  }
  if (latinTexts.length === 0) return fields;
  const original = JSON.stringify(fields);
  const sys = "You convert anime/card-game data to Arabic. Take the JSON below and rewrite ONLY the human-readable text fields into natural Arabic: the character name (transliterated), anime title, quote, power_name, power_description, and every skill name & description. Preserve the JSON structure, all keys, and every numeric/type/effect/cooldown/unblockable value EXACTLY as they are. Do NOT add or remove skills. Respond with ONLY valid JSON.";
  try {
    const out = await generateText(sys, "JSON:\n" + original);
    const parsed = extractJson(out);
    if (parsed && typeof parsed === "object") return parsed;
  } catch { }
  return fields;
}

Deno.serve(async (req) => {
  // CORS: يسمح لتطبيق الويب على Cloudflare Pages بالاتصال بالدالة
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  };
  const json = (body: any, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
    const body = await req.json();
    const { admin_token, entity_type, prompt, image_url, background_url, existing, entity_id } = body || {};

    if (!admin_token || !prompt || !entity_type) {
      return json({ ok: false, error: "bad request" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: adminId, error: authErr } = await supabase.rpc("admin_id_from_token", { p_token: admin_token });
    if (authErr || !adminId) {
      return json({ ok: false, error: "غير مصرح" }, 401);
    }

    const fullPrompt = [
      image_url ? "Character image: " + image_url : null,
      background_url ? "Background photo for the character's skill pages: " + background_url : null
    ].filter(Boolean).join("\n");
    // بحث فعلي عن معلومات الشخصية في ويكيبيديا ليستند إليها المساعد
    // ولا يختلق قدراتها من ذاكرته.
    let research = null;
    try { research = await researchCharacterInfo(prompt); } catch (e) { research = null; }
    const finalPrompt = (research ? "WEB INFO about this character (use it to make the data accurate):\n" + research + "\n\n" : "") +
      (fullPrompt ? fullPrompt + "\n\nDescription:\n" + prompt : prompt);
    const isEdit = !!(existing && (typeof existing === "object"));
    const systemText = systemPrompt(entity_type, isEdit);
    const requestText = buildFullPrompt(finalPrompt, entity_type, isEdit, isEdit ? existing : null);
    const raw = await generateText(systemText, requestText);
    const parsed = extractJson(raw);
    let fields = normalizeSkillNumbers(parsed);
    // الشخصيات الجديدة فقط: صحّح قالب المهارات الافتراضي برمجيًا لو أخطأ النموذج
    // (هجوم عادي 100/تهدئة 0، صد 1/تهدئة 2، مهارة مميزة) — لا تطبق على التعديل أو الوحوش
    if (!isEdit && entity_type === "character" && fields && typeof fields === "object") {
      // لو طلب الأدمن صراحةً نوع تأثير للمهارة المميزة (سم/امتصاص/سرقة/نسخ/...)
      // نطبّقه على الخانة الثالثة بغضّ النظر عمّا أعاده النموذج.
      const requested = detectRequestedEffects(prompt);
      if (requested.length > 0) applyRequestedEffectToSkill(fields, 2, requested[0]);
      fields = enforceDefaultCharacterTemplate(fields);
      fields = normalizeSkillNumbers(fields);
    }
    // الصورة المرفوعة من الأدمن دائمًا تفوز على أي رابط تولّده النموذج،
    // حتى لا يظهر الاقتراح صورة ثم لا تُطبّق على النموذج.
    if (image_url && fields && typeof fields === "object") {
      fields.image = image_url;
    }
    // الخلفية المرفوعة من الأدمن تفوز كذلك على أي خلفية يقترحها النموذج.
    if (background_url && fields && typeof fields === "object") {
      fields.background = background_url;
    }
    // ضمان العربية لكل النصوص القابلة للقراءة (أسماء وأوصاف مهارات...)
    // لو ظهرت أي نصوص إنجليزية (شائع من النماذج) نعدّل توليدها بالعربية.
    if (fields && typeof fields === "object") {
      try {
        fields = await arabicizeFields(fields);
        fields = normalizeSkillNumbers(fields);
      } catch (e) {}
    }
    return json({ ok: true, v: "26", entity_type, fields, image_url: image_url || null, background_url: background_url || null, isEdit, entity_id: entity_id || null }, 200);
  } catch (e) {
    const msg = (e && e.message) ? e.message : "خطأ في توليد المحتوى";
    return json({ ok: false, v: "25", error: msg }, 502);
  }
});
