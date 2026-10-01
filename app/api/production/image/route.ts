import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_MODEL = "gemini-3.1-flash-image";

function safeSegment(value: string, fallback: string) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

type Step = {
  type?: string;
  content?: Array<{
    type?: string;
    data?: string;
    mime_type?: string;
  }>;
};

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, code: "gemini_api_key_missing", error: "GEMINI_API_KEY is not configured." }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const characterBible = typeof body?.characterBible === "string" ? body.characterBible.trim() : "";
    const projectId = typeof body?.projectId === "string" ? body.projectId : "project";
    const sceneId = typeof body?.sceneId === "string" ? body.sceneId : "scene-01";
    const model = typeof body?.model === "string" && body.model.trim()
      ? body.model.trim()
      : process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_MODEL;

    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Image prompt is required." }, { status: 400 });
    }

    const referenceImageBase64 = typeof body?.referenceImageBase64 === "string" ? body.referenceImageBase64.trim() : "";
    const referenceMimeType = typeof body?.referenceMimeType === "string" ? body.referenceMimeType : "image/png";

    const fullPrompt = [
      "You are Gemi, the Image Artist for AI Office.",
      "Generate ONE production-ready 16:9 cinematic image for a video scene.",
      "Character consistency is mandatory.",
      characterBible ? "CHARACTER BIBLE (immutable; preserve these traits exactly):\n" + characterBible : "",
      "SCENE PROMPT:\n" + prompt,
      "Do not redesign recurring characters. Do not add random clothing, facial features, hair changes, logos, or accessories that contradict the Character Bible.",
    ].filter(Boolean).join("\n\n");

    const input: unknown[] = [{ type: "text", text: fullPrompt }];
    if (referenceImageBase64) {
      input.push({
        type: "image",
        data: referenceImageBase64.replace(/^data:[^;]+;base64,/, ""),
        mime_type: referenceMimeType,
      });
    }

    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input,
        response_format: {
          type: "image",
          aspect_ratio: "16:9",
          image_size: "1K",
        },
        store: false,
      }),
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({})) as {
      id?: string;
      status?: string;
      steps?: Step[];
      error?: { message?: string; status?: string; code?: number };
    };

    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        code: data.error?.status ?? "gemini_api_error",
        status: response.status,
        error: data.error?.message ?? "Gemini image generation failed.",
      }, { status: response.status });
    }

    const image = data.steps
      ?.filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? [])
      .find((block) => block.type === "image" && typeof block.data === "string" && block.data.length > 0);

    if (!image?.data) {
      return NextResponse.json({ ok: false, code: "gemini_image_no_result", error: "No generated image was returned.", model }, { status: 502 });
    }

    const mimeType = image.mime_type ?? "image/png";
    const extension = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
    const projectSlug = safeSegment(projectId, "project");
    const sceneSlug = safeSegment(sceneId, "scene-01");
    const relativeDir = path.join("generated", "images", projectSlug);
    const absoluteDir = path.join(process.cwd(), "public", relativeDir);
    await mkdir(absoluteDir, { recursive: true });

    const filename = sceneSlug + "." + extension;
    await writeFile(path.join(absoluteDir, filename), Buffer.from(image.data, "base64"));

    return NextResponse.json({
      ok: true,
      provider: "Google Gemini API",
      model,
      interactionId: data.id,
      assetUrl: "/" + relativeDir.replaceAll(path.sep, "/") + "/" + filename,
      mimeType,
      message: "Gemi generated and saved the image asset.",
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      code: "gemini_image_exception",
      error: error instanceof Error ? error.message : "Unknown Gemini image error.",
    }, { status: 500 });
  }
}
