/**
 * Manifest integrity (spec v0.2 §12, §34).
 *
 * The manifest is authorial interpretation, so it cannot be checked for correctness. It can be
 * checked for honesty: that every passage it classifies actually exists in the essay, that every
 * passage the essay marks is classified, and that the word counts it normalizes dwell against
 * match the prose those counts claim to describe.
 *
 * The prose lives in `fixtures/passages/`, not in the essay. This package has no essay — the
 * portfolio does — and a word count that can only be checked by someone holding a private
 * repository is not a checkable claim. The fixtures are the seven marked passages as committed
 * snapshots, so a reader of *this* repository can verify the counts themselves. The other half of
 * the guarantee lives in the portfolio: a drift test there re-cuts the passages from the live
 * essay and fails if they no longer match these files. Editing the prose without re-cutting the
 * fixtures breaks the essay's build, not this package's.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PASSAGE_MANIFEST_VERSION, passageManifest } from "../src/manifest";
import { countWords } from "../tools/passage-text";

const fixtureDir = path.join(__dirname, "..", "fixtures", "passages");

const rendered = new Map(
  readdirSync(fixtureDir)
    .filter((file) => file.endsWith(".txt"))
    .map((file) => [
      path.basename(file, ".txt"),
      countWords(readFileSync(path.join(fixtureDir, file), "utf8")),
    ])
);

describe("passage manifest", () => {
  it("classifies exactly the passages the fixtures contain", () => {
    expect([...rendered.keys()].sort()).toEqual(
      passageManifest.passages.map((passage) => passage.id).sort()
    );
  });

  it("records word counts that match the prose", () => {
    for (const passage of passageManifest.passages) {
      const actual = rendered.get(passage.id);
      expect(actual, passage.id).toBeDefined();
      // Exact: the count is a stated fact about the essay, and dwell-per-word is compared across
      // passages, so drift here quietly tilts every comparison the mirror makes.
      expect(actual, passage.id).toBe(passage.wordCount);
    }
  });

  it("carries the load-bearing entries §34 requires", () => {
    const ids = passageManifest.passages.map((passage) => passage.id);
    expect(ids).toContain("archive-self-citation");
    expect(ids).toContain("performative-loop");
    expect(ids).toContain("legibility-discussion");
    expect(ids).toContain("memory-system-design");
  });

  it("keeps archive-self-citation and performative-loop as distinct passages (§12)", () => {
    const archive = passageManifest.passages.find((p) => p.id === "archive-self-citation");
    const loop = passageManifest.passages.find((p) => p.id === "performative-loop");
    expect(archive?.section).toBe("section-ii");
    expect(loop?.section).toBe("section-v");
  });

  it("stamps every entry with the manifest version", () => {
    for (const passage of passageManifest.passages) {
      expect(passage.manifestVersion).toBe(PASSAGE_MANIFEST_VERSION);
    }
  });

  it("offers enough passages on both sides for a mechanism/abstract comparison", () => {
    const has = (category: string) =>
      passageManifest.passages.filter((p) => (p.categories as string[]).includes(category)).length;
    expect(has("mechanism")).toBeGreaterThanOrEqual(2);
    expect(has("abstract")).toBeGreaterThanOrEqual(2);
  });
});
