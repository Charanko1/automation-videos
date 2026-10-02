import { Buffer } from "node:buffer";

const DEFAULT_BASE_URL = "http://127.0.0.1:20128/v1";

export type OmniRouteImageResult = {
  imageBase64: string;
  mimeType: string;
  model: string;
};

function normalizeBase64(value: string) {
  return value.replace(/^data:[^;]+;base64,/, "").trim();
}

function mimeFromDataUrl(value: string) {
  const match = value.match(/^data:([^;]+);base64,/i);
  return match?.[1] ?? "image/png";
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export async function generateWithOmniRouteImage(options: {
  prompt: string;
  width?: number;
  height?: number;
  model?: string;
}): Promise<OmniRouteImageResult> {
  const apiKey = process.env.OMNIROUTE_API_KEY?.trim();
  const baseUrl = normalizeBaseUrl(process.env.OMNIROUTE_BASE_URL?.trim() || DEFAULT_BASE_URL);
  const model = options.model?.trim() || process.env.OMNIROUTE_IMAGE_MODEL?.trim();

  if (!apiKey) throw new Error("OMNIROUTE_API_KEY is required.");
  if (!model) throw new Error("OMNIROUTE_IMAGE_MODEL is required for OmniRoute image generation.");

  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: options.prompt,
      size: `${Math.max(256, Math.round(options.width ?? 1024))}x${Math.max(256, Math.round(options.height ?? 576))}`,
      n: 1,
      response_format: "b64_json",
    }),
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({})) as {
    created?: number;
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OmniRoute image request failed (${response.status}).`);
  }

  const item = data?.data?.[0];
  const b64 = typeof item?.b64_json === "string" ? item.b64_json.trim() : "";
  if (b64) {
    return { imageBase64: normalizeBase64(b64), mimeType: "image/png", model };
  }

  const dataUrl = typeof item?.url === "string" ? item.url.trim() : "";
  if (dataUrl.startsWith("data:")) {
    return { imageBase64: normalizeBase64(dataUrl), mimeType: mimeFromDataUrl(dataUrl), model };
  }

  if (/^https?:\/\//i.test(dataUrl)) {
    const imageResponse = await fetch(dataUrl, { cache: "no-store" });
    if (!imageResponse.ok) throw new Error(`OmniRoute returned an image URL, but fetching it failed (${imageResponse.status}).`);
    const contentType = imageResponse.headers.get("content-type") ?? "image/png";
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    return { imageBase64: bytes.toString("base64"), mimeType: contentType.split(";")[0] || "image/png", model };
  }

  throw new Error("OmniRoute returned no image data.");
}
