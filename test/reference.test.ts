/**
 * `testing/reference.json` still describes the package that ships beside it.
 *
 * The file exists so a consumer's test runner can read the thresholds and the manifest without
 * loading TypeScript out of `node_modules`. That makes it a copy, and a copy that can go stale is
 * worse than no copy: a downstream reading script would keep passing its own preconditions
 * against numbers the engine no longer uses, and the resulting suite would be green and
 * meaningless.
 *
 * So the generated file is never trusted. It is rebuilt here from the same modules the runtime
 * imports and compared, which makes "the reference is current" a checked property rather than a
 * step someone is supposed to remember.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildReference, serializeReference } from "../tools/reference";
import { THRESHOLDS } from "../src/thresholds";
import { passageManifest } from "../src/manifest";
import { inferenceRules } from "../src/claims";

const here = path.dirname(fileURLToPath(import.meta.url));
const committedText = readFileSync(path.join(here, "../testing/reference.json"), "utf8");

describe("the shipped reference is a faithful projection of the source", () => {
  it("regenerates byte-for-byte", () => {
    // Byte comparison rather than deep-equal on purpose: the file is committed, so a diff a
    // reviewer sees is the diff the test enforces. Comparing parsed objects would let
    // formatting drift accumulate in something people are asked to read.
    expect(serializeReference(buildReference())).toBe(committedText);
  });

  it("carries every threshold the engine actually consults", () => {
    const committed = JSON.parse(committedText) as ReturnType<typeof buildReference>;
    expect(committed.thresholds).toEqual(THRESHOLDS);
  });

  it("lists every manifest passage, with the word counts dwell is normalized by", () => {
    const committed = JSON.parse(committedText) as ReturnType<typeof buildReference>;
    expect(committed.passages.map((passage) => passage.id)).toEqual(
      passageManifest.passages.map((passage) => passage.id)
    );
    for (const passage of passageManifest.passages) {
      const shipped = committed.passages.find((candidate) => candidate.id === passage.id);
      // §9 divides dwell by word count. A consumer comparing raw seconds across a 60-word
      // passage and a 240-word one would be measuring the essay's layout, not the reader, so
      // this number is the one a downstream fixture most needs to be right.
      expect(shipped?.wordCount).toBe(passage.wordCount);
      expect(shipped?.categories).toEqual(passage.categories);
    }
  });

  it("names every rule, with the ceiling on what it may conclude", () => {
    const committed = JSON.parse(committedText) as ReturnType<typeof buildReference>;
    expect(committed.rules).toEqual(
      inferenceRules.map((rule) => ({
        id: rule.id,
        promotable: rule.promotable,
        maximumConfidence: rule.maximumConfidence,
      }))
    );
    // §13. If this ever admits a third tier, a consumer asserting on two would stop being able
    // to detect the difference.
    for (const rule of committed.rules) {
      expect(["low", "moderate"]).toContain(rule.maximumConfidence);
    }
  });
});
