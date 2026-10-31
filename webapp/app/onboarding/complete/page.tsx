"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import LoadingScreen from "../../LoadingScreen";
import { useAuth } from "../../lib/auth/client";
import { ONBOARDING_RETURN_PATH } from "../OnboardingFlowRedirect";
import PlanSelection from "../PlanSelection";

/**
 * Return route of the hosted organization onboarding flow (NEXT_PUBLIC_ONBOARDING_FLOW_URL). The flow has created
 * the workspace and its first admin; this page signs the admin in to that workspace and continues with the plan
 * selection. Optional query parameters from the flow's redirect pick the workspace:
 *   organizationId  sign in to that organization (fidp=OrganizationSSO&orgId=)
 *   login_hint      the admin's email: organization discovery by email domain
 * Without either, the organization sign-in page asks. After the sign-in the user comes back here (returnTo).
 */
export default function OnboardingCompletePage() {
  const router = useRouter();
  const { isLoading, isSignedIn, user, signIn, switchOrganization } = useAuth();
  const [isReady, setIsReady] = useState(false);
  const startedRef = useRef(false);
  const currentOrgId = user?.orgId ?? "";

  useEffect(() => {
    if (isLoading || startedRef.current) return;
    startedRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const organizationId = params.get("organizationId")?.trim() ?? "";
    const loginHint = (params.get("login_hint") ?? params.get("email") ?? "").trim();

    if (!isSignedIn) {
      if (organizationId) {
        signIn({ fidp: "OrganizationSSO", orgId: organizationId, returnTo: ONBOARDING_RETURN_PATH });
      } else if (loginHint) {
        signIn({ fidp: "OrganizationSSO", loginHint, orgDiscoveryType: "emailDomain", returnTo: ONBOARDING_RETURN_PATH });
      } else {
        signIn({ fidp: "OrganizationSSO", returnTo: ONBOARDING_RETURN_PATH });
      }
      return;
    }

    if (organizationId && currentOrgId !== organizationId) {
      switchOrganization({ orgId: organizationId }, { returnTo: ONBOARDING_RETURN_PATH });
      return;
    }

    setIsReady(true);
  }, [isLoading, isSignedIn, currentOrgId, signIn, switchOrganization]);

  if (!isReady) {
    return (
      <LoadingScreen
        description="Signing you in to your new workspace."
        steps={[]}
        title="Finishing your workspace setup…"
      />
    );
  }

  return <PlanSelection onSelect={() => router.push("/dashboard")} stepLabel="Last step" />;
}
