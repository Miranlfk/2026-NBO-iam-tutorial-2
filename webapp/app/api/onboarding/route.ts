import { NextResponse } from "next/server";
import { publicConfig } from "../../lib/config/public";
import { logger } from "../../lib/logging/logger";

const routeLogger = logger.child({ route: "onboarding" });

type OnboardingRequest = {
  email?: string;
  familyName?: string;
  givenName?: string;
  organizationName?: string;
  organizationHandle?: string;
  password?: string;
  registrationNumber?: string;
};

type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type Organization = {
  id: string;
  name: string;
  orgHandle: string;
  status: string;
};

type KybResult = {
  status?: string;
  referenceId?: string;
  reasons?: unknown;
};

const ONBOARDING_ERROR_MESSAGE = "We couldn't create your organization right now. Please try again in a moment.";
const KYB_UNAVAILABLE_MESSAGE = "We couldn't verify your company right now. Please try again in a moment.";

const clientSecret = process.env.CLIENT_SECRET ?? process.env.NEXT_PUBLIC_CLIENT_SECRET;
const parentOrganizationId = process.env.PARENT_ORGANIZATION_ID;
const rootTokenScopes =
  process.env.ROOT_SCOPES ??
  "internal_organization_create internal_organization_view internal_org_user_mgt_create internal_org_user_mgt_list";
const organizationTokenScopes =
  process.env.ORG_SCOPES ??
  "internal_org_user_mgt_create internal_org_user_mgt_list internal_org_role_mgt_view internal_org_role_mgt_update";
const userStoreName = process.env.USER_STORE_NAME ?? "DEFAULT";
const userStoreId = Buffer.from(userStoreName).toString("base64").replace(/=+$/, "");
const pollInterval = Number(process.env.POLL_INTERVAL_MS ?? 1500);
const orgReadyTimeout = Number(process.env.USERSTORE_TIMEOUT_MS ?? 30000);
const userCreationRetryTimeout = Number(process.env.USER_CREATION_RETRY_TIMEOUT_MS ?? 30000);
// KYB (know your business) check before the organization is created: the plain JSON contract of the BI
// /flows/kyb endpoint, {companyName, registrationNumber} -> {status: APPROVED|REJECTED, referenceId, reasons}.
// Unset KYB_URL skips the check.
const kybUrl = process.env.KYB_URL?.trim();
const kybTimeout = Number(process.env.KYB_TIMEOUT_MS ?? 10000);

function asText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getConfig() {
  const { baseUrl } = publicConfig();
  const clientId = process.env.CLIENT_ID || publicConfig().clientId;

  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error("Workspace setup is missing required server configuration.");
  }

  if (!parentOrganizationId) {
    throw new Error("Workspace setup is missing the parent organization ID.");
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    clientId,
    clientSecret,
    parentOrganizationId
  };
}

async function getToken(params: Record<string, string>) {
  const config = getConfig();
  const response = await fetch(`${config.baseUrl}/oauth2/token`, {
    body: new URLSearchParams(params),
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });
  const body = (await response.json().catch(() => ({}))) as TokenResponse;

  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description ?? body.error ?? "Failed to prepare workspace access.");
  }

  return body.access_token;
}

