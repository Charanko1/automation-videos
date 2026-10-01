import { NextResponse } from "next/server";
import { hasPlanScope, readCredential } from "../../../../lib/chatgpt-auth";

export async function POST() {
  try {
    const credential = await readCredential();
    if (!credential) return NextResponse.json({ ok: false, error: "Connect ChatGPT first." }, { status: 401 });
    if (!hasPlanScope(credential.scopes)) {
      return NextResponse.json({
        ok: false,
        code: "chatgpt_plan_scope_missing",
        error: "Your ChatGPT account signed in, but did not grant chatgpt.tokens.use.direct.",
      }, { status: 403 });
    }

    if (credential.expiresAt <= Date.now() + 30_000) {
      return NextResponse.json({ ok: false, error: "Access token expired. Sign in with ChatGPT again." }, { status: 401 });
    }

    const modelsResponse = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${credential.accessToken}` },
      cache: "no-store",
    });
    const modelsJson = await modelsResponse.json().catch(() => ({}));

    if (!modelsResponse.ok) {
      return NextResponse.json({
        ok: false,
        stage: "models",
        status: modelsResponse.status,
        error: modelsJson?.error?.message ?? modelsJson?.detail ?? "Model catalog request failed.",
        code: modelsJson?.error?.code ?? null,
      }, { status: modelsResponse.status });
    }

    const model = Array.isArray(modelsJson.models)
      ? modelsJson.models.find((item: { visibility?: string }) => item?.visibility === "list")?.slug
      : null;

    if (!model) {
      return NextResponse.json({ ok: false, error: "No displayable model was returned for this ChatGPT account." }, { status: 502 });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: "Reply with exactly: AI Office connected." }],
        store: false,
        stream: false,
      }),
      cache: "no-store",
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        stage: "inference",
        status: response.status,
        error: json?.error?.message ?? json?.detail ?? "Responses API request failed.",
        code: json?.error?.code ?? null,
      }, { status: response.status });
    }

    return NextResponse.json({
      ok: true,
      model,
      output: json?.output_text ?? "Connected, but no output_text was returned.",
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
