import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { generateWithNovitaKlingI2V } from "../../../../lib/novita-video";

function safeName(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "ai-office"
  );
}

function resolvePublicAssetPath(assetUrl: string) {
  const clean = assetUrl.split("?")[0].split("#")[0];
  if (!clean.startsWith("/generated/")) return null;

  const relative = clean.replace(/^\/+/, "");
  const absolute = path.resolve(process.cwd(), "public", relative);
  const publicRoot = path.resolve(process.cwd(), "public") + path.sep;

  if (!absolute.startsWith(publicRoot)) return null;
  return absolute;
}

function extensionForContentType(contentType: string) {
  return /webm/i.test(contentType) ? ".webm" : ".mp4";
}

async function downloadVideo(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });

  if (!response.ok) {
    throw new Error(
      `Novita generated the video, but downloading the video failed (${response.status}).`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024) {
    throw new Error("Novita returned an unexpectedly small video file.");
  }

  return {
    bytes,
    extension: extensionForContentType(
      response.headers.get("content-type") || "video/mp4",
    ),
  };
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { ok: false, error: "Local video generation is currently development-only." },
      { status: 400 },
    );
  }

  let sceneId = "scene";
  try {
    const body = await request.json().catch(() => ({}));
    const projectId =
      typeof body?.projectId === "string" ? body.projectId.trim() : "";
    sceneId =
      typeof body?.sceneId === "string" ? body.sceneId.trim() : "scene";
    const sourceAssetUrl =
      typeof body?.sourceAssetUrl === "string"
        ? body.sourceAssetUrl.trim()
        : "";
    const prompt =
      typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const durationSeconds =
      typeof body?.durationSeconds === "number"
        ? body.durationSeconds
        : Number(body?.durationSeconds);

    if (!projectId || !sceneId || !sourceAssetUrl || !prompt) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "projectId, sceneId, sourceAssetUrl, and prompt are required.",
        },
        { status: 400 },
      );
    }

    const imagePath = resolvePublicAssetPath(sourceAssetUrl);
    if (!imagePath) {
      return NextResponse.json(
        {
          ok: false,
          error: "sourceAssetUrl must point to a generated local image.",
        },
        { status: 400 },
      );
    }

    const imageBytes = await fs.readFile(imagePath);
    if (imageBytes.length === 0) {
      throw new Error("The source scene image is empty.");
    }

    if (imageBytes.length > 10 * 1024 * 1024) {
      throw new Error("The source scene image is larger than Novita's 10MB limit.");
    }

    const imageDataUrl =
      "data:image/png;base64," + imageBytes.toString("base64");

    const result = await generateWithNovitaKlingI2V(
      prompt,
      imageDataUrl,
      {
        durationSeconds:
          Number.isFinite(durationSeconds) && durationSeconds > 0
            ? durationSeconds
            : 5,
      },
    );

    const projectSlug = safeName(projectId);
    const sceneSlug = safeName(sceneId);
    const outputDir = path.join(
      process.cwd(),
      "public",
      "generated",
      "videos",
      projectSlug,
    );

    await fs.mkdir(outputDir, { recursive: true });

    const downloaded = await downloadVideo(result.videoUrl);
    const destination = path.join(
      outputDir,
      sceneSlug + downloaded.extension,
    );
    await fs.writeFile(destination, downloaded.bytes);

    return NextResponse.json({
      ok: true,
      sceneId,
      assetUrl: `/generated/videos/${projectSlug}/${sceneSlug}${downloaded.extension}`,
      model: result.model,
      taskId: result.taskId,
      status: result.status,
      progressPercent: result.progressPercent,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Video generation failed.";
    console.error("[AI Office] Kling I2V failed:", message);
    return NextResponse.json(
      { ok: false, error: `Kling I2V failed for ${sceneId}. ${message}` },
      { status: 502 },
    );
  }
}
