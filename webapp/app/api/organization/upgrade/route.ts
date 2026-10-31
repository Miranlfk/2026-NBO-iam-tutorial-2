import { NextRequest, NextResponse } from "next/server";
import { requireScope } from "../../../lib/auth/guard";
import { Scope, Tier } from "../../../lib/auth/utils";
import { getOrgTier, upsertOrgTier } from "../../../lib/db/queries/org-tiers";
import { shareApplicationRoles, removeApplicationRoles, scimFetchRoleIdByName, scimAssignRoleToUser } from "../../../lib/asgardeo/client";
import { publicConfig } from "../../../lib/config/public";
import { logger } from "../../../lib/logging/logger";
import { logRequestActor } from "../../../lib/auth/log";

const routeLogger = logger.child({ route: "organization/upgrade" });

const clientSecret = process.env.CLIENT_SECRET ?? "";
const applicationId = process.env.APP_ID ?? "";
const appDisplayName = process.env.APP_DISPLAY_NAME ?? "Wayfinder";
const appSharingScopes = process.env.APP_SHARING_SCOPES ?? "internal_application_mgt_update";

function getRolesForTier(tier: Tier): string[] {
  const { basicBrandingEditor, advancedBrandingEditor, idpManager } = publicConfig().roleNames;
  if (tier === Tier.BASIC) return [basicBrandingEditor];
  if (tier === Tier.ADVANCED) return [basicBrandingEditor, advancedBrandingEditor, idpManager];
  return [];
}

async function assignRolesToAdmin(accessToken: string, adminId: string, roles: string[]): Promise<void> {
  await Promise.all(
    roles.map(async (roleName) => {
      const roleId = await scimFetchRoleIdByName(accessToken, roleName);
      if (roleId) {
        await scimAssignRoleToUser(accessToken, roleId, adminId);
      } else {
        routeLogger.warn({ roleName }, "Role not found in organization; skipping assignment");
      }
    })
  );
}

async function getRootToken(): Promise<string> {
  const { baseUrl } = publicConfig();
  const clientId = process.env.CLIENT_ID || publicConfig().clientId;
  const response = await fetch(`${baseUrl}/oauth2/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "client_credentials", scope: appSharingScopes }),
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const json = await response.json().catch(() => ({})) as { access_token?: string; error_description?: string };

  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description ?? "Failed to get management token for application sharing.");
  }

  return json.access_token;
}

export async function GET(request: NextRequest) {
  logRequestActor("organization/upgrade", request);
  const auth = await requireScope(request, [Scope.UPGRADE_VIEW]);
  if (auth instanceof NextResponse) return auth;

  const { orgId } = auth.claims;
  const record = getOrgTier(orgId);

  return NextResponse.json({ tier: (record?.tier ?? Tier.FREE) as Tier });
}

export async function POST(request: NextRequest) {
  logRequestActor("organization/upgrade", request);
  const auth = await requireScope(request, [Scope.UPGRADE_CREATE]);
  if (auth instanceof NextResponse) return auth;

  const { orgId, sub: adminId } = auth.claims;

  let tier: Tier;
  try {
    const body = await request.json() as { tier?: string };
    if (body.tier !== Tier.BASIC && body.tier !== Tier.ADVANCED) {
      return NextResponse.json({ error: "Invalid tier. Must be BASIC or ADVANCED." }, { status: 422 });
    }
    tier = body.tier as Tier;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const roles = getRolesForTier(tier);

  if (applicationId) {
    try {
      const rootToken = await getRootToken();
      if (roles.length > 0) {
        await shareApplicationRoles(rootToken, orgId, roles, applicationId, appDisplayName);
      }
    } catch (err) {
      routeLogger.error({ err, orgId, tier }, "Application role sharing failed");
      return NextResponse.json(
        { error: "Upgrade failed. Please check your configuration and try again." },
        { status: 500 }
      );
    }
  } else {
    routeLogger.warn("APP_ID is not configured; skipping application role sharing");
  }

  if (adminId && roles.length > 0) {
    const accessToken = request.headers.get("authorization")!.slice(7);
    try {
      await assignRolesToAdmin(accessToken, adminId, roles);
    } catch (err) {
      routeLogger.error({ err, adminId, orgId, tier }, "Admin role assignment failed");
    }
  }

  upsertOrgTier(orgId, tier);

  return NextResponse.json({ tier }, { status: 202 });
}

export async function PUT(request: NextRequest) {
  logRequestActor("organization/upgrade", request);
  const auth = await requireScope(request, [Scope.UPGRADE_UPDATE]);
  if (auth instanceof NextResponse) return auth;

  const { orgId, sub: adminId } = auth.claims;

  let tier: Tier;
  try {
    const body = await request.json() as { tier?: string };
    if (body.tier !== Tier.BASIC && body.tier !== Tier.ADVANCED) {
      return NextResponse.json({ error: "Invalid tier. Must be BASIC or ADVANCED." }, { status: 422 });
    }
    tier = body.tier as Tier;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const roles = getRolesForTier(tier);

  if (applicationId) {
    try {
      const rootToken = await getRootToken();
      if (roles.length > 0) {
        await shareApplicationRoles(rootToken, orgId, roles, applicationId, appDisplayName);
      }
    } catch (err) {
      routeLogger.error({ err, orgId, tier }, "Application role sharing failed");
      return NextResponse.json(
        { error: "Upgrade failed. Please check your configuration and try again." },
        { status: 500 }
      );
    }
  }

  if (adminId && roles.length > 0) {
    const accessToken = request.headers.get("authorization")!.slice(7);
    try {
      await assignRolesToAdmin(accessToken, adminId, roles);
    } catch (err) {
      routeLogger.error({ err, adminId, orgId, tier }, "Admin role assignment failed");
    }
  }

  upsertOrgTier(orgId, tier);

  return NextResponse.json({ tier }, { status: 202 });
}

export async function DELETE(request: NextRequest) {
  logRequestActor("organization/upgrade", request);
  const auth = await requireScope(request, [Scope.UPGRADE_DELETE]);
  if (auth instanceof NextResponse) return auth;

  const { orgId } = auth.claims;

  if (applicationId) {
    try {
      const rootToken = await getRootToken();
      const { basicBrandingEditor, advancedBrandingEditor, idpManager } = publicConfig().roleNames;
      const allRoles = [basicBrandingEditor, advancedBrandingEditor, idpManager];
      await removeApplicationRoles(rootToken, orgId, allRoles, applicationId, appDisplayName);
    } catch (err) {
      routeLogger.error({ err, orgId }, "Application role removal failed");
      return NextResponse.json(
        { error: "Downgrade failed. Please check your configuration and try again." },
        { status: 500 }
      );
    }
  } else {
    routeLogger.warn("APP_ID is not configured; skipping application role removal");
  }

  upsertOrgTier(orgId, Tier.FREE);

  return NextResponse.json({ tier: Tier.FREE });
}
