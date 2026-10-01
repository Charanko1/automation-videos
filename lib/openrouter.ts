const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "deepseek/deepseek-r1-distill-llama-70b:free";

type OpenRouterMessage = {
  role: "assistant";
  content?: string | Array<{ type?: string; text?: string }>;
};

export type OpenRouterResult = {
  text: string;
  model: string;
  displayName: string;
};

function extractContent(content: OpenRouterMessage["content"]) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

export async function generateWithOpenRouter(prompt: string, modelSlug?: string): Promise<OpenRouterResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const configuredModel = modelSlug?.trim() || process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL;
  const modelAliases: Record<string, string> = {
    "deepseek/deepseek-chat:free": DEFAULT_MODEL,
    "deepseek/deepseek-chat-v3.1:free": DEFAULT_MODEL,
  };
  const model = modelAliases[configuredModel] ?? configuredModel;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required.");
  }

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://127.0.0.1:3000",
      "X-Title": "AI Office YouTube Factory",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({})) as {
    choices?: Array<{ message?: OpenRouterMessage }>;
    error?: { message?: string; code?: number | string };
  };

  if (!response.ok) {
    const providerMessage = data?.error?.message ?? `OpenRouter request failed (${response.status}).`;
    if (response.status === 429) {
      throw new Error(`OpenRouter rate limit: ${providerMessage}`);
    }
    throw new Error(providerMessage);
  }

  const text = extractContent(data?.choices?.[0]?.message?.content).trim();
  if (!text) {
    throw new Error("OpenRouter returned an empty response.");
  }

  return {
    text,
    model,
    displayName: model === DEFAULT_MODEL ? "DeepSeek R1 Distill · OpenRouter Free" : model,
  };
}
