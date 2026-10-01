import { Buffer } from "node:buffer";

const DEFAULT_MODEL = "@cf/bytedance/stable-diffusion-xl-lightning";

export type CloudflareImageResult = {
  imageBase64: string;
  mimeType: string;
  model: string;
};

function normalizeBase64(value: string) {
  return value.replace(/^data:[^;]+;base64,/, "").trim();
}

export async function generateWithCloudflareImage(options: {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  numSteps?: number;
  guidance?: number;
  seed?: number;
  imageBase64?: string;
  imageMimeType?: string;
}): Promise<CloudflareImageResult> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const model = process.env.CLOUDFLARE_IMAGE_MODEL?.trim() || DEFAULT_MODEL;

  if (!accountId || !apiToken) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.");
  }

  const width = Math.max(256, Math.min(2048, Math.round(options.width ?? 1024)));
  const height = Math.max(256, Math.min(2048, Math.round(options.height ?? 576)));
  const numSteps = Math.max(1, Math.min(20, Math.round(options.numSteps ?? 4)));

  const payload: Record<string, unknown> = {
    prompt: options.prompt,
    negative_prompt: options.negativePrompt,
    width,
    height,
    num_steps: numSteps,
    guidance: options.guidance ?? 7.5,
  };

  if (typeof options.seed === "number") payload.seed = Math.round(options.seed);

  if (options.imageBase64) {
    payload.image_b64 = normalizeBase64(options.imageBase64);
    payload.strength = 0.75;
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudflare Workers AI ${response.status}: ${errorText.slice(0, 1200)}`);
  }

  if (contentType.includes("image/")) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      imageBase64: bytes.toString("base64"),
      mimeType: contentType.split(";")[0] || "image/png",
      model,
    };
  }

  const data = await response.json().catch(() => ({})) as {
    result?: unknown;
    success?: boolean;
    errors?: Array<{ message?: string }>;
  };

  if (Array.isArray(data.errors) && data.errors.length > 0) {
    throw new Error(data.errors.map((item) => item.message).filter(Boolean).join("; ") || "Cloudflare Workers AI returned an error.");
  }

  const result = data.result as Record<string, unknown> | string | undefined;
  const encoded =
    typeof result === "string"
      ? result
      : result && typeof result.image === "string"
        ? result.image
        : result && typeof result.image_base64 === "string"
          ? result.image_base64
          : "";

  if (!encoded) {
    throw new Error("Cloudflare Workers AI responded successfully, but no image data was returned.");
  }

  return {
    imageBase64: normalizeBase64(encoded),
    mimeType: "image/png",
    model,
  };
}
