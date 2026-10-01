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

async function ensureLocalOnly() {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("ChatGPT plan connection test is local-development only.");
  }
}

export async function saveCredential(credential: ChatGPTCredential) {
  await ensureLocalOnly();
  await fs.writeFile(filePath, JSON.stringify(credential, null, 2), { mode: 0o600 });
}

export async function readCredential() {
  await ensureLocalOnly();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as ChatGPTCredential;
  } catch {
    return null;
  }
}

export function hasPlanScope(scopes: string[]) {
  return scopes.includes("chatgpt.tokens.use.direct");
}
