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

  const raw = text
    .slice(contentStart, end)
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function extractBalancedJsonValues(text: string) {
  const source = stripThinkingText(text);
  const values: unknown[] = [];

  let searchFrom = 0;

  while (searchFrom < source.length) {
    const brace = source.indexOf("{", searchFrom);
    const bracket = source.indexOf("[", searchFrom);

    let start = -1;
    if (brace >= 0 && bracket >= 0) start = Math.min(brace, bracket);
    else start = Math.max(brace, bracket);

    if (start < 0) break;

    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    let end = -1;

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

      if (char === "{" || char === "[") {
        stack.push(char);
        continue;
      }

      if (char === "}" || char === "]") {
        const expected = char === "}" ? "{" : "[";
        if (stack[stack.length - 1] !== expected) {
          stack.length = 0;
          break;
        }

        stack.pop();
        if (stack.length === 0) {
          end = index;
          break;
        }
      }
    }

    if (end < 0) {
      searchFrom = start + 1;
      continue;
    }

    const raw = source.slice(start, end + 1).trim();
    try {
      values.push(JSON.parse(raw) as unknown);
    } catch {
      // Ignore malformed candidates and keep looking for another complete value.
    }

    searchFrom = end + 1;
  }

  return values;
}

function deepFindByKey(value: unknown, keys: string[], seen = new Set<unknown>()): unknown {
  if (!value || typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindByKey(item, keys, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;

  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }

  for (const child of Object.values(record)) {
    const found = deepFindByKey(child, keys, seen);
    if (found !== undefined) return found;
  }

  return undefined;
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function serializeCharacterBible(value: unknown) {
  if (typeof value === "string") return value.trim();

  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value) && value.length === 0) return "";

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function nestedName(value: unknown) {
  if (typeof value === "string") return value.trim();

  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  return asString(
    record.name ??
      record.speaker ??
      record.character_name ??
      record.characterName ??
      record.id ??
      record.character_id ??
      record.characterId,
  );
}

function parseDialogue(value: unknown): AIProductionDialogue[] {
  const entries: unknown[] = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
          if (typeof entry === "string") {
            return [{ speaker: key, line: entry }];
          }
          if (Array.isArray(entry)) {
            return entry.map((item) =>
              item && typeof item === "object"
                ? { ...(item as Record<string, unknown>), speaker: (item as Record<string, unknown>).speaker ?? key }
                : { speaker: key, line: String(item ?? "") },
            );
          }
          return [entry];
        })
      : typeof value === "string"
        ? value
            .split(/\r?\n+/)
            .map((line) => line.trim())
            .filter(Boolean)
        : [];

  return entries
    .map((entry) => {
      if (typeof entry === "string") {
        const match =
          entry.match(/^\s*([^:：]{1,60})\s*[:：]\s*(.+)\s*$/s) ??
          entry.match(/^\s*[-*•]?\s*([^\-–—]{1,60})\s*[-–—]\s*(.+)\s*$/s);

        return {
          speaker: match ? match[1].trim() : "",
          characterId: undefined,
          line: match ? match[2].trim() : "",
          emotion: undefined,
        };
      }

      if (!entry || typeof entry !== "object") {
        return { speaker: "", characterId: undefined, line: "", emotion: undefined };
      }

      const record = entry as Record<string, unknown>;
      const characterValue = record.character ?? record.character_data ?? record.characterData;
      return {
        speaker: nestedName(record.speaker) || nestedName(characterValue) || nestedName(record.name) || nestedName(record.character_name),
        characterId: asString(record.character_id ?? record.characterId) ||
          nestedName(characterValue) || undefined,
        line: asString(
          record.line ??
            record.text ??
            record.spoken_line ??
            record.spokenLine ??
            record.dialogue ??
            record.content ??
            record.value,
        ),
        emotion: asString(record.emotion ?? record.feeling ?? record.mood) || undefined,
      };
    })
    .filter((entry) => Boolean(entry.speaker && entry.line));
}

