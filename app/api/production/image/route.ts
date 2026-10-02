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
      "Generate ONE production-ready 16:9 cinematic frame from an ongoing character-driven drama scene.",
      "Character consistency and acting continuity are mandatory.",
      "This frame must look like a shot from a 3D animated film, not concept art, poster art, or a documentary illustration.",
      characterBible ? "CHARACTER BIBLE (immutable; preserve these traits exactly):\n" + characterBible : "",
      "SCENE PROMPT:\n" + prompt,
      "Do not redesign recurring characters. Do not add random clothing, facial features, hair changes, logos, or accessories that contradict the Character Bible.",
      "STYLE LOCK: cute polished 3D animated film frame, chibi/toy-like proportions, soft rounded geometry, expressive friendly faces, high-quality 3D materials, subtle depth of field, cinematic lighting, warm playful family-friendly mood, coherent art direction across all scenes.",
      "ACTING DIRECTION: show the named characters interacting, reacting, looking at each other, holding relevant props, and expressing the emotional beat implied by the scene.",
      "CAMERA DIRECTION: stage the shot like an animated movie scene: two-shots, over-the-shoulder, close-up, reaction shot, or establishing shot. Keep eye-lines, blocking, scale, and spatial relationships readable.",
      "CONTINUITY: preserve recurring character identity, costume, proportions, props, location, time of day, and emotional state from the supplied character bible and scene prompt.",
      "STRICTLY AVOID: comic book, manga, anime, 2D illustration, graphic novel, flat vector artwork, thick ink outlines, sketch, watercolor, photorealistic photography, horror, gritty realism, text overlays, captions, subtitles, logos, UI panels.",
    ].filter(Boolean).join("\n\n");

    const omniImageModel = process.env.OMNIROUTE_IMAGE_MODEL?.trim();
    const useOmniRoute = Boolean(omniImageModel) && !referenceImageBase64;

    const negativePrompt = process.env.GEMI_IMAGE_NEGATIVE_PROMPT?.trim() || [
      "comic book", "manga", "anime", "2D illustration", "graphic novel", "flat vector art", "thick ink outlines",
      "sketch", "watercolor", "photorealistic", "gritty realism", "horror", "text", "subtitles", "captions", "logos", "UI"
    ].join(", ");

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
          negativePrompt,
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
        negativePrompt,
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
