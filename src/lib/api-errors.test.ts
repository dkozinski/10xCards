import { describe, expect, it } from "vitest";
import { apiError, type ApiErrorCode } from "./api-errors";

describe("apiError", () => {
  it.each<[ApiErrorCode, number]>([
    ["validation_failed", 400],
    ["invalid_json", 400],
    ["unauthorized", 401],
    ["server_error", 500],
  ])("%s responds with %i and the shared body shape", async (code, status) => {
    const response = apiError(code, "message");
    expect(response.status).toBe(status);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: { code, message: "message" } });
  });

  it("includes field errors when given", async () => {
    const details = { fieldErrors: { front: ["Front is required"] } };
    const response = apiError("validation_failed", "Invalid flashcard", details);
    expect(await response.json()).toEqual({
      error: { code: "validation_failed", message: "Invalid flashcard", details },
    });
  });
});
