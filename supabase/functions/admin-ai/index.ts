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
  character: '{"name":"string","anime":"string","hp":"number 40..1000","atk":"number 40..1000","quote":"string","power_name":"string","power_description":"string","gold_prize":"number 0..5000","skills":[{"name":"string","type":"attack|defense|special","damage":"number 0..999","cooldown":"number of turns 0..20","effect":"control|reflect|absorb|heal|shield|poison|steal|copy| empty string","description":"string optional"}]}',
  monster: '{"name":"string","anime":"string","hp":"number 100..2000","atk":"number 80..1000","quote":"string","power_name":"string","power_description":"string","gold_prize":"number 0..5000","skills":[{"name":"string","type":"attack|defense|special","damage":"number 0..999","cooldown":"number of turns 0..20","effect":"control|reflect|absorb|heal|shield|poison|steal|copy| empty string","description":"string optional"}]}',
  weapon: '{"name":"string","description":"string","price":"number 100..10000","max_durability":"number 1..200","skills":[{"name":"string","type":"attack|defense|special","damage":"number 0..999","cooldown":"number of turns 0..20","effect":"control|reflect|absorb|heal|shield|poison|steal|copy| empty string","description":"string optional"}]}',
  companion: '{"name":"string","description":"string","price":"number 0..20000","base_hp":"number 50..500","base_atk":"number 20..300","skills":[{"name":"string","type":"attack|defense|special","damage":"number 0..999","cooldown":"number of turns 0..20","effect":"control|reflect|absorb|heal|shield|poison|steal|copy| empty string","description":"string optional"}]}',
  potion: '{"name":"string","description":"string","effect_type":"heal|heal_percent|reset_cooldown|atk_boost|shield|skill","effect_value":"number 0..10000","price":"number 0..5000"}'
};

function systemPrompt(entityType: string, isEdit: boolean): string {
  const schema = SCHEMAS[entityType] || SCHEMAS.character;
  const skillRules =
    "SKILL NUMBER RULES (apply these defaults on every skill):\n" +
    "- Non-damage/effect skills — control, steal, copy, freeze/stun, seal, unseal, reflect, unblockable_reflect, shadow, delay_cooldown, hp_boost, atk_boost: their 'damage' field is a COUNT, always default it to 1 unless the admin says otherwise.\n" +
    "- Damage skills — normal attack, unblockable, poison, lifesteal/absorb, special: their 'damage' must be at least 100 (default 100 if unspecified) and a multiple of 50.\n" +
    "- Defense/block skills: 'damage' = how many attacks it can block, use 1 unless the admin says otherwise.\n" +
    "- 'cooldown' is measured in TURNS, not seconds (cooldown 1 = reusable after the fighter takes 1 of their own turns).\n";
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
    "Use sensible balanced numbers.\n" + skillRules +
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
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048, responseMimeType: "application/json" }
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

// يفرض قواعد أرقام المهارات على أي JSON قادم من النموذج مهما قال المساعد:
// مهارات التأثير/العدّ (control/steal/copy/freeze/reflect/defense...) = 1 على الأقل،
// ومهارات الضرر (هجوم/خاص/سم...) = 100 على الأقل ومضاعفات 50.
function normalizeSkillNumbers(fields: any): any {
  if (!fields || !Array.isArray(fields.skills)) return fields;
  const countEffects: Record<string, boolean> = {
    control: true, steal: true, copy: true, freeze: true, "stun": true,
    seal: true, unseal: true, reflect: true, shadow: true,
    delay_cooldown: true, hp_boost: true, atk_boost: true,
    consecutive_turns: true, absorb_atk: true, absorb_hp: true
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
      damage = Math.max(1, damage);
    } else if (countEffects[eff] || countEffects[typ]) {
      damage = Math.max(1, damage);
    } else {
      damage = Math.max(100, damage);
      damage = Math.round(damage / 50) * 50;
    }
    return Object.assign({}, sk, { damage });
  });
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
    const { admin_token, entity_type, prompt, image_url, existing, entity_id } = body || {};

    if (!admin_token || !prompt || !entity_type) {
      return json({ ok: false, error: "bad request" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: adminId, error: authErr } = await supabase.rpc("admin_id_from_token", { p_token: admin_token });
    if (authErr || !adminId) {
      return json({ ok: false, error: "غير مصرح" }, 401);
    }

    const fullPrompt = image_url ? "Image: " + image_url + "\n\nDescription:\n" + prompt : prompt;
    const isEdit = !!(existing && (typeof existing === "object"));
    const systemText = systemPrompt(entity_type, isEdit);
    const requestText = buildFullPrompt(fullPrompt, entity_type, isEdit, isEdit ? existing : null);
    const raw = await generateText(systemText, requestText);
    const parsed = extractJson(raw);
    const fields = normalizeSkillNumbers(parsed);
    // الصورة المرفوعة من الأدمن دائمًا تفوز على أي رابط تولّده النموذج،
    // حتى لا يظهر الاقتراح صورة ثم لا تُطبّق على النموذج.
    if (image_url && fields && typeof fields === "object") {
      fields.image = image_url;
    }
    return json({ ok: true, v: "26", entity_type, fields, image_url: image_url || null, isEdit, entity_id: entity_id || null }, 200);
  } catch (e) {
    const msg = (e && e.message) ? e.message : "خطأ في توليد المحتوى";
    return json({ ok: false, v: "25", error: msg }, 502);
  }
});
