import { Client, handle_file } from "@gradio/client";
import { promises as fs } from "node:fs";

const DEFAULT_SPACE = "Wan-AI/Wan-2.2-5B";
const DEFAULT_SPACE_URL = "https://wan-ai-wan-2-2-5b.hf.space";
const DEFAULT_API_NAME = "/generate_video";

export type HFWanVideoResult = { model: string; videoUrl?: string; videoBase64?: string; mimeType: string; provider: string };

function extractRemoteUrl(value: unknown): string | undefined {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) return value.trim();
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  for (const key of ["url", "video_url", "video", "file", "value", "data"]) {
    const found = extractRemoteUrl(item[key]);
    if (found) return found;
  }
  return undefined;
}

function extractLocalPath(value: unknown): string | undefined {
  if (typeof value === "string" && !/^https?:\/\//i.test(value) && value.length > 0) return value;
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  for (const key of ["path", "video", "file", "value", "data"]) {
    const found = extractLocalPath(item[key]);
    if (found) return found;
  }
  return undefined;
}

function normalizeDuration(value?: number) {
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(5, Math.round(value * 10) / 10));
}

export async function generateWithHFWan(prompt: string, imageDataUrl: string, options?: { durationSeconds?: number }): Promise<HFWanVideoResult> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error("Video prompt is required.");
  if (!imageDataUrl.startsWith("data:image/")) throw new Error("HF Wan I2V source image must be a data:image/... URL.");

  const space = process.env.HF_WAN_SPACE?.trim() || DEFAULT_SPACE;
  const apiName = process.env.HF_WAN_API_NAME?.trim() || DEFAULT_API_NAME;
  const spaceUrl = process.env.HF_WAN_SPACE_URL?.trim().replace(/\/+$/, "") || DEFAULT_SPACE_URL;
  const duration = normalizeDuration(options?.durationSeconds);
  const imageBuffer = Buffer.from(imageDataUrl.replace(/^data:image\/[^;]+;base64,/i, ""), "base64");
  if (imageBuffer.length < 100) throw new Error("HF Wan received an empty/invalid source image.");

  console.log("[AI Office] HF WAN CONNECT", { space, apiName, duration });
  const client = await Client.connect(space, { events: ["status", "data"] });
  const apiInfo = await client.view_api();
  const namedEndpoints = apiInfo?.named_endpoints ?? {};
  console.log("[AI Office] HF WAN API", { space, endpoints: Object.keys(namedEndpoints) });

  const endpoint = namedEndpoints[apiName] ? apiName : Object.keys(namedEndpoints).find((name) => /generate_video|image.*video|i2v/i.test(name));
  if (!endpoint) throw new Error("HF Wan Space \"" + space + "\" does not expose \"" + apiName + "\". Available endpoints: " + (Object.keys(namedEndpoints).join(", ") || "none"));

  const result = await client.predict(endpoint, [
    handle_file(imageBuffer),
    cleanPrompt,
    1280,
    720,
    duration,
    30,
    5.0,
    5.0,
    -1,
  ]);

  const data = Array.isArray(result?.data) ? result.data : [result?.data];
  const videoUrl = data.map(extractRemoteUrl).find(Boolean);
  if (videoUrl) return { model: "Wan2.2-5B", videoUrl, mimeType: "video/mp4", provider: "huggingface-zerogpu" };

  const localPath = data.map(extractLocalPath).find(Boolean);
  if (localPath) {
    try {
      const bytes = await fs.readFile(localPath);
      if (bytes.length >= 1024) return { model: "Wan2.2-5B", videoBase64: bytes.toString("base64"), mimeType: "video/mp4", provider: "huggingface-zerogpu" };
    } catch {}
    return { model: "Wan2.2-5B", videoUrl: localPath.startsWith("/") ? new URL(localPath, spaceUrl).toString() : localPath, mimeType: "video/mp4", provider: "huggingface-zerogpu" };
  }

  throw new Error("HF Wan completed without a video artifact. Raw result: " + JSON.stringify(result).slice(0, 1200));
}