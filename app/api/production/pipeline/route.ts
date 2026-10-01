import { NextResponse } from "next/server";
import { generateWithChatGPT } from "../../../../lib/chatgpt";

type Stage = "research" | "script" | "director";

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
        "Turn the script into a production-ready scene plan.",
        "Return 8-12 numbered scenes.",
        "For each scene provide:",
        "- Purpose",
        "- Narration excerpt",
        "- Visual direction",
        "- Camera / motion direction",
        "- On-screen text",
        "- Asset requirement",
        "Keep visual instructions concrete for a later media renderer.",
        "Do not claim that ChatGPT generated any image, audio, or video asset.",
        "",
        "SCRIPT:",
        script,
      ].join("\n");
    }

    const result = await generateWithChatGPT(prompt);

    return NextResponse.json({
      ok: true,
      stage,
      model: result.model,
      displayName: result.displayName,
      text: result.text,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, stage: (await request.clone().json().catch(() => ({})))?.stage ?? null, error: error instanceof Error ? error.message : "AI pipeline failed." },
      { status: 502 },
    );
  }
}
