import { NextResponse } from "next/server";
import { generateWithOmniRoute } from "../../../../lib/omniroute";
import { parseDirectorPlan } from "../../../../lib/drama-scene-plan";

type Stage = "research" | "script" | "director";

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
    const requestedSceneCount = 6;

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
        "You are Rhea, the Story Researcher in a small animated drama studio.",
        `Project title: ${title}`,
        `Genre: ${format}`,
        "",
        "Develop the story foundation for a fictional, character-driven drama.",
        "PRODUCTION LANGUAGE: Bahasa Indonesia (id-ID). Write all story content in natural Bahasa Indonesia.",
        "Do not turn the concept into a documentary, explainer, lecture, or narrated list of facts.",
        "",
        "Return a compact story bible containing:",
        "1. Premise.",
        "2. Setting and world rules.",
        "3. Main cast: 3-6 recurring characters. For every character include character_id, name, role, personality, goal, fear, secret, relationship_to_protagonist.",
        "4. Central conflict and stakes.",
        "5. Beginning, midpoint escalation, climax, ending.",
        "6. Protagonist emotional arc.",
        "7. A short continuity note for clothing, props, locations, and recurring relationships.",
        "Make the story visual and easy to stage as an animated short drama.",
      ].join("\n");
    }

    if (stage === "script") {
      prompt = [
        "You are Wri, the Screenwriter for a character-driven animated drama studio.",
        `Project title: ${title}`,
        `Genre: ${format}`,
        "",
        "Turn the story foundation into a cinematic screenplay.",
        "The audience should discover the story through characters, acting, conflict, actions, and dialogue.",
        "PRODUCTION LANGUAGE: Bahasa Indonesia (id-ID). Write every spoken dialogue line in natural Bahasa Indonesia. Do not write dialogue in English unless a specific English phrase is intentionally part of the story.",
        "",
        "Requirements:",
        `- Write exactly ${requestedSceneCount} scenes for a YouTube Short.`,
        "- Target a final spoken duration of roughly 45-60 seconds.",
        "- Each scene should contain 1-3 dialogue lines.",
        "- Keep each dialogue line to 12 words or fewer.",
        "- Use compact scenes with a strong hook, escalating conflict, reveal/twist, and clean ending.",
        "- Do not pad scenes with exposition; let actions, reactions, and short dialogue carry the story.",
        "- Each scene has a clear location, time of day, purpose, emotional beat, visible action, and consequence that leads into the next scene.",
        "- Use 2-4 recurring characters across the story. Characters must have stable names and personalities.",
        "- Dialogue should carry the scene. Avoid narrator exposition.",
        "- Stage directions must be short and only describe visible action, expressions, blocking, props, or camera-relevant behavior.",
        "- Include reversals, tension, reactions, and a satisfying dramatic ending.",
        "- Do not use documentary language, educational narration, fact lists, citations, or a YouTube call-to-action.",
        "- Do not use Markdown bullets in the screenplay.",
        "- Use scene headings in plain text only, such as INT. APARTMENT - NIGHT.",
        "- Character dialogue should use the format CHARACTER NAME: spoken line.",
        "- RETURN ONLY THE SCREENPLAY.",
        "",
        "STORY FOUNDATION:",
        research,
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
        "camera_and_composition must specify a shot type such as establishing, wide, medium, two-shot, over-the-shoulder, close-up, reaction shot, and include framing and camera movement when useful.",
        "lighting_and_color must support the emotional beat and maintain continuity.",
        "Track continuity across scenes: character appearance, clothing, props, location, time of day, and emotional state.",
        "For voice_personality, describe the character's delivery in Bahasa Indonesia: pace, tone, warmth, tension, and emotional expression.",
        "GLOBAL STYLE LOCK: cute polished 3D animated film, appealing chibi/toy-like cinematic proportions, soft rounded geometry, expressive eyes and faces, polished 3D materials, subtle depth of field, warm film lighting, soft volumetric light, family-friendly dramatic storytelling.",
        "NEVER: comic panels, 2D illustration, anime, manga, graphic novel, flat vector art, thick ink outlines, photorealistic photography, infographic layout, poster art, text-heavy compositions, random extra characters, random costume changes.",
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

    let result: Awaited<ReturnType<typeof generateWithOmniRoute>>;

    if (stage === "director") {
      try {
        result = await generateWithOmniRoute(prompt, undefined, {
          responseFormat: { type: "json_object" },
          noCache: true,
        });
      } catch (structuredError) {
        console.warn(
          "[AI Office] Structured Director request was not accepted; falling back to normal JSON prompting:",
          structuredError,
        );
        result = await generateWithOmniRoute(prompt);
      }
    } else {
      result = await generateWithOmniRoute(prompt);
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
          const repairedResult = await generateWithOmniRoute(repairPrompt, undefined, {
            responseFormat: { type: "json_object" },
            noCache: true,
          });
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
      provider: "OmniRoute",
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
