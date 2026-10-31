import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "../../../../lib/auth/guard";
import { getBrandingInheritance } from "../../../../lib/asgardeo/branding-inheritance";
import { logger } from "../../../../lib/logging/logger";
import { logRequestActor } from "../../../../lib/auth/log";

const routeLogger = logger.child({ route: "organization/branding/inheritance" });

/** Whether the workspace's sign-in branding is its own or its parent's, and which fields override the parent. */
export async function GET(request: NextRequest) {
  logRequestActor("organization/branding/inheritance", request);
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { orgId } = auth.claims;

  try {
    return NextResponse.json(await getBrandingInheritance(orgId));
  } catch (err) {
    routeLogger.error({ err, orgId }, "Failed to resolve branding inheritance");
    const message = err instanceof Error ? err.message : "Failed to resolve branding inheritance.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
