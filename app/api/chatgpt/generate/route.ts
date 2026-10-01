import { NextResponse } from "next/server";
import { hasPlanScope, readCredential } from "../../../../lib/chatgpt-auth";

const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const MODELS_ENDPOINT = "https://api.openai.com/v1/models";

type ModelItem = {
  slug?: string;
  display_name?: string;
  visibility?: string;
};

export async function POST(request: Request) {
  try {
    const credential = await readCredential();

    if (!credential) {
      return NextResponse.json({ ok: false, error: "Connect ChatGPT first." }, { status: 401 });
    }

    if (!hasPlanScope(credential.scopes)) {
      return NextResponse.json(
        {
          ok: false,
          code: "chatgpt_plan_scope_missing",
          error: "The account signed in, but did not grant ChatGPT plan usage.",
        },
        { status: 403 },
      );
    }

    if (credential.expiresAt <= Date.now() + 30_000) {
      return NextResponse.json(
        { ok: false, code: "chatgpt_token_expired", error: "Access token expired. Sign in with ChatGPT again." },
        { status: 401 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return NextResponse.json({ ok: false, error: "Prompt is required." }, { status: 400 });
    }

    const modelsResponse = await fetch(MODELS_ENDPOINT, {
      headers: { Authorization: `Bearer ${credential.accessToken}` },
      cache: "no-store",
    });
    const modelsData = await modelsResponse.json().catch(() => ({}));

    if (!modelsResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          stage: "models",
          status: modelsResponse.status,
          error: modelsData?.error?.message ?? modelsData?.detail ?? "Unable to read the ChatGPT model catalog.",
          code: modelsData?.error?.code ?? null,
        },
        { status: modelsResponse.status },
      );
    }

    const model = Array.isArray(modelsData?.models)
      ? (modelsData.models as ModelItem[]).find((item) => item?.visibility === "list" && typeof item.slug === "string")
      : null;

    if (!model?.slug) {
      return NextResponse.json(
        { ok: false, stage: "models", error: "No displayable model was returned for this ChatGPT account." },
        { status: 502 },
      );
    }

    const response = await fetch(RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.slug,
        input: [
          {
            role: "user",
            content: prompt,
          },
        ],
        store: false,
        stream: true,
      }),
      cache: "no-store",
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      return NextResponse.json(
        {
          ok: false,
          stage: "inference",
          status: response.status,
          error: data?.error?.message ?? data?.detail ?? "ChatGPT plan inference was rejected.",
          code: data?.error?.code ?? null,
        },
        { status: response.status || 502 },
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let completed = false;
    let failedCode: string | null = null;
    let failedMessage: string | null = null;

    const consumeBlock = (block: string) => {
      const lines = block.split(/\r?\n/);
      let eventType = "";
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith("event:")) eventType = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }

      if (!dataLines.length) return;

      const raw = dataLines.join("\n");
      if (raw === "[DONE]") return;

      let data: any;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }

      const type = eventType || data?.type;

      if (type === "response.output_text.delta") {
        if (typeof data.delta === "string") text += data.delta;
      } else if (type === "response.completed") {
        completed = true;
      } else if (type === "response.failed") {
        failedCode = data?.response?.error?.code ?? data?.error?.code ?? "response_failed";
        failedMessage = data?.response?.error?.message ?? data?.error?.message ?? "ChatGPT response failed.";
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const match = /\r?\n\r?\n/.exec(buffer);
        if (!match || match.index === undefined) break;

        const block = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        consumeBlock(block);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) consumeBlock(buffer);

    if (failedCode) {
      return NextResponse.json(
        {
          ok: false,
          stage: "inference",
          code: failedCode,
          error: failedMessage,
          model: model.slug,
        },
        { status: 502 },
      );
    }

    if (!completed) {
      return NextResponse.json(
        {
          ok: false,
          stage: "inference",
          code: "response_not_completed",
          error: "The stream ended before response.completed.",
          model: model.slug,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      stage: "inference",
      model: model.slug,
      displayName: model.display_name ?? model.slug,
      text,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