// Caller credentials for KYB_URL: an API key header, a bearer token or Basic, whichever is set (first wins).
function kybHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };

  if (process.env.KYB_API_KEY) {
    headers[process.env.KYB_API_KEY_HEADER || "x-api-key"] = process.env.KYB_API_KEY;
  } else if (process.env.KYB_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${process.env.KYB_BEARER_TOKEN}`;
  } else if (process.env.KYB_USERNAME) {
    const credentials = `${process.env.KYB_USERNAME}:${process.env.KYB_PASSWORD ?? ""}`;
    headers.Authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
  }

  return headers;
}

/** The KYB decision, or null when the KYB service could not be reached or gave no decision. */
async function checkBusiness(url: string, companyName: string, registrationNumber: string) {
  try {
    const response = await fetch(url, {
      body: JSON.stringify({ companyName, registrationNumber }),
      headers: kybHeaders(),
      method: "POST",
      signal: AbortSignal.timeout(Number.isFinite(kybTimeout) ? kybTimeout : 10000)
    });
    const body = (await response.json().catch(() => ({}))) as KybResult;

    if (!response.ok || (body.status !== "APPROVED" && body.status !== "REJECTED")) {
      routeLogger.error({ statusCode: response.status, kybStatus: body.status }, "KYB check gave no decision");
      return null;
    }

    return {
      approved: body.status === "APPROVED",
      reasons: Array.isArray(body.reasons) ? body.reasons.filter((r): r is string => typeof r === "string") : [],
      referenceId: typeof body.referenceId === "string" ? body.referenceId : ""
    };
  } catch (error) {
    routeLogger.error({ err: error }, "KYB check failed");
    return null;
  }
}

async function createOrganization(accessToken: string, name: string, orgHandle?: string): Promise<Organization> {
  const config = getConfig();
  const response = await fetch(`${config.baseUrl}/api/server/v1/organizations`, {
    body: JSON.stringify({
      description: `Workspace for ${name}`,
      name,
      ...(orgHandle ? { orgHandle } : {}),
      parentId: config.parentOrganizationId,
      type: "TENANT"
    }),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : "Failed to create the organization.";

    throw new Error(message);
  }

  return body as Organization;
}

async function createOrganizationUser({
  accessToken,
  email,
  familyName,
  givenName,
  password
}: {
  accessToken: string;
  email: string;
  familyName: string;
  givenName: string;
  password?: string;
}) {
  const config = getConfig();
  const schemas = ["urn:ietf:params:scim:schemas:core:2.0:User"];

  if (!password) {
    schemas.push("urn:scim:wso2:schema");
  }

  const response = await fetch(`${config.baseUrl}/o/scim2/Users`, {
    body: JSON.stringify({
      schemas,
      emails: [
        {
          primary: true,
          value: email
        }
      ],
      name: {
        familyName,
        givenName
      },
      ...(password ? { password } : { "urn:scim:wso2:schema": { askPassword: "true" } }),
      userName: `${userStoreName}/${email}`
    }),
    headers: {
      Accept: "application/scim+json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/scim+json"
    },
    method: "POST"
  });
  const body = await response.json().catch(() => ({}));

  return { body, ok: response.ok, status: response.status };
}

async function createOrganizationUserWithRetry(args: {
  accessToken: string;
  email: string;
  familyName: string;
  givenName: string;
  password?: string;
}) {
  const startedAt = Date.now();

  while (true) {
    const { body, ok, status } = await createOrganizationUser(args);

    if (ok) {
      return body;
    }

    const message = typeof body?.detail === "string" ? body.detail : "Failed to create the organization user.";

    if (status !== 400 || Date.now() - startedAt >= userCreationRetryTimeout) {
      throw new Error(message);
    }

    await sleep(pollInterval);
  }
}

async function fetchOrganization(accessToken: string, organizationId: string): Promise<string | null> {
  const config = getConfig();
  const response = await fetch(`${config.baseUrl}/api/server/v1/organizations/${organizationId}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    method: "GET"
  });

  if (response.status === 404 || response.status === 409 || response.status === 503) {
    return null;
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : "Failed to check workspace readiness.";

    throw new Error(message);
  }

  return typeof body?.status === "string" ? body.status : null;
}

async function waitForOrganization(accessToken: string, organizationId: string) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < orgReadyTimeout) {
    const status = await fetchOrganization(accessToken, organizationId);

    if (status === "ACTIVE") {
      return;
    }

    await sleep(pollInterval);
  }

  throw new Error("Timed out waiting for the workspace to become available.");
}

async function fetchUserStore(accessToken: string): Promise<boolean> {
  const config = getConfig();
  const response = await fetch(`${config.baseUrl}/o/api/server/v1/userstores/${userStoreId}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    method: "GET"
  });

  if (response.status === 404 || response.status === 500 || response.status === 503) {
    return false;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : "Failed to check user store readiness.";

    throw new Error(message);
  }

  return true;
}

async function fetchRoleIdByName(accessToken: string, roleName: string): Promise<string | null> {
  const config = getConfig();
  const filter = encodeURIComponent(`displayName eq ${roleName}`);
  const response = await fetch(`${config.baseUrl}/o/scim2/v2/Roles?filter=${filter}`, {
    headers: {
      Accept: "application/scim+json",
      Authorization: `Bearer ${accessToken}`
    },
    method: "GET"
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Failed to fetch role "${roleName}".`);
  }

  const resources = body?.Resources;

  if (!Array.isArray(resources) || resources.length === 0) {
    return null;
  }

  return typeof resources[0]?.id === "string" ? resources[0].id : null;
}

