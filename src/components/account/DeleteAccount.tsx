import { useEffect, useRef, useState } from "react";
import { Mail, Trash2 } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";
import { Button } from "@/components/ui/button";
import type { ApiErrorBody } from "@/lib/api-errors";
import { emailsMatch } from "@/lib/validation/account";

// One definer call whose cascade covers a single user's rows; anything slower is
// a hung connection.
const REQUEST_TIMEOUT_MS = 30_000;

const NOT_DELETED = "Something went wrong on our side. Your account was not deleted. Try again.";
const UNREACHABLE = "Could not reach the server. Check your connection and try again.";

interface DeleteAccountProps {
  // only what the island uses: every prop is serialized into the page's HTML
  email: string;
}

export default function DeleteAccount({ email }: DeleteAccountProps) {
  const [typed, setTyped] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const refocusRef = useRef<"field" | "button" | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const matches = emailsMatch(typed, email);

  // Disabling the focused button on submit drops focus to the page; after a
  // failure it goes back to where the user can act (runs once re-enabled).
  useEffect(() => {
    if (pending) return;
    if (refocusRef.current === "field") document.getElementById("confirm-email")?.focus();
    if (refocusRef.current === "button") buttonRef.current?.focus();
    refocusRef.current = null;
  }, [pending]);

  async function deleteAccount() {
    setFieldError(undefined);
    setServerError(null);
    setPending(true);
    setAnnouncement("Deleting your account…");
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_email: typed }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // The button stays disabled until the navigation replaces the page.
      if (response.status === 204) {
        window.location.assign("/?deleted=1");
        return;
      }
      if (response.status === 401) {
        window.location.assign("/auth/signin");
        return;
      }
      // Partial: a proxy or platform error page may answer with JSON of another shape
      const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
      // e.g. only _root (body too large): nothing to show under the field
      const message =
        body?.error?.code === "validation_failed" ? body.error.details?.fieldErrors.confirm_email?.[0] : undefined;
      if (message) {
        setFieldError(message);
        setAnnouncement(message);
        refocusRef.current = "field";
      } else {
        setServerError(NOT_DELETED);
        refocusRef.current = "button";
      }
    } catch {
      // Offline or a timeout, so the outcome is unknown: a retry is safe because
      // after a committed delete it answers 204 or 401.
      setServerError(UNREACHABLE);
      refocusRef.current = "button";
    }
    setAnnouncement((prev) => (prev === "Deleting your account…" ? "" : prev));
    setPending(false);
  }

  // ServerError announces itself (role="alert"); the live region carries the
  // rest, including the field error, which FormField does not announce.
  return (
    <div className="space-y-4">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <FormField
        id="confirm-email"
        name="confirm_email"
        type="email"
        label={`Type ${email} to confirm`}
        value={typed}
        onChange={(v) => {
          setTyped(v);
          if (fieldError) setFieldError(undefined);
        }}
        placeholder={email}
        error={fieldError}
        icon={<Mail className="size-4" />}
      />

      <ServerError message={serverError} />

      <Button
        ref={buttonRef}
        type="button"
        variant="destructive"
        disabled={!matches || pending}
        onClick={() => void deleteAccount()}
        className="w-full rounded-lg"
      >
        {pending ? (
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : (
          <Trash2 />
        )}
        {pending ? "Deleting account…" : "Delete account"}
      </Button>
    </div>
  );
}
