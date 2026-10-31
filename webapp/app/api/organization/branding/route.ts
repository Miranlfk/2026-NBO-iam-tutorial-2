import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireScope } from "../../../lib/auth/guard";
import { Scope } from "../../../lib/auth/utils";
import { getBranding, upsertBranding, deleteBranding } from "../../../lib/db/queries/branding";
import {
  brandingCreate,
  brandingUpdate,
  brandingDelete,
  type BrandingConfig,
} from "../../../lib/asgardeo/client";
import { getOrgM2MToken } from "../../../lib/asgardeo/m2m";
import { getParentBranding } from "../../../lib/asgardeo/branding-inheritance";
import { logger } from "../../../lib/logging/logger";
import { logRequestActor } from "../../../lib/auth/log";

const routeLogger = logger.child({ route: "organization/branding" });

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

const getBrandingToken = (orgId: string) => getOrgM2MToken(orgId, "internal_org_branding_preference_update");

// Asgardeo uses the nearest branding preference whole: once a workspace saves its own, nothing comes from its
// parent any more. So the logo and favicon a workspace leaves empty are copied from the parent's effective
// branding when it saves (a copy at save time, not a live link): the sign-in page keeps the parent's logo while
// the workspace overrides, for example, the colors.
async function withParentImages(orgId: string, config: BrandingConfig): Promise<BrandingConfig> {
  if (config.logoUrl && config.faviconUrl) return config;

  try {
    const { branding } = await getParentBranding(orgId);
    return {
      ...config,
      logoUrl: config.logoUrl || branding?.logoUrl || "",
      faviconUrl: config.faviconUrl || branding?.faviconUrl || "",
    };
  } catch (err) {
    routeLogger.warn({ err, orgId }, "Parent branding lookup failed; saving without inherited images");
    return config;
  }
}

function recordToConfig(record: NonNullable<ReturnType<typeof getBranding>>): BrandingConfig {
  return {
    primaryColor: record.primary_color,
    secondaryColor: record.secondary_color,
    logoUrl: record.logo_url,
    faviconUrl: record.favicon_url,
    fontFamily: record.font_family,
    fontImportUrl: record.font_import_url,
    textPrimaryColor: record.text_primary_color,
    displayName: record.display_name,
    supportEmail: record.support_email,
  };
}

async function parseBody(request: NextRequest): Promise<Record<string, unknown> | NextResponse> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
}

function buildConfig(body: Record<string, unknown>): BrandingConfig | NextResponse {
  const primaryColor = String(body.primaryColor ?? "#2563EB").trim();
  const secondaryColor = String(body.secondaryColor ?? "#FBBF24").trim();
  const textPrimaryColor = String(body.textPrimaryColor ?? "#111827").trim();

  if (!HEX_RE.test(primaryColor)) {
    return NextResponse.json({ error: "primaryColor must be a valid 6-digit hex color." }, { status: 422 });
  }
  if (!HEX_RE.test(secondaryColor)) {
    return NextResponse.json({ error: "secondaryColor must be a valid 6-digit hex color." }, { status: 422 });
  }
  if (!HEX_RE.test(textPrimaryColor)) {
    return NextResponse.json({ error: "textPrimaryColor must be a valid 6-digit hex color." }, { status: 422 });
  }

  return {
    primaryColor,
    secondaryColor,
    logoUrl: String(body.logoUrl ?? "").trim(),
    faviconUrl: String(body.faviconUrl ?? "").trim(),
    fontFamily: String(body.fontFamily ?? "Inter").trim(),
    fontImportUrl: String(body.fontImportUrl ?? "https://fonts.googleapis.com/css?family=Inter").trim(),
    textPrimaryColor,
    displayName: String(body.displayName ?? "").trim(),
    supportEmail: String(body.supportEmail ?? "").trim(),
  };
}

export async function GET(request: NextRequest) {
  logRequestActor("organization/branding", request);
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { orgId } = auth.claims;
  const record = getBranding(orgId);

  if (!record) {
    return NextResponse.json({ branding: null });
  }

  return NextResponse.json({ branding: recordToConfig(record) });
}

export async function POST(request: NextRequest) {
  logRequestActor("organization/branding", request);
  const auth = await requireScope(request, [Scope.BRANDING_CREATE_BASIC, Scope.BRANDING_CREATE_ADVANCED]);
  if (auth instanceof NextResponse) return auth;

  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const built = buildConfig(body);
  if (built instanceof NextResponse) return built;

  const { orgId } = auth.claims;

  try {
    const config = await withParentImages(orgId, built);
    const m2mToken = await getBrandingToken(orgId);
    await brandingCreate(m2mToken, orgId, config);
    const record = upsertBranding(orgId, config);
    return NextResponse.json({ branding: recordToConfig(record) }, { status: 201 });
  } catch (err) {
    routeLogger.error({ err, orgId }, "Failed to create branding");
    const message = err instanceof Error ? err.message : "Failed to create branding.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function PUT(request: NextRequest) {
  logRequestActor("organization/branding", request);
  const auth = await requireScope(request, [Scope.BRANDING_CREATE_BASIC, Scope.BRANDING_CREATE_ADVANCED]);
  if (auth instanceof NextResponse) return auth;

  const body = await parseBody(request);
  if (body instanceof NextResponse) return body;

  const built = buildConfig(body);
  if (built instanceof NextResponse) return built;

  const { orgId } = auth.claims;

  try {
    const config = await withParentImages(orgId, built);
    const m2mToken = await getBrandingToken(orgId);
    const existing = getBranding(orgId);
    if (existing) {
      await brandingUpdate(m2mToken, orgId, config);
    } else {
      await brandingCreate(m2mToken, orgId, config);
    }
    const record = upsertBranding(orgId, config);
    return NextResponse.json({ branding: recordToConfig(record) });
  } catch (err) {
    routeLogger.error({ err, orgId }, "Failed to update branding");
    const message = err instanceof Error ? err.message : "Failed to update branding.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  logRequestActor("organization/branding", request);
  const auth = await requireScope(request, [Scope.BRANDING_DELETE]);
  if (auth instanceof NextResponse) return auth;

  const { orgId } = auth.claims;
  const record = getBranding(orgId);

  if (!record) {
    return NextResponse.json({ error: "No branding configured for this organization." }, { status: 404 });
  }

  try {
    const m2mToken = await getBrandingToken(orgId);
    await brandingDelete(m2mToken, orgId);
    deleteBranding(orgId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    routeLogger.error({ err, orgId }, "Failed to delete branding");
    const message = err instanceof Error ? err.message : "Failed to delete branding.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