async function assignRoleToUser(accessToken: string, roleId: string, userId: string) {
  const config = getConfig();
  const response = await fetch(`${config.baseUrl}/o/scim2/v2/Roles/${roleId}`, {
    body: JSON.stringify({
      Operations: [{ op: "add", path: "users", value: [{ value: userId }] }],
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"]
    }),
    headers: {
      Accept: "application/scim+json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/scim+json"
    },
    method: "PATCH"
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      body && typeof body === "object" && "detail" in body && typeof body.detail === "string"
        ? body.detail
        : `Failed to assign role "${roleId}" to user.`;

    throw new Error(message);
  }
}

async function waitForUserStore(accessToken: string) {
  if (userStoreName.toUpperCase() === "PRIMARY") {
    return;
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < orgReadyTimeout) {
    const ready = await fetchUserStore(accessToken);

    if (ready) {
      return;
    }

    await sleep(pollInterval);
  }

  throw new Error(`Timed out waiting for the "${userStoreName}" user store to become available.`);
}

export async function POST(request: Request) {
  try {
    const { organizationHandleSupported: orgHandleSupported, roleNames } = publicConfig();
    const payload = (await request.json()) as OnboardingRequest;
    const email = asText(payload.email).toLowerCase();
    const familyName = asText(payload.familyName);
    const givenName = asText(payload.givenName);
    const organizationName = asText(payload.organizationName);
    const organizationHandle = asText(payload.organizationHandle);
    const password = asText(payload.password) || undefined;
    const registrationNumber = asText(payload.registrationNumber);

    if (!email || !givenName || !familyName || !organizationName) {
      return NextResponse.json({ message: "All onboarding fields are required." }, { status: 400 });
    }

    if (orgHandleSupported && !organizationHandle) {
      return NextResponse.json({ message: "All onboarding fields are required." }, { status: 400 });
    }

    let kybReference: string | undefined;

    if (kybUrl) {
      const kyb = await checkBusiness(kybUrl, organizationName, registrationNumber);

      if (!kyb) {
        return NextResponse.json({ code: "KYB_UNAVAILABLE", message: KYB_UNAVAILABLE_MESSAGE }, { status: 503 });
      }

      if (!kyb.approved) {
        routeLogger.warn({ organizationName, referenceId: kyb.referenceId }, "KYB check rejected the company");
        const reasons = kyb.reasons.length > 0 ? ` ${kyb.reasons.join(" ")}` : "";
        const reference = kyb.referenceId ? ` Reference: ${kyb.referenceId}.` : "";

        return NextResponse.json(
          {
            code: "KYB_REJECTED",
            message: `We couldn't verify ${organizationName}.${reasons}${reference}`,
            referenceId: kyb.referenceId
          },
          { status: 422 }
        );
      }

      kybReference = kyb.referenceId;
      routeLogger.info({ organizationName, referenceId: kybReference }, "KYB check approved the company");
    }

    const rootAccessToken = await getToken({
      grant_type: "client_credentials",
      scope: rootTokenScopes
    });

    const organization = await createOrganization(
      rootAccessToken,
      organizationName,
      orgHandleSupported ? organizationHandle : undefined
    );

    await waitForOrganization(rootAccessToken, organization.id);

    const organizationAccessToken = await getToken({
      grant_type: "organization_switch",
      scope: organizationTokenScopes,
      switching_organization: organization.id,
      token: rootAccessToken
    });

    await waitForUserStore(organizationAccessToken);

    const user = await createOrganizationUserWithRetry({
      accessToken: organizationAccessToken,
      email,
      familyName,
      givenName,
      password
    });

    const [adminRoleId, memberRoleId] = await Promise.all([
      fetchRoleIdByName(organizationAccessToken, roleNames.admin),
      fetchRoleIdByName(organizationAccessToken, roleNames.member)
    ]);

    await Promise.all([
      adminRoleId ? assignRoleToUser(organizationAccessToken, adminRoleId, user.id) : Promise.resolve(),
      memberRoleId ? assignRoleToUser(organizationAccessToken, memberRoleId, user.id) : Promise.resolve()
    ]);

    return NextResponse.json({
      kybReference,
      organization,
      user: {
        emails: user.emails,
        id: user.id,
        name: user.name,
        userName: user.userName
      }
    });
  } catch (error) {
    routeLogger.error({ err: error }, "Failed to complete onboarding");

    return NextResponse.json(
      {
        message: ONBOARDING_ERROR_MESSAGE
      },
      { status: 500 }
    );
  }
}
