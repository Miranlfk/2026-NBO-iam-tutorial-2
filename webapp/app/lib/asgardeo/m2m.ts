import { publicConfig } from "../config/public";

/**
 * Machine-to-machine tokens of the Wayfinder application (CLIENT_ID or NEXT_PUBLIC_CLIENT_ID + CLIENT_SECRET):
 * client_credentials in the root organization, and organization_switch into a sub-organization. Server-side only.
 */

type TokenResponse = { access_token?: string; error_description?: string };

async function requestToken(params: Record<string, string>, failureMessage: string): Promise<string> {
  const { baseUrl } = publicConfig();
  const clientId = process.env.CLIENT_ID || publicConfig().clientId;
  const clientSecret = process.env.CLIENT_SECRET ?? "";
  const response = await fetch(`${baseUrl}/oauth2/token`, {
    method: "POST",
    body: new URLSearchParams(params),
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const json = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description ?? failureMessage);
  }

  return json.access_token;
}

export function getRootM2MToken(scope: string): Promise<string> {
  return requestToken({ grant_type: "client_credentials", scope }, "Failed to get root management token.");
}

export async function getOrgM2MToken(orgId: string, scope: string, rootScope = "internal_organization_view"): Promise<string> {
  const rootToken = await getRootM2MToken(rootScope);

  return requestToken(
    { grant_type: "organization_switch", token: rootToken, switching_organization: orgId, scope },
    "Failed to get org management token."
  );
}
