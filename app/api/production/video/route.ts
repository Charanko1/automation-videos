import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { generateWithOmniRouteVideo } from "../../../../lib/omniroute-video";

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

function extensionForMime(mimeType: string) {
  if (/webm/i.test(mimeType)) return ".webm";
  if (/quicktime/i.test(mimeType)) return ".mov";
  return ".mp4";
}

async function downloadVideo(url: string) {
  const baseUrl =
    process.env.OMNIROUTE_BASE_URL?.trim().replace(/\/v1\/?$/, "") ||
    "http://127.0.0.1:20128";
  const absoluteUrl = /^https?:\/\//i.test(url)
    ? url
    : new URL(url, `${baseUrl}/`).toString();

  const response = await fetch(absoluteUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });

  if (!response.ok) {
    throw new Error(`OmniRoute returned a video URL, but downloading it failed (${response.status}).`);
  }

  const contentType = response.headers.get("content-type") || "video/mp4";
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024) {
    throw new Error("The generated video response was unexpectedly small.");
  }

  return {
    bytes,
    extension: extensionForMime(contentType),
  };
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { ok: false, error: "Local video generation is currently development-only." },
      { status: 400 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const projectId =
      typeof body?.projectId === "string" ? body.projectId.trim() : "";
    const sceneId =
      typeof body?.sceneId === "string" ? body.sceneId.trim() : "";
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
        { ok: false, error: "projectId, sceneId, sourceAssetUrl, and prompt are required." },
        { status: 400 },
      );
    }

    const imagePath = resolvePublicAssetPath(sourceAssetUrl);
    if (!imagePath) {
      return NextResponse.json(
        { ok: false, error: "sourceAssetUrl must point to a generated local image." },
        { status: 400 },
      );
    }

    const imageBytes = await fs.readFile(imagePath);
    if (imageBytes.length === 0) {
      throw new Error("The source scene image is empty.");
    }

    const imageDataUrl =
      "data:image/png;base64," + imageBytes.toString("base64");

    const result = await generateWithOmniRouteVideo(prompt, imageDataUrl, {
      durationSeconds:
        Number.isFinite(durationSeconds) && durationSeconds > 0
          ? durationSeconds
          : 5,
    });

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

    let extension = ".mp4";
    let destination = path.join(outputDir, sceneSlug + extension);

    if (result.videoBase64) {
      const rawBase64 = result.videoBase64.replace(/^data:[^;]+;base64,/i, "");
      const bytes = Buffer.from(rawBase64, "base64");
      if (bytes.length < 1024) {
        throw new Error("OmniRoute returned an unexpectedly small base64 video.");
      }
      extension = extensionForMime(result.mimeType);
      destination = path.join(outputDir, sceneSlug + extension);
      await fs.writeFile(destination, bytes);
    } else if (result.videoUrl) {
      const downloaded = await downloadVideo(result.videoUrl);
      extension = downloaded.extension;
      destination = path.join(outputDir, sceneSlug + extension);
      await fs.writeFile(destination, downloaded.bytes);
    }

    return NextResponse.json({
      ok: true,
      sceneId,
      assetUrl: `/generated/videos/${projectSlug}/${sceneSlug}${extension}`,
      model: result.model,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Video generation failed.";
    console.error("[AI Office] I2V failed:", message);
    return NextResponse.json(
      { ok: false, error: `I2V failed for ${typeof bodySceneIdPlaceholder === "string" ? bodySceneIdPlaceholder : "scene"}. ${message}` },
      { status: 502 },
    );
  }
}
