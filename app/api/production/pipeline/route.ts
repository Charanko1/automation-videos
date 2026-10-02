import { NextResponse } from "next/server";
import { generateWithOmniRoute } from "../../../../lib/omniroute";

type Stage = "research" | "script" | "director";

type DirectorScene = {
  sceneId: string;
  purpose?: string;
  narrationExcerpt?: string;
  dialogue?: Array<{ speaker: string; characterId?: string; line: string; emotion?: string }>;
  charactersPresent?: string[];
  emotionalBeat?: string;
  visualPrompt: string;
  cameraAndComposition?: string;
  lightingAndColor?: string;
  environment?: string;
  characterActions?: string;
  onScreenText?: string;
  assetType?: string;
  referenceCharacterIds?: string[];
  aspectRatio?: string;
  imagePriority?: string;
};

function stripThinkingText(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function extractMarkedJson(text: string, startMarker: string, endMarker: string) {
  const start = text.indexOf(startMarker);
  if (start < 0) return null;
  const contentStart = start + startMarker.length;
  const end = text.indexOf(endMarker, contentStart);
  if (end < 0) return null;
  let raw = text.slice(contentStart, end).trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text: string) {
  const source = stripThinkingText(text).replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = source.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(source.slice(start, index + 1)) as unknown; }
        catch { return null; }
      }
    }
  }
  return null;
}

function extractDirectorPayload(text: string) {
  const parsed = extractMarkedJson(text, "DIRECTOR_JSON_START", "DIRECTOR_JSON_END")
    ?? extractMarkedJson(text, "SCENES_JSON_START", "SCENES_JSON_END")
    ?? extractFirstJsonObject(text);
  if (!parsed || typeof parsed !== "object" || parsed === null) return { characterBible: "", rawScenes: [] as unknown[] };
  const item = parsed as Record<string, unknown>;
  const rawScenes = Array.isArray(item.scenes) ? item.scenes : Array.isArray(item.scene) ? item.scene : [];
  const characterBible = typeof item.character_bible === "string" ? item.character_bible.trim() : "";
  return { characterBible, rawScenes };
}

