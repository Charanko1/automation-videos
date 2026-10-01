import { NextResponse } from "next/server";
import { generateWithChatGPT } from "../../../../lib/chatgpt";

const MAX_TITLE = 200;

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { ok: false, error: "AI Office pipeline is currently local-development only." },
      { status: 400 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, MAX_TITLE) : "";
    const type = typeof body?.type === "string" ? body.type.trim().slice(0, 80) : "General";

    if (!title) {
      return NextResponse.json({ ok: false, error: "Project title is required." }, { status: 400 });
    }

    const research = await generateWithChatGPT(
      [
        "You are Rhea, the Researcher in an AI YouTube production office.",
        `Project title: ${title}`,
        `Format: ${type}`,
        "",
        "Research the topic for a factual YouTube production brief.",
        "Return:",
        "1. A concise topic thesis.",
        "2. Five key facts or claims to cover.",
        "3. Important context and definitions.",
        "4. Three claims that should be fact-checked before publishing.",
        "5. A suggested audience angle.",
        "Keep the result structured and practical. Do not invent citations or claim to browse the web.",
      ].join("\n"),
    );

    const script = await generateWithChatGPT(
      [
        "You are Wri, the Scriptwriter in an AI YouTube production office.",
        `Project title: ${title}`,
        `Format: ${type}`,
        "",
        "Use the research brief below to write a YouTube script.",
        "Requirements:",
        "- Strong 15-30 second hook.",
        "- Clear narration with short paragraphs.",
        "- Natural transitions.",
        "- No fabricated sources, quotes, statistics, or events.",
        "- Mark any statement that needs fact-checking as [VERIFY].",
        "- End with a concise takeaway and call to action.",
        "",
        "RESEARCH BRIEF:",
        research.text,
      ].join("\n"),
    );

    const director = await generateWithChatGPT(
      [
        "You are Dira, the Director in an AI YouTube production office.",
        `Project title: ${title}`,
        `Format: ${type}`,
        "",
        "Turn the script into a production-ready scene plan.",
        "Return 8-12 numbered scenes.",
        "For each scene provide:",
        "- Purpose",
        "- Narration excerpt",
        "- Visual direction",
        "- Camera / motion direction",
        "- On-screen text",
        "- Asset requirement",
        "Keep visual instructions concrete enough for a later media renderer. Do not claim that ChatGPT generated the media itself.",
        "",
        "SCRIPT:",
        script.text,
      ].join("\n"),
    );

    return NextResponse.json({
      ok: true,
      model: director.model,
      displayName: director.displayName,
      stages: {
        research: research.text,
        script: script.text,
        director: director.text,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "AI pipeline failed.",
      },
      { status: 502 },
    );
  }
}
