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

    const result = await renderLocalVideo({ projectId, title, script, director, model });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Local render failed." },
      { status: 502 },
    );
  }
}
