import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateWithCloudflareImage } from "../../../../lib/cloudflare-image";
import { generateWithOmniRouteImage } from "../../../../lib/omniroute-image";

function safeSegment(value: string, fallback: string) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const characterBible = typeof body?.characterBible === "string" ? body.characterBible.trim() : "";
    const projectId = typeof body?.projectId === "string" ? body.projectId : "project";
    const sceneId = typeof body?.sceneId === "string" ? body.sceneId : "scene-01";

    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Image prompt is required." }, { status: 400 });
    }

    const referenceImageBase64 = typeof body?.referenceImageBase64 === "string" ? body.referenceImageBase64.trim() : "";

    const fullPrompt = [
      "You are Gemi, the Image Artist for AI Office.",
      "Generate ONE production-ready 16:9 cinematic image for a video scene.",
      "Character consistency is mandatory.",
      characterBible ? "CHARACTER BIBLE (immutable; preserve these traits exactly):\n" + characterBible : "",
      "SCENE PROMPT:\n" + prompt,
      "Do not redesign recurring characters. Do not add random clothing, facial features, hair changes, logos, or accessories that contradict the Character Bible.",
    ].filter(Boolean).join("\n\n");

    const omniImageModel = process.env.OMNIROUTE_IMAGE_MODEL?.trim();
    const useOmniRoute = Boolean(omniImageModel) && !referenceImageBase64;

    let result: { imageBase64: string; mimeType: string; model: string };
    let provider: "OmniRoute" | "Cloudflare Workers AI";

    if (useOmniRoute) {
      try {
        result = await generateWithOmniRouteImage({
          prompt: fullPrompt,
          width: 1024,
          height: 576,
          model: omniImageModel,
        });
        provider = "OmniRoute";
      } catch (omniError) {
        result = await generateWithCloudflareImage({
          prompt: fullPrompt,
          width: 1024,
          height: 576,
          numSteps: 4,
          imageBase64: referenceImageBase64 || undefined,
        });
        provider = "Cloudflare Workers AI";
        console.warn(
          "OmniRoute image generation failed; Cloudflare fallback used:",
          omniError instanceof Error ? omniError.message : omniError,
        );
      }
    } else {
      result = await generateWithCloudflareImage({
        prompt: fullPrompt,
        width: 1024,
        height: 576,
        numSteps: 4,
        imageBase64: referenceImageBase64 || undefined,
      });
      provider = "Cloudflare Workers AI";
    }

    const projectSlug = safeSegment(projectId, "project");
    const sceneSlug = safeSegment(sceneId, "scene-01");
    const relativeDir = path.join("generated", "images", projectSlug);
    const absoluteDir = path.join(process.cwd(), "public", relativeDir);
    await mkdir(absoluteDir, { recursive: true });

    const extension = result.mimeType.includes("jpeg") || result.mimeType.includes("jpg") ? "jpg" : "png";
    const filename = sceneSlug + "." + extension;
    await writeFile(path.join(absoluteDir, filename), Buffer.from(result.imageBase64, "base64"));

    return NextResponse.json({
      ok: true,
      provider,
      model: result.model,
      assetUrl: "/" + relativeDir.replaceAll(path.sep, "/") + "/" + filename,
      mimeType: result.mimeType,
      message: `${provider} generated and saved the image asset.`,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      code: "cloudflare_image_exception",
      error: error instanceof Error ? error.message : "Unknown Cloudflare image error.",
    }, { status: 500 });
  }
}
