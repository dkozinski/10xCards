import React, { useState } from "react";
import { CircleAlert, RotateCcw, Sparkles } from "lucide-react";
import { z } from "zod";
import { ServerError } from "@/components/auth/ServerError";
import { useElapsedSeconds } from "@/components/hooks/useElapsedSeconds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { ApiErrorBody } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import { SOURCE_TEXT_MAX, SOURCE_TEXT_MIN, generateProposalsSchema } from "@/lib/validation/generation";
import type { FlashcardProposalDto, ProposalsResponseDto } from "@/types";

// Time-based, not driven by the server: the request is one synchronous POST with no
// progress events, so these only reassure the user that the wait is expected.
const STAGES: [atSeconds: number, message: string][] = [
  [0, "Reading your text…"],
  [5, "Picking out the key concepts…"],
  [12, "Writing questions and answers…"],
  [25, "Almost there…"],
];

function stageFor(elapsed: number): string {
  let message = STAGES[0][1];
  for (const [at, text] of STAGES) if (elapsed >= at) message = text;
  return message;
}

// "20000" → "20,000"; fixed format so server and browser render the same
// string regardless of the runtime's Intl data.
function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Past the service's 60 s upstream timeout but under the ~100 s CDN ceiling, so it
// only fires when the connection hangs without the server or the edge answering.
const CLIENT_TIMEOUT_MS = 75_000;

interface RequestError {
  message: string;
  retryable: boolean;
}

const GENERATION_FAILED: RequestError = {
  message: "Could not generate proposals. This is usually temporary — please try again.",
  retryable: true,
};

export default function GenerateProposals() {
  // The source text lives only in React state: no web storage, so nothing outlives the tab.
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<RequestError | null>(null);
  const [proposals, setProposals] = useState<FlashcardProposalDto[] | null>(null);
  const [pending, setPending] = useState(false);
  const elapsed = useElapsedSeconds(pending);

  async function generate() {
    if (pending) return;
    setRequestError(null);

    const parsed = generateProposalsSchema.safeParse({ text });
    if (!parsed.success) {
      setFieldError(z.flattenError(parsed.error).fieldErrors.text?.[0] ?? "Invalid text.");
      return;
    }
    setFieldError(null);
    setProposals(null);
    setPending(true);

    let response: Response;
    try {
      response = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
    } catch (error) {
      setRequestError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? GENERATION_FAILED
          : { message: "Network error. Check your connection and try again.", retryable: true },
      );
      setPending(false);
      return;
    }

    // Partial: a proxy or platform page may answer with a body of another shape, or none at all
    const body = (await response.json().catch(() => null)) as Partial<ProposalsResponseDto & ApiErrorBody> | null;
    const code = body?.error?.code;
    if (response.ok && Array.isArray(body?.proposals)) {
      setProposals(body.proposals);
    } else if (code === "validation_failed" && body?.error?.details) {
      setFieldError(body.error.details.fieldErrors.text?.[0] ?? "Invalid text.");
    } else if (code === "generation_failed") {
      setRequestError(GENERATION_FAILED);
    } else if (code === "unauthorized") {
      setRequestError({
        message: "Your session has expired. Sign in again to generate proposals.",
        retryable: false,
      });
    } else {
      // a 200 without a proposals list is a transient platform response, not our error
      setRequestError({ message: "Something went wrong. Please try again later.", retryable: response.ok });
    }
    setPending(false);
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    void generate();
  }

  // the schema measures the trimmed value, so the counter does too
  const length = text.trim().length;

  return (
    <div className="space-y-6">
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <div>
          <div className="mb-1 flex items-baseline justify-between text-sm">
            <label htmlFor="source-text" className="text-blue-100/80">
              Source text
            </label>
            <span className={cn("text-xs", length > SOURCE_TEXT_MAX ? "text-red-300" : "text-white/40")}>
              {formatCount(length)} / {formatCount(SOURCE_TEXT_MAX)}
            </span>
          </div>
          <Textarea
            id="source-text"
            name="text"
            rows={12}
            value={text}
            placeholder="Paste notes, an article excerpt or a textbook chapter…"
            // the text must leave no trace: these stop form restoration from keeping it
            // and cloud spellcheckers from receiving it
            autoComplete="off"
            spellCheck={false}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "source-text-hint source-text-error" : "source-text-hint"}
            onChange={(e) => {
              setText(e.target.value);
              if (fieldError) setFieldError(null);
            }}
            className={cn(
              "field-sizing-fixed max-h-[60vh] resize-y rounded-lg bg-white/10 text-white placeholder-white/40 focus-visible:ring-2",
              fieldError
                ? // aria-invalid: variants too, or the shadcn base's aria-invalid:*-destructive wins
                  "border-red-400/60 focus-visible:ring-red-400 aria-invalid:border-red-400/60 aria-invalid:ring-red-400"
                : "border-white/20 focus-visible:ring-purple-400",
            )}
          />
          <p id="source-text-hint" className="mt-1 text-xs text-white/40">
            {formatCount(SOURCE_TEXT_MIN)} to {formatCount(SOURCE_TEXT_MAX)} characters.
          </p>
          {fieldError && (
            <p id="source-text-error" className="mt-1 flex items-center gap-1 text-xs text-red-300">
              <CircleAlert className="size-3" />
              {fieldError}
            </p>
          )}
        </div>

        <Button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
        >
          {pending ? (
            <span className="flex items-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Generating…
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Generate proposals
            </span>
          )}
        </Button>
      </form>

      {requestError && (
        <div className="space-y-3">
          <ServerError message={requestError.message} />
          {requestError.retryable && (
            <Button
              type="button"
              onClick={() => void generate()}
              className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-white transition-colors hover:bg-white/20"
            >
              <RotateCcw className="size-4" />
              Try again
            </Button>
          )}
        </div>
      )}

      {/* Always mounted: screen readers announce changes to a live region that already
          exists, not one inserted together with its text. Errors announce via ServerError's
          role="alert"; the per-second counter is left out, it would flood the reader. */}
      <p className="sr-only" aria-live="polite">
        {pending ? stageFor(elapsed) : proposals ? `Generated ${proposals.length} proposals` : ""}
      </p>

      {pending && (
        <div className="space-y-3">
          <p className="flex items-baseline justify-between text-sm text-blue-100/80" aria-hidden="true">
            <span>{stageFor(elapsed)}</span>
            <span className="text-xs text-white/40 tabular-nums">{elapsed} s</span>
          </p>
          <ul className="space-y-3" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="rounded-lg border border-white/10 bg-white/5 p-4">
                <Skeleton className="h-4 w-3/4 bg-white/10" />
                <Skeleton className="mt-3 h-3 w-full bg-white/10" />
                <Skeleton className="mt-2 h-3 w-5/6 bg-white/10" />
              </li>
            ))}
          </ul>
        </div>
      )}

      {proposals && (
        <div>
          <h2 className="mb-1 text-xl font-semibold">Proposals ({proposals.length})</h2>
          <p className="mb-4 text-sm text-blue-100/60">
            Preview only — saving proposals to your deck comes in the next step.
          </p>
          <ul className="space-y-3">
            {proposals.map((card, i) => (
              // proposals have no id and the list is never reordered, so the index is a stable key
              <li key={i} className="rounded-lg border border-white/10 bg-white/5 p-4">
                <p className="font-medium break-words whitespace-pre-wrap">{card.front}</p>
                <p className="mt-2 border-t border-white/10 pt-2 text-sm break-words whitespace-pre-wrap text-blue-100/80">
                  {card.back}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
