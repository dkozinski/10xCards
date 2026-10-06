import type { APIRoute } from "astro";
import { apiError } from "@/lib/api-errors";
import { readBody } from "@/lib/read-body";
import { saveGeneration } from "@/lib/services/generations";
import { createClient } from "@/lib/supabase";
import { fieldErrorsFromIssues } from "@/lib/validation/field-errors";
import { saveGenerationSchema } from "@/lib/validation/generation";
import type { SaveGenerationResponseDto } from "@/types";

export const prerender = false;

// 20 cards of at most 700 characters, at up to 4 UTF-8 bytes each, plus JSON keys.
const MAX_BODY_BYTES = 64 * 1024;

// Saves the kept cards of one reviewed generation plus its counts. A retry with
// the same generation_id is a replay: 200 with the original count, nothing written.
export const POST: APIRoute = async (context) => {
  if (!context.locals.user) {
    return apiError("unauthorized", "Sign in to save flashcards");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return apiError("server_error", "Supabase is not configured");
  }

  const read = await readBody(context.request, MAX_BODY_BYTES);
  if (read === "too_large") {
    return apiError("validation_failed", "Invalid generation", {
      fieldErrors: { _root: ["Request body is too large"] },
    });
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

  const parsed = saveGenerationSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("validation_failed", "Invalid generation", { fieldErrors: fieldErrorsFromIssues(parsed.error) });
  }

  try {
    // parsed.data, not body: it carries the trimmed values the schema measured
    const response: SaveGenerationResponseDto = await saveGeneration(supabase, parsed.data);
    return Response.json(response);
  } catch (error) {
    // Only code and message reach the Worker log: a PostgrestError's details can
    // quote the failing row, i.e. the user's card text. The client gets the fixed code.
    const { code, message } = error as { code?: string; message?: string };
    // eslint-disable-next-line no-console
    console.error("saveGeneration failed", { code, message });
    return apiError("server_error", "Could not save the flashcards");
  }
};
