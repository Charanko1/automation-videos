import type { AIProductionDialogue, AIProductionScene } from "./workspace";

export type ParsedDramaPlan = {
  characterBible: string;
  scenes: AIProductionScene[];
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
  raw = raw.replace(/^\`\`\`json\s*/i, "").replace(/\s*\`\`\`$/i, "").trim();
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text: string) {
  const source = stripThinkingText(text)
    .replace(/^\`\`\`json\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();

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

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, index + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function extractRawPlan(text: string) {
  return (
    extractMarkedJson(text, "DIRECTOR_JSON_START", "DIRECTOR_JSON_END") ??
    extractMarkedJson(text, "SCENES_JSON_START", "SCENES_JSON_END") ??
    extractFirstJsonObject(text)
  );
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseDialogue(value: unknown): AIProductionDialogue[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    .map((entry) => ({
      speaker: asString(entry.speaker),
      characterId: asString(entry.character_id) || undefined,
      line: asString(entry.line),
      emotion: asString(entry.emotion) || undefined,
    }))
    .filter((entry) => Boolean(entry.speaker && entry.line));
}

function buildVisualPrompt(
  prompt: string,
  scene: Record<string, unknown>,
  characterBible: string,
) {
  const camera = asString(scene.camera_and_composition);
  const lighting = asString(scene.lighting_and_color);
  const environment = asString(scene.environment);
  const actions = asString(scene.character_actions);
  const emotionalBeat = asString(scene.emotional_beat);
  const charactersPresent = Array.isArray(scene.characters_present)
    ? scene.characters_present.filter((value): value is string => typeof value === "string" && value.trim()).join(", ")
    : "";

  return [
    prompt,
    charactersPresent ? "VISIBLE CHARACTERS: " + charactersPresent : "",
    emotionalBeat ? "EMOTIONAL BEAT: " + emotionalBeat : "",
    actions ? "ACTING / BLOCKING: " + actions : "",
    camera ? "CAMERA: " + camera : "",
    lighting ? "LIGHTING: " + lighting : "",
    environment ? "ENVIRONMENT: " + environment : "",
    characterBible ? "IMMUTABLE CHARACTER BIBLE:\n" + characterBible : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function parseDirectorPlan(text: string): ParsedDramaPlan {
  const parsed = extractRawPlan(text);

  if (!parsed || typeof parsed !== "object" || parsed === null) {
    return { characterBible: "", scenes: [] };
  }

  const item = parsed as Record<string, unknown>;
  const characterBible = asString(item.character_bible);
  const rawScenes = Array.isArray(item.scenes)
    ? item.scenes
    : Array.isArray(item.scene)
      ? item.scene
      : [];

  const scenes = rawScenes
    .map((entry): AIProductionScene | null => {
      if (!entry || typeof entry !== "object") return null;

      const scene = entry as Record<string, unknown>;
      const sceneId = asString(scene.scene_id);
      const prompt = asString(scene.visual_prompt_core) || asString(scene.visual_prompt);
      if (!sceneId || !prompt) return null;

      return {
        sceneId,
        purpose: asString(scene.purpose) || undefined,
        narrationExcerpt: asString(scene.narration_excerpt) || undefined,
        dialogue: parseDialogue(scene.dialogue),
        charactersPresent: Array.isArray(scene.characters_present)
          ? scene.characters_present.filter((value): value is string => typeof value === "string" && value.trim())
          : undefined,
        emotionalBeat: asString(scene.emotional_beat) || undefined,
        visualPrompt: buildVisualPrompt(prompt, scene, characterBible),
        cameraAndComposition: asString(scene.camera_and_composition) || undefined,
        lightingAndColor: asString(scene.lighting_and_color) || undefined,
        environment: asString(scene.environment) || undefined,
        characterActions: asString(scene.character_actions) || undefined,
        onScreenText: asString(scene.on_screen_text) || undefined,
        assetType: asString(scene.asset_type) || undefined,
        referenceCharacterIds: Array.isArray(scene.reference_character_ids)
          ? scene.reference_character_ids.filter((value): value is string => typeof value === "string" && value.trim())
          : undefined,
        aspectRatio: "16:9",
        imagePriority: asString(scene.image_priority) || undefined,
      };
    })
    .filter((scene): scene is AIProductionScene => Boolean(scene));

  return { characterBible, scenes };
}

export function getDramaDialogue(scenes: AIProductionScene[]) {
  return scenes.flatMap((scene) =>
    (scene.dialogue ?? []).map((dialogue) => ({
      sceneId: scene.sceneId,
      ...dialogue,
    })),
  );
}
