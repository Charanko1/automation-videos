import { promises as fs } from "node:fs";
import path from "node:path";

export type ChatGPTCredential = {
  email?: string;
  name?: string;
  subject: string;
  clientId: string;
  extAgentHostId: string;
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt: number;
  scopes: string[];
  savedAt: string;
};

const filePath = path.join(process.cwd(), ".ai-office-chatgpt-auth.json");
const TOKEN_ENDPOINT = "https://auth.openai.com/api/accounts/oauth/token";
const RESOURCE = "https://api.openai.com/v1";

async function ensureLocalOnly() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("ChatGPT plan connection is local-development only.");
  }
}

export async function saveCredential(credential: ChatGPTCredential) {
  await ensureLocalOnly();
  await fs.writeFile(filePath, JSON.stringify(credential, null, 2), { mode: 0o600 });
}

async function refreshCredential(credential: ChatGPTCredential) {
  if (!credential.refreshToken || credential.expiresAt > Date.now() + 2 * 60_000) return credential;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: credential.clientId,
    refresh_token: credential.refreshToken,
    resource: RESOURCE,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || typeof data.access_token !== "string") {
    throw new Error(data?.error_description ?? data?.error ?? `ChatGPT token refresh failed (${response.status}).`);
  }

  const refreshed: ChatGPTCredential = {
    ...credential,
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : credential.refreshToken,
    idToken: typeof data.id_token === "string" ? data.id_token : credential.idToken,
    tokenType: typeof data.token_type === "string" ? data.token_type : credential.tokenType,
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000,
    scopes: typeof data.scope === "string"
      ? data.scope.split(/\s+/).filter(Boolean)
      : credential.scopes,
    savedAt: new Date().toISOString(),
  };

  await saveCredential(refreshed);
  return refreshed;
}

export async function readCredential() {
  await ensureLocalOnly();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const credential = JSON.parse(raw) as ChatGPTCredential;
    return await refreshCredential(credential);
  } catch {
    return null;
  }
}

export function hasPlanScope(scopes: string[]) {
  return scopes.includes("chatgpt.tokens.use.direct");
}
