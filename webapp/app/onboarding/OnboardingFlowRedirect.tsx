"use client";

import { useEffect } from "react";
import LoadingScreen from "../LoadingScreen";
import { publicConfig } from "../lib/config/public";

export const ONBOARDING_RETURN_PATH = "/onboarding/complete";

/**
 * The hosted organization onboarding flow (NEXT_PUBLIC_ONBOARDING_FLOW_URL) with its placeholders filled in:
 * {returnUrl} = <this origin>/onboarding/complete, where the flow sends the new admin back, and {clientId} = this
 * application's client ID. Both URL-encoded.
 */
function buildOnboardingFlowUrl(): string {
  const { onboardingFlowUrl, clientId } = publicConfig();
  const returnUrl = `${window.location.origin}${ONBOARDING_RETURN_PATH}`;

  return onboardingFlowUrl
    .replaceAll("{returnUrl}", encodeURIComponent(returnUrl))
    .replaceAll("{clientId}", encodeURIComponent(clientId));
}

/** "Get started" when sign-up runs in Asgardeo's onboarding flow instead of the in-app form. */
export default function OnboardingFlowRedirect() {
  useEffect(() => {
    window.location.replace(buildOnboardingFlowUrl());
  }, []);

  return (
    <LoadingScreen
      description="Taking you to workspace registration."
      steps={[]}
      title="Redirecting…"
    />
  );
}
