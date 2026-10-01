import { NextResponse } from "next/server";
import { generateWithCloudflareImage } from "../../../../lib/cloudflare-image";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const prompt =
      typeof body?.prompt === "string" && body.prompt.trim()
        ? body.prompt.trim()
        : "A cinematic realistic deep-ocean submarine scene with dramatic volumetric lighting, detailed water particles, and a wide 16:9 composition.";

    const result = await generateWithCloudflareImage({
      prompt,
      width: 1024,
      height: 576,
      numSteps: 4,
    });

    return NextResponse.json({
      ok: true,
      stage: "image_generation",
      provider: "Cloudflare Workers AI",
      model: result.model,
      mimeType: result.mimeType,
      imageBase64: result.imageBase64,
      message: "Cloudflare image generation succeeded.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Cloudflare image error.";
    const missing = message.includes("CLOUDFLARE_ACCOUNT_ID") || message.includes("CLOUDFLARE_API_TOKEN");

    return NextResponse.json(
      {
        ok: false,
        code: missing ? "cloudflare_credentials_missing" : "cloudflare_image_test_exception",
        error: message,
      },
      { status: missing ? 503 : 500 },
    );
  }
}
