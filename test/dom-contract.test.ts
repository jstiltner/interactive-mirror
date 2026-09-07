/**
 * `testing/index.js` and `testing/index.d.ts` still describe the same module.
 *
 * Every other module here carries its types in the same file as its values, so they cannot
 * disagree. The DOM contract is the exception: it ships as hand-written JavaScript with a
 * hand-written declaration file, because it is loaded by *other projects' test runners* and a
 * test runner is not a bundler. Playwright delegates `node_modules` to Node, and Node refuses to
 * strip types from anything under `node_modules` — so a `.ts` file there is unloadable by the
 * most likely consumer of a DOM contract.
 *
 * The cost of that choice is exactly one thing: the values and the types can now drift. This
 * test is the payment. Importing both and comparing them turns "keep these two files in sync"
 * from a discipline into a check.
 *
 * The selectors are also checked against the components that emit them. A contract that named
 * `[data-mirror-reveal]` while the panel rendered `data-mirror-open` would be worse than no
 * contract: a consumer's suite would find nothing, assert nothing, and pass.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_STORAGE,
  MIRROR_SELECTORS,
  claimSelector,
  ruleSelector,
  sourceLinkSelector,
} from "../testing/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const declarations = readFileSync(path.join(here, "../testing/index.d.ts"), "utf8");

const componentSource = ["MirrorPanel.tsx", "MirrorShell.tsx"]
  .map((file) => readFileSync(path.join(here, "../src/ui", file), "utf8"))
  .join("\n");

describe("the declaration file matches the module it declares", () => {
  it("declares every exported selector, with the same literal value", () => {
    for (const [key, value] of Object.entries(MIRROR_SELECTORS)) {
      expect(declarations, `index.d.ts is missing the key ${key}`).toContain(
        `readonly ${key}: ${JSON.stringify(value)};`
      );
    }
  });

  it("declares no selector the module does not export", () => {
    const declared = [...declarations.matchAll(/readonly (\w+): "/g)].map((match) => match[1]);
    expect(declared.sort()).toEqual(Object.keys(MIRROR_SELECTORS).sort());
  });

  it("declares the forbidden-storage list as the tuple it actually is", () => {
    for (const entry of FORBIDDEN_STORAGE) {
      expect(declarations).toContain(`"${entry}"`);
    }
    expect([...declarations.matchAll(/^\s{2}"(\w+)",$/gm)].map((m) => m[1])).toEqual([
      ...FORBIDDEN_STORAGE,
    ]);
  });

  it("declares every exported helper", () => {
    for (const name of ["claimSelector", "ruleSelector", "sourceLinkSelector"]) {
      expect(declarations).toContain(`export declare function ${name}(`);
    }
  });
});

describe("the contract matches the DOM the components emit", () => {
  it("names only attributes the panel or the shell actually renders", () => {
    for (const [key, selector] of Object.entries(MIRROR_SELECTORS)) {
      for (const attribute of selector.match(/data-[\w-]+/g) ?? []) {
        expect(
          componentSource,
          `MIRROR_SELECTORS.${key} looks for ${attribute}, which no component renders`
        ).toContain(attribute);
      }
    }
  });

  it("builds parameterised selectors from attributes the components render", () => {
    expect(claimSelector("x")).toBe('[data-mirror-claim][data-claim-id="x"]');
    expect(ruleSelector("r")).toBe('[data-mirror-rule][data-rule-id="r"]');
    expect(sourceLinkSelector("r")).toBe('[data-source-link][data-rule-id="r"]');
    for (const attribute of ["data-claim-id", "data-rule-id"]) {
      expect(componentSource).toContain(attribute);
    }
  });
});
