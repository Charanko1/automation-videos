const DEFAULT_BASE_URL = "http://127.0.0.1:20128/v1";

type OmniRouteVideoResponse = {
  model?: string;
  data?: Array<{
    url?: string;
    b64_json?: string;
    mime_type?: string;
    content?: string;
    video_url?: string;
  }>;
  url?: string;
  video_url?: string;
  b64_json?: string;
  id?: string;
  status?: string;
  error?: { message?: string; code?: string | number };
  message?: string;
};

export type OmniRouteVideoResult = {
  model: string;
  videoUrl?: string;
  videoBase64?: string;
  mimeType: string;
  cacheStatus?: string;
  provider?: string;
  requestId?: string;
  omniRouteVersion?: string;
};

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

async function requestOmniRoute(path: string, init: RequestInit = {}) {
  const baseUrl = normalizeBaseUrl(
    process.env.OMNIROUTE_BASE_URL?.trim() || DEFAULT_BASE_URL,
  );
  const apiKey = process.env.OMNIROUTE_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "OMNIROUTE_API_KEY is required. Start OmniRoute and copy the API key from Dashboard → Endpoints.",
    );
  }

  const candidates = [baseUrl];

  // Windows/Node can resolve "localhost" to IPv6 (::1) while OmniRoute is
  // listening on IPv4. Retry the same request through 127.0.0.1.
  if (/^http:\/\/localhost(?::|\/)/i.test(baseUrl)) {
    candidates.push(
      baseUrl.replace(/^http:\/\/localhost/i, "http://127.0.0.1"),
    );
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Content-Type", "application/json");

  // Video providers such as Novita return short-lived signed URLs. Never let
  // OmniRoute's media cache reuse an old signed URL for an identical scene.
  headers.set("X-OmniRoute-No-Cache", "true");
  headers.set("Cache-Control", "no-store");

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

  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);

  throw new Error(
    `Cannot reach OmniRoute at ${candidates.join(" or ")}. Make sure OmniRoute is running on port 20128 and OMNIROUTE_BASE_URL is correct. Original error: ${detail}`,
  );
}

function isVideoModel(id: string) {
  const value = id.toLowerCase();
  return (
    value.includes("video") ||
    value.includes("i2v") ||
    value.includes("image-to-video") ||
    value.includes("image_to_video") ||
    value.includes("seedance") ||
    value.includes("kling") ||
    value.includes("runway")
  );
}

function looksLikeI2VModel(id: string) {
  const value = id.toLowerCase();
  return (
    value.includes("i2v") ||
    value.includes("image-to-video") ||
    value.includes("image_to_video") ||
    value.includes("runway") ||
    value.includes("grok-imagine-video") ||
    value.includes("wan-2.1") ||
    value.includes("wan-2.2") ||
    value.includes("seedance")
  );
}

