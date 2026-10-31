import { readdirSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Astro turns every .ts/.js file under src/pages/ into an endpoint unless its own
// name, or the name of a directory above it, starts with "_". An unprefixed test
// therefore ships to production as an endpoint, with Vitest bundled into the Worker.
const PAGES = fileURLToPath(new URL("./pages", import.meta.url));
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

describe("src/pages layout", () => {
  it("keeps every test file out of the router with a _ prefix", () => {
    const tests = readdirSync(PAGES, { encoding: "utf8", recursive: true }).filter((path) => TEST_FILE.test(path));
    const offenders = tests.filter((path) => !path.split(sep).some((segment) => segment.startsWith("_")));

    // A scan that finds no test at all would pass without checking anything.
    expect(tests.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
