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

function systemPrompt(entityType: string, isEdit: boolean, useArabic: boolean): string {
  const schema = SCHEMAS[entityType] || SCHEMAS.character;
  const langNote = useArabic
    ? "Write ALL human-readable text fields (name, anime, quote, power name/description, skill names & descriptions) in Arabic unless the admin clearly requests another language."
    : "Write ALL human-readable text fields (name, anime, quote, power name/description, skill names & descriptions) in English, matching the language of the admin's request.";
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
        "- EVERY text value MUST be written in " + (useArabic ? "ARABIC" : "ENGLISH") + ": the character name (transliterate Latin names, e.g. Goku → غوكو if Arabic, Goku if English), anime title, quote, power_name, power_description, and every skill name & description. Only the technical fields stay in English ('type', 'damage', 'cooldown', 'effect').\n" +
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
      "Do NOT invent fields outside the schema.\n" + skillRules + langNote + "\n" +
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
    langNote + "\n" +
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
// اختيار ثابت (وليس عشوائيًا) لتأثير المهارة المميزة لكل شخصية: يعتمد على اسم
// المهارة/الشخصية بحيث يكون متغيرًا بين الشخصيات لكن ثابتًا لكل شخصية عند
// إعادة المحاولة، وليس دائمًا unblockable.
function hashStr(s: string): number {
  let h = 0;
  for (const ch of s) { h = (h * 31 + (ch.codePointAt(0) || 0)) >>> 0; }
  return h;
}
function pickSignatureEffect(name: string, effects: string[]): string {
  if (!effects || effects.length === 0) return "unblockable";
  return effects[hashStr(name) % effects.length];
}

function enforceDefaultCharacterTemplate(fields: any, excludedEffects: string[] = []): any {
  if (!fields || typeof fields !== "object" || !Array.isArray(fields.skills)) return fields;
  const skills = fields.skills;
  // نضمن وجود ثلاث خانات مهارات دائمًا: إن أعاد النموذج أقل من 3 نكمل
  // بخانات فارغة فيُطبَّق قالب المهارة المميزة على الخانة الثالثة بدل أن
  // تبقى هجومًا عاديًا (السلوك الذي كان يحدث سابقًا عند أقل من 3 مهارات).
  while (skills.length < 3) skills.push({});
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
  const isSigDamage = !(isPlainAttack || isPlainBlock);
  if (isPlainAttack || isPlainBlock) {
    // هجوم عادي أو دفاع/صد عادي — لا تصلح كمهارة مميزة (هذه الخانتان 1 و 2).
    // نستبدلها تلقائيًا بتأثير مميز حقيقي ذي ضرر قوي.
    skill3 = Object.assign({}, skill3, { type: "special" });
    const fallbackEffects = ["poison", "lifesteal", "unblockable"]
        .filter(e => !excludedEffects.includes(e));
    const chosen = pickSignatureEffect(skill3.name || fields.name || "skill", fallbackEffects);
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
    const fallbackEffects = ["poison", "lifesteal", "unblockable"]
        .filter(e => !excludedEffects.includes(e));
    const chosen = pickSignatureEffect(skill3.name || fields.name || "skill", fallbackEffects);
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

// يحدد لغة طلب الأدمن: عربية أم لاتينية (إنجليزية أو لاتينية أخرى).
// يُستخدم لاختيار لغة الناتج تلقائيًا بدلاً من الفرض الدائم على العربية.
function isArabicPrompt(s: any): boolean {
  const t = String(s || "");
  const arabic = (t.match(/[\u0600-\u06FF]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  return arabic > 0 && arabic >= latin;
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

// يبحث عن صورة حقيقية للشخصية من ويكيبيديا (الحقل thumbnail/originalimage يوفّره
// ملخّص REST Summary) ليستخدمها إن لم يرفع المستخدم صورة بنفسه.
async function findCharacterImage(prompt: string): Promise<string | null> {
  const name = extractName(prompt);
  const queries: string[] = [name, prompt].filter((q): q is string => !!q && q.trim() !== "").filter((q, i, a) => a.indexOf(q) === i);
  for (const q of queries) {
    if (!q) continue;
    for (const wiki of ["en", "ar", "ja"]) {
      try {
        const url = "https://" + wiki + ".wikipedia.org/api/rest_v1/page/summary/" +
          encodeURIComponent(String(q).replace(/ /g, "_"));
        const res = await fetch(url, { headers: { "User-Agent": "CardGameAdminAI/1.0" } });
        if (!res.ok) continue;
        const s = await res.json();
        const img = (s && s.originalimage && s.originalimage.source) || (s && s.thumbnail && s.thumbnail.source);
        if (img && /^https?:\/\//i.test(String(img))) return String(img);
      } catch { }
    }
  }
  return null;
}

// يختار نوع المهارة الصحيح (مطابق لـ game.js في الجهة الأمامية) ثم يحوّله
// إلى حقول قاعدة البيانات (type/effect/unblockable) مع تقريب الضرر حسب قيود DB.
function aiSkillTypeChoice(sk: any): string {
  const e = String((sk && sk.effect) || "").trim();
  const effectAliases: Record<string, string> = {
    "steal": "steal", "copy": "copy", "control": "control",
    "reflect": "reflect", "shield": "defense", "heal": "hp_boost",
    "poison": "poison", "atk_boost": "atk_boost", "freeze": "freeze",
    "lifesteal": "lifesteal", "seal": "seal", "unseal": "unseal"
  };
  if (e && effectAliases[e] !== undefined) return effectAliases[e];
  const t = String((sk && sk.type) || "attack").trim().toLowerCase();
  const typeAliases: Record<string, string> = {
    "attack": "attack", "defense": "defense", "special": "special",
    "steal": "steal", "copy": "copy", "control": "control",
    "unblockable": "unblockable", "freeze": "freeze",
    "lifesteal": "lifesteal", "reflect": "reflect",
    "seal": "seal", "unseal": "unseal", "poison": "poison",
    "shadow": "shadow", "hp_boost": "hp_boost", "atk_boost": "atk_boost",
    "delay_cooldown": "delay_cooldown",
    "unblockable_reflect": "unblockable_reflect",
    "consecutive_turns": "consecutive_turns",
    "absorb_atk": "absorb_atk", "absorb_hp": "absorb_hp"
  };
  return typeAliases[t] || "attack";
}

function skillTypeChoiceToFields(choice: string): { type: string; effect: string | null; unblockable: boolean } {
  let type = "attack", effect: string | null = null, unblockable = false;
  if (choice === "steal") { type = "special"; effect = "steal"; }
  else if (choice === "copy") { type = "special"; effect = "copy"; }
  else if (choice === "control") { type = "special"; effect = "control"; }
  else if (choice === "defense") { type = "defense"; }
  else if (choice === "hp_boost") { type = "special"; effect = "hp_boost"; }
  else if (choice === "atk_boost") { type = "special"; effect = "atk_boost"; }
  else if (choice === "poison") { type = "special"; effect = "poison"; }
  else if (choice === "unblockable") { type = "special"; unblockable = true; }
  else if (choice === "freeze") { type = "special"; effect = "freeze"; }
  else if (choice === "lifesteal") { type = "special"; effect = "lifesteal"; }
  else if (choice === "reflect") { type = "special"; effect = "reflect"; }
  else if (choice === "seal") { type = "special"; effect = "seal"; }
  else if (choice === "unseal") { type = "special"; effect = "unseal"; }
  else if (choice === "shadow") { type = "special"; effect = "shadow"; }
  else if (choice === "delay_cooldown") { type = "special"; effect = "delay_cooldown"; }
  else if (choice === "unblockable_reflect") { type = "special"; effect = "reflect"; unblockable = true; }
  else if (choice === "consecutive_turns") { type = "special"; effect = "consecutive_turns"; }
  else if (choice === "absorb_atk") { type = "special"; effect = "absorb_atk"; }
  else if (choice === "absorb_hp") { type = "special"; effect = "absorb_hp"; }
  return { type, effect, unblockable };
}

// يحوّل قائمة المهارات من اقتراح AI إلى صفوف جاهزة للإدراج في جداول skills
// و character_skills (نفس منطق createSkillsForTarget في الواجهة الأمامية).
function buildSkillRows(fields: any): any[] {
  const skills = (fields && Array.isArray(fields.skills)) ? fields.skills : [];
  const rows: any[] = [];
  for (const sk of skills) {
    const typeChoice = aiSkillTypeChoice(sk);
    let damageRaw = Math.max(0, Math.round(Number(sk.damage) || 0));
    if (typeChoice === "attack" || typeChoice === "unblockable" || typeChoice === "special") {
      damageRaw = Math.round(damageRaw / 50) * 50;
    }
    let params: any = {};
    try { if (sk.params && typeof sk.params === "object") params = Object.assign({}, sk.params); } catch (e) {}
    if (typeChoice === "control") { params.control_count = damageRaw; damageRaw = 0; }
    if (typeChoice === "poison" && params.poison_turns == null) { params.poison_turns = 2; }
    const { type, effect, unblockable } = skillTypeChoiceToFields(typeChoice);
    rows.push({
      name: String(sk.name || "مهارة").slice(0, 60),
      type,
      damage: damageRaw,
      cooldown: Math.max(0, Number(sk.cooldown) || 0),
      effect,
      unblockable,
      description: String(sk.description || "").slice(0, 300),
      color: (sk.color && /^#[0-9A-Fa-f]{6}$/.test(sk.color)) ? sk.color : null,
      params,
      stroke_color: (sk.stroke_color && /^#[0-9A-Fa-f]{6}$/.test(sk.stroke_color)) ? sk.stroke_color : null,
      stroke_width: Math.max(0, Number(sk.stroke_width) || 0)
    });
  }
  return rows;
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
    const { admin_token, player_token, entity_type, prompt, image_url, background_url, existing, entity_id } = body || {};

    const isPlayerOrder = !!player_token && !admin_token;
    if (!prompt || !entity_type || (!admin_token && !player_token)) {
      return json({ ok: false, error: "bad request" }, 400);
    }
    if (isPlayerOrder && entity_type !== "character") {
      return json({ ok: false, error: "اللاعبون يطلبون الشخصيات فقط" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // --- هوية الطالب: أدمن أو لاعب ---
    let requesterId: string | null = null;
    if (isPlayerOrder) {
      const { data: pid, error: perr } = await supabase.rpc("player_id_from_token", { p_token: player_token });
      if (perr || !pid) return json({ ok: false, error: "غير مصرح" }, 401);
      requesterId = String(pid);
      // طلب واحد فقط: منع اللاعب من طلب أكثر من شخصية ما دام لديه طلب قيد
      // المراجعة أو تم اعتماده. الطلب المرفوض يسمح له بالمحاولة من جديد.
      const { data: dup, error: dupErr } = await supabase
        .from("characters")
        .select("id")
        .eq("requested_by", requesterId)
        .in("status", ["pending", "approved"]);
      if (dupErr) return json({ ok: false, error: dupErr.message || "تعذر التحقق من الطلب السابق" }, 500);
      if (dup && dup.length > 0) {
        return json({ ok: false, error: "لقد أرسلت طلب شخصية من قبل وهو قيد المراجعة أو معتمد بالفعل" }, 409);
      }
    } else {
      const { data: adminId, error: authErr } = await supabase.rpc("admin_id_from_token", { p_token: admin_token });
      if (authErr || !adminId) {
        return json({ ok: false, error: "غير مصرح" }, 401);
      }
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
    const useArabic = isArabicPrompt(prompt);
    const systemText = systemPrompt(entity_type, isEdit, useArabic);
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
    // لو لم تُرفع صورة، يبحث المساعد عن صورة حقيقية للشخصية من الويب بنفسه.
    if (!fields.image) {
      try {
        const foundImage = await findCharacterImage(prompt);
        if (foundImage) fields.image = foundImage;
      } catch (e) {}
    }
    // الخلفية المرفوعة من الأدمن تفوز كذلك على أي خلفية يقترحها النموذج.
    if (background_url && fields && typeof fields === "object") {
      fields.background = background_url;
    }
    // ضمان العربية لكل النصوص القابلة للقراءة (أسماء وأوصاف مهارات...)
    // فقط عند طلب العربية: لو ظهرت أي نصوص إنجليزية (شائع من النماذج) نعدّل توليدها بالعربية.
    if (useArabic && fields && typeof fields === "object") {
      try {
        fields = await arabicizeFields(fields);
        fields = normalizeSkillNumbers(fields);
      } catch (e) {}
    }

    // --- أمر اللاعب: إدراج مباشر كشخصية pending مرتبطة باللاعب ---
    if (isPlayerOrder) {
      if (!fields || typeof fields !== "object" || !fields.name) {
        return json({ ok: false, error: "لم ينجح التوليد، حاول من جديد" }, 502);
      }
      const cRow: any = {
        name: String(fields.name || "").slice(0, 80),
        anime: String(fields.anime || "").slice(0, 80),
        identity_image: fields.image || null,
        hp: Math.max(1, Math.round(Number(fields.hp) || 100)),
        atk: Math.max(1, Math.round(Number(fields.atk) || 100)),
        level: Math.max(1, Math.round(Number(fields.level) || 1)),
        quote: String(fields.quote || "").slice(0, 300),
        power_name: String(fields.power_name || "").slice(0, 100),
        power_description: String(fields.power_description || "").slice(0, 500),
        gold_prize: Math.max(0, Math.round(Number(fields.gold_prize) || 0)),
        glow_color: (fields.glow_color && /^#[0-9A-Fa-f]{6}$/.test(fields.glow_color)) ? fields.glow_color : "#3b82ff",
        is_monster: false,
        admin_only: false,
        available: false,
        owner_id: null,
        status: "pending",
        requested_by: requesterId
      };
      const { data: created, error: cErr } = await supabase.from("characters").insert(cRow).select("id").single();
      if (cErr || !created) {
        return json({ ok: false, error: cErr ? cErr.message : "تعذر حفظ الشخصية" }, 500);
      }
      // مهارات مقترحة بواسطة AI — تُنشأ وتُربط مباشرة
      const skillRows = buildSkillRows(fields);
      let slot = 1;
      for (const sk of skillRows) {
        const { data: skillData, error: sErr } = await supabase.from("skills").insert({
          name: sk.name,
          type: sk.type,
          damage: sk.damage,
          cooldown: sk.cooldown,
          effect: sk.effect,
          unblockable: sk.unblockable,
          description: sk.description,
          color: sk.color,
          params: sk.params,
          stroke_color: sk.stroke_color,
          stroke_width: sk.stroke_width
        }).select("id").single();
        if (sErr || !skillData) continue;
        await supabase.from("character_skills").insert({
          character_id: created.id,
          skill_id: skillData.id,
          slot
        });
        slot++;
      }
      return json({ ok: true, v: "26", entity_type, fields, image_url: fields.image || null, isEdit: false, entity_id: null, character_id: created.id, status: "pending" }, 200);
    }

    // --- وضع الأدمن الحالي: إرجاع الاقتراح دون إدراج ---
    // للشخصيات الجديدة: تضع الحالة pending awaiting approval من الأدمن
    if (!isEdit && entity_type === "character" && fields && typeof fields === "object") {
      fields.status = "pending";
    }
    return json({ ok: true, v: "26", entity_type, fields, image_url: image_url || null, background_url: background_url || null, isEdit, entity_id: entity_id || null }, 200);
  } catch (e) {
    const msg = (e && e.message) ? e.message : "خطأ في توليد المحتوى";
    return json({ ok: false, v: "25", error: msg }, 502);
  }
});
