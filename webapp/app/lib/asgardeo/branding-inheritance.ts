import {
  brandingGetPublic,
  brandingOverrides,
  orgGet,
  type BrandingConfig,
  type InheritableBrandingField,
} from "./client";
import { getRootM2MToken } from "./m2m";
import { publicConfig } from "../config/public";

/**
 * Branding inheritance between a workspace and its parent organization. Asgardeo resolves an organization's
 * branding to the nearest preference up the hierarchy and uses it whole (no field-level merge): a workspace
 * without a preference of its own shows its parent's, one with its own shows only its own.
 */

export type BrandingSource = "own" | "inherited" | "default";

export interface ParentBranding {
  parent: { id: string; name: string } | null;
  /** The parent's effective branding (its own, or inherited from further up); null when none. */
  branding: BrandingConfig | null;
}

export interface BrandingInheritance extends ParentBranding {
  /** own: the workspace has a preference; inherited: it uses an ancestor's; default: none in its hierarchy. */
  source: BrandingSource;
  own: BrandingConfig | null;
  effective: BrandingConfig | null;
  /** Fields of the workspace's own preference that differ from the parent's effective branding. */
  overrides: InheritableBrandingField[];
}

const rootOrganizationId = () => process.env.PARENT_ORGANIZATION_ID ?? "";

/** The root organization's branding is read without the /o/<org-id> prefix. */
export const brandingOrgId = (orgId: string): string | null => (orgId === rootOrganizationId() ? null : orgId);

async function organizationName(rootToken: string, orgId: string): Promise<string> {
  try {
    return (await orgGet(rootToken, orgId)).name;
  } catch {
    // The root organization: its handle is the tenant segment of the base URL (https://<host>/t/<handle>).
    return orgId === rootOrganizationId()
      ? (publicConfig().baseUrl.match(/\/t\/([^/]+)$/)?.[1] ?? "Root organization")
      : "Parent organization";
  }
}

export async function getParentBranding(orgId: string): Promise<ParentBranding> {
  if (orgId === rootOrganizationId()) {
    return { parent: null, branding: null };
  }

  const rootToken = await getRootM2MToken("internal_organization_view");
  const { parentId } = await orgGet(rootToken, orgId);

  if (!parentId) {
    return { parent: null, branding: null };
  }

  const [name, branding] = await Promise.all([
    organizationName(rootToken, parentId),
    brandingGetPublic(brandingOrgId(parentId), true),
  ]);

  return { parent: { id: parentId, name }, branding };
}

export async function getBrandingInheritance(orgId: string): Promise<BrandingInheritance> {
  const [own, effective, parent] = await Promise.all([
    brandingGetPublic(brandingOrgId(orgId), false),
    brandingGetPublic(brandingOrgId(orgId), true),
    getParentBranding(orgId),
  ]);

  return {
    ...parent,
    effective,
    overrides: own ? brandingOverrides(own, parent.branding) : [],
    own,
    source: own ? "own" : effective ? "inherited" : "default",
  };
}
