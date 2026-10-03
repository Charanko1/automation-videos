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
        "You are Dira, the Director and prompt supervisor for a preschool YouTube Shorts studio.",
        `Project title: ${title}`,
        `Theme: ${format}`,
        "",
        "Convert the storyboard into a production-ready JSON plan for children ages 2-7.",
        "CONTENT SAFETY: bright, cheerful, warm, positive, playful, safe. No dark, scary, sad, violent, dangerous, adult, or heavy-conflict material.",
        "STRICT OUTPUT: return exactly ONE valid JSON object and nothing else. No markdown fences. No commentary.",
        "Top-level shape: { \"character_bible\": [...], \"scenes\": [...] }.",
        "character_bible MUST be an array. Bimo MUST be the first character and use EXACTLY this core identity: Bimo, a 5-year-old Indonesian boy, round face, short black hair, big brown eyes, red t-shirt, blue shorts, yellow sneakers.",
        "For every additional character, define a fixed character_id and a complete reusable visual description. Never redesign them between scenes.",
        `Create exactly ${requestedSceneCount} scenes.`,
        "Each scene MUST represent ONE simple visible action in ONE location and last 4-6 seconds.",
        "Each scene MUST contain: scene_id, purpose, narration_excerpt, dialogue, characters_present, emotional_beat, visual_prompt_core, camera_and_composition, lighting_and_color, environment, character_actions, on_screen_text, asset_type, reference_character_ids, aspect_ratio, image_priority.",
        "Set aspect_ratio to \"9:16\" in every scene.",
        "visual_prompt_core MUST be written entirely in ENGLISH.",
        "camera_and_composition, lighting_and_color, environment, and character_actions MUST be written in ENGLISH.",
        "Do not put Indonesian narration/subtitle inside visual_prompt_core.",
        "narration_excerpt MUST be in Bahasa Indonesia and MAXIMUM 6 WORDS.",
        "dialogue MUST contain exactly one short spoken line per scene using the narration_excerpt as the spoken line, with speaker \"Narrator\" and character_id empty. This line is the subtitle/voice-over for Vox.",
        "No scene may contain more than one narration line.",
        "Every scene must keep the bottom 20% visually empty for subtitles.",
        "STYLE LOCK for EVERY visual prompt: Bright, cheerful 3D animated cartoon for toddlers and kids, modern preschool YouTube animation, soft high-end family-friendly 3D animated-film look, chubby rounded characters, big expressive eyes, big smiles, simple shapes, saturated pastel colors, soft even daylight, clean uncluttered background, high contrast, gentle camera movement, slow pacing, bouncy playful character motion, vertical 9:16, subject centered, bottom 20% empty, no text, no letters, no watermark.",
        "CHARACTER LOCK for EVERY scene: Bimo, a 5-year-old Indonesian boy, round face, short black hair, big brown eyes, red t-shirt, blue shorts, yellow sneakers. Always the same face, outfit, colors, and proportions.",
        "NEGATIVE PROMPT for EVERY scene: dark, scary, horror, moody lighting, dramatic shadows, photorealistic, realistic human, crowded scene, multiple rooms, crying, violence, adult themes, text, subtitles, watermark, distorted hands, extra fingers, blurry, inconsistent character.",
        "",
        "STORYBOARD SCRIPT:",
        script,
      ].join("\n");
    }

    if (stage === "director") {
      prompt = [
        "You are Dira, the Director of a character-driven 3D animated drama studio.",
        `Project title: ${title}`,
        `Genre: ${format}`,
        "",
        "Convert the screenplay into an exact scene-by-scene production plan.",
        "This is DRAMA for YouTube Shorts. The characters are actors inside one continuous world. Do not summarize a topic.",
        "",
        "STRICT OUTPUT: return exactly ONE valid JSON object and nothing else. No markdown fences. No commentary.",
        "Return this exact top-level shape and order: { \"character_bible\": [...], \"scenes\": [...] }. Put character_bible FIRST and scenes SECOND.",
        "character_bible MUST be a JSON array of 3-6 character objects, never a prose paragraph. It must define every recurring character with character_id, name, apparent_age, gender_presentation, species_or_human, face, skin_or_surface, eyes, hair_or_head_features, body_build, signature_clothing, footwear, accessories, personality, voice_personality, color_palette, art_style, hard_constraints.",
        "Do not repeat the full character bible inside scenes. Keep character fields concise but concrete so the complete JSON fits in one response.",
        "character_bible must stay as the top-level JSON array described above; do not rename it or move it inside scenes.",
        `Create exactly ${requestedSceneCount} scenes. Do not create more or fewer.`,
        "Each scene keys: scene_id, purpose, narration_excerpt, dialogue, characters_present, emotional_beat, visual_prompt_core, camera_and_composition, lighting_and_color, environment, character_actions, on_screen_text, asset_type, reference_character_ids, aspect_ratio, image_priority.",
        "Set aspect_ratio to \"9:16\" for every scene. This production is vertical-first for YouTube Shorts.",
        "dialogue is an array of objects: speaker, character_id, line, emotion. Prefer 1-3 short dialogue lines per scene for this production pass.",
        "Every dialogue line must be in Bahasa Indonesia (id-ID) because Vox will synthesize it with an Indonesian Windows voice.",
        "A brief silent visual beat is allowed for at most one scene when it improves pacing, but the overall six-scene Short must contain dialogue.",
        "characters_present is an array of character_id values visible in the shot.",
        "reference_character_ids must contain every recurring character visible in the shot.",
        "narration_excerpt should be empty when dialogue and acting already carry the scene. Do not invent narration just to fill the field.",
        "on_screen_text should be empty unless the story naturally requires readable diegetic text such as a sign, letter, or phone screen.",
        "visual_prompt_core must describe one film frame of the characters ACTING: their pose, eye-lines, expressions, relationships, props, environment, and immediate action.",
        "For every scene, choose a distinct physical action or reaction and write it explicitly in character_actions. Avoid static posing; the frame must look like a frozen animation keyframe captured mid-action.",
        "Use varied movement across the six scenes: at least one reach/gesture, one turn/reaction, one interaction with a prop, and one stronger body movement such as running, grabbing, opening, pulling, or recoiling when story-appropriate.",
        "camera_and_composition must specify a shot type such as establishing, wide, medium, two-shot, over-the-shoulder, close-up, reaction shot, and include framing and camera movement when useful.",
        "lighting_and_color must support the emotional beat and maintain continuity.",
        "Track continuity across scenes: character appearance, clothing, props, location, time of day, and emotional state.",
        "For voice_personality, describe the character's delivery in Bahasa Indonesia: pace, tone, warmth, tension, and emotional expression.",
        "GLOBAL STYLE LOCK: bright cheerful preschool 3D animation for ages 2-7, rounded chubby characters, big expressive eyes, saturated pastel colors, soft even daylight, uncluttered backgrounds, gentle playful motion, vertical 9:16.",
        "NEVER: dark, scary, horror, moody lighting, dramatic shadows, photorealistic photography, realistic human proportions, crowded scenes, multiple rooms, crying, violence, adult themes, text, letters, subtitles, watermark, random extra characters, random costume changes.",
        "Prioritize readable acting shots: two-shots, over-the-shoulder dialogue, close-ups, reaction shots, and motivated establishing shots.",
        "Do not claim that any image, audio, or video asset has already been generated.",
        "If output length is constrained, prioritize a complete character_bible and exactly " + requestedSceneCount + " complete scenes over commentary. Do not sacrifice the character bible for verbose scene descriptions.",
        "Keep all dialogue lines to 12 words or fewer and natural for speech. Target 45-60 seconds total spoken dialogue across the six scenes.",
        "Language consistency is mandatory: screenplay, Director dialogue, subtitles, and TTS input must all use Bahasa Indonesia (id-ID).",
        "",
        "SCREENPLAY:",
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
          "You are Dira, the Director of a cute 3D animated YouTube Shorts studio.",
          "Repair and normalize the Director output below into one valid JSON object.",
          "PRODUCTION LANGUAGE: Bahasa Indonesia (id-ID).",
          "Do not invent a new story. Preserve the screenplay's characters, events, locations, actions, and emotional beats.",
          "The final JSON MUST contain exactly these top-level keys in this order: character_bible, scenes.",
          "character_bible MUST be a JSON array of 3-6 recurring character objects.",
          "scenes MUST be an array of exactly 6 scene objects.",
          "Every scene object MUST contain scene_id, purpose, dialogue, characters_present, emotional_beat, visual_prompt_core, camera_and_composition, lighting_and_color, environment, character_actions, on_screen_text, asset_type, reference_character_ids, aspect_ratio, image_priority.",
          "Every scene MUST have at least one dialogue object unless a single brief silent reaction beat is clearly needed; the whole Short must contain dialogue.",
          "Every dialogue object MUST contain speaker, character_id, line, emotion. Write dialogue in natural Bahasa Indonesia.",
          "Set aspect_ratio to 9:16 for every scene.",
          "Keep dialogue short: maximum 12 words per line.",
          "Return ONLY valid JSON. No markdown fences. No commentary.",
          "",
          "ORIGINAL SCREENPLAY:",
          script,
          "",
          "DIRECTOR OUTPUT TO REPAIR:",
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
