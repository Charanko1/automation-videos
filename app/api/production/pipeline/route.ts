import { NextResponse } from "next/server";
import { generateWithChatGPT } from "../../../../lib/chatgpt";
import { generateWithOmniRoute } from "../../../../lib/omniroute";
import { parseDirectorPlan } from "../../../../lib/drama-scene-plan";

type Stage = "research" | "script" | "director";

type TextBrainResult = {
  text: string;
  model: string;
  displayName: string;
  provider: "ChatGPT plan" | "OmniRoute";
};

async function generateWithPreferredBrain(prompt: string): Promise<TextBrainResult> {
  const preferred = (process.env.AI_OFFICE_TEXT_PROVIDER?.trim().toLowerCase() || "chatgpt");

  if (preferred !== "omniroute") {
    try {
      const result = await generateWithChatGPT(prompt);
      return { ...result, provider: "ChatGPT plan" };
    } catch (chatgptError) {
      console.warn(
        "[AI Office] ChatGPT plan brain unavailable; falling back to OmniRoute:",
        chatgptError,
      );
    }
  }

  const result = await generateWithOmniRoute(prompt);
  return { ...result, provider: "OmniRoute" };
}



export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { ok: false, error: "AI Office pipeline is currently local-development only." },
      { status: 400 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const stage = body?.stage as Stage;
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 200) : "";
    const format = typeof body?.format === "string" ? body.format.trim().slice(0, 80) : "Drama";
    const research = typeof body?.research === "string" ? body.research.trim() : "";
    const script = typeof body?.script === "string" ? body.script.trim() : "";
    const requestedSceneCount = Math.min(8, Math.max(5, Math.round(Number(body?.sceneCount) || 6)));

    if (!["research", "script", "director"].includes(stage)) {
      return NextResponse.json({ ok: false, error: "stage must be research, script, or director." }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ ok: false, error: "Project title is required." }, { status: 400 });
    }
    if (stage === "script" && !research) {
      return NextResponse.json({ ok: false, error: "Story foundation is required before screenplay generation." }, { status: 400 });
    }
    if (stage === "director" && !script) {
      return NextResponse.json({ ok: false, error: "Screenplay is required before director planning." }, { status: 400 });
    }

    let prompt = "";

    if (stage === "research") {
      prompt = [
        "You are Rhea, a preschool YouTube Shorts story designer.",
        `Project title: ${title}`,
        `Theme: ${format}`,
        "",
        "Create a tiny, cheerful, positive story for children ages 2-7.",
        "Audience safety is absolute: no scary, dark, sad, violent, dangerous, adult, or heavy-conflict themes.",
        "Good themes include sharing, cleanliness, good habits, colors, numbers, letters, cute animals, helping, kindness, and simple learning.",
        "MAIN CHARACTER LOCK: Bimo, a 5-year-old Indonesian boy, round face, short black hair, big brown eyes, red t-shirt, blue shorts, yellow sneakers.",
        "Keep the cast small: Bimo plus at most 2 simple supporting characters.",
        "Build a very clear beginning, simple action, and happy ending.",
        "The story must be easy to visualize with one simple action per scene and one location per scene.",
        "PRODUCTION LANGUAGE: Bahasa Indonesia.",
        "",
        "Return a compact story brief with: premise, lesson, setting, cast, beginning, middle, ending, and a continuity note.",
      ].join("\n");
    }

    if (stage === "script") {
      prompt = [
        "You are Wri, a preschool YouTube Shorts storyboard writer.",
        `Project title: ${title}`,
        `Theme: ${format}`,
        "",
        "Turn the story brief into a ready-to-produce sequence for children ages 2-7.",
        "PRODUCTION LANGUAGE: Bahasa Indonesia for all narration and spoken lines.",
        `Use exactly ${requestedSceneCount} scenes.`,
        "Each scene lasts 4-6 seconds.",
        "Each scene contains ONE simple action and ONE location only.",
        "Keep the scene visually simple: Bimo plus at most 1-2 supporting characters.",
        "Use a clear flow: opening -> simple action/problem -> happy result.",
        "No dark, scary, sad, violent, dangerous, adult, or heavy-conflict material.",
        "Every narration/subtitle line must be natural Bahasa Indonesia and MAXIMUM 6 WORDS.",
        "Prefer one short spoken/narrated line per scene.",
        "Make Bimo the main character in the story.",
        "Do not write visual prompts in Indonesian; visual prompts will be created in English by Dira.",
        "RETURN ONLY THE STORYBOARD SCRIPT.",
        "",
        "STORY BRIEF:",
        research,
      ].join("\n");
    }

    if (stage === "director") {
      prompt = [
        "You are Dira, the Director and prompt supervisor for preschool YouTube Shorts.",
        `Project title: ${title}`,
        `Theme: ${format}`,
        "",
        "Convert the storyboard into a production-ready JSON scene plan for children ages 2-7.",
        "CONTENT SAFETY: bright, cheerful, warm, positive, playful, safe. No dark, scary, sad, violent, dangerous, adult, or heavy-conflict material.",
        "STRICT OUTPUT: return exactly ONE valid JSON object and nothing else. No markdown fences. No commentary.",
        "Top-level shape: { \"character_bible\": [...], \"scenes\": [...] }.",
        "character_bible MUST be an array. Bimo MUST be the first character and use EXACTLY this identity: Bimo, a 5-year-old Indonesian boy, round face, short black hair, big brown eyes, red t-shirt, blue shorts, yellow sneakers.",
        "Every additional character MUST have one fixed character_id and one reusable detailed description. Never redesign a character between scenes.",
        `Create exactly ${requestedSceneCount} scenes.`,
        "Each scene lasts 4-6 seconds and contains ONE simple visible action and ONE specific location only.",
        "ONE SCENE = ONE complete image. Never request a split screen, collage, montage, or multi-panel composition.",
        "All visual directions must be in ENGLISH. All narration/subtitle and spoken voice lines must be in Bahasa Indonesia.",
        "Each scene MUST contain these keys: scene_id, purpose, narration_excerpt, dialogue, characters_present, emotional_beat, visual_prompt_core, camera_and_composition, motion, lighting_and_color, environment, character_actions, on_screen_text, asset_type, reference_character_ids, aspect_ratio, image_priority.",
        "CAMERA RULE IS ABSOLUTE: camera_and_composition MUST be exactly \"static locked-off shot, no zoom, no pan, no camera movement\".",
        "ALL movement comes from characters only. Never describe zoom, pan, tracking, dolly, orbit, handheld, camera shake, or any other camera motion anywhere.",
        "Every scene MUST start with character action at 0 seconds. Never begin with a character standing still or posing.",
        "motion MUST use exactly this English timing format: \"0-2s: ... 2-4s: ... 4-6s: ...\" and describe progressive physical character action with active verbs.",
        "Use active verbs such as walks, runs, waves, hops, claps, nods, laughs, hands over, picks up, dances, jumps, points, cleans, shares, opens, closes.",
        "The action must involve hands, arms, legs, body, or head movement, not only facial expression.",
        "Keep movement simple and age-appropriate. Do not introduce a new action chain that changes the scene location.",
        "Setting MUST be specific and visually match the story location. Example: if the story says park, use an outdoor green park with grass, trees, sky, and a bench.",
        "narration_excerpt MUST contain no more than 6 words and must be the only spoken/subtitle line for that scene.",
        "dialogue MUST contain exactly one object: speaker \"Narrator\", character_id empty, line equal to narration_excerpt, emotion describing cheerful delivery.",
        "characters_present and reference_character_ids must list only the characters actually visible in the image.",
        "Keep the bottom 20% visually empty for subtitles.",
        "STYLE LOCK for EVERY scene: Bright, cheerful 3D animated cartoon for toddlers and kids, in the style of modern preschool YouTube animation, soft Pixar-like look. Chubby rounded characters with big expressive eyes and big smiles, simple shapes. Saturated pastel colors, soft even daylight, clean uncluttered background, high contrast so the subject pops on a phone screen. Static locked-off shot, no zoom, no pan, no camera movement. Vertical 9:16, subject centered, keep the bottom 20% of the frame empty. No text, no letters, no watermark in the image.",
        "CHARACTER LOCK for EVERY scene: Bimo, a 5-year-old Indonesian boy, round face, short black hair, big brown eyes, red t-shirt, blue shorts, yellow sneakers. Always the same face, outfit, hairstyle, colors, and body proportions.",
        "NEGATIVE PROMPT for EVERY scene: dark, scary, horror, moody lighting, dramatic shadows, photorealistic, realistic human, crowded scene, multiple rooms, crying, violence, adult themes, text, subtitles, watermark, distorted hands, extra fingers, blurry, inconsistent character, static pose, standing still, frozen, stiff, camera zoom, camera pan, camera movement, tracking shot, dolly shot, slideshow, split screen, collage.",
        "visual_prompt_core MUST describe a single full-frame preschool animation shot: specific setting, character placement, clear action, expressive pose, props, and bright lighting.",
        "character_actions MUST be a concise physical-action description that matches motion exactly.",
        "Do not add random characters, random costume changes, or unrelated props.",
        "Return no prose outside the JSON object.",
        "",
        "STORYBOARD SCRIPT:",
        script,
      ].join("\n");
    }
    let result: TextBrainResult;

    if (stage === "director" && (process.env.AI_OFFICE_TEXT_PROVIDER?.trim().toLowerCase() || "chatgpt") === "omniroute") {
      try {
        const omniResult = await generateWithOmniRoute(prompt, undefined, {
          responseFormat: { type: "json_object" },
          noCache: true,
        });
        result = { ...omniResult, provider: "OmniRoute" };
      } catch (structuredError) {
        console.warn(
          "[AI Office] Structured Director request was not accepted; falling back to normal JSON prompting:",
          structuredError,
        );
        const omniResult = await generateWithOmniRoute(prompt);
        result = { ...omniResult, provider: "OmniRoute" };
      }
    } else {
      result = await generateWithPreferredBrain(prompt);
    }

    let dramaPlan = stage === "director"
      ? parseDirectorPlan(result.text)
      : { characterBible: "", scenes: [] };

    if (stage === "director") {
      const initialPlanNeedsRepair =
        !dramaPlan.characterBible ||
        dramaPlan.scenes.length !== requestedSceneCount;

      if (initialPlanNeedsRepair) {
        const repairPrompt = [
          "You are Dira, the Director and prompt supervisor for a preschool YouTube Shorts studio.",
          "Normalize the Director output into one valid JSON object for children ages 2-7.",
          "Keep the existing story, characters, locations, actions, and lesson. Do not invent unrelated events.",
          "The final JSON MUST contain exactly these top-level keys: character_bible, scenes.",
          "character_bible MUST be an array. Bimo MUST be the first character and keep his exact fixed description.",
          `scenes MUST be an array of exactly ${requestedSceneCount} scene objects.`,
          "Each scene is ONE simple action in ONE location and lasts 4-6 seconds.",
          "Every visual field must be in ENGLISH. narration_excerpt and spoken dialogue must be in Bahasa Indonesia.",
          "Every narration_excerpt must contain 6 words or fewer.",
          "Every scene dialogue array must contain exactly one short Narrator line equal to narration_excerpt, with an empty character_id.",
          "Set aspect_ratio to 9:16. Keep the bottom 20% empty for subtitles.",
          "Apply the exact bright cheerful preschool style and Bimo character lock from the original Director instructions.",
          "Return ONLY valid JSON. No markdown. No commentary.",
          "",
          "ORIGINAL STORYBOARD:",
          script,
          "",
          "DIRECTOR OUTPUT TO NORMALIZE:",
          result.text.slice(0, 14000),
        ].join("\n");

        try {
          let repairedResult: TextBrainResult;
          if ((process.env.AI_OFFICE_TEXT_PROVIDER?.trim().toLowerCase() || "chatgpt") === "omniroute") {
            const omniRepair = await generateWithOmniRoute(repairPrompt, undefined, {
              responseFormat: { type: "json_object" },
              noCache: true,
            });
            repairedResult = { ...omniRepair, provider: "OmniRoute" };
          } else {
            repairedResult = await generateWithPreferredBrain(repairPrompt);
          }

          const repairedPlan = parseDirectorPlan(repairedResult.text);
          if (repairedPlan.characterBible && repairedPlan.scenes.length === requestedSceneCount) {
            result = repairedResult;
            dramaPlan = repairedPlan;
          }
        } catch (repairError) {
          console.warn("[AI Office] Director normalization pass failed:", repairError);
        }
      }

      if (!dramaPlan.characterBible) {
        console.error("[AI Office] Director raw output missing character_bible:", result.text);
        return NextResponse.json(
          {
            ok: false,
            error: "Director returned no character_bible. The raw Director output was not in the expected JSON shape.",
            directorRawPreview: result.text.slice(0, 2500),
          },
          { status: 502 },
        );
      }

      if (dramaPlan.scenes.length !== requestedSceneCount) {
        return NextResponse.json(
          {
            ok: false,
            error: `Director returned ${dramaPlan.scenes.length} scenes, but exactly ${requestedSceneCount} were requested after normalization.`,
            directorRawPreview: result.text.slice(0, 5000),
            hint: "The Director normalization pass could not produce six parseable scenes. Inspect directorRawPreview before retrying to avoid wasting provider calls.",
          },
          { status: 502 },
        );
      }

      const dialogueLineCount = dramaPlan.scenes.reduce((count, scene) => count + (scene.dialogue?.length ?? 0), 0);
      const silentScenes = dramaPlan.scenes.filter((scene) => (scene.dialogue?.length ?? 0) === 0);
      const silentSceneIds = silentScenes.map((scene) => scene.sceneId);
      if (dialogueLineCount === 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "Director returned no parseable dialogue lines. Regenerate the director stage with character dialogue.",
            silentSceneIds,
          },
          { status: 502 },
        );
      }
    }

    return NextResponse.json({
      ok: true,
      stage,
      provider: result.provider,
      model: result.model,
      displayName: result.displayName,
      text: result.text,
      ...(stage === "director"
        ? {
            characterBible: dramaPlan.characterBible,
            scenes: dramaPlan.scenes,
            sceneCount: dramaPlan.scenes.length,
            dialogueLineCount: dramaPlan.scenes.reduce((count, scene) => count + (scene.dialogue?.length ?? 0), 0),
          }
        : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AI drama pipeline failed." },
      { status: 502 },
    );
  }
}
