import { NextResponse } from "next/server";

const DEFAULT_MODEL = "gemini-3.1-flash-image";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

type ImageBlock = {
  type?: string;
  data?: string;
  mime_type?: string;
};

type GeminiInteraction = {
  id?: string;
  status?: string;
  steps?: Array<{
    type?: string;
    content?: ImageBlock[];
  }>;
  error?: { code?: number; message?: string; status?: string };
};

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, code: "gemini_api_key_missing", error: "GEMINI_API_KEY is not configured. Add it to .env.local and restart Next.js." },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const prompt =
      typeof body?.prompt === "string" && body.prompt.trim()
        ? body.prompt.trim()
        : "Generate a cinematic, realistic deep-ocean submarine scene with dramatic volumetric lighting, detailed water particles, and a wide 16:9 composition.";

    const model =
      typeof body?.model === "string" && body.model.trim()
        ? body.model.trim()
        : process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_MODEL;

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        response_format: {
          type: "image",
          aspect_ratio: "16:9",
          image_size: "1K",
        },
        store: false,
      }),
      cache: "no-store",
    });

    const data = (await response.json().catch(() => ({}))) as GeminiInteraction;

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: data.error?.status ?? "gemini_api_error",
          status: response.status,
          error: data.error?.message ?? "Gemini image generation request failed.",
        },
        { status: response.status },
      );
    }

    const imageStep = data.steps?.find((step) => step.type === "model_output");
    const imageBlock = imageStep?.content?.find(
      (block) => block.type === "image" && typeof block.data === "string" && block.data.length > 0,
    );

    if (!imageBlock?.data) {
      return NextResponse.json(
        {
          ok: false,
          code: "gemini_image_no_result",
          error: "Gemini responded successfully, but no image data was returned.",
          model,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      stage: "image_generation",
      provider: "Google Gemini API",
      model,
      mimeType: imageBlock.mime_type ?? "image/png",
      imageBase64: imageBlock.data,
      message: "Gemini image generation succeeded.",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, code: "gemini_image_test_exception", error: error instanceof Error ? error.message : "Unknown Gemini error." },
      { status: 500 },
    );
  }
}
