import { NextResponse } from "next/server";
import { generateWithChatGPTImage } from "../../../../lib/chatgpt-image";
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
      "Generate ONE complete full-frame 9:16 image for a cheerful preschool YouTube Short for children ages 2-7.",
      "Character consistency, age-appropriate acting, and playful body motion are mandatory.",
      "This is ONE standalone animation keyframe, not a collage, split screen, montage, or storyboard sheet.",
      KIDS_SHORTS_STYLE_LOCK,
      KIDS_SHORTS_CHARACTER_LOCK,
      GEMI_VISUAL_PROFILE,
      "The result must feel unmistakably cute and child-friendly: adorable rounded characters, big smiles, expressive eyes, simple colorful props, bright daylight, and polished 3D animation.",
      "ONE-SCENE RULE: one location, one simple action, one clear subject. Avoid visual complexity.",
      "SUBTITLE SAFE AREA: keep the bottom 20% of the image visually simple and mostly empty.",
      "CAMERA RULE: static locked-off shot, no zoom, no pan, no camera movement.",
      "ALL MOTION COMES FROM CHARACTERS: do not animate or imply camera movement.",
      "ONE IMAGE RULE: full-frame single image only, never split screen, collage, montage, or multiple panels.",

      "KEYFRAME RULE: freeze an expressive moment from the middle of a character action. The starting state must already be active at time 0, not a neutral pose.",
      "ACTION REQUIREMENT: show exactly one simple, age-appropriate physical action, with visible arms/hands/legs/body movement such as reaching, pointing, picking up, handing, cleaning, sharing, waving, jumping, stepping, hugging, clapping, or dancing.",
      "Do not show danger, fear, sadness, injury, or aggressive conflict.",
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
      typeof body?.motion === "string" && body.motion.trim()
        ? "TIMED CHARACTER MOTION: " + body.motion.trim()
        : "",
      "CAMERA: static locked-off shot, no zoom, no pan, no camera movement.",
      "Do not redesign recurring characters. Do not add random clothing, facial features, hair changes, logos, or accessories that contradict the Character Bible.",
      "STYLE LOCK: " + GEMI_VISUAL_PROFILE,
      "ACTING DIRECTION: show the named characters interacting, reacting, looking at each other, holding relevant props, and expressing the emotional beat implied by the scene. Make emotions visually obvious and charming rather than stiff or neutral. Capture a mid-action instant with body movement, gesture, and reaction all readable at once.",
      "CHARACTER SCALE: avoid distant wide shots that make the cast tiny. Prefer medium, medium-wide, two-shot, over-the-shoulder, and close-up framing when dialogue or emotion is important. Keep at least one face and the key action large enough to read on a phone screen.",
      "CAMERA DIRECTION: use a static locked-off composition only. No zoom, no pan, no tracking, no camera movement. Keep faces, eye-lines, blocking, scale, and spatial relationships readable inside the 9:16 frame.",
      "CONTINUITY: preserve recurring character identity, costume, proportions, props, location, time of day, and emotional state from the supplied character bible and scene prompt.",
      "STRICTLY AVOID: dark, scary, horror, moody lighting, dramatic shadows, photorealistic photography, realistic human proportions, crowded scene, multiple rooms, crying, violence, adult themes, text, letters, subtitles, watermark, distorted hands, extra fingers, blurry, inconsistent character, static pose, standing still, frozen, stiff, camera zoom, camera pan, camera movement, tracking shot, dolly shot, slideshow, split screen, collage.",
    ].filter(Boolean).join("\n\n");

    const imageProvider = process.env.AI_OFFICE_IMAGE_PROVIDER?.trim().toLowerCase() || "auto";
    const omniImageModel = process.env.OMNIROUTE_IMAGE_MODEL?.trim();
    const negativePrompt = process.env.GEMI_IMAGE_NEGATIVE_PROMPT?.trim() || GEMI_NEGATIVE_PROFILE;

    let result: { imageBase64: string; mimeType: string; model: string } | null = null;
    let provider: "ChatGPT plan" | "OmniRoute" | "Cloudflare Workers AI" = "Cloudflare Workers AI";
    const errors: string[] = [];

    if (imageProvider === "chatgpt" || imageProvider === "auto") {
      try {
        const chatgptResult = await generateWithChatGPTImage(fullPrompt);
        result = {
          imageBase64: chatgptResult.imageBase64,
          mimeType: chatgptResult.mimeType,
          model: chatgptResult.model,
        };
        provider = "ChatGPT plan";
      } catch (chatgptError) {
        const message = chatgptError instanceof Error ? chatgptError.message : String(chatgptError);
        errors.push("ChatGPT: " + message);
        console.warn("[AI Office] ChatGPT image generation failed:", message);
      }
    }

    if (!result && (imageProvider === "omniroute" || imageProvider === "auto")) {
      if (!omniImageModel) {
        errors.push("OmniRoute: OMNIROUTE_IMAGE_MODEL is not configured.");
      } else {
        try {
          result = await generateWithOmniRouteImage({
            prompt: fullPrompt,
            width: 576,
            height: 1024,
            model: omniImageModel,
          });
          provider = "OmniRoute";
        } catch (omniError) {
          const message = omniError instanceof Error ? omniError.message : String(omniError);
          errors.push("OmniRoute: " + message);
          console.warn("[AI Office] OmniRoute image generation failed:", message);
        }
      }
    }

    if (!result) {
      try {
        result = await generateWithCloudflareImage({
          prompt: fullPrompt,
          width: 576,
          height: 1024,
          numSteps: 4,
          imageBase64: referenceImageBase64 || undefined,
          negativePrompt,
        });
        provider = "Cloudflare Workers AI";
      } catch (cloudflareError) {
        const message = cloudflareError instanceof Error ? cloudflareError.message : String(cloudflareError);
        errors.push("Cloudflare: " + message);
      }
    }

    if (!result) {
      throw new Error("All image providers failed for " + sceneId + ". " + errors.join(" | "));
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
