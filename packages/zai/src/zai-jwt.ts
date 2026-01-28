const CACHE_TTL_MS = 3 * 60 * 1000;
const TOKEN_TTL_MS = CACHE_TTL_MS + 30 * 1000;

type CachedToken = {
  apiKey: string;
  token: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

export async function getZaiAuthorizationHeader(apiKey: string): Promise<string> {
  const jwtToken = await getJwtToken(apiKey);
  return `Bearer ${jwtToken}`;
}

async function getJwtToken(apiKey: string): Promise<string> {
  const parts = apiKey.split(".");
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    return apiKey;
  }

  const now = Date.now();
  if (cachedToken && cachedToken.apiKey === apiKey && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }

  const [key, secret] = parts;
  const payload = {
    api_key: key,
    exp: now + TOKEN_TTL_MS,
    timestamp: now,
  };

  const token = await signJwtHS256({
    header: { alg: "HS256", sign_type: "SIGN" },
    payload,
    secret,
  });

  cachedToken = {
    apiKey,
    token,
    expiresAt: now + CACHE_TTL_MS,
  };

  return token;
}

async function signJwtHS256({
  header,
  payload,
  secret,
}: {
  header: Record<string, string>;
  payload: Record<string, unknown>;
  secret: string;
}): Promise<string> {
  const headerSegment = base64UrlEncode(JSON.stringify(header));
  const payloadSegment = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = await hmacSha256(signingInput, secret);
  return `${signingInput}.${signature}`;
}

async function hmacSha256(message: string, secret: string): Promise<string> {
  if (globalThis.crypto?.subtle != null) {
    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(message));
    return base64UrlEncode(new Uint8Array(signature));
  }

  const { createHmac } = await import("node:crypto");
  const signature = createHmac("sha256", secret).update(message).digest();
  return base64UrlEncode(signature);
}

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;

  let base64: string;
  if (typeof Buffer !== "undefined") {
    base64 = Buffer.from(bytes).toString("base64");
  } else {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    base64 = btoa(binary);
  }

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
