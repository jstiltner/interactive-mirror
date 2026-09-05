import { defineConfig } from "vitest/config";

/**
 * Node environment, deliberately. Nothing in `src/` that a test exercises touches the DOM:
 * `session.ts` owns every browser API the package uses, and the derivation it feeds is a pure
 * function of an event array (§35). A jsdom environment here would let a rule quietly start
 * reading the document and still pass.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
