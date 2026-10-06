import type { z } from "zod";
import type { ValidationDetails } from "@/lib/api-errors";

// z.flattenError keeps only the first path segment, so every error inside an
// array would collapse onto one key. A bulk payload keys errors by the full
// dotted path instead ("cards.3.back"), so the client can point at one card.
// Issues on the payload itself go under "_root".
export function fieldErrorsFromIssues(error: z.ZodError): ValidationDetails["fieldErrors"] {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}
