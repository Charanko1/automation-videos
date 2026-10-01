import { hasPlanScope, readCredential } from "./chatgpt-auth";

const MODELS_ENDPOINT = "https://api.openai.com/v1/models";
const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

type ModelItem = {
  slug?: string;
  display_name?: string;
  visibility?: string;
};

type ChatGPTResult = {
  text: string;
  model: string;
  displayName: string;
};

export async function generateWithChatGPT(prompt: string, modelSlug?: string): Promise<ChatGPTResult> {
  const credential = await readCredential();

  if (!credential) {
    throw new Error("Connect ChatGPT first.");
  }

  if (!hasPlanScope(credential.scopes)) {
    throw new Error("The account is connected, but ChatGPT plan usage permission was not granted.");
  }

  if (credential.expiresAt <= Date.now() + 30_000) {
    throw new Error("ChatGPT access token is expired. Sign in with ChatGPT again.");
  }

  let model: { slug: string; display_name?: string } | null = modelSlug
    ? { slug: modelSlug, display_name: modelSlug }
    : null;

  if (!model) {
    const modelsResponse = await fetch(MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${credential.accessToken}` },
      cache: "no-store",
    });
    const modelsData = await modelsResponse.json().catch(() => ({}));

    if (!modelsResponse.ok) {
      throw new Error(
        modelsData?.error?.message ??
          modelsData?.detail ??
          `Unable to read ChatGPT models (${modelsResponse.status}).`,
      );
    }

    model = Array.isArray(modelsData?.models)
      ? (modelsData.models as ModelItem[]).find(
          (item) => item?.visibility === "list" && typeof item.slug === "string",
        )
          ? (() => {
              const item = (modelsData.models as ModelItem[]).find(
                (entry) => entry?.visibility === "list" && typeof entry.slug === "string",
              )!;
              return { slug: item.slug!, display_name: item.display_name };
            })()
          : null
      : null;

    if (!model?.slug) {
      throw new Error("No displayable ChatGPT model is available for this account.");
    }
  }

  const response = await fetch(RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.slug,
      input: [
        {
          role: "user",
          content: prompt,
        },
      ],
      store: false,
      stream: true,
    }),
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data?.error?.message ??
        data?.detail ??
        `ChatGPT inference failed (${response.status}).`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let completed = false;
  let failedMessage = "";

  const consumeBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    let eventType = "";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) eventType = line.slice(6).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }

    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    if (raw === "[DONE]") return;

    let data: {
      type?: string;
      delta?: string;
      response?: { error?: { message?: string } };
      error?: { message?: string };
    };

    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    const type = eventType || data.type;
    if (type === "response.output_text.delta" && typeof data.delta === "string") {
      text += data.delta;
    }
    if (type === "response.completed") completed = true;
    if (type === "response.failed") {
      failedMessage =
        data.response?.error?.message ??
        data.error?.message ??
        "ChatGPT response failed.";
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const match = /\r?\n\r?\n/.exec(buffer);
      if (!match || match.index === undefined) break;
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      consumeBlock(block);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) consumeBlock(buffer);

  if (failedMessage) throw new Error(failedMessage);
  if (!completed) throw new Error("ChatGPT stream ended before response.completed.");
  if (!text.trim()) throw new Error("ChatGPT returned an empty response.");

  return {
    text: text.trim(),
    model: model.slug,
    displayName: model.display_name ?? model.slug,
  };
}
