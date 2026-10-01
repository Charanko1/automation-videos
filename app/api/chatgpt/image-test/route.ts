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
      headers: { Authorization: \`Bearer \__ACCESS_TOKEN__\` },
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
        Authorization: \`Bearer \__ACCESS_TOKEN__\`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.slug,
        input: prompt,
        tools: [
          {
            type: "image_generation",
            model: "gpt-image-2.5-flare",
            action: "generate",
          },
        ],
        tool_choice: { type: "image_generation" },
        store: false,
        stream: false,
      }),
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        stage: "image_generation",
        status: response.status,
        code: data?.error?.code ?? null,
        error: data?.error?.message ?? data?.detail ?? "The ChatGPT plan rejected image generation through this integration.",
      }, { status: response.status });
    }

    const imageCall = Array.isArray(data?.output)
      ? data.output.find((item: { type?: string; result?: string; status?: string }) =>
          item?.type === "image_generation_call" && typeof item?.result === "string"
        )
      : null;

    if (!imageCall?.result) {
      return NextResponse.json({
        ok: false,
        stage: "image_generation",
        code: "image_generation_no_result",
        error: "The request succeeded, but no image_generation_call result was returned.",
        model: model.slug,
      }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      stage: "image_generation",
      model: model.slug,
      displayName: model.display_name ?? model.slug,
      imageBase64: imageCall.result,
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
