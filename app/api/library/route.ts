import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ ok: false, assets: [] }, { status: 400 });
  }

  try {
    const root = path.join(process.cwd(), "public", "generated");
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const assets = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const manifestPath = path.join(dir, "manifest.json");
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        assets.push({
          id: entry.name,
          title: manifest.title ?? entry.name,
          model: manifest.model ?? null,
          generatedAt: manifest.generatedAt ?? null,
          durationSeconds: manifest.durationSeconds ?? null,
          videoUrl: "/generated/" + entry.name + "/final.mp4",
          thumbnailUrl: "/generated/" + entry.name + "/thumbnail.jpg",
          manifestUrl: "/generated/" + entry.name + "/manifest.json",
        });
      } catch {
        // Ignore incomplete render directories.
      }
    }

    assets.sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")));
    return NextResponse.json({ ok: true, assets });
  } catch (error) {
    return NextResponse.json(
      { ok: false, assets: [], error: error instanceof Error ? error.message : "Library scan failed." },
      { status: 500 },
    );
  }
}
