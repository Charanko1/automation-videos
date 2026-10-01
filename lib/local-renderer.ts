import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type SceneCue = { start: number; end: number; text: string };

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "ai-office";
}

function chunkText(text: string, maxChars = 220) {
  const normalized = text.replace(/\r/g, "").replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [normalized];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? current + " " + sentence.trim() : sentence.trim();
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
  return hours.toString().padStart(2, "0") + ":" + minutes.toString().padStart(2, "0") + ":" + secs.toString().padStart(2, "0") + "," + ms.toString().padStart(3, "0");
}

function escapePowerShellSingle(value: string) {
  return value.replace(/'/g, "''");
}

function subtitlePathForFfmpeg(file: string) {
  return file.replace(/\\/g, "/").replace(/:/g, "\\:");
}

async function run(command: string, args: string[]) {
  try {
    return await execFileAsync(command, args, { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  } catch (error: any) {
    const stderr = error?.stderr || error?.stdout || error?.message || "command failed";
    throw new Error(String(stderr).trim().slice(-5000));
  }
}

async function findExecutable(command: string) {
  try {
    await execFileAsync(process.platform === "win32" ? "where.exe" : "which", [command], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function renderLocalVideo(input: {
  projectId: string;
  title: string;
  script: string;
  director: string;
  model?: string;
}) {
  if (process.platform !== "win32") {
    throw new Error("Local video rendering is currently implemented for Windows. It uses Windows Speech Synthesis plus FFmpeg.");
  }

  const hasFfmpeg = await findExecutable("ffmpeg");
  const hasFfprobe = await findExecutable("ffprobe");
  const hasPowershell = await findExecutable("powershell");
  if (!hasFfmpeg || !hasFfprobe || !hasPowershell) {
    throw new Error("Local renderer prerequisites missing. Install FFmpeg (ffmpeg + ffprobe) and ensure powershell.exe is available in PATH.");
  }

  const projectSlug = safeName(input.projectId) + "-" + Date.now();
  const outDir = path.join(process.cwd(), "public", "generated", projectSlug);
  await fs.mkdir(outDir, { recursive: true });

  const scriptPath = path.join(outDir, "script.txt");
  const directorPath = path.join(outDir, "director-scene-plan.txt");
  const tempDir = path.join(process.cwd(), ".ai-office-render-temp");
  await fs.mkdir(tempDir, { recursive: true });
  const ps1Path = path.join(tempDir, "make-voice-" + safeName(input.projectId) + "-" + Date.now() + ".ps1");
  const audioPath = path.join(outDir, "narration.wav");
  const srtPath = path.join(outDir, "subtitles.srt");
  const videoPath = path.join(outDir, "final.mp4");
  const thumbnailPath = path.join(outDir, "thumbnail.jpg");
  const manifestPath = path.join(outDir, "manifest.json");

  await fs.writeFile(scriptPath, input.script, "utf8");
  await fs.writeFile(directorPath, input.director, "utf8");

  const ps = [
    "Add-Type -AssemblyName System.Speech",
    "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$synth.Rate = 0",
    "$synth.Volume = 100",
    "$synth.SetOutputToWaveFile('" + escapePowerShellSingle(audioPath) + "')",
    "$text = Get-Content -Raw -LiteralPath '" + escapePowerShellSingle(scriptPath) + "'",
    "$synth.Speak($text)",
    "$synth.Dispose()",
  ].join("\r\n");

  await fs.writeFile(ps1Path, ps, "utf8");
  await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1Path]);

  const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audioPath]);
  const duration = Math.max(1, Number.parseFloat(probe.stdout.trim()) || 1);

  const chunks = chunkText(input.script);
  const weights = chunks.map((chunk) => Math.max(1, chunk.length));
  const weightTotal = Math.max(1, weights.reduce((a, b) => a + b, 0));
  let cursor = 0;
  const cues: SceneCue[] = chunks.map((chunk, index) => {
    const segment = duration * (weights[index] / weightTotal);
    const start = cursor;
    const end = index === chunks.length - 1 ? duration : Math.min(duration, cursor + segment);
    cursor = end;
    return { start, end, text: chunk };
  });

  const srt = cues.map((cue, index) =>
    String(index + 1) + "\n" + formatSrtTime(cue.start) + " --> " + formatSrtTime(cue.end) + "\n" + cue.text + "\n",
  ).join("\n");
  await fs.writeFile(srtPath, srt, "utf8");

  const subtitleFile = subtitlePathForFfmpeg(srtPath);
  const videoFilter =
    "drawbox=x=0:y=0:w=iw:h=ih:color=0x0b1020@1:t=fill," +
    "drawbox=x=(iw-520)/2+sin(t*0.7)*220:y=90:w=520:h=8:color=0x6f8cff@0.9:t=fill," +
    "drawbox=x=(iw-220)/2+cos(t*0.45)*360:y=ih-140:w=220:h=12:color=0x4fe0aa@0.85:t=fill," +
    "subtitles='" + subtitleFile + "':force_style='FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101620,Outline=2,Shadow=1,Alignment=2,MarginV=54'";

  await run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=0x0b1020:s=1280x720:r=30",
    "-i", audioPath,
    "-vf", videoFilter,
    "-t", duration.toFixed(3),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "160k",
    "-shortest",
    "-movflags", "+faststart",
    videoPath,
  ]);

  await run("ffmpeg", ["-y", "-ss", "0", "-i", videoPath, "-frames:v", "1", "-q:v", "2", thumbnailPath]);

  const manifest = {
    projectId: input.projectId,
    title: input.title,
    model: input.model ?? null,
    generatedAt: new Date().toISOString(),
    type: "local-captioned-video",
    durationSeconds: Number(duration.toFixed(3)),
    scenes: cues.length,
    note: "Video rendered locally from the ChatGPT-generated script. Visuals are synthetic motion graphics; no external AI image/video/TTS provider was used.",
    files: {
      script: "script.txt",
      director: "director-scene-plan.txt",
      narration: "narration.wav",
      subtitles: "subtitles.srt",
      video: "final.mp4",
      thumbnail: "thumbnail.jpg",
    },
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await fs.rm(ps1Path, { force: true }).catch(() => undefined);

  const publicBase = "/generated/" + projectSlug;
  return {
    videoUrl: publicBase + "/final.mp4",
    thumbnailUrl: publicBase + "/thumbnail.jpg",
    manifestUrl: publicBase + "/manifest.json",
    durationSeconds: Number(duration.toFixed(3)),
    scenes: cues.length,
  };
}
