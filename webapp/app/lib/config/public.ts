/**
 * Browser-visible configuration, read from the environment at runtime.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` into the bundles at build time, which
 * would bake one domain and one identity provider into the image. Instead, the root
 * layout reads these values on the server for every request and hands them to
 * RuntimeConfigProvider, so one image serves any domain. The NEXT_PUBLIC_ names are
 * kept so existing .env.local files keep working; changing a value needs a restart,
 * not a rebuild.
 *
 * Dependency-free (no React, no next/*): the MCP server imports this module through
 * app/lib/auth/utils.ts.
 */

export interface PublicConfig {
  /** Identity provider base URL, e.g. https://api.asgardeo.io/t/<org>. */
  baseUrl: string;
  clientId: string;
  scopes: string;
  /** Empty means the browser's current origin. */
  afterSignInUrl: string;
  /** Empty means the browser's current origin. */
  afterSignOutUrl: string;
  enhancedOrganizationAuthentication: boolean;
  organizationHandleSupported: boolean;
  /**
   * Hosted organization onboarding flow that "Get started" opens instead of the in-app sign-up form; empty keeps
   * the form. {returnUrl} and {clientId} in the URL are replaced (see app/onboarding/OnboardingFlowRedirect.tsx).
   */
  onboardingFlowUrl: string;
  /** True when the in-app sign-up checks the company against KYB_URL first (the URL itself stays server-side). */
  kybEnabled: boolean;
  upgradeWaitMs: number;
  agentChatUrl: string;
  agentHttpBaseUrl: string;
  /** Comma-separated organization names or IDs the chat widget is hidden from. */
  agentChatHiddenOrgs: string;
  roleNames: {
    admin: string;
    member: string;
    idpManager: string;
    basicBrandingEditor: string;
    advancedBrandingEditor: string;
  };
}

const CLIENT_CONFIG_KEY = "__WAYFINDER_PUBLIC_CONFIG__";

// Computed keys: Next.js only inlines literal `process.env.NEXT_PUBLIC_X` references.
function env(name: string): string | undefined {
  const value = typeof process === "undefined" ? undefined : process.env[name];
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function envFlag(name: string): boolean {
  return (env(name) ?? "").toLowerCase() === "true";
}

function toHttpBaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "http://localhost:8791";
  }
}

/** Reads the configuration from process.env. Server-side only. */
export function readPublicConfigFromEnv(): PublicConfig {
  const agentChatUrl = env("NEXT_PUBLIC_AGENT_CHAT_URL") ?? "ws://localhost:8791/chat";
  const upgradeWaitMs = Number(env("NEXT_PUBLIC_UPGRADE_WAIT_MS") ?? 5000);

  return {
    baseUrl: (env("NEXT_PUBLIC_BASE_URL") ?? "").replace(/\/$/, ""),
    clientId: env("NEXT_PUBLIC_CLIENT_ID") ?? "",
    scopes: env("NEXT_PUBLIC_SCOPES") ?? "openid",
    afterSignInUrl: env("NEXT_PUBLIC_AFTER_SIGN_IN_URL") ?? "",
    afterSignOutUrl: env("NEXT_PUBLIC_AFTER_SIGN_OUT_URL") ?? "",
    enhancedOrganizationAuthentication: envFlag("NEXT_PUBLIC_ENHANCED_ORGANIZATION_AUTHENTICATION"),
    organizationHandleSupported: envFlag("NEXT_PUBLIC_ORGANIZATION_HANDLE_SUPPORTED"),
    onboardingFlowUrl: env("NEXT_PUBLIC_ONBOARDING_FLOW_URL") ?? "",
    kybEnabled: !!env("KYB_URL"),
    upgradeWaitMs: Number.isFinite(upgradeWaitMs) ? upgradeWaitMs : 5000,
    agentChatUrl,
    agentHttpBaseUrl: env("NEXT_PUBLIC_AGENT_HTTP_BASE_URL") ?? toHttpBaseUrl(agentChatUrl),
    agentChatHiddenOrgs: env("NEXT_PUBLIC_AGENT_CHAT_HIDDEN_ORGS") ?? "",
    roleNames: {
      admin: env("NEXT_PUBLIC_ADMIN_ROLE_NAME") ?? "WayFinder-Admin",
      member: env("NEXT_PUBLIC_MEMBER_ROLE_NAME") ?? "WayFinder-Member",
      idpManager: env("NEXT_PUBLIC_IDP_MANAGER_ROLE_NAME") ?? "IdP-Manager",
      basicBrandingEditor: env("NEXT_PUBLIC_BASIC_BRANDING_EDITOR_ROLE_NAME") ?? "Basic-Branding-Editor",
      advancedBrandingEditor: env("NEXT_PUBLIC_ADVANCED_BRANDING_EDITOR_ROLE_NAME") ?? "Advanced-Branding-Editor",
    },
  };
}

/** Called by RuntimeConfigProvider in the browser before any child renders. */
export function setClientPublicConfig(config: PublicConfig) {
  (globalThis as Record<string, unknown>)[CLIENT_CONFIG_KEY] = config;
}

/**
 * The current configuration: the server-rendered copy in the browser, process.env
 * on the server. Call it where the value is used, not at module load, because client
 * modules are evaluated before RuntimeConfigProvider renders.
 */
export function publicConfig(): PublicConfig {
  if (typeof window !== "undefined") {
    const config = (globalThis as Record<string, unknown>)[CLIENT_CONFIG_KEY] as PublicConfig | undefined;

    if (config) return config;
  }

  return readPublicConfigFromEnv();
}