async function resolveVideoModel() {
  const configured = process.env.OMNIROUTE_VIDEO_MODEL?.trim();
  if (configured) return configured;

  const response = await requestOmniRoute("/models");
  const data = (await response.json().catch(() => ({}))) as {
    data?: Array<{ id?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(
      data?.error?.message ??
        `OmniRoute model catalog request failed (${response.status}).`,
    );
  }

  const models = Array.isArray(data.data)
    ? data.data
        .map((item) => (typeof item?.id === "string" ? item.id.trim() : ""))
        .filter(Boolean)
    : [];

  // Prefer Kling I2V when it is exposed by OmniRoute. This avoids the
  // previous Novita-first behavior that caused production runs to fail with
  // 403/insufficient-balance when the Novita account had no credit.
  const klingI2V = models.find((id) => {
    const value = id.toLowerCase();
    return (
      (value.startsWith("klingai/") || value.startsWith("kling/")) &&
      (value.includes("i2v") ||
        value.includes("image-to-video") ||
        value.includes("image_to_video") ||
        value.includes("v2.5-turbo") ||
        value.includes("v2-5-turbo") ||
        value.includes("v2.6") ||
        value.includes("v2-6"))
    );
  });
  if (klingI2V) return klingI2V;

  // Keep Novita as the next fallback when Kling I2V is not connected.
  const novitaI2V = models.find((id) => {
    const value = id.toLowerCase();
    return (
      value.startsWith("novita/") &&
      (value.includes("i2v") ||
        value.includes("img2video") ||
        value.includes("image-to-video") ||
        value.includes("image_to_video"))
    );
  });
  if (novitaI2V) return novitaI2V;

  const preferred = models.find(looksLikeI2VModel);
  if (preferred) {
    console.warn(
      `[AI Office] No Novita I2V model was exposed by OmniRoute; auto-selected ${preferred}. Set OMNIROUTE_VIDEO_MODEL explicitly to your intended I2V provider/model.`,
    );
    return preferred;
  }

  const novitaModels = models.filter((id) => id.toLowerCase().startsWith("novita/"));
  if (novitaModels.length > 0) {
    throw new Error(
      `OmniRoute exposes Novita models but none is identified as I2V: ${novitaModels.join(", ")}. Set OMNIROUTE_VIDEO_MODEL to a Novita I2V model such as novita/wan2.7-i2v if it appears in your catalog.`,
    );
  }

  const anyVideo = models.find(isVideoModel);
  if (anyVideo) {
    throw new Error(
      `OmniRoute exposed video model "${anyVideo}", but no model was identified as image-to-video. Set OMNIROUTE_VIDEO_MODEL to an I2V-capable model from your OmniRoute model catalog.`,
    );
  }

  throw new Error(
    "No video model was exposed by OmniRoute. Connect a video provider and set OMNIROUTE_VIDEO_MODEL to an image-to-video model.",
  );
}

function extractMedia(data: OmniRouteVideoResponse) {
  const first = Array.isArray(data.data) ? data.data[0] : undefined;

  const url =
    first?.url?.trim() ||
    first?.video_url?.trim() ||
    data.url?.trim() ||
    data.video_url?.trim();

  const videoBase64 =
    first?.b64_json?.trim() ||
    first?.content?.trim() ||
    data.b64_json?.trim();

  return {
    url: url || undefined,
    videoBase64: videoBase64 || undefined,
    mimeType:
      first?.mime_type?.trim() ||
      (videoBase64 ? "video/mp4" : "video/mp4"),
  };
}

export async function generateWithOmniRouteVideo(
  prompt: string,
  imageDataUrl: string,
  options?: {
    model?: string;
    durationSeconds?: number;
  },
): Promise<OmniRouteVideoResult> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error("Video prompt is required.");
  if (!imageDataUrl.startsWith("data:image/")) {
    throw new Error("I2V source image must be supplied as a data:image/... URL.");
  }

  const model = options?.model?.trim() || (await resolveVideoModel());
  const duration = Math.max(
    4,
    Math.min(10, Math.round(options?.durationSeconds ?? 5)),
  );

  const response = await requestOmniRoute("/videos/generations", {
    method: "POST",
    signal: AbortSignal.timeout(10 * 60 * 1000),
    body: JSON.stringify({
      model,
      prompt: cleanPrompt,
      image: imageDataUrl,
      promptImage: imageDataUrl,
      input_reference: imageDataUrl,
      first_frame_image: imageDataUrl,
      duration,
      seconds: duration,
      aspect_ratio: "9:16",
      ratio: "9:16",
      size: "720x1280",
      width: 720,
      height: 1280,
      sound: false,
      response_format: "url",
    }),
  });

  const rawResponseText = await response.text().catch(() => "");
  let data: OmniRouteVideoResponse = {};
  try {
    data = rawResponseText ? (JSON.parse(rawResponseText) as OmniRouteVideoResponse) : {};
  } catch {
    // Keep the raw text for diagnostics when OmniRoute returns a non-JSON response.
  }

  if (!response.ok) {
    const providerMessage =
      data?.error?.message ??
      data?.message ??
      rawResponseText.slice(0, 500) ??
      `OmniRoute video request failed (${response.status}).`;

    console.error("[AI Office] I2V OMNIROUTE RESPONSE", {
      buildMarker: "I2V-OMNI-BUILD-20261003-1",
      status: response.status,
      statusText: response.statusText,
      model,
      responseUrl: response.url,
      cacheStatus: response.headers.get("X-OmniRoute-Cache"),
      provider: response.headers.get("X-OmniRoute-Provider"),
      requestId: response.headers.get("X-OmniRoute-Request-Id"),
      omniRouteVersion: response.headers.get("X-OmniRoute-Version"),
      contentType: response.headers.get("content-type"),
      body: rawResponseText.slice(0, 1000),
    });

    throw new Error(
      `OmniRoute video request failed (${response.status}). ${providerMessage}`,
    );
  }

  const media = extractMedia(data);
  if (!media.url && !media.videoBase64) {
    throw new Error(
      `OmniRoute video model "${model}" completed without returning a video URL or base64 video. Response status: ${data.status ?? "unknown"}.`,
    );
  }

  return {
    model: typeof data.model === "string" && data.model.trim() ? data.model.trim() : model,
    videoUrl: media.url,
    videoBase64: media.videoBase64,
    mimeType: media.mimeType,
    cacheStatus: response.headers.get("X-OmniRoute-Cache")?.trim() || undefined,
    provider: response.headers.get("X-OmniRoute-Provider")?.trim() || undefined,
    requestId: response.headers.get("X-OmniRoute-Request-Id")?.trim() || undefined,
    omniRouteVersion: response.headers.get("X-OmniRoute-Version")?.trim() || undefined,
  };
}
