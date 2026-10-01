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
        error: "The account signed in, but did not grant ChatGPT plan usage.",
      }, { status: 403 });
    }

    if (credential.expiresAt <= Date.now() + 30_000) {
      return NextResponse.json({ ok: false, error: "Access token expired. Sign in with ChatGPT again." }, { status: 401 });
    }

    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${credential.accessToken}` },
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        stage: "models",
        status: response.status,
        error: data?.error?.message ?? data?.detail ?? "ChatGPT plan connection was rejected.",
        code: data?.error?.code ?? null,
      }, { status: response.status });
    }

    const visible = Array.isArray(data.models)
      ? data.models.filter((item: { visibility?: string }) => item?.visibility === "list")
      : [];

    return NextResponse.json({
      ok: true,
      stage: "plan_connection",
      message: "ChatGPT plan token is accepted.",
      models: visible.slice(0, 10).map((item: { slug?: string; display_name?: string }) => ({
        slug: item.slug,
        displayName: item.display_name,
      })),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
