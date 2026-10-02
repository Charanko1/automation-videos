import { NextResponse } from "next/server";
import { generateWithOmniRoute } from "../../../../lib/omniroute";

type Stage = "research" | "script" | "director";

type DirectorScene = {
  sceneId: string;
  purpose?: string;
  narrationExcerpt?: string;
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
        "You are Rhea, the Researcher in an AI YouTube production office.",
        `Project title: ${title}`,
        `Format: ${format}`,
        "",
        "Create a factual research brief for this YouTube project.",
        "Return:",
        "1. Concise topic thesis.",
        "2. Five key facts or claims to cover.",
        "3. Important context and definitions.",
        "4. Three claims that must be fact-checked before publishing.",
        "5. Suggested audience angle.",
        "Keep it structured and practical. Do not invent citations or claim to browse the web.",
      ].join("\n");
    }

    if (stage === "script") {
      prompt = [
        "You are Wri, the Scriptwriter in an AI YouTube production office.",
        `Project title: ${title}`,
        `Format: ${format}`,
        "",
        "Use the research brief below to write a YouTube script.",
        "Requirements:",
        "- Strong 15-30 second hook.",
        "- Clear spoken narration with short paragraphs.",
        "- Natural transitions.",
        "- No fabricated sources, quotes, statistics, or events.",
        "- Mark statements needing external fact-checking as [VERIFY] inside the prose, but do not add production labels.",
        "- End with a concise takeaway and call to action.",
        "- RETURN ONLY THE SPOKEN NARRATION IN PLAIN TEXT.",
        "- Do NOT use Markdown headings, #, bullets, section labels, HOOK:, INTRO:, TRANSISI:, TRANSITION:, TAKEAWAY:, SCENE:, VISUAL:, stage directions, sound cues, or editorial notes.",
        "",
        "RESEARCH BRIEF:",
        research,
      ].join("\n");
    }

    if (stage === "director") {
      prompt = [
        "You are Dira, the Director in an AI YouTube production office.",
        `Project title: ${title}`,
        `Format: ${format}`,
        "",
        "Turn the script into a production-ready visual plan for Gemi, the Image Artist.",
        "STRICT OUTPUT: return exactly ONE valid JSON object and nothing else. No markdown fences. No commentary.",
        "Top-level keys: character_bible and scenes.",
        "character_bible: concise but complete immutable character specification using character_id, name, apparent_age, gender_presentation, ethnicity_or_species, face, skin_or_surface, eyes, hair_or_head_features, body_build, signature_clothing, footwear, accessories, color_palette, art_style, hard_constraints.",
        "Create 8-12 scenes.",
        "Each scene keys: scene_id, purpose, narration_excerpt, visual_prompt_core, camera_and_composition, lighting_and_color, environment, character_actions, on_screen_text, asset_type, reference_character_ids, aspect_ratio, image_priority.",
        "aspect_ratio must be exactly 16:9.",
        "visual_prompt_core is the cinematic prompt for the image model. Do not repeat the Character Bible inside it; the server appends the immutable Character Bible.",
        "GLOBAL VISUAL STYLE LOCK for every scene: cute stylized 3D animated film look, chibi/toy-like characters, soft rounded shapes, expressive friendly faces, polished 3D materials, cinematic depth of field, warm studio lighting, soft volumetric light, playful family-friendly adventure mood, cohesive color palette, consistent character proportions. Never use comic-book panels, 2D illustration, anime, manga, graphic novel, flat vector art, thick ink outlines, photorealism, horror, gritty realism, or text-heavy artwork.",
        "Every visual_prompt_core must describe an actual 3D animated scene with clear character action, pose, environment, camera angle, and lighting. Prefer medium/wide cinematic shots that make the subject feel alive and readable.",
        "Never use phrases such as same character as before or as previously described.",
        "Do not claim any image, audio, or video asset was already generated.",
        "Keep the response compact enough to avoid truncation and make it valid for JSON.parse.",
        "",
        "SCRIPT:",
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
