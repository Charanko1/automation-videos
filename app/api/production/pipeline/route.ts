import { NextResponse } from "next/server";
import { generateWithChatGPT } from "../../../../lib/chatgpt";

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

function parseDirectorScenes(text: string): DirectorScene[] {
  const parsed = extractMarkedJson(text, "SCENES_JSON_START", "SCENES_JSON_END");
  const rawScenes =
    parsed &&
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { scenes?: unknown }).scenes)
      ? (parsed as { scenes: unknown[] }).scenes
      : [];

  return rawScenes
    .map((scene) => {
      if (!scene || typeof scene !== "object") return null;
      const item = scene as Record<string, unknown>;
      const sceneId = typeof item.scene_id === "string" ? item.scene_id.trim() : "";
      const visualPrompt = typeof item.visual_prompt === "string" ? item.visual_prompt.trim() : "";
      if (!sceneId || !visualPrompt) return null;
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
        referenceCharacterIds: Array.isArray(item.reference_character_ids)
          ? item.reference_character_ids.filter((value): value is string => typeof value === "string")
          : undefined,
        aspectRatio: typeof item.aspect_ratio === "string" ? item.aspect_ratio : "16:9",
        imagePriority: typeof item.image_priority === "string" ? item.image_priority : undefined,
      } satisfies DirectorScene;
    })
    .filter((scene): scene is DirectorScene => Boolean(scene));
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
        "- Clear narration with short paragraphs.",
        "- Natural transitions.",
        "- No fabricated sources, quotes, statistics, or events.",
        "- Mark statements needing external fact-checking as [VERIFY].",
        "- End with a concise takeaway and call to action.",
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
        "First create an IMMUTABLE CHARACTER BIBLE for every recurring human/animal/fictional character.",
        "The Character Bible must use fixed fields: character_id, name, apparent_age, gender_presentation, ethnicity_or_species, face, skin_or_surface, eyes, hair_or_head_features, body_build, signature_clothing, footwear, accessories, color_palette, art_style, and hard_constraints.",
        "Once created, NEVER change the Character Bible during this project unless the story explicitly introduces a permanent character redesign.",
        "Then output the Character Bible exactly between CHARACTER_BIBLE_START and CHARACTER_BIBLE_END.",
        "After the Character Bible, return 8-12 numbered scenes.",
        "For every scene provide:",
        "- scene_id",
        "- purpose",
        "- narration_excerpt",
        "- visual_prompt",
        "- camera_and_composition",
        "- lighting_and_color",
        "- environment",
        "- character_actions",
        "- on_screen_text",
        "- asset_type",
        "- reference_character_ids",
        "- aspect_ratio (always 16:9)",
        "- image_priority (hero, standard, transition)",
        "CRITICAL: Every visual_prompt MUST include the complete relevant Character Bible text verbatim for each referenced recurring character.",
        "CRITICAL: Never use vague phrases such as 'same character as before' or 'as previously described'. Repeat the fixed character specification in every scene.",
        "Design prompts for Gemi using Cloudflare Workers AI image generation. Do not request image generation from ChatGPT.",
        "If a reference image is available, instruct Gemi to use it as a subject reference while preserving the Character Bible constraints.",
        "Keep visual instructions concrete, cinematic, and production-ready.",
        "Do not claim that any image, audio, or video asset has already been generated.",
        "After the numbered scene plan, output the exact same scene data as machine-readable JSON between SCENES_JSON_START and SCENES_JSON_END.",
        "The JSON must be an object with a single top-level key called scenes containing the scene array.",
        "Use snake_case keys matching the scene fields: scene_id, purpose, narration_excerpt, visual_prompt, camera_and_composition, lighting_and_color, environment, character_actions, on_screen_text, asset_type, reference_character_ids, aspect_ratio, image_priority.",
        "Do not wrap the JSON in markdown fences. Keep every visual_prompt complete and production-ready.",
        "",
        "SCRIPT:",
        script,
      ].join("\n");
    }

    const result = await generateWithChatGPT(prompt);

    let characterBible = "";
    if (stage === "director") {
      const match = result.text.match(/CHARACTER_BIBLE_START\\s*([\\s\\S]*?)\\s*CHARACTER_BIBLE_END/i);
      characterBible = match?.[1]?.trim() ?? "";
    }

    const scenes = stage === "director" ? parseDirectorScenes(result.text) : [];

    if (stage === "director" && scenes.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "Director completed, but no structured scene JSON was returned. Run the Director stage again.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      stage,
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
