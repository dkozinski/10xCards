// The closed vocabulary of API error codes (see AGENTS.md). Routes return errors
// only through apiError(), so a new code has to be added here, never inline.

export type ApiErrorCode =
  | "validation_failed"
  | "invalid_json"
  | "unauthorized"
  | "not_found"
  | "server_error"
  | "generation_failed";

const STATUS: Record<ApiErrorCode, number> = {
  validation_failed: 400,
  invalid_json: 400,
  unauthorized: 401,
  // The addressed resource does not exist for this caller. Under RLS a missing
  // row and another user's row look the same, so one code covers both.
  not_found: 404,
  server_error: 500,
  // The AI dependency failed or produced nothing usable; retrying may help.
  generation_failed: 502,
};

export interface ValidationDetails {
  fieldErrors: Partial<Record<string, string[]>>;
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ValidationDetails;
  };
}

export function apiError(code: ApiErrorCode, message: string, details?: ValidationDetails): Response {
  const body: ApiErrorBody = { error: details ? { code, message, details } : { code, message } };
  return Response.json(body, { status: STATUS[code] });
}
