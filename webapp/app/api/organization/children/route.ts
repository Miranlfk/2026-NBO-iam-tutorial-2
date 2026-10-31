import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "../../../lib/auth/guard";
import { Scope } from "../../../lib/auth/utils";
import {
  brandingGetPublic,
  brandingOverrides,
  orgCreateChild,
  orgListChildren,
} from "../../../lib/asgardeo/client";
import { brandingOrgId, type BrandingSource } from "../../../lib/asgardeo/branding-inheritance";
import { publicConfig } from "../../../lib/config/public";
import { logger } from "../../../lib/logging/logger";
import { logRequestActor } from "../../../lib/auth/log";

const routeLogger = logger.child({ route: "organization/children" });

// Child workspaces: sub-organizations of the signed-in user's workspace, through the organization-level
// Organization Management API with the user's own (workspace) token.

export async function GET(request: NextRequest) {
  logRequestActor("organization/children", request);
  const auth = await requireScope(request, [Scope.ORG_VIEW]);
  if (auth instanceof NextResponse) return auth;

  const { orgId } = auth.claims;
  const accessToken = request.headers.get("authorization")!.slice(7);

  try {
    const children = await orgListChildren(accessToken);

    // A child without a preference of its own uses this workspace's effective branding. Branding is informative
    // here: a lookup that fails leaves branding null instead of failing the list.
    const [workspaceBranding, ...ownBrandings] = await Promise.allSettled([
      brandingGetPublic(brandingOrgId(orgId), true),
      ...children.map((child) => brandingGetPublic(child.id, false)),
    ]);

    const organizations = children.map((child, i) => {
      const own = ownBrandings[i];

      if (workspaceBranding.status === "rejected" || own.status === "rejected") {
        const reason = workspaceBranding.status === "rejected" ? workspaceBranding.reason : (own as PromiseRejectedResult).reason;
        routeLogger.warn({ err: reason, childId: child.id }, "Branding lookup failed for child workspace");
        return { ...child, branding: null };
      }

      const source: BrandingSource = own.value ? "own" : workspaceBranding.value ? "inherited" : "default";
      const overrides = own.value ? brandingOverrides(own.value, workspaceBranding.value) : [];
      return { ...child, branding: { overrides, source } };
    });

    return NextResponse.json({ organizations });
  } catch (err) {
    routeLogger.error({ err, orgId }, "Failed to list child workspaces");
    const message = err instanceof Error ? err.message : "Failed to list child workspaces.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  logRequestActor("organization/children", request);
  const auth = await requireScope(request, [Scope.ORG_CREATE]);
  if (auth instanceof NextResponse) return auth;

  let body: { name?: unknown; orgHandle?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const orgHandle = typeof body.orgHandle === "string" ? body.orgHandle.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "name is required." }, { status: 422 });
  }

  if (publicConfig().organizationHandleSupported && !orgHandle) {
    return NextResponse.json({ error: "orgHandle is required." }, { status: 422 });
  }

  const { orgId } = auth.claims;
  const accessToken = request.headers.get("authorization")!.slice(7);

  try {
    const organization = await orgCreateChild(accessToken, {
      name,
      parentId: orgId,
      orgHandle: publicConfig().organizationHandleSupported ? orgHandle : undefined,
    });
    return NextResponse.json({ organization: { ...organization, branding: null } }, { status: 201 });
  } catch (err) {
    routeLogger.error({ err, orgId, name }, "Failed to create child workspace");
    const message = err instanceof Error ? err.message : "Failed to create child workspace.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
