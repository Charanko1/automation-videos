import { NextResponse } from "next/server";
import { hasPlanScope, readCredential } from "../../../../lib/chatgpt-auth";

const MODELS_ENDPOINT = "https://api.openai.com/v1/models";
const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

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
      return NextResponse.json({
        ok: false,
        code: "chatgpt_plan_scope_missing",
        error: "The account is connected, but ChatGPT plan usage permission was not granted.",
      }, { status: 403 });
    }

    if (credential.expiresAt <= Date.now() + 30_000) {
      return NextResponse.json({
        ok: false,
        code: "chatgpt_token_expired",
        error: "ChatGPT access token is expired. Sign in with ChatGPT again.",
      }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const prompt =
      typeof body?.prompt === "string" && body.prompt.trim()
        ? body.prompt.trim()
        : "Generate a single cinematic image of a futuristic office at night, realistic lighting, detailed environment, 16:9.";

    const modelsResponse = await fetch(MODELS_ENDPOINT, {
      headers: { Authorization: "Bearer " + credential.accessToken },
      cache: "no-store",
    });
    const modelsData = await modelsResponse.json().catch(() => ({}));

    if (!modelsResponse.ok) {
      return NextResponse.json({
        ok: false,
        stage: "models",
        status: modelsResponse.status,
        code: modelsData?.error?.code ?? null,
        error: modelsData?.error?.message ?? modelsData?.detail ?? "Unable to read the ChatGPT model catalog.",
      }, { status: modelsResponse.status });
    }

    const model = Array.isArray(modelsData?.models)
      ? (modelsData.models as ModelItem[]).find(
          (item) => item?.visibility === "list" && typeof item.slug === "string",
        )
      : null;

    if (!model?.slug) {
      return NextResponse.json({
        ok: false,
        stage: "models",
        error: "No displayable ChatGPT model was returned for this account.",
      }, { status: 502 });
    }

    const response = await fetch(RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + credential.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.slug,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
        tools: [
          {
            type: "image_generation",
            model: "gpt-image-2.5-flare",
            action: "generate",
          },
        ],
        tool_choice: { type: "image_generation" },
        store: false,
        stream: true,
      }),
      cache: "no-store",
    });

    const raw = await response.text();

    if (!response.ok) {
      let data: any = {};
      try {
        data = JSON.parse(raw);
      } catch {
        const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
        if (dataLine) {
          try {
            data = JSON.parse(dataLine.slice(6));
          } catch {}
        }
      }

      return NextResponse.json({
        ok: false,
        stage: "image_generation",
        status: response.status,
        code: data?.error?.code ?? data?.code ?? null,
        error: data?.error?.message ?? data?.message ?? raw.slice(0, 1000) ?? "The ChatGPT plan rejected image generation through this integration.",
      }, { status: response.status });
    }

    let imageBase64 = "";
    let streamError: string | null = null;

    for (const block of raw.split(/\r?\n\r?\n/)) {
      const dataLine = block
        .split(/\r?\n/)
        .find((line) => line.startsWith("data: "));
      if (!dataLine) continue;

      const payload = dataLine.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const event = JSON.parse(payload);

        if (event?.type === "response.output_item.done") {
          const item = event?.item;
          if (item?.type === "image_generation_call" && typeof item?.result === "string") {
            imageBase64 = item.result;
          }
        }

        if (event?.type === "response.completed") {
          const output = event?.response?.output;
          if (Array.isArray(output)) {
            const imageCall = output.find(
              (item: { type?: string; result?: string }) =>
                item?.type === "image_generation_call" && typeof item?.result === "string",
            );
            if (imageCall?.result) imageBase64 = imageCall.result;
          }
        }

        if (event?.type === "error" || event?.type === "response.failed") {
          streamError =
            event?.error?.message ??
            event?.response?.error?.message ??
            "The image generation stream failed.";
        }
      } catch {
        // Ignore non-JSON SSE frames.
      }
    }

    if (!imageBase64) {
      return NextResponse.json({
        ok: false,
        stage: "image_generation",
        code: streamError ? "image_generation_stream_error" : "image_generation_no_result",
        error: streamError ?? "The request streamed successfully, but no image_generation_call result was returned.",
        model: model.slug,
      }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      stage: "image_generation",
      model: model.slug,
      displayName: model.display_name ?? model.slug,
      imageBase64,
      message: "Image generation succeeded through the ChatGPT plan token.",
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      stage: "image_generation",
      error: error instanceof Error ? error.message : "Unknown image generation error.",
    }, { status: 500 });
  }
}
