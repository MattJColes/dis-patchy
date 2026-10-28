import { confirmSignIn, signIn } from "aws-amplify/auth";
import { motion } from "motion/react";
import { useState, type FormEvent } from "react";

type Step = "credentials" | "newPassword" | "totp";

export function SignIn({ onDone, onCancel }: { onDone(): void; onCancel(): void }) {
  const [step, setStep] = useState<Step>("credentials");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function next(signInStep: string) {
    if (signInStep === "DONE") return onDone();
    if (signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") return setStep("newPassword");
    if (signInStep === "CONFIRM_SIGN_IN_WITH_TOTP_CODE") return setStep("totp");
    setError(`Unsupported sign-in step: ${signInStep}`);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      const result =
        step === "credentials"
          ? await signIn({ username: String(form.get("email")), password: String(form.get("password")) })
          : await confirmSignIn({ challengeResponse: String(form.get("answer")) });
      await next(result.nextStep.signInStep);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel}>
      <motion.form
        className="panel modal"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        initial={{ y: 24, scale: 0.96, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        <h2>Sign in to watch live</h2>
        <p className="hint">Live mode needs a user in the Cognito ops group.</p>
        {step === "credentials" ? (
          <>
            <label>
              Email
              <input name="email" type="email" autoComplete="username" required autoFocus />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
          </>
        ) : (
          <label>
            {step === "newPassword" ? "Choose a new password" : "Authenticator code"}
            <input
              name="answer"
              type={step === "newPassword" ? "password" : "text"}
              autoComplete={step === "newPassword" ? "new-password" : "one-time-code"}
              inputMode={step === "totp" ? "numeric" : undefined}
              required
              autoFocus
            />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Continue"}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}
