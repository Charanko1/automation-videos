import { hasPlanScope, readCredential } from "./chatgpt-auth";

const MODELS_ENDPOINT = "https://api.openai.com/v1/models";
const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

type ModelItem = {
  slug?: string;
  display_name?: string;
  visibility?: string;
};

export type ChatGPTImageResult = {
  imageBase64: string;
  mimeType: string;
  model: string;
  displayName: string;
};

export async function generateWithChatGPTImage(prompt: string): Promise<ChatGPTImageResult> {
  const credential = await readCredential();

  if (!credential) {
    throw new Error("Connect ChatGPT first.");
  }

  if (!hasPlanScope(credential.scopes)) {
    throw new Error("ChatGPT plan usage permission was not granted.");
  }

  if (credential.expiresAt <= Date.now() + 30_000) {
    throw new Error("ChatGPT access token is expired. Sign in with ChatGPT again.");
  }

  const modelsResponse = await fetch(MODELS_ENDPOINT, {
    headers: { Authorization: "Bearer " + credential.accessToken },
    cache: "no-store",
  });
  const modelsData = await modelsResponse.json().catch(() => ({}));

  if (!modelsResponse.ok) {
    throw new Error(
      modelsData?.error?.message ??
        modelsData?.detail ??
        "Unable to read the ChatGPT model catalog.",
    );
  }

  const model = Array.isArray(modelsData?.models)
    ? (modelsData.models as ModelItem[]).find(
        (item) => item?.visibility === "list" && typeof item.slug === "string",
      )
    : null;

  if (!model?.slug) {
    throw new Error("No displayable ChatGPT model was returned for this account.");
  }

  const response = await fetch(RESPONSES_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + credential.accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.slug,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      tools: [
        {
          type: "image_generation",
          model: "gpt-image-2.5-flare",
          action: "generate",
        },
      ],
      tool_choice: { type: "image_generation" },
      store: false,
      stream: true,
    }),
    cache: "no-store",
  });

  const raw = await response.text();

  if (!response.ok) {
    let data: any = {};
    try {
      data = JSON.parse(raw);
    } catch {
      const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
      if (dataLine) {
        try { data = JSON.parse(dataLine.slice(6)); } catch {}
      }
    }

    throw new Error(
      data?.error?.message ??
        data?.message ??
        raw.slice(0, 1200) ??
        "ChatGPT plan image generation was rejected.",
    );
  }

  let imageBase64 = "";
  let streamError = "";

  for (const block of raw.split(/\r?\n\r?\n/)) {
    const dataLine = block
      .split(/\r?\n/)
      .find((line) => line.startsWith("data: "));
    if (!dataLine) continue;

    const payload = dataLine.slice(6).trim();
    if (!payload || payload === "[DONE]") continue;

    try {
      const event = JSON.parse(payload);

      if (event?.type === "response.output_item.done") {
        const item = event?.item;
        if (
          item?.type === "image_generation_call" &&
          typeof item?.result === "string"
        ) {
          imageBase64 = item.result;
        }
      }

      if (event?.type === "response.completed") {
        const output = event?.response?.output;
        if (Array.isArray(output)) {
          const imageCall = output.find(
            (item: { type?: string; result?: string }) =>
              item?.type === "image_generation_call" &&
              typeof item?.result === "string",
          );
          if (imageCall?.result) imageBase64 = imageCall.result;
        }
      }

      if (event?.type === "error" || event?.type === "response.failed") {
        streamError =
          event?.error?.message ??
          event?.response?.error?.message ??
          "The image generation stream failed.";
      }
    } catch {}
  }

  if (!imageBase64) {
    throw new Error(
      streamError ||
        "ChatGPT image generation completed without an image result.",
    );
  }

  return {
    imageBase64,
    mimeType: "image/png",
    model: model.slug,
    displayName: model.display_name ?? model.slug,
  };
}
