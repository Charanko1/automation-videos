import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { hasPlanScope, saveCredential } from "../../../../../lib/chatgpt-auth";

const TOKEN_ENDPOINT = "https://auth.openai.com/api/accounts/oauth/token";
const REDIRECT_URI = "http://127.0.0.1:3000/api/auth/chatgpt/callback";
const ISSUER = "https://auth.openai.com";
const JWKS = createRemoteJWKSet(new URL("https://auth.openai.com/.well-known/jwks.json"));

function finish(message: string, error = false) {
  const url = new URL("http://127.0.0.1:3000/settings");
  url.searchParams.set("chatgpt", error ? "error" : "connected");
  url.searchParams.set("message", message);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") return finish("Local test only.", true);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const issuedClientId = url.searchParams.get("client_id");
  const oauthError = url.searchParams.get("error");

  const jar = await cookies();
  const savedState = jar.get("ai_office_oai_state")?.value;
  const nonce = jar.get("ai_office_oai_nonce")?.value;
  const verifier = jar.get("ai_office_oai_verifier")?.value;
  const hostId = jar.get("ai_office_oai_host")?.value;

  if (oauthError) return finish(`OpenAI authorization: ${oauthError}`, true);
  if (!code || !state || state !== savedState || !nonce || !verifier || !hostId || !issuedClientId) {
    return finish("OAuth callback validation failed.", true);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: issuedClientId,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT_URI,
    resource: "https://api.openai.com/v1",
  });

  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const tokenJson = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || typeof tokenJson.id_token !== "string" || typeof tokenJson.access_token !== "string") {
    return finish(`Token exchange failed (${tokenResponse.status}).`, true);
  }

  let identity;
  try {
    identity = await jwtVerify(tokenJson.id_token, JWKS, {
      issuer: ISSUER,
      audience: issuedClientId,
      requiredClaims: ["sub", "exp", "iat"],
      clockTolerance: 5,
    });
  } catch {
    return finish("ID token verification failed.", true);
  }

  if (identity.payload.nonce !== nonce || typeof identity.payload.sub !== "string") {
    return finish("OpenAI identity validation failed.", true);
  }

  const scopes = String(tokenJson.scope ?? "").split(/\s+/).filter(Boolean);
  const expiresAt = Date.now() + Number(tokenJson.expires_in ?? 3600) * 1000;

  await saveCredential({
    email: typeof identity.payload.email === "string" ? identity.payload.email : undefined,
    name: typeof identity.payload.name === "string" ? identity.payload.name : undefined,
    subject: identity.payload.sub,
    clientId: issuedClientId,
    extAgentHostId: hostId,
    idToken: tokenJson.id_token,
    accessToken: tokenJson.access_token,
    refreshToken: typeof tokenJson.refresh_token === "string" ? tokenJson.refresh_token : undefined,
    tokenType: typeof tokenJson.token_type === "string" ? tokenJson.token_type : "Bearer",
    expiresAt,
    scopes,
    savedAt: new Date().toISOString(),
  });

  const enabled = hasPlanScope(scopes);
  return finish(
    enabled
      ? "ChatGPT plan permission granted. Ready for a test request."
      : "Signed in, but ChatGPT plan usage was not granted to this account.",
    false,
  );
}