function findDialogueValue(scene: Record<string, unknown>) {
  const directKeys = [
    "dialogue",
    "dialogues",
    "dialogue_lines",
    "dialogueLines",
    "spoken_lines",
    "spokenLines",
    "lines",
  ];

  for (const key of directKeys) {
    if (scene[key] !== undefined) {
      const parsed = parseDialogue(scene[key]);
      if (parsed.length > 0) return parsed;
    }
  }

  const queue: unknown[] = Object.values(scene);
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) queue.push(item);
      continue;
    }

    const record = value as Record<string, unknown>;

    for (const key of directKeys) {
      if (record[key] !== undefined) {
        const parsed = parseDialogue(record[key]);
        if (parsed.length > 0) return parsed;
      }
    }

    for (const child of Object.values(record)) {
      if (child && typeof child === "object") queue.push(child);
    }
  }

  return [];
}

function buildVisualPrompt(prompt: string, scene: Record<string, unknown>) {
  const camera = asString(scene.camera_and_composition ?? scene.camera);
  const lighting = asString(scene.lighting_and_color ?? scene.lighting);
  const environment = asString(scene.environment ?? scene.location);
  const actions = asString(scene.character_actions ?? scene.actions ?? scene.blocking);
  const emotionalBeat = asString(scene.emotional_beat ?? scene.emotion);
  const charactersPresent = Array.isArray(scene.characters_present)
    ? scene.characters_present
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        .join(", ")
    : Array.isArray(scene.charactersPresent)
      ? scene.charactersPresent
          .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
          .join(", ")
      : "";

  return [
    prompt,
    charactersPresent ? "VISIBLE CHARACTERS: " + charactersPresent : "",
    emotionalBeat ? "EMOTIONAL BEAT: " + emotionalBeat : "",
    actions ? "ACTING / BLOCKING: " + actions : "",
    camera ? "CAMERA: " + camera : "",
    lighting ? "LIGHTING: " + lighting : "",
    environment ? "ENVIRONMENT: " + environment : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function looksLikeScene(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Boolean(
    asString(
      record.scene_id ??
        record.sceneId ??
        record.scene_number ??
        record.sceneNumber ??
        record.id ??
        record.number,
    ),
  );
}

function sceneCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;

  if (!value || typeof value !== "object") return [];

  return Object.values(value);
}

function findSceneArray(parsedValues: unknown[]) {
  const sceneKeys = [
    "scenes",
    "scene_plans",
    "scenePlans",
    "scene_list",
    "sceneList",
    "shots",
    "shot_list",
    "shotList",
    "storyboard",
  ];

  for (const value of parsedValues) {
    const directWhole = sceneCollection(value);
    if (directWhole.length > 0) return directWhole;

    for (const key of sceneKeys) {
      const directValue =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)[key]
          : undefined;

      const directScenes = sceneCollection(directValue);
      if (directScenes.length > 0) return directScenes;
    }

    const nested = deepFindByKey(value, ["scene"]);
    const nestedScenes = sceneCollection(nested);
    if (nestedScenes.length > 0) return nestedScenes;
  }

  return [];
}

function findCharacterBible(parsedValues: unknown[]) {
  for (const value of parsedValues) {
    const candidate = deepFindByKey(value, ["character_bible", "characterBible", "characters"]);
    const serialized = serializeCharacterBible(candidate);
    if (serialized) return serialized;
  }

  return "";
}

