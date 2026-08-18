import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-1.5-flash";

const SCHEMAS = {
  character: '{"name":"string","anime":"string","hp":"number 40..1000","atk":"number 40..1000","quote":"string","power_name":"string","power_description":"string","gold_prize":"number 0..5000"}',
  monster: '{"name":"string","anime":"string","hp":"number 100..2000","atk":"number 80..1000","quote":"string","power_name":"string","power_description":"string","gold_prize":"number 0..5000"}',
  weapon: '{"name":"string","description":"string","price":"number 100..10000","max_durability":"number 1..200","skills":[{"name":"string","type":"attack|defense|special","damage":"number 0..999","cooldown":"number 0..20","effect":"control|reflect|absorb|heal|shield|poison|steal|copy| empty string","description":"string optional"}]}',
  companion: '{"name":"string","description":"string","price":"number 0..20000","base_hp":"number 50..500","base_atk":"number 20..300","skills":[{"name":"string","type":"attack|defense|special","damage":"number 0..999","cooldown":"number 0..20","effect":"control|reflect|absorb|heal|shield|poison|steal|copy| empty string","description":"string optional"}]}',
  potion: '{"name":"string","description":"string","effect_type":"heal|heal_percent|reset_cooldown|atk_boost|shield|skill","effect_value":"number 0..10000","price":"number 0..5000"}'
};

function systemPrompt(entityType: string, isEdit: boolean): string {
  const schema = SCHEMAS[entityType] || SCHEMAS.character;
  if (isEdit) {
    return (
      "You are the assistant for a mobile card-battle game. The admin gives you the CURRENT data of an " +
      "existing " + entityType + " (below) and a request about how to adjust it (name, stats, skills) in " +
      "Arabic or English. Reply with ONLY valid JSON matching the requested type. Do NOT wrap in markdown. " +
      "Do NOT invent fields outside the schema. Keep every field from the CURRENT data that the request " +
      "does not change — only change the fields implied by the request. If a field is missing from current " +
      "data, keep the same key name with a sensible value. Text fields may be in the same language as the request.\n\n" +
      "Requested type: " + entityType + "\nSchema (use these keys):\n" + schema
    );
  }
  return (
    "You are the assistant for a mobile card-battle game. The admin gives you a short " +
    "description (name, stats, skills) in Arabic or English. You must reply with ONLY valid JSON " +
    "matching the requested type. Do NOT wrap in markdown. Do NOT invent fields outside the schema. " +
    "Use sensible balanced numbers. Text fields may be in the same language as the request.\n\n" +
    "Requested type: " + entityType + "\nSchema (use these keys):\n" + schema
  );
}

async function callGemini(apiKey: string, prompt: string, entityType: string, isEdit: boolean, existing: any): Promise<string> {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + apiKey;
  let fullPrompt = prompt;
  if (isEdit && existing) {
    fullPrompt = "CURRENT DATA of the existing " + entityType + ":\n" +
      JSON.stringify(existing) + "\n\nRequest:\n" + prompt;
  }
  const body = {
    contents: [{ role: "user", parts: [{ text: systemPrompt(entityType, isEdit) + "\n\n" + fullPrompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error("Gemini " + res.status + ": " + text);
  }
  const json = await res.json();
  return (json && json.candidates && json.candidates[0] && json.candidates[0].content &&
    json.candidates[0].content.parts && json.candidates[0].content.parts[0] && json.candidates[0].content.parts[0].text) || "";
}

function extractJson(text: string): any {
  let clean = text.trim();
  const fence = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) clean = fence[1].trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) clean = clean.slice(start, end + 1);
  return JSON.parse(clean);
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

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return json({ ok: false, error: "GEMINI_API_KEY not configured" }, 500);
    }

    const fullPrompt = image_url ? "Image: " + image_url + "\n\nDescription:\n" + prompt : prompt;
    const isEdit = !!(existing && (typeof existing === "object"));
    const raw = await callGemini(apiKey, fullPrompt, entity_type, isEdit, isEdit ? existing : null);
    const fields = extractJson(raw);

    return json({ ok: true, entity_type, fields, image_url: image_url || null, isEdit, entity_id: entity_id || null }, 200);
  } catch (e) {
    const msg = (e && e.message) ? e.message : "خطأ في توليد المحتوى";
    return json({ ok: false, error: msg }, 502);
  }
});
