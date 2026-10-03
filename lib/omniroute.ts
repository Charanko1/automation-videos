const DEFAULT_BASE_URL = "http://127.0.0.1:20128/v1";
const DEFAULT_MODEL = "auto";

type OmniRouteMessage = {
  role: "assistant";
  content?: string | Array<{ type?: string; text?: string }>;
};

export type OmniRouteResult = {
  text: string;
  model: string;
  displayName: string;
};

function extractContent(content: OmniRouteMessage["content"]) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

async function requestOmniRoute(path: string, init: RequestInit = {}) {
  const baseUrl = normalizeBaseUrl(process.env.OMNIROUTE_BASE_URL?.trim() || DEFAULT_BASE_URL);
  const apiKey = process.env.OMNIROUTE_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "OMNIROUTE_API_KEY is required. Start OmniRoute, connect a free provider, then copy the API key from Dashboard → Endpoints.",
    );
  }

  const candidates = [baseUrl];
  if (/^http:\/\/localhost(?::|\/)/i.test(baseUrl)) {
    candidates.push(baseUrl.replace(/^http:\/\/localhost/i, "http://127.0.0.1"));
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Content-Type", "application/json");

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await fetch(`${candidate}${path}`, {
        ...init,
        headers,
        cache: "no-store",
      });
    } catch (error) {
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Cannot reach OmniRoute at ${candidates.join(" or ")}. Make sure OmniRoute is running on port 20128 and OMNIROUTE_BASE_URL is correct. Original error: ${detail}`,
  );
}

export async function checkOmniRoute(): Promise<{ modelCount: number; models: string[] }> {
  const response = await requestOmniRoute("/models");
  const data = await response.json().catch(() => ({})) as {
    data?: Array<{ id?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OmniRoute models request failed (${response.status}).`);
  }

  const models = Array.isArray(data.data)
    ? data.data
        .map((item) => (typeof item?.id === "string" ? item.id.trim() : ""))
        .filter(Boolean)
    : [];

  return { modelCount: models.length, models };
}

export async function generateWithOmniRoute(
  prompt: string,
  modelSlug?: string,
  options?: {
    responseFormat?: Record<string, unknown>;
    noCache?: boolean;
  },
): Promise<OmniRouteResult> {
  const model = modelSlug?.trim() || process.env.OMNIROUTE_MODEL?.trim() || DEFAULT_MODEL;

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
  };

  if (options?.responseFormat) body.response_format = options.responseFormat;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options?.noCache) headers["X-OmniRoute-No-Cache"] = "true";

  const response = await requestOmniRoute("/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({})) as {
    choices?: Array<{ message?: OmniRouteMessage }>;
    model?: string;
    error?: { message?: string; code?: number | string };
  };

  if (!response.ok) {
    const providerMessage = data?.error?.message ?? `OmniRoute request failed (${response.status}).`;
    if (response.status === 429) {
      throw new Error(`OmniRoute rate limit: ${providerMessage}`);
    }
    throw new Error(providerMessage);
  }

  const text = extractContent(data?.choices?.[0]?.message?.content).trim();
  if (!text) {
    throw new Error("OmniRoute returned an empty response. Check that at least one provider is connected.");
  }

  const resolvedModel = typeof data.model === "string" && data.model.trim() ? data.model.trim() : model;

  return {
    text,
    model: resolvedModel,
    displayName: `OmniRoute · ${resolvedModel}`,
  };
}
