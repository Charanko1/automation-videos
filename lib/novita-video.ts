const DEFAULT_BASE_URL = "https://api.novita.ai";
const DEFAULT_ENDPOINT = "/v3/async/kling-v3.0-std-i2v";
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

type NovitaTaskResponse = {
  task_id?: string;
  error?: { message?: string; code?: string | number };
  message?: string;
};

type NovitaTaskResult = {
  extra?: {
    debug_info?: {
      request_info?: string;
      submit_time_ms?: string;
      execute_time_ms?: string;
      complete_time_ms?: string;
    };
  };
  task?: {
    task_id?: string;
    status?: string;
    reason?: string;
    eta?: number;
    progress_percent?: number;
  };
  videos?: Array<{
    video_url?: string;
    video_url_ttl?: string | number;
    video_type?: string;
  }>;
  audios?: Array<{
    audio_url?: string;
  }>;
};

export type NovitaVideoResult = {
  model: string;
  videoUrl: string;
  taskId: string;
  status: string;
  progressPercent?: number;
};

function cleanBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function getApiKey() {
  const key = process.env.NOVITA_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "NOVITA_API_KEY is missing. Add your Novita AI API key to .env.local and restart AI Office.",
    );
  }
  return key;
}

function getEndpoint() {
  const custom = process.env.NOVITA_KLING_I2V_ENDPOINT?.trim();
  return custom || DEFAULT_ENDPOINT;
}

async function novitaFetch(path: string, init: RequestInit = {}) {
  const baseUrl = cleanBaseUrl(
    process.env.NOVITA_BASE_URL?.trim() || DEFAULT_BASE_URL,
  );

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${getApiKey()}`);
  headers.set("Content-Type", "application/json");

  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot reach Novita AI at ${baseUrl}. Check internet access and NOVITA_API_KEY. Original error: ${detail}`,
    );
  }
}

function normaliseImageForNovita(imageDataUrl: string) {
  if (!imageDataUrl.startsWith("data:image/")) {
    throw new Error("Kling I2V source image must be a data:image/... URL.");
  }

  // Novita's v3 model APIs accept an image string; keep the complete data URL
  // so the MIME type travels with the base64 payload.
  return imageDataUrl;
}

async function submitKlingI2V(
  prompt: string,
  imageDataUrl: string,
  durationSeconds: number,
) {
  const endpoint = getEndpoint();
  const response = await novitaFetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      image: normaliseImageForNovita(imageDataUrl),
      sound: false,
      prompt: prompt.slice(0, 2500),
      duration: durationSeconds,
      cfg_scale: 0.5,
      negative_prompt:
        "static pose, standing still, frozen, stiff motion, camera zoom, camera pan, tracking shot, scene change, collage, split screen, text, watermark, scary, dark, violent, dangerous action",
    }),
  });

  const data = (await response.json().catch(() => ({}))) as NovitaTaskResponse;

  if (!response.ok) {
    throw new Error(
      data?.error?.message ??
        data?.message ??
        `Novita Kling submission failed (${response.status}).`,
    );
  }

  if (!data.task_id) {
    throw new Error("Novita Kling accepted the request but returned no task_id.");
  }

  return data.task_id;
}

async function pollKlingTask(taskId: string, timeoutMs: number) {
  const startedAt = Date.now();
  let lastProgress = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const response = await novitaFetch(
      `/v3/async/task-result?task_id=${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        signal: AbortSignal.timeout(30_000),
      },
    );

    const data = (await response.json().catch(() => ({}))) as NovitaTaskResult;

    if (!response.ok) {
      throw new Error(
        data?.task?.reason ||
          `Novita task-result request failed (${response.status}).`,
      );
    }

    const task = data.task;
    const status = String(task?.status || "").toUpperCase();
    const progress =
      typeof task?.progress_percent === "number"
        ? task.progress_percent
        : undefined;

    if (progress !== undefined && progress > lastProgress) {
      lastProgress = progress;
      console.log(
        `[AI Office] Kling task ${taskId} progress ${progress}% status=${status}`,
      );
    }

    if (status === "TASK_STATUS_SUCCEED" || status === "SUCCEED") {
      const videoUrl = data.videos?.[0]?.video_url?.trim();
      if (!videoUrl) {
        throw new Error(
          "Novita marked the Kling task as successful but returned no video_url.",
        );
      }

      return {
        videoUrl,
        status,
        progressPercent: progress,
      };
    }

    if (status === "TASK_STATUS_FAILED" || status === "FAILED") {
      throw new Error(
        task?.reason || `Novita Kling task ${taskId} failed.`,
      );
    }

    await new Promise((resolve) =>
      setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS),
    );
  }

  throw new Error(
    `Novita Kling task ${taskId} did not finish within ${Math.round(timeoutMs / 60000)} minutes.`,
  );
}

export async function generateWithNovitaKlingI2V(
  prompt: string,
  imageDataUrl: string,
  options?: {
    durationSeconds?: number;
    timeoutMs?: number;
  },
): Promise<NovitaVideoResult> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error("Video prompt is required.");

  const durationSeconds = Math.max(
    3,
    Math.min(15, Math.round(options?.durationSeconds ?? 5)),
  );
  const timeoutMs = Math.max(
    60_000,
    Math.min(20 * 60 * 1000, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  );

  const taskId = await submitKlingI2V(
    cleanPrompt,
    imageDataUrl,
    durationSeconds,
  );

  console.log(
    `[AI Office] Submitted Kling v3.0 STD I2V task ${taskId}; polling Novita asynchronously.`,
  );

  const result = await pollKlingTask(taskId, timeoutMs);

  return {
    model: "kling-v3.0-std-i2v",
    videoUrl: result.videoUrl,
    taskId,
    status: result.status,
    progressPercent: result.progressPercent,
  };
}
