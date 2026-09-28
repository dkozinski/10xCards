// The closed vocabulary of API error codes (see AGENTS.md). Routes return errors
// only through apiError(), so a new code has to be added here, never inline.

export type ApiErrorCode = "validation_failed" | "invalid_json" | "unauthorized" | "server_error";

const STATUS: Record<ApiErrorCode, number> = {
  validation_failed: 400,
  invalid_json: 400,
  unauthorized: 401,
  server_error: 500,
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
