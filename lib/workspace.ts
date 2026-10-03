export type ProjectStatus = "DRAFT" | "PRODUCING" | "COMPLETED";
export type AIPipelinePhase = "IDLE" | "RESEARCH" | "SCRIPT" | "DIRECTOR" | "IMAGES" | "COMPLETED" | "FAILED";

export type AIRender = {
  status: "IDLE" | "RENDERING" | "READY" | "FAILED";
  videoUrl?: string;
  thumbnailUrl?: string;
  generatedAt?: string;
  error?: string;
};

export type AIProductionDialogue = {
  speaker: string;
  characterId?: string;
  line: string;
  emotion?: string;
};

export type AIProductionScene = {
  sceneId: string;
  purpose?: string;
  narrationExcerpt?: string;
  dialogue?: AIProductionDialogue[];
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

export type AIImageAsset = {
  sceneId: string;
  assetUrl: string;
  model?: string;
  narrationExcerpt?: string;
  generatedAt: string;
};

export type AIProduction = {
  phase: AIPipelinePhase;
  pipelineVersion?: "drama-v2";
  textProvider?: "ChatGPT plan" | "OmniRoute";
  research?: string;
  script?: string;
  director?: string;
  characterBible?: string;
  scenePlans?: AIProductionScene[];
  imageAssets?: AIImageAsset[];
  model?: string;
  render?: AIRender;
  error?: string;
  updatedAt?: string;
};

export type Project = {
  id: string;
  title: string;
  type: string;
  totalScenes: number;
  currentScene: number;
  status: ProjectStatus;
  ai?: AIProduction;
  createdAt: string;
  updatedAt: string;
};

export type ProductionSettings = {
  dailyCeiling: number;
  targetVideos: number;
  scenesPerVideo: number;
  maxBreaks: number;
};

export type Workspace = {
  projects: Project[];
  activeProjectId: string | null;
  settings: ProductionSettings;
};

export const WORKSPACE_STORAGE_KEY = "ai-office.workspace.v1";

export const DEFAULT_SETTINGS: ProductionSettings = {
  dailyCeiling: 30000,
  targetVideos: 2,
  scenesPerVideo: 6,
  maxBreaks: 2,
};

export const EMPTY_WORKSPACE: Workspace = {
  projects: [],
  activeProjectId: null,
  settings: DEFAULT_SETTINGS,
};

export function readWorkspace(): Workspace {
  if (typeof window === "undefined") return EMPTY_WORKSPACE;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return EMPTY_WORKSPACE;
    const parsed = JSON.parse(raw) as Partial<Workspace>;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      activeProjectId: typeof parsed.activeProjectId === "string" ? parsed.activeProjectId : null,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
    };
  } catch {
    return EMPTY_WORKSPACE;
  }
}

export function writeWorkspace(workspace: Workspace) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
}

export function createProject(title: string, type: string, totalScenes: number): Project {
  const now = new Date().toISOString();
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `project-${Date.now()}`,
    title: title.trim(),
    type: type.trim() || "General",
    totalScenes,
    currentScene: 0,
    status: "DRAFT",
    ai: { phase: "IDLE", updatedAt: now },
    createdAt: now,
    updatedAt: now,
  };
}
