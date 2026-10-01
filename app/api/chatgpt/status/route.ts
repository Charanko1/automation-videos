import { NextResponse } from "next/server";
import { hasPlanScope, readCredential } from "../../../../lib/chatgpt-auth";

export async function GET() {
  try {
    const credential = await readCredential();
    if (!credential) return NextResponse.json({ connected: false, planUsageEnabled: false });

    return NextResponse.json({
      connected: true,
      planUsageEnabled: hasPlanScope(credential.scopes),
      email: credential.email ?? null,
      name: credential.name ?? null,
      expiresAt: credential.expiresAt,
      scopes: credential.scopes,
    });
  } catch (error) {
    return NextResponse.json({ connected: false, planUsageEnabled: false, error: error instanceof Error ? error.message : "Unavailable" }, { status: 400 });
  }
}
