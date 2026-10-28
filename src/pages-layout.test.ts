import { readdirSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Astro turns every file under src/pages/ into a route unless its own name, or the
// name of a directory above it, starts with "_". An unprefixed test therefore ships
// to production as an endpoint, with Vitest bundled into the Worker.
const PAGES = fileURLToPath(new URL("./pages", import.meta.url));
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

describe("src/pages layout", () => {
  it("keeps every test file out of the router with a _ prefix", () => {
    const offenders = readdirSync(PAGES, { encoding: "utf8", recursive: true })
      .filter((path) => TEST_FILE.test(path))
      .filter((path) => !path.split(sep).some((segment) => segment.startsWith("_")));

    expect(offenders).toEqual([]);
  });
});