export function parseDirectorPlan(text: string): ParsedDramaPlan {
  const clean = stripThinkingText(text);
  const marked =
    extractMarkedJson(clean, "DIRECTOR_JSON_START", "DIRECTOR_JSON_END") ??
    extractMarkedJson(clean, "SCENES_JSON_START", "SCENES_JSON_END");

  const parsedValues = [
    ...(marked ? [marked] : []),
    ...extractBalancedJsonValues(clean),
  ];

  const fenceClean = clean
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  if (fenceClean && fenceClean !== clean) {
    try {
      const fencedParsed = JSON.parse(fenceClean) as unknown;
      parsedValues.unshift(fencedParsed);
    } catch {
      // Balanced JSON extraction may still recover valid objects.
    }
  }

  if (parsedValues.length === 0) {
    try {
      parsedValues.push(JSON.parse(clean) as unknown);
    } catch {
      return { characterBible: "", scenes: [] };
    }
  }

  const characterBible = findCharacterBible(parsedValues);
  const rawScenes = findSceneArray(parsedValues);

  const scenes = rawScenes
    .map((entry, index): AIProductionScene | null => {
      if (!entry || typeof entry !== "object") return null;

      const scene = entry as Record<string, unknown>;
      const rawSceneNumber = asText(
        scene.scene_id ??
          scene.sceneId ??
          scene.scene_number ??
          scene.sceneNumber ??
          scene.id ??
          scene.number,
      );
      const numericScene = Number.parseInt(rawSceneNumber, 10);
      const sceneId =
        rawSceneNumber && Number.isFinite(numericScene) && !rawSceneNumber.includes("-")
          ? "S" + String(numericScene).padStart(3, "0")
          : rawSceneNumber || "S" + String(index + 1).padStart(3, "0");

      const purpose = asString(scene.purpose ?? scene.scene_purpose ?? scene.scenePurpose);
      const promptCore = asString(
        scene.visual_prompt_core ??
          scene.visual_prompt ??
          scene.visualPrompt ??
          scene.visual_description ??
          scene.visualDescription,
      );
      const narrationExcerpt = asString(scene.narration_excerpt ?? scene.narrationExcerpt);
      const environment = asString(scene.environment ?? scene.location);
      const characterActions = asString(
        scene.character_actions ?? scene.actions ?? scene.blocking,
      );
      const emotionalBeat = asString(scene.emotional_beat ?? scene.emotionalBeat ?? scene.emotion);

      const prompt = promptCore || [
        purpose ? "PURPOSE: " + purpose : "",
        emotionalBeat ? "EMOTIONAL BEAT: " + emotionalBeat : "",
        characterActions ? "CHARACTER ACTIONS: " + characterActions : "",
        environment ? "ENVIRONMENT: " + environment : "",
        narrationExcerpt ? "STORY BEAT: " + narrationExcerpt : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      if (!sceneId) return null;

      return {
        sceneId,
        purpose: asString(scene.purpose) || undefined,
        narrationExcerpt: asString(scene.narration_excerpt ?? scene.narrationExcerpt) || undefined,
        dialogue: findDialogueValue(scene),
        charactersPresent: Array.isArray(scene.characters_present)
          ? scene.characters_present.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
          : Array.isArray(scene.charactersPresent)
            ? scene.charactersPresent.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
            : undefined,
        emotionalBeat: asString(scene.emotional_beat ?? scene.emotionalBeat) || undefined,
        visualPrompt: buildVisualPrompt(prompt, scene),
        cameraAndComposition: asString(scene.camera_and_composition ?? scene.camera) || undefined,
        lightingAndColor: asString(scene.lighting_and_color ?? scene.lighting) || undefined,
        environment: asString(scene.environment ?? scene.location) || undefined,
        characterActions: asString(scene.character_actions ?? scene.actions ?? scene.blocking) || undefined,
        onScreenText: asString(scene.on_screen_text ?? scene.onScreenText) || undefined,
        assetType: asString(scene.asset_type ?? scene.assetType) || undefined,
        referenceCharacterIds: Array.isArray(scene.reference_character_ids)
          ? scene.reference_character_ids.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
          : Array.isArray(scene.referenceCharacterIds)
            ? scene.referenceCharacterIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
            : undefined,
        aspectRatio: asString(scene.aspect_ratio ?? scene.aspectRatio) || "9:16",
        imagePriority: asString(scene.image_priority ?? scene.imagePriority) || undefined,
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
