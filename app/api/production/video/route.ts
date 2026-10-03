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

async function downloadVideo(
  url: string,
  metadata?: {
    model?: string;
    cacheStatus?: string;
    provider?: string;
    requestId?: string;
    omniRouteVersion?: string;
  },
) {
  const baseUrl =
    process.env.OMNIROUTE_BASE_URL?.trim().replace(/\/v1\/?$/, "") ||
    "http://127.0.0.1:20128";
  const absoluteUrl = /^https?:\/\//i.test(url)
    ? url
    : new URL(url, `${baseUrl}/`).toString();

  const parsed = new URL(absoluteUrl);
  const omniRouteHost =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1";
  const omniRouteApiKey = process.env.OMNIROUTE_API_KEY?.trim();

  const attempts: RequestInit[] = [
    {
      headers: {
        Accept: "video/mp4,video/webm,video/*;q=0.9,*/*;q=0.1",
        "User-Agent": "AI-Office/1.0",
        ...(omniRouteHost && omniRouteApiKey
          ? { Authorization: `Bearer ${omniRouteApiKey}` }
          : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10 * 60 * 1000),
    },
  ];

  let lastStatus = 0;
  let lastDetail = "";

  for (let attempt = 0; attempt < attempts.length; attempt += 1) {
    const response = await fetch(absoluteUrl, attempts[attempt]);
    if (response.ok) {
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

    lastStatus = response.status;
    lastDetail = (await response.text().catch(() => "")).slice(0, 300);

    console.error("[AI Office] I2V artifact fetch failed:", {
      status: response.status,
      finalUrlHost: (() => {
        try {
          return new URL(response.url || absoluteUrl).hostname;
        } catch {
          return parsed.hostname;
        }
      })(),
      contentType: response.headers.get("content-type"),
      redirected: response.redirected,
      model: metadata?.model,
      provider: metadata?.provider,
      cacheStatus: metadata?.cacheStatus,
      requestId: metadata?.requestId,
      omniRouteVersion: metadata?.omniRouteVersion,
      detail: lastDetail,
    });
  }

  const host = parsed.hostname;
  const finalUrlHost = (() => {
    try {
      return new URL(absoluteUrl).hostname;
    } catch {
      return host;
    }
  })();
  const signedDate = parsed.searchParams.get("X-Amz-Date");
  const signedExpires = parsed.searchParams.get("X-Amz-Expires");
  const signedInfo =
    signedDate && signedExpires
      ? ` Signed URL: X-Amz-Date=${signedDate}, X-Amz-Expires=${signedExpires}s.`
      : "";
  throw new Error(
    [
      `Video artifact download failed (${lastStatus}) from ${host}.`,
      `Final host: ${finalUrlHost}.`,
      metadata?.model ? `Model: ${metadata.model}.` : "",
      metadata?.provider ? `Provider: ${metadata.provider}.` : "",
      metadata?.cacheStatus ? `OmniRoute cache: ${metadata.cacheStatus}.` : "",
      metadata?.omniRouteVersion ? `OmniRoute version: ${metadata.omniRouteVersion}.` : "",
      metadata?.requestId ? `Request id: ${metadata.requestId}.` : "",
      signedInfo,
      lastDetail ? `Upstream: ${lastDetail}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
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
      const downloaded = await downloadVideo(result.videoUrl, {
        model: result.model,
        cacheStatus: result.cacheStatus,
        provider: result.provider,
        requestId: result.requestId,
        omniRouteVersion: result.omniRouteVersion,
      });
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
      { ok: false, error: `I2V failed for ${sceneId}. ${message}` },
      { status: 502 },
    );
  }
}
