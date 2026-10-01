import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const AUTH_ENDPOINT = "https://auth.openai.com/api/accounts/authorize";
const REDIRECT_URI = "http://127.0.0.1:3000/api/auth/chatgpt/callback";

function base64url(value: Buffer) {
  return value.toString("base64url");
}

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "This experimental ChatGPT plan connection is local-development only." },
      { status: 400 },
    );
  }

  const state = randomBytes(32).toString("hex");
  const nonce = randomBytes(32).toString("hex");
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const hostId = `urn:uuid:${randomUUID()}`;

  const params = new URLSearchParams({
    client_id: "dynamic_agent_client",
    agent_name_hint: "AI Office",
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: "https://api.openai.com/v1",
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  const response = NextResponse.redirect(`${AUTH_ENDPOINT}?${params.toString()}`);
  response.cookies.set("ai_office_oai_state", state, { httpOnly: true, sameSite: "lax", secure: false, maxAge: 600, path: "/" });
  response.cookies.set("ai_office_oai_nonce", nonce, { httpOnly: true, sameSite: "lax", secure: false, maxAge: 600, path: "/" });
  response.cookies.set("ai_office_oai_verifier", verifier, { httpOnly: true, sameSite: "lax", secure: false, maxAge: 600, path: "/" });
  response.cookies.set("ai_office_oai_host", hostId, { httpOnly: true, sameSite: "lax", secure: false, maxAge: 60 * 60 * 24 * 365, path: "/" });
  return response;
}
