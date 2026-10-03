import { NextResponse } from "next/server";
import { renderLocalVideo } from "../../../../lib/local-renderer";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { ok: false, error: "Local rendering is currently development-only." },
      { status: 400 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
    const script = typeof body?.script === "string" ? body.script.trim() : "";
    const director = typeof body?.director === "string" ? body.director.trim() : "";
    const model = typeof body?.model === "string" ? body.model.trim().slice(0, 100) : undefined;
    const imageAssets = Array.isArray(body?.imageAssets)
      ? body.imageAssets
          .filter((asset: unknown) => {
            if (!asset || typeof asset !== "object") return false;
            const item = asset as Record<string, unknown>;
            return typeof item.assetUrl === "string" && item.assetUrl.startsWith("/generated/");
          })
          .slice(0, 30)
      : [];

    const videoAssets = Array.isArray(body?.videoAssets)
      ? body.videoAssets
          .filter((asset: unknown) => {
            if (!asset || typeof asset !== "object") return false;
            const item = asset as Record<string, unknown>;
            return typeof item.assetUrl === "string" && item.assetUrl.startsWith("/generated/videos/");
          })
          .slice(0, 30)
      : [];

    if (!projectId || !title || !script || !director) {
      return NextResponse.json(
        { ok: false, error: "projectId, title, script, and director are required." },
        { status: 400 },
      );
    }

    if (script.length > 100_000 || director.length > 100_000) {
      return NextResponse.json(
        { ok: false, error: "Project AI artifacts are too large for local rendering." },
        { status: 413 },
      );
    }

    console.log(`[AI Office] Render started: ${projectId} (${videoAssets.length} I2V videos)`);
    const result = await renderLocalVideo({ projectId, title, script, director, model, imageAssets, videoAssets });
    console.log(`[AI Office] Render completed: ${projectId}`);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local render failed.";
    console.error("[AI Office] Render failed:", message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    );
  }
}
