import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateWithCloudflareImage } from "../../../../lib/cloudflare-image";
import { generateWithOmniRouteImage } from "../../../../lib/omniroute-image";
import {
  GEMI_NEGATIVE_PROFILE,
  GEMI_VISUAL_PROFILE,
  KIDS_SHORTS_CHARACTER_LOCK,
  KIDS_SHORTS_STYLE_LOCK,
} from "../../../../lib/gemi-style";

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
      "Generate ONE production-ready 9:16 vertical frame for a cheerful preschool YouTube Short for children ages 2-7.",
      "Character consistency, age-appropriate acting, and playful animation are mandatory.",
      "This frame must look like a shot from a cute polished 3D animated film, not concept art, poster art, or a documentary illustration.",
      KIDS_SHORTS_STYLE_LOCK,
      KIDS_SHORTS_CHARACTER_LOCK,
      GEMI_VISUAL_PROFILE,
      "The result must feel unmistakably cute and child-friendly: adorable rounded characters, big smiles, expressive eyes, simple colorful props, bright daylight, and polished 3D animation.",
      "ONE-SCENE RULE: one location, one simple action, one clear subject. Avoid visual complexity.",
      "SUBTITLE SAFE AREA: keep the bottom 20% of the image visually simple and mostly empty.",

      "KEYFRAME RULE: this is a frozen moment from an animated scene. Show the characters in the middle of a clear physical action or reaction. Do not pose them for a portrait.",
      "ACTION REQUIREMENT: show exactly one simple, age-appropriate visible action such as reaching, pointing, picking up, handing, cleaning, sharing, waving, jumping, stepping, hugging, or reacting.",
      "Do not show danger, fear, sadness, injury, or aggressive conflict."
      "POSE REQUIREMENT: use natural weight shift, bent joints, asymmetry, gesture direction, and active eye-lines. Avoid straight symmetrical standing poses.",

      characterBible ? "CHARACTER BIBLE (immutable; preserve these traits exactly):\n" + characterBible : "",
      "SCENE PROMPT:\n" + prompt,
      Array.isArray(body?.charactersPresent) && body.charactersPresent.length
        ? "VISIBLE CHARACTER IDS: " + body.charactersPresent.join(", ")
        : "",
      Array.isArray(body?.referenceCharacterIds) && body.referenceCharacterIds.length
        ? "REFERENCE CHARACTER IDS: " + body.referenceCharacterIds.join(", ")
        : "",
      typeof body?.emotionalBeat === "string" && body.emotionalBeat.trim()
        ? "EMOTIONAL BEAT: " + body.emotionalBeat.trim()
        : "",
      typeof body?.cameraAndComposition === "string" && body.cameraAndComposition.trim()
        ? "DIRECTOR CAMERA: " + body.cameraAndComposition.trim()
        : "",
      typeof body?.characterActions === "string" && body.characterActions.trim()
        ? "DIRECTOR ACTING: " + body.characterActions.trim()
        : "",
      "Do not redesign recurring characters. Do not add random clothing, facial features, hair changes, logos, or accessories that contradict the Character Bible.",
      "STYLE LOCK: " + GEMI_VISUAL_PROFILE,
      "ACTING DIRECTION: show the named characters interacting, reacting, looking at each other, holding relevant props, and expressing the emotional beat implied by the scene. Make emotions visually obvious and charming rather than stiff or neutral. Capture a mid-action instant with body movement, gesture, and reaction all readable at once.",
      "CHARACTER SCALE: avoid distant wide shots that make the cast tiny. Prefer medium, medium-wide, two-shot, over-the-shoulder, and close-up framing when dialogue or emotion is important. Keep at least one face and the key action large enough to read on a phone screen.",
      "CAMERA DIRECTION: stage the shot like a vertical animated short: medium shots, two-shots, over-the-shoulder, close-up, reaction shot, or motivated establishing shot. Keep faces, eye-lines, blocking, scale, and spatial relationships readable inside the 9:16 frame.",
      "CONTINUITY: preserve recurring character identity, costume, proportions, props, location, time of day, and emotional state from the supplied character bible and scene prompt.",
      "STRICTLY AVOID: dark, scary, horror, moody lighting, dramatic shadows, photorealistic photography, realistic human proportions, crowded scene, multiple rooms, crying, violence, adult themes, text, letters, subtitles, watermark, distorted hands, extra fingers, blurry, inconsistent character, stiff portrait poses.",
    ].filter(Boolean).join("\n\n");

    const omniImageModel = process.env.OMNIROUTE_IMAGE_MODEL?.trim();
    const useOmniRoute = Boolean(omniImageModel) && !referenceImageBase64;

    const negativePrompt = process.env.GEMI_IMAGE_NEGATIVE_PROMPT?.trim() || GEMI_NEGATIVE_PROFILE;

    let result: { imageBase64: string; mimeType: string; model: string };
    let provider: "OmniRoute" | "Cloudflare Workers AI";

    if (useOmniRoute) {
      try {
        result = await generateWithOmniRouteImage({
          prompt: fullPrompt,
          width: 576,
          height: 1024,
          model: omniImageModel,
        });
        provider = "OmniRoute";
      } catch (omniError) {
        result = await generateWithCloudflareImage({
          prompt: fullPrompt,
          width: 576,
          height: 1024,
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
        width: 576,
        height: 1024,
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
      code: "image_generation_exception",
      error: error instanceof Error ? error.message : "Unknown Cloudflare image error.",
    }, { status: 500 });
  }
}
