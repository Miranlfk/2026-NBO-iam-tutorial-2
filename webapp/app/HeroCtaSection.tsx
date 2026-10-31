"use client";

import Link from "next/link";
import SignInButton from "./SignInButton";
import { useAuth } from "./lib/auth/client";

export default function HeroCtaSection() {
  const { isSignedIn } = useAuth();

  return (
    <div className="hero-actions">
      {isSignedIn ? (
        <Link className="button button-primary" href="/dashboard">
          Go to dashboard
        </Link>
      ) : (
        <>
          <Link className="button button-primary" href="/onboarding">
            Create workspace
          </Link>
          <SignInButton className="button button-secondary" />
        </>
      )}
    </div>
  );
}
