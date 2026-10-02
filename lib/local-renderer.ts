import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDramaDialogue, parseDirectorPlan } from "./drama-scene-plan";
import type { AIProductionScene } from "./workspace";

const execFileAsync = promisify(execFile);

type SceneCue = {
  sceneId: string;
  start: number;
  end: number;
  text: string;
  speaker: string;
  characterId?: string;
};

type SceneImageAsset = {
  assetUrl: string;
  sceneId?: string;
};

function resolvePublicAssetPath(assetUrl: string) {
  const clean = assetUrl.split("?")[0].split("#")[0];
  if (!clean.startsWith("/generated/")) return null;

  const relative = clean.replace(/^\/+/, "");
  const absolute = path.resolve(process.cwd(), "public", relative);
  const publicRoot = path.resolve(process.cwd(), "public") + path.sep;

  if (!absolute.startsWith(publicRoot)) return null;
  return absolute;
}

function safeName(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "ai-office"
  );
}

function cleanDialogueLine(text: string) {
  return text
    .replace(/\r/g, " ")
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/^\s*[A-Z][A-Z0-9 _-]{0,30}\s*:\s*/i, "")
    .replace(/^\s*["“](.*)["”]\s*$/s, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanNarrationText(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const output: string[] = [];

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    if (/^\s*#{1,6}\s+/.test(line)) continue;
    if (/^(INT\.|EXT\.|SCENE\s*\d+)/i.test(line)) continue;

    const labelMatch = line.match(
      /^\s*(HOOK|INTRO|OUTRO|TRANSISI|TRANSITION|TAKEAWAY|NARASI|VOICE[- ]?OVER|VISUAL|SHOT|B-?ROLL)\s*[:\-]\s*(.*)$/i,
    );
    if (labelMatch) line = labelMatch[2].trim();

    line = line.replace(/^\s*\([^)]{1,160}\)\s*/g, "");
    line = line.replace(/^\s*\[[^\]]{1,160}\]\s*/g, "");
    line = line.replace(/^\s*[-*•]\s+/, "").trim();

    if (line) output.push(line);
  }

  return output.join(" ").replace(/\s+/g, " ").trim();
}

