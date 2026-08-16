import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    const body = await req.json();
    const { secret, recipient_ids, title, body: messageBody, data } = body ?? {};

    if (!secret || !recipient_ids || !Array.isArray(recipient_ids) || recipient_ids.length === 0) {
      return new Response("bad request", { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1. verify internal secret against Vault
    const { data: storedSecret, error: secretErr } = await supabase
      .rpc("push_get_secret", { p_name: "push_internal_secret" });

    if (secretErr || !storedSecret || storedSecret !== secret) {
      return new Response("unauthorized", { status: 401 });
    }

    // 2. load FCM service account from Vault
    const { data: saJson, error: saErr } = await supabase
      .rpc("push_get_secret", { p_name: "fcm_service_account" });

    if (saErr || !saJson) {
      return new Response("missing fcm service account", { status: 500 });
    }

    const serviceAccount = JSON.parse(saJson);

    // 3. load device tokens for recipients
    const { data: tokens, error: tokErr } = await supabase
      .from("device_tokens")
      .select("device_token")
      .in("player_id", recipient_ids);

    if (tokErr) {
      return new Response(tokErr.message, { status: 500 });
    }

    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    // 4. obtain an OAuth2 access token from the service account
    const accessToken = await getAccessToken(serviceAccount);

    // 5. send one message per device
    const sendResults = await Promise.allSettled(
      tokens.map((t) => sendFcm(accessToken, serviceAccount.project_id, t.device_token, title, messageBody, data))
    );

    const sent = sendResults.filter((r) => r.status === "fulfilled").length;

    return new Response(JSON.stringify({ sent, total: tokens.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response("error: " + (e && e.message), { status: 500 });
  }
});

// --- FCM v1 helpers ---------------------------------------------------

async function getAccessToken(sa: any): Promise<string> {
  const jwt = await createJwt(sa);
  const res = await fetch(`https://oauth2.googleapis.com/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = await res.json();
  return json.access_token;
}

async function createJwt(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: sa.token_uri,
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claim}`;
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = base64ToBytes(pemContents);
  return await crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function sendFcm(
  accessToken: string,
  projectId: string,
  deviceToken: string,
  title: string,
  body: string,
  data: any
): Promise<void> {
  const message = {
    message: {
      token: deviceToken,
      notification: title || body ? { title: title ?? "", body: body ?? "" } : undefined,
      data: data ?? undefined,
    },
  };
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(message),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FCM ${res.status}: ${text}`);
  }
}

// --- utils -------------------------------------------------------------

function b64url(data: string | Uint8Array): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToBytes(b64: string): Uint8Array {
  const norm = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