function parseDirectorScenes(text: string, characterBible = ""): DirectorScene[] {
  const { rawScenes } = extractDirectorPayload(text);
  return rawScenes.map((scene) => {
    if (!scene || typeof scene !== "object") return null;
    const item = scene as Record<string, unknown>;
    const sceneId = typeof item.scene_id === "string" ? item.scene_id.trim() : "";
    const prompt = typeof item.visual_prompt_core === "string" ? item.visual_prompt_core.trim() : typeof item.visual_prompt === "string" ? item.visual_prompt.trim() : "";
    if (!sceneId || !prompt) return null;
    const visualPrompt = characterBible ? [prompt, "", "IMMUTABLE CHARACTER BIBLE:", characterBible].join("\n") : prompt;
    return {
      sceneId,
      purpose: typeof item.purpose === "string" ? item.purpose : undefined,
      narrationExcerpt: typeof item.narration_excerpt === "string" ? item.narration_excerpt : undefined,
      dialogue: Array.isArray(item.dialogue)
        ? item.dialogue
            .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
            .map((value) => ({
              speaker: typeof value.speaker === "string" ? value.speaker : "",
              characterId: typeof value.character_id === "string" ? value.character_id : undefined,
              line: typeof value.line === "string" ? value.line : "",
              emotion: typeof value.emotion === "string" ? value.emotion : undefined,
            }))
            .filter((value) => Boolean(value.speaker && value.line))
        : undefined,
      charactersPresent: Array.isArray(item.characters_present)
        ? item.characters_present.filter((value): value is string => typeof value === "string")
        : undefined,
      emotionalBeat: typeof item.emotional_beat === "string" ? item.emotional_beat : undefined,
      visualPrompt,
      cameraAndComposition: typeof item.camera_and_composition === "string" ? item.camera_and_composition : undefined,
      lightingAndColor: typeof item.lighting_and_color === "string" ? item.lighting_and_color : undefined,
      environment: typeof item.environment === "string" ? item.environment : undefined,
      characterActions: typeof item.character_actions === "string" ? item.character_actions : undefined,
      onScreenText: typeof item.on_screen_text === "string" ? item.on_screen_text : undefined,
      assetType: typeof item.asset_type === "string" ? item.asset_type : undefined,
      referenceCharacterIds: Array.isArray(item.reference_character_ids) ? item.reference_character_ids.filter((value): value is string => typeof value === "string") : undefined,
      aspectRatio: "16:9",
      imagePriority: typeof item.image_priority === "string" ? item.image_priority : undefined,
    } satisfies DirectorScene;
  }).filter((scene): scene is DirectorScene => Boolean(scene));
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
    const format = typeof body?.format === "string" ? body.format.trim().slice(0, 80) : "General";
    const research = typeof body?.research === "string" ? body.research.trim() : "";
    const script = typeof body?.script === "string" ? body.script.trim() : "";

    if (!["research", "script", "director"].includes(stage)) {
      return NextResponse.json({ ok: false, error: "stage must be research, script, or director." }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ ok: false, error: "Project title is required." }, { status: 400 });
    }
    if (stage === "script" && !research) {
      return NextResponse.json({ ok: false, error: "Research brief is required before script generation." }, { status: 400 });
    }
    if (stage === "director" && !script) {
      return NextResponse.json({ ok: false, error: "Script is required before director planning." }, { status: 400 });
    }

    let prompt = "";

    if (stage === "research") {
      prompt = [
        "You are Rhea, the Story Researcher in an AI drama production office.",
        `Project title: ${title}`,
        `Genre: ${format}`,
        "",
        "Develop the story foundation for a character-driven drama. This is fictional storytelling, not a documentary or explainer.",
        "Return:",
        "1. One-sentence premise.",
        "2. Setting and world rules.",
        "3. Main cast: 3-6 recurring characters with character_id, role, personality, goal, fear, secret, and relationship to the protagonist.",
        "4. Central conflict and stakes.",
        "5. Beginning, midpoint escalation, climax, and ending.",
        "6. Emotional arc for the protagonist.",
        "Keep the story coherent, visual, and suitable for short-form cinematic scenes. Do not write factual claims unless the story explicitly requires them.",
      ].join("\n");
    }

    if (stage === "script") {
      prompt = [
        "You are Wri, the Screenwriter in an AI drama production office.",
        `Project title: ${title}`,
        `Genre: ${format}`,
        "",
        "Use the story foundation below to write a cinematic screenplay, not a documentary narration.",
        "The audience should experience the story through characters, actions, conflict, and dialogue.",
        "Requirements:",
        "- Create 8-12 compact scenes with clear locations and time-of-day.",
        "- Every scene must have characters doing something visible.",
        "- Use natural dialogue between named recurring characters; avoid narrator exposition unless absolutely necessary.",
        "- Give each important character a distinct voice and personality.",
        "- Include emotional escalation, reversals, and cause-and-effect between scenes.",
        "- Use brief stage directions only when needed for visible action or performance.",
        "- No Markdown bullets or editorial commentary.",
        "- Do not write headings such as HOOK, INTRO, TAKEAWAY, VISUAL, VOICE-OVER, or B-ROLL.",
        "- End with a satisfying dramatic beat rather than a YouTube-style factual takeaway.",
        "- RETURN ONLY THE SCREENPLAY.",
        "",
        "STORY FOUNDATION:",
        research,
      ].join("\n");
    }

    if (stage === "director") {
      prompt = [
        "You are Dira, the Director of a character-driven animated drama studio.",
        `Project title: ${title}`,
        `Genre: ${format}`,
        "",
        "Turn the screenplay into a production-ready shot plan for Gemi, the Image Artist.",
        "This is DRAMA, not a documentary. Characters are actors inside a continuous story world.",
        "STRICT OUTPUT: return exactly ONE valid JSON object and nothing else. No markdown fences. No commentary.",
        "Top-level keys: character_bible and scenes.",
        "character_bible: define every recurring character with character_id, name, apparent_age, gender_presentation, species_or_human, face, skin_or_surface, eyes, hair_or_head_features, body_build, signature_clothing, footwear, accessories, personality, voice_personality, color_palette, art_style, hard_constraints.",
        "Create exactly 8-12 scenes.",
        "Each scene keys: scene_id, purpose, narration_excerpt, dialogue, characters_present, emotional_beat, visual_prompt_core, camera_and_composition, lighting_and_color, environment, character_actions, on_screen_text, asset_type, reference_character_ids, aspect_ratio, image_priority.",
        "dialogue is an array of {speaker, character_id, line, emotion}; preserve the screenplay dialogue exactly when possible.",
        "characters_present is an array of character_id values present in the shot.",
        "emotional_beat describes the scene emotion and how it changes.",
        "reference_character_ids must contain every recurring character visible in the image.",
        "aspect_ratio must be exactly 16:9.",
        "visual_prompt_core must describe a single cinematic 3D animated film frame that shows the acting and blocking of the characters. Never turn the scene into an illustration of a narrated topic.",
        "GLOBAL VISUAL STYLE LOCK: cute polished 3D animated film, chibi/toy-like but cinematic proportions, soft rounded geometry, expressive faces, high-quality 3D materials, subtle depth of field, warm studio lighting, soft volumetric light, family-friendly dramatic storytelling, consistent character design.",
        "NO STYLE DRIFT: never use comic-book panels, 2D illustration, anime, manga, graphic novel, flat vector art, thick ink outlines, photorealistic photography, gritty realism, random costume changes, random extra characters, text-heavy artwork, or infographic composition.",
        "Prioritize two-shots, over-the-shoulder shots, close-ups, reaction shots, and simple establishing shots. Make the characters' expressions, eye-lines, poses, and relationships obvious.",
        "Track continuity: location, time of day, clothing, props, injuries, and emotional state must carry logically from scene to scene.",
        "Do not claim any image, audio, or video asset was already generated.",
        "Keep the response compact enough to remain valid JSON.",
        "",
        "SCREENPLAY:",
        script,
      ].join("\n");
    }

    const result = await generateWithOmniRoute(prompt);

    const directorPayload = stage === "director"
      ? extractDirectorPayload(result.text)
      : { characterBible: "", rawScenes: [] as unknown[] };
    const characterBible = directorPayload.characterBible;
    const scenes = stage === "director" ? parseDirectorScenes(result.text, characterBible) : [];

    if (stage === "director" && scenes.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Director returned an invalid structured plan. Expected valid JSON with character_bible and 8-12 scenes.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      stage,
      provider: "OmniRoute",
      model: result.model,
      displayName: result.displayName,
      text: result.text,
      ...(stage === "director" ? { characterBible, scenes } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AI pipeline failed." },
      { status: 502 },
    );
  }
}
