import { SignJWT } from "jose";

const KLING_BASE_URL =
  process.env.KLING_BASE_URL?.trim().replace(/\/+$/, "") ||
  "https://api-singapore.klingai.com";

type KlingCreateResponse = {
  code?: number;
  message?: string;
  request_id?: string;
  data?: {
    id?: string;
    status?: string;
  };
};

type KlingTaskResponse = {
  code?: number;
  message?: string;
  request_id?: string;
  data?: Array<{
    id?: string;
    status?: string;
    message?: string;
    outputs?: Array<{
      type?: string;
      url?: string;
      watermark_url?: string;
      duration?: string;
    }>;
  }>;
};

export type KlingVideoResult = {
  model: string;
  videoUrl: string;
  mimeType: string;
  provider: string;
  requestId?: string;
  omniRouteVersion?: string;
  cacheStatus?: string;
};

async function getKlingToken() {
  const apiKey = process.env.KLING_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "KLING_API_KEY is required when AI_OFFICE_I2V_PROVIDER=kling.",
    );
  }

  // Current Kling API keys are sent directly as Bearer tokens. Some legacy
  // accounts may still expose AccessKey/SecretKey credentials, so support the
  // legacy JWT path too when those variables are configured.
  const accessKey = process.env.KLING_ACCESS_KEY?.trim();
  const secretKey = process.env.KLING_SECRET_KEY?.trim();

  if (accessKey && secretKey) {
    const secret = new TextEncoder().encode(secretKey);
    return await new SignJWT({ iss: accessKey })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setNotBefore("0s")
      .setExpirationTime("30m")
      .sign(secret);
  }

  return apiKey;
}

async function klingFetch(path: string, init: RequestInit = {}) {
  const token = await getKlingToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");

  const response = await fetch(`${KLING_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(10 * 60 * 1000),
  });

  return response;
}

function rawBase64FromDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/i);
  if (!match?.[1]) {
    throw new Error("Kling I2V source image must be a base64 data:image URL.");
  }
  return match[1];
}

export async function generateWithKlingDirect(
  prompt: string,
  imageDataUrl: string,
  options?: { durationSeconds?: number },
): Promise<KlingVideoResult> {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error("Video prompt is required.");

  const duration = Math.max(
    5,
    Math.min(10, Math.round(options?.durationSeconds ?? 5)),
  );

  const imageBase64 = rawBase64FromDataUrl(imageDataUrl);

  // Kling's current 2.5 Turbo I2V endpoint accepts a prompt plus a first-frame
  // image. Base64 may be sent without the data-url prefix.
  const createResponse = await klingFetch(
    "/image-to-video/kling-2.5-turbo",
    {
      method: "POST",
      body: JSON.stringify({
        contents: [
          { type: "prompt", text: cleanPrompt },
          { type: "first_frame", url: imageBase64 },
        ],
        settings: {
          resolution: "720p",
          duration,
        },
        options: {
          watermark_info: { enabled: false },
        },
      }),
    },
  );

  const createText = await createResponse.text().catch(() => "");
  let created: KlingCreateResponse = {};
  try {
    created = createText ? (JSON.parse(createText) as KlingCreateResponse) : {};
  } catch {
    // Keep raw response for diagnostics.
  }

  if (!createResponse.ok || created.code !== 0 || !created.data?.id) {
    throw new Error(
      `Kling create task failed (${createResponse.status}). ${created.message || createText.slice(0, 500)}`,
    );
  }

  const taskId = created.data.id;
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastStatus = "submitted";
  let lastMessage = "";

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const taskResponse = await klingFetch(
      `/tasks?task_ids=${encodeURIComponent(taskId)}`,
      { method: "GET", body: undefined },
    );

    const taskText = await taskResponse.text().catch(() => "");
    let task: KlingTaskResponse = {};
    try {
      task = taskText ? (JSON.parse(taskText) as KlingTaskResponse) : {};
    } catch {
      // Keep raw response for diagnostics.
    }

    const item = Array.isArray(task.data) ? task.data[0] : undefined;
    lastStatus = item?.status || lastStatus;
    lastMessage = item?.message || task.message || "";

    console.log("[AI Office] KLING DIRECT STATUS", {
      taskId,
      status: lastStatus,
      message: lastMessage,
    });

    if (!taskResponse.ok || (typeof task.code === "number" && task.code !== 0)) {
      throw new Error(
        `Kling task query failed (${taskResponse.status}). ${lastMessage || taskText.slice(0, 500)}`,
      );
    }

    if (lastStatus === "failed") {
      throw new Error(
        `Kling I2V task failed. ${lastMessage || "No failure message returned."}`,
      );
    }

    if (lastStatus === "succeeded" || lastStatus === "success") {
      const output = item?.outputs?.find(
        (candidate) => candidate?.type === "video" && candidate?.url,
      );
      if (!output?.url) {
        throw new Error(
          "Kling I2V task succeeded but did not return a video URL.",
        );
      }

      return {
        model: "kling-v2-5-turbo",
        videoUrl: output.url,
        mimeType: "video/mp4",
        provider: "klingai-direct",
        requestId: task.request_id || created.request_id,
      };
    }
  }

  throw new Error(
    `Kling I2V timed out after 10 minutes. Last status: ${lastStatus}. ${lastMessage}`,
  );
}
