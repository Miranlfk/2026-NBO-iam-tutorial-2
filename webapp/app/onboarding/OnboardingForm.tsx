"use client";

import { useState } from "react";
import { useAuth } from "../lib/auth/client";
import { publicConfig } from "../lib/config/public";
import LoadingScreen, { LoadingStep } from "../LoadingScreen";
import PlanSelection from "./PlanSelection";

type OnboardingResponse = {
  code?: string;
  message?: string;
  organization: {
    id: string;
    name: string;
    orgHandle: string;
  };
  user: {
    id: string;
    userName: string;
  };
};

type FormState = {
  email: string;
  familyName: string;
  givenName: string;
  organizationName: string;
  organizationHandle: string;
  password: string;
  registrationNumber: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

const ONBOARDING_ERROR_MESSAGE = "We couldn't create your organization right now. Please try again in a moment.";

const FIELD_LABELS: Record<keyof FormState, string> = {
  email: "Work email",
  familyName: "Last name",
  givenName: "First name",
  organizationName: "Organization name",
  organizationHandle: "Organization handle",
  password: "Password",
  registrationNumber: "Company registration number"
};

const initialForm: FormState = {
  email: "",
  familyName: "",
  givenName: "",
  organizationName: "",
  organizationHandle: "",
  password: "",
  registrationNumber: ""
};

function validate(form: FormState, orgHandleSupported: boolean, kybEnabled: boolean): FormErrors {
  const errors: FormErrors = {};

  for (const key of Object.keys(form) as (keyof FormState)[]) {
    if ((key === "organizationHandle" && !orgHandleSupported) || (key === "registrationNumber" && !kybEnabled)) {
      continue;
    }

    if (!form[key].trim()) {
      errors[key] = `${FIELD_LABELS[key]} is required.`;
    }
  }

  return errors;
}

const INITIAL_STEPS: LoadingStep[] = [
  { label: "Provisioning your organization", status: "pending" },
  { label: "Creating your user account", status: "pending" },
  { label: "Switching to your workspace", status: "pending" },
];

const KYB_STEP: LoadingStep = { label: "Verifying your company", status: "pending" };

// Errors the server words for the user (KYB rejected, KYB unavailable); anything else gets the generic message.
const USER_FACING_ERROR_CODES = new Set(["KYB_REJECTED", "KYB_UNAVAILABLE"]);

type Phase = "form" | "plan" | "submitting";

export default function OnboardingForm() {
  const { switchOrganization } = useAuth();
  const { organizationHandleSupported: orgHandleSupported, kybEnabled } = publicConfig();
  const initialSteps = kybEnabled ? [KYB_STEP, ...INITIAL_STEPS] : INITIAL_STEPS;
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [steps, setSteps] = useState<LoadingStep[]>(initialSteps);
  const [showPassword, setShowPassword] = useState(false);

  function setStepStatus(index: number, status: LoadingStep["status"]) {
    setSteps((current) =>
      current.map((step, i) => (i === index ? { ...step, status } : step))
    );
  }

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function handleSubmit(event: { preventDefault(): void }) {
    event.preventDefault();

    const validationErrors = validate(form, orgHandleSupported, kybEnabled);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setPhase("plan");
  }

  async function handlePlanSelect() {
    setSubmitError("");
    setSteps(initialSteps);
    setPhase("submitting");

    let errorMessage = ONBOARDING_ERROR_MESSAGE;

    try {
      setStepStatus(0, "active");
      const { organizationHandle, registrationNumber, ...rest } = form;
      const response = await fetch("/api/onboarding", {
        body: JSON.stringify({
          ...rest,
          ...(orgHandleSupported ? { organizationHandle } : {}),
          ...(kybEnabled ? { registrationNumber } : {}),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = (await response.json().catch(() => ({}))) as Partial<OnboardingResponse>;

      if (!response.ok) {
        if (body.code && USER_FACING_ERROR_CODES.has(body.code) && body.message) {
          errorMessage = body.message;
          setStepStatus(0, "error");
        }
        throw new Error(errorMessage);
      }

      for (let i = 0; i < initialSteps.length; i += 1) {
        setStepStatus(i, "done");
        if (i + 1 < initialSteps.length) setStepStatus(i + 1, "active");
      }

      const result = body as OnboardingResponse;

      await new Promise((resolve) => setTimeout(resolve, 1200));
      switchOrganization(result.organization);
    } catch {
      setSubmitError(errorMessage);
      await new Promise((resolve) => setTimeout(resolve, errorMessage === ONBOARDING_ERROR_MESSAGE ? 2200 : 4000));
      setPhase("form");
    }
  }

  if (phase === "plan") {
    return <PlanSelection onBack={() => setPhase("form")} onSelect={handlePlanSelect} />;
  }

  if (phase === "submitting") {
    return (
      <LoadingScreen
        description="This usually takes just a few seconds."
        error={submitError || undefined}
        steps={steps}
        title="Setting up your workspace…"
      />
    );
  }

  return (
    <form className="onboarding-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label>
          <span>First name<span className="required-mark">*</span></span>
          <input
            autoComplete="given-name"
            className={errors.givenName ? "input--error" : ""}
            onChange={(event) => updateField("givenName", event.target.value)}
            value={form.givenName}
          />
        </label>
        <label>
          <span>Last name<span className="required-mark">*</span></span>
          <input
            autoComplete="family-name"
            className={errors.familyName ? "input--error" : ""}
            onChange={(event) => updateField("familyName", event.target.value)}
            value={form.familyName}
          />
        </label>
      </div>
      <label>
        <span>Work email<span className="required-mark">*</span></span>
        <input
          autoComplete="email"
          className={errors.email ? "input--error" : ""}
          onChange={(event) => updateField("email", event.target.value)}
          type="email"
          value={form.email}
        />
      </label>
      <label>
        <span>Password<span className="required-mark">*</span></span>
        <div className="password-field">
          <input
            autoComplete="new-password"
            className={errors.password ? "input--error" : ""}
            onChange={(event) => updateField("password", event.target.value)}
            type={showPassword ? "text" : "password"}
            value={form.password}
          />
          <button
            className="password-toggle"
            onClick={() => setShowPassword((v) => !v)}
            type="button"
          >
            {showPassword ? (
              <svg fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" x2="23" y1="1" y2="23" />
              </svg>
            ) : (
              <svg fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="18" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </label>
      <label>
        <span>Organization name<span className="required-mark">*</span></span>
        <input
          autoComplete="organization"
          className={errors.organizationName ? "input--error" : ""}
          onChange={(event) => updateField("organizationName", event.target.value)}
          value={form.organizationName}
        />
      </label>
      {kybEnabled ? (
        <label>
          <span>Company registration number<span className="required-mark">*</span></span>
          <input
            className={errors.registrationNumber ? "input--error" : ""}
            onChange={(event) => updateField("registrationNumber", event.target.value)}
            placeholder="e.g. GB20261038"
            value={form.registrationNumber}
          />
        </label>
      ) : null}
      {orgHandleSupported ? (
        <label>
          <span>Organization handle<span className="required-mark">*</span></span>
          <input
            className={errors.organizationHandle ? "input--error" : ""}
            onChange={(event) => updateField("organizationHandle", event.target.value)}
            value={form.organizationHandle}
          />
        </label>
      ) : null}
      <button className="button button-primary" type="submit">
        Create organization
      </button>
      {submitError ? <p className="form-error">{submitError}</p> : null}
    </form>
  );
}
