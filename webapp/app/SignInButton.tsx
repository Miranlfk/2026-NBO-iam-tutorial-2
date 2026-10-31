"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "./lib/auth/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Sign in" for workspace users. Asks for the work email, then starts the authorize request with organization
 * discovery by email domain (login_hint + orgDiscoveryType=emailDomain), so Asgardeo routes the user to the
 * workspace that owns the domain and on to that workspace's IdP. Wayfinder's own staff sign in to the root
 * organization without discovery.
 */
export default function SignInButton({ className, label = "Sign in" }: { className: string; label?: string }) {
  const { signIn } = useAuth();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setError(null);
    setOpen(true);
  }

  function handleSubmit(event: { preventDefault(): void }) {
    event.preventDefault();
    const loginHint = email.trim().toLowerCase();

    if (!EMAIL_RE.test(loginHint)) {
      setError("Enter your work email address.");
      return;
    }

    signIn({ fidp: "OrganizationSSO", loginHint, orgDiscoveryType: "emailDomain" });
  }

  return (
    <>
      <button className={className} onClick={openDialog} type="button">
        {label}
      </button>
      {/* Portal: the landing header is sticky (its own stacking context). */}
      {open && createPortal(
        <div className="modal-backdrop public-modal" role="dialog" aria-modal="true" aria-label="Sign in" onClick={() => setOpen(false)}>
          <div className="modal-dialog" style={{ maxWidth: "440px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Sign in</p>
                <h3 style={{ margin: "2px 0 0" }}>Find your workspace</h3>
              </div>
              <button className="modal-close" type="button" aria-label="Close" onClick={() => setOpen(false)}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <form className="modal-body" onSubmit={handleSubmit}>
              <p style={{ color: "var(--app-muted)", fontSize: "0.9rem", margin: 0 }}>
                Enter your work email. We&apos;ll take you to your company&apos;s workspace and its sign-in.
              </p>
              <label className="form-field-label">
                Work email
                <input
                  autoComplete="email"
                  autoFocus
                  className="form-field-input"
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  placeholder="you@company.com"
                  type="email"
                  value={email}
                />
              </label>
              {error && (
                <p className="form-error" role="alert" style={{ fontSize: "0.86rem" }}>
                  {error}
                </p>
              )}
              <button className="button button-primary" disabled={!email.trim()} type="submit">
                Continue
              </button>
              <p style={{ color: "var(--app-muted)", fontSize: "0.84rem", margin: 0, textAlign: "center" }}>
                Wayfinder staff?{" "}
                <button className="text-button" onClick={() => signIn()} type="button">
                  Sign in to the Wayfinder workspace
                </button>
              </p>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