function chunkText(text: string, maxChars = 120) {
  const normalized = text
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return [];

  const sentences =
    normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [normalized];

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current
      ? current + " " + sentence.trim()
      : sentence.trim();

    if (current && next.length > maxChars) {
      chunks.push(current);
      current = sentence.trim();
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function formatSrtTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.floor((safe - Math.floor(safe)) * 1000);

  return (
    hours.toString().padStart(2, "0") +
    ":" +
    minutes.toString().padStart(2, "0") +
    ":" +
    secs.toString().padStart(2, "0") +
    "," +
    ms.toString().padStart(3, "0")
  );
}

function escapePowerShellSingle(value: string) {
  return value.replace(/'/g, "''");
}

function subtitlePathForFfmpeg(file: string) {
  return file.replace(/\\/g, "/").replace(/:/g, "\\:");
}

async function run(command: string, args: string[]) {
  try {
    return await execFileAsync(command, args, {
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error: any) {
    const stderr =
      error?.stderr || error?.stdout || error?.message || "command failed";
    throw new Error(String(stderr).trim().slice(-5000));
  }
}

async function findExecutable(command: string) {
  try {
    await execFileAsync(
      process.platform === "win32" ? "where.exe" : "which",
      [command],
      { windowsHide: true },
    );
    return true;
  } catch {
    return false;
  }
}

function cameraMotion(scene: AIProductionScene) {
  const camera = (scene.cameraAndComposition ?? "").toLowerCase();

  if (
    camera.includes("close-up") ||
    camera.includes("close up") ||
    camera.includes("reaction")
  ) {
    return {
      zoom: "min(zoom+0.00065,1.10)",
      x: "iw/2-(iw/zoom/2)",
      y: "ih/2-(ih/zoom/2)",
    };
  }

  if (camera.includes("wide") || camera.includes("establishing")) {
    return {
      zoom: "max(zoom-0.00035,1.0)",
      x: "iw/2-(iw/zoom/2)",
      y: "ih/2-(ih/zoom/2)",
    };
  }

  if (
    camera.includes("over-the-shoulder") ||
    camera.includes("over the shoulder")
  ) {
    return {
      zoom: "min(zoom+0.0005,1.08)",
      x: "iw/2-(iw/zoom/2)+sin(on*0.012)*24",
      y: "ih/2-(ih/zoom/2)",
    };
  }

  return {
    zoom: "min(zoom+0.00045,1.07)",
    x: "iw/2-(iw/zoom/2)",
    y: "ih/2-(ih/zoom/2)",
  };
}

async function createDialogueAudio(options: {
  tempDir: string;
  outputDir: string;
  lines: Array<{
    index: number;
    sceneId: string;
    speaker: string;
    characterId?: string;
    line: string;
  }>;
}) {
  const { tempDir, outputDir, lines } = options;

  const dialogueJsonPath = path.join(
    tempDir,
    "dialogue-" + Date.now() + ".json",
  );
  const scriptPath = path.join(
    tempDir,
    "tts-dialogue-" + Date.now() + ".ps1",
  );
  const audioDir = path.join(outputDir, "dialogue-lines");

  await fs.mkdir(audioDir, { recursive: true });
  await fs.writeFile(dialogueJsonPath, JSON.stringify(lines, null, 2), "utf8");

  const ps = [
    "Add-Type -AssemblyName System.Speech",
    "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$synth.Rate = 0",
    "$synth.Volume = 100",
    "$items = @(Get-Content -Raw -LiteralPath '" +
      escapePowerShellSingle(dialogueJsonPath) +
      "' | ConvertFrom-Json)",
    "$voiceNames = @($synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name } | Where-Object { $_ })",
    "$voiceMap = @{}",
    "$voiceIndex = 0",
    "$outDir = '" + escapePowerShellSingle(audioDir) + "'",
    "$null = New-Item -ItemType Directory -Force -Path $outDir",
    "foreach ($item in $items) {",
    "  $speaker = [string]$item.speaker",
    "  if (-not $voiceMap.ContainsKey($speaker)) {",
    "    if ($voiceNames.Count -gt 0) {",
    "      $voiceMap[$speaker] = $voiceNames[$voiceIndex % $voiceNames.Count]",
    "      $voiceIndex++",
    "    } else {",
    "      $voiceMap[$speaker] = ''",
    "    }",
    "  }",
    "  $voice = [string]$voiceMap[$speaker]",
    "  if ($voice) { try { $synth.SelectVoice($voice) } catch {} }",
    "  $index = [int]$item.index",
    "  $file = Join-Path $outDir (($index.ToString('000')) + '.wav')",
    "  $synth.SetOutputToWaveFile($file)",
    "  $synth.Speak([string]$item.line)",
    "}",
    "$synth.Dispose()",
  ].join("\r\n");

  await fs.writeFile(scriptPath, ps, "utf8");
  await run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
  ]);

  return { audioDir, dialogueJsonPath, scriptPath };
}

export async function renderLocalVideo(input: {
  projectId: string;
  title: string;
  script: string;
  director: string;
  model?: string;
  imageAssets?: SceneImageAsset[];
}) {
  if (process.platform !== "win32") {
    throw new Error(
      "Local video rendering is currently implemented for Windows. It uses Windows Speech Synthesis plus FFmpeg.",
    );
  }

  const hasFfmpeg = await findExecutable("ffmpeg");
  const hasFfprobe = await findExecutable("ffprobe");
  const hasPowershell = await findExecutable("powershell");

  if (!hasFfmpeg || !hasFfprobe || !hasPowershell) {
    throw new Error(
      "Local renderer prerequisites missing. Install FFmpeg (ffmpeg + ffprobe) and ensure powershell.exe is available in PATH.",
    );
  }

  const projectSlug = safeName(input.projectId) + "-" + Date.now();
  const outDir = path.join(
    process.cwd(),
    "public",
    "generated",
    projectSlug,
  );
  await fs.mkdir(outDir, { recursive: true });

  const screenplayPath = path.join(outDir, "screenplay.txt");
  const directorPath = path.join(outDir, "director-scene-plan.txt");
  const dialoguePath = path.join(outDir, "dialogue.txt");
  const dialogueAudioPath = path.join(outDir, "dialogue.wav");
  const srtPath = path.join(outDir, "subtitles.srt");
  const videoPath = path.join(outDir, "final.mp4");
  const thumbnailPath = path.join(outDir, "thumbnail.jpg");
  const manifestPath = path.join(outDir, "manifest.json");

  await fs.writeFile(screenplayPath, input.script, "utf8");
  await fs.writeFile(directorPath, input.director, "utf8");

  const plan = parseDirectorPlan(input.director);
  if (plan.scenes.length === 0) {
    throw new Error(
      "Director scene plan could not be parsed. Regenerate the Director stage before rendering.",
    );
  }

  const rawDramaLines = getDramaDialogue(plan.scenes);
  const dramaLines = rawDramaLines
    .map((line, index) => ({
      index,
      sceneId: line.sceneId,
      speaker: line.speaker,
      characterId: line.characterId,
      line: cleanDialogueLine(line.line),
    }))
    .filter((line) => line.speaker && line.line);

  if (dramaLines.length === 0) {
    const fallback = chunkText(cleanNarrationText(input.script));

    if (fallback.length === 0) {
      throw new Error(
        "No dialogue was found in the Director plan and no fallback narration could be extracted.",
      );
    }

    dramaLines.push(
      ...fallback.map((line, index) => ({
        index,
        sceneId:
          plan.scenes[Math.min(index, plan.scenes.length - 1)]?.sceneId ??
          "S001",
        speaker: "Narrator",
        characterId: undefined,
        line,
      })),
    );
  }

  await fs.writeFile(
    dialoguePath,
    dramaLines.map((line) => line.speaker + ": " + line.line).join("\n"),
    "utf8",
  );

  const tempDir = path.join(process.cwd(), ".ai-office-render-temp");
  await fs.mkdir(tempDir, { recursive: true });

  const { audioDir, dialogueJsonPath, scriptPath: voiceScriptPath } =
    await createDialogueAudio({
      tempDir,
      outputDir: outDir,
      lines: dramaLines,
    });

  const audioFiles: string[] = [];
  for (const line of dramaLines) {
    const file = path.join(
      audioDir,
      String(line.index).padStart(3, "0") + ".wav",
    );

    try {
      await fs.access(file);
      audioFiles.push(file);
    } catch {
      throw new Error(
        "TTS did not create an audio file for dialogue line " +
          line.index +
          ".",
      );
    }
  }

  const concatAudioPath = path.join(
    tempDir,
    "dialogue-concat-" + Date.now() + ".txt",
  );

  await fs.writeFile(
    concatAudioPath,
    audioFiles
      .map(
        (file) =>
          "file '" +
          file.replace(/\\/g, "/").replace(/'/g, "''") +
          "'",
      )
      .join("\n") + "\n",
    "utf8",
  );

  await run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatAudioPath,
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "pcm_s16le",
    dialogueAudioPath,
  ]);

  const cueDurations: number[] = [];

  for (const file of audioFiles) {
    const probe = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ]);

    cueDurations.push(
      Math.max(0.1, Number.parseFloat(probe.stdout.trim()) || 0.1),
    );
  }

  const totalDuration = Math.max(
    1,
    cueDurations.reduce((sum, value) => sum + value, 0),
  );

  let cursor = 0;
  const cues: SceneCue[] = dramaLines.map((line, index) => {
    const start = cursor;
    const end =
      index === dramaLines.length - 1
        ? totalDuration
        : cursor + cueDurations[index];

    cursor = end;

    return {
      sceneId: line.sceneId,
      start,
      end,
      text: line.line,
      speaker: line.speaker,
      characterId: line.characterId,
    };
  });

  const srt = cues
    .map(
      (cue, index) =>
        String(index + 1) +
        "\n" +
        formatSrtTime(cue.start) +
        " --> " +
        formatSrtTime(cue.end) +
        "\n" +
        cue.text +
        "\n",
    )
    .join("\n");

  await fs.writeFile(srtPath, srt, "utf8");

  const assetMap = new Map<string, SceneImageAsset>();
  for (const asset of Array.isArray(input.imageAssets)
    ? input.imageAssets
    : []) {
    const sceneId =
      typeof asset.sceneId === "string" && asset.sceneId.trim()
        ? asset.sceneId.trim()
        : null;

    if (sceneId) assetMap.set(sceneId, asset);
  }

  const fallbackAssets = Array.isArray(input.imageAssets)
    ? input.imageAssets
    : [];
  const imageDir = path.join(outDir, "scene-images");

  await fs.mkdir(imageDir, { recursive: true });

  const clipPaths: string[] = [];
  let generatedImageCount = 0;

  for (let sceneIndex = 0; sceneIndex < plan.scenes.length; sceneIndex += 1) {
    const scene = plan.scenes[sceneIndex];
    const asset = assetMap.get(scene.sceneId) ?? fallbackAssets[sceneIndex];

    if (!asset) continue;

    const imagePath = resolvePublicAssetPath(asset.assetUrl);
    if (!imagePath) continue;

    try {
      await fs.access(imagePath);
    } catch {
      continue;
    }

    const sceneCues = cues.filter(
      (cue) => cue.sceneId === scene.sceneId,
    );

    const clipDuration =
      sceneCues.length > 0
        ? Math.max(
            0.8,
            sceneCues[sceneCues.length - 1].end -
              sceneCues[0].start,
          )
        : Math.max(
            1.2,
            totalDuration / Math.max(plan.scenes.length, 1),
          );

    const frames = Math.max(24, Math.ceil(clipDuration * 30));
    const clipPath = path.join(
      imageDir,
      String(sceneIndex + 1).padStart(3, "0") + ".mp4",
    );
    const motion = cameraMotion(scene);

    const imageFilter =
      "scale=1280:720:force_original_aspect_ratio=decrease," +
      "pad=1280:720:(ow-iw)/2:(oh-ih)/2," +
      "zoompan=z='" +
      motion.zoom +
      "':x='" +
      motion.x +
      "':y='" +
      motion.y +
      "':d=" +
      frames +
      ":s=1280x720:fps=30,format=yuv420p";

    await run("ffmpeg", [
      "-y",
      "-loop",
      "1",
      "-i",
      imagePath,
      "-t",
      clipDuration.toFixed(3),
      "-vf",
      imageFilter,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      clipPath,
    ]);

    clipPaths.push(clipPath);
    generatedImageCount += 1;
  }

  if (clipPaths.length !== plan.scenes.length) {
    throw new Error(
      "Drama render requires one generated image for every Director scene. Generate all scene keyframes before rendering.",
    );
  }

  if (clipPaths.length === 0) {
    throw new Error(
      "No usable generated scene images were found. Generate the drama keyframes before rendering.",
    );
  }

  const concatVideoPath = path.join(imageDir, "concat.txt");

  await fs.writeFile(
    concatVideoPath,
    clipPaths
      .map(
        (file) =>
          "file '" +
          file.replace(/\\/g, "/").replace(/'/g, "''") +
          "'",
      )
      .join("\n") + "\n",
    "utf8",
  );

  const slideshowPath = path.join(
    imageDir,
    "drama-slideshow.mp4",
  );

  await run("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatVideoPath,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    slideshowPath,
  ]);

  const subtitleFile = subtitlePathForFfmpeg(srtPath);
  const videoFilter =
    "subtitles='" +
    subtitleFile +
    "':force_style='FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101620,Outline=2,Shadow=1,Alignment=2,MarginV=44,WrapStyle=2'";

  await run("ffmpeg", [
    "-y",
    "-i",
    slideshowPath,
    "-i",
    dialogueAudioPath,
    "-vf",
    videoFilter,
    "-t",
    totalDuration.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-shortest",
    "-movflags",
    "+faststart",
    videoPath,
  ]);

  await run("ffmpeg", [
    "-y",
    "-ss",
    "0",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    thumbnailPath,
  ]);

  const speakers = Array.from(
    new Set(dramaLines.map((line) => line.speaker)),
  );

  const manifest = {
    projectId: input.projectId,
    title: input.title,
    model: input.model ?? null,
    generatedAt: new Date().toISOString(),
    type: "local-drama-dialogue-video",
    durationSeconds: Number(totalDuration.toFixed(3)),
    scenes: plan.scenes.length,
    dialogueLines: dramaLines.length,
    speakers,
    imageScenes: generatedImageCount,
    note:
      "Local drama assembly with Windows Speech Synthesis character dialogue, speaker-based voice assignment when multiple system voices are available, clean subtitles without speaker labels, and Director-driven camera motion. AI video motion is not applied yet.",
    files: {
      screenplay: "screenplay.txt",
      director: "director-scene-plan.txt",
      dialogue: "dialogue.txt",
      dialogueAudio: "dialogue.wav",
      subtitles: "subtitles.srt",
      video: "final.mp4",
      thumbnail: "thumbnail.jpg",
    },
  };

  await fs.writeFile(
    manifestPath,
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  await fs.rm(dialogueJsonPath, { force: true }).catch(() => undefined);
  await fs.rm(voiceScriptPath, { force: true }).catch(() => undefined);

  const publicBase = "/generated/" + projectSlug;

  return {
    videoUrl: publicBase + "/final.mp4",
    thumbnailUrl: publicBase + "/thumbnail.jpg",
    manifestUrl: publicBase + "/manifest.json",
    durationSeconds: Number(totalDuration.toFixed(3)),
    scenes: plan.scenes.length,
  };
}
