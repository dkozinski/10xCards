import type { APIRoute } from "astro";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { z } from "zod";
import { apiError } from "@/lib/api-errors";
import { GenerationError, generateProposals } from "@/lib/services/generation";
import { generateProposalsSchema } from "@/lib/validation/generation";
import type { ProposalsResponseDto } from "@/types";

export const prerender = false;

// 20,000 characters of text fit comfortably even at 4 UTF-8 bytes each plus JSON.
const MAX_BODY_BYTES = 128 * 1024;

// request.text() would buffer up to the platform's 100 MB limit before any check,
// enough to exceed the isolate's memory and CPU. Reject on the declared length,
// then count the bytes actually streamed (Content-Length can be absent) and stop early.
async function readBody(request: Request, maxBytes: number): Promise<{ text: string } | "too_large" | "unreadable"> {
  if (Number(request.headers.get("Content-Length")) > maxBytes) return "too_large";
  if (!request.body) return { text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return "too_large";
      }
      chunks.push(value);
    }
  } catch {
    // e.g. the client disconnected mid-upload
    return "unreadable";
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes) };
}

// Nothing below may log the request text, the prompt or the model output: Workers
// Logs persist console output, and the source text must leave no trace (PRD NFR).
export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return apiError("unauthorized", "Sign in to generate flashcards");
  }

  if (!OPENROUTER_API_KEY) {
    return apiError("server_error", "AI generation is not configured");
  }

  const read = await readBody(context.request, MAX_BODY_BYTES);
  if (read === "too_large") {
    return apiError("validation_failed", "Invalid text", { fieldErrors: { text: ["Request body is too large"] } });
  }
  if (read === "unreadable") {
    return apiError("invalid_json", "Request body could not be read");
  }

  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return apiError("invalid_json", "Request body must be valid JSON");
  }

  const parsed = generateProposalsSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("validation_failed", "Invalid text", {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    });
  }

  const started = Date.now();
  try {
    // parsed.data, not body: it carries the trimmed text the schema measured
    const { proposals, meta } = await generateProposals(OPENROUTER_API_KEY, parsed.data);
    // eslint-disable-next-line no-console
    console.info("generateProposals ok", {
      count: proposals.length,
      dropped: meta.dropped,
      latencyMs: meta.latencyMs,
      usage: meta.usage,
    });
    const response: ProposalsResponseDto = { proposals };
    return Response.json(response);
  } catch (error) {
    const latencyMs = Date.now() - started;
    if (error instanceof GenerationError) {
      // kind, status and content-free diagnostics only; status is absent on network
      // failures and timeouts, diagnostics on failures before a completion arrived
      // eslint-disable-next-line no-console
      console.error("generateProposals failed", {
        kind: error.kind,
        status: error.status,
        ...error.diagnostics,
        latencyMs,
      });
      // a rejected key, model or schema is our misconfiguration: retrying cannot help
      return error.kind === "upstream_config"
        ? apiError("server_error", "AI generation is misconfigured")
        : apiError("generation_failed", "Could not generate flashcards. Please try again.");
    }
    // eslint-disable-next-line no-console
    console.error("generateProposals crashed", { name: error instanceof Error ? error.name : typeof error, latencyMs });
    return apiError("server_error", "Could not generate flashcards");
  }
};
