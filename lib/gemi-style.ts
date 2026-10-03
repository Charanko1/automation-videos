export const KIDS_SHORTS_STYLE_LOCK = [
  "BRIGHT, CHEERFUL 3D ANIMATED CARTOON FOR TODDLERS AND KIDS AGES 2-7.",
  "Modern preschool YouTube animation, soft high-end family-friendly 3D animated-film look.",
  "Chubby rounded characters with big expressive eyes, big smiles, simple appealing shapes.",
  "Saturated pastel colors, soft even daylight, clean uncluttered background, high contrast so the subject pops on a phone screen.",
  "Gentle camera movement, slow pacing, bouncy playful character motion.",
  "Vertical 9:16. Subject centered. Keep the bottom 20% of the frame visually empty for subtitles.",
  "One simple visible action and one location per scene.",
  "No text, no letters, no watermark, no subtitles inside the generated image.",
].join("\n");

export const KIDS_SHORTS_CHARACTER_LOCK = [
  "MAIN CHARACTER: Bimo, a 5-year-old Indonesian boy.",
  "Round face, short black hair, big brown eyes, red t-shirt, blue shorts, yellow sneakers.",
  "Always preserve exactly the same face, hairstyle, outfit, colors, body proportions, and age in every scene.",
  "Bimo should look adorable, friendly, energetic, innocent, and expressive.",
].join("\n");

export const KIDS_SHORTS_NEGATIVE_PROMPT = [
  "dark",
  "scary",
  "horror",
  "moody lighting",
  "dramatic shadows",
  "photorealistic",
  "realistic human",
  "crowded scene",
  "multiple rooms",
  "crying",
  "violence",
  "adult themes",
  "text",
  "letters",
  "subtitles",
  "watermark",
  "distorted hands",
  "extra fingers",
  "blurry",
  "inconsistent character",
  "static portrait",
  "passport photo",
  "stiff mannequin pose",
  "standing straight",
  "arms at sides",
  "emotionless face",
  "complex background",
  "extra characters",
].join(", ");

export const GEMI_VISUAL_PROFILE = [
  "GEMI VISUAL PROFILE — 3D CHARACTER & SCENE ARTIST",
  KIDS_SHORTS_STYLE_LOCK,
  KIDS_SHORTS_CHARACTER_LOCK,
  "Character design: rounded toy-like proportions, oversized readable heads, soft cheeks, large expressive eyes, friendly smiles, clean silhouettes.",
  "Materials: smooth polished 3D surfaces, soft fabric, clean toy-like details, gentle shading, no gritty texture.",
  "Color direction: cheerful pastel palette with saturated accents, warm highlights, gentle contrast, no gloomy atmosphere.",
  "Lighting: soft even daylight, gentle fill, subtle rim light, soft depth of field, bright family-friendly mood.",
  "World design: simple charming preschool environments with a few clear props and no visual clutter.",
  "Acting: dynamic animation keyframes, bouncy playful poses, clear weight shifts, bent joints, asymmetrical silhouettes, readable gestures, expressive faces.",
  "Motion-first staging: freeze a moment during a simple action, not a posed portrait.",
  "Expression-first posing: face, torso, arms, hands, and gaze must communicate the same emotion.",
  "Framing: vertical 9:16, centered subject, phone-readable faces, bottom 20% empty.",
  "Continuity lock: preserve every recurring character's face, hair, outfit, colors, proportions, accessories, and identity across all scenes.",
].join("\n");

export const GEMI_NEGATIVE_PROFILE = KIDS_SHORTS_NEGATIVE_PROMPT;