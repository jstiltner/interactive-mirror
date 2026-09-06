/**
 * Observation derivation (spec v0.2 §6, §8, §9, §33, §35).
 *
 * These tests are written against synthetic event logs rather than a browser, because the whole
 * claim of §35 is that the log is sufficient: if a sentence the reader is shown cannot be
 * reproduced from events alone, the audit panel is decorative.
 */

import { describe, expect, it } from "vitest";
import { deriveObservations } from "../src/observations";
import type { PassageDefinition } from "../src/manifest";
import type { ReaderEvent } from "../src/types";
import { readingLog, type Span } from "../fixtures/sessions";

const manifest: PassageDefinition[] = [
  {
    id: "mech-a",
    label: "mechanism A",
    section: "section-ii",
    wordCount: 100,
    categories: ["mechanism", "formal"],
    manifestVersion: "test",
  },
  {
    id: "mech-b",
    label: "mechanism B",
    section: "section-v",
    wordCount: 100,
    categories: ["mechanism"],
    manifestVersion: "test",
  },
  {
    id: "abs-a",
    label: "abstract A",
    section: "section-iii",
    wordCount: 100,
    categories: ["abstract"],
    manifestVersion: "test",
  },
  {
    id: "abs-b",
    label: "abstract B",
    section: "section-iv",
    wordCount: 100,
    categories: ["abstract"],
    manifestVersion: "test",
  },
];

const log = (spans: Span[], extra: Partial<ReaderEvent>[] = [], end = 0) =>
  readingLog(spans, { extra, until: end });

const derive = (events: ReaderEvent[], now: number) =>
  deriveObservations(events, manifest, { now, exposureState: "pre" });

describe("purity (§35)", () => {
  it("produces identical observations for an identical history", () => {
    const events = log([
      { target: "section-ii", from: 0, to: 90_000 },
      { target: "mech-a", section: "section-ii", from: 10_000, to: 80_000 },
    ]);
    expect(derive(events, 100_000)).toEqual(derive(events, 100_000));
  });

  it("derives nothing at all from an empty log", () => {
    expect(derive([], 100_000)).toEqual([]);
  });
});

describe("evidence roots (§33)", () => {
  it("gives a passage and its containing section one root, not two", () => {
    const events = log([
      { target: "section-ii", from: 0, to: 90_000 },
      { target: "mech-a", section: "section-ii", from: 10_000, to: 80_000 },
      { target: "abs-a", section: "section-iii", from: 95_000, to: 100_000 },
      { target: "abs-b", section: "section-iv", from: 105_000, to: 110_000 },
    ]);
    const observations = derive(events, 120_000);
    const section = observations.find((o) => o.ruleId === "section_dwell_v1");
    const passage = observations.find(
      (o) => o.ruleId === "passage_dwell_above_median_v1" && o.target === "mech-a"
    );

    expect(section).toBeDefined();
    expect(passage).toBeDefined();
    expect(passage!.evidenceRootIds).toEqual(section!.evidenceRootIds);
    // Two observations, one behavioural episode: the union is one root, not two.
    expect(new Set([...passage!.evidenceRootIds, ...section!.evidenceRootIds]).size).toBe(1);
  });
});

describe("attention measurement (§6)", () => {
  it("does not accrue dwell while the tab is hidden", () => {
    const spans: Span[] = [{ target: "section-ii", from: 0, to: 120_000 }];
    const visible = derive(log(spans), 120_000);
    const hidden = derive(
      log(spans, [
        { type: "visibility_change", timestamp: 10_000, metadata: { state: "hidden" } },
        { type: "visibility_change", timestamp: 110_000, metadata: { state: "visible" } },
      ]),
      120_000
    );

    expect(visible.find((o) => o.ruleId === "section_dwell_v1")).toBeDefined();
    expect(hidden.find((o) => o.ruleId === "section_dwell_v1")).toBeUndefined();
  });

  it("does not accrue dwell for a reader who has stopped interacting", () => {
    // One enter event, one activity ping, then two minutes of nothing.
    const events: ReaderEvent[] = [
      {
        id: "evt_1",
        type: "section_enter",
        timestamp: 0,
        section: "section-ii",
        exposureState: "pre",
      },
    ];
    const observations = derive(events, 300_000);
    expect(observations.find((o) => o.ruleId === "section_dwell_v1")).toBeUndefined();
  });
});

describe("return detection (§8)", () => {
  it("requires another section in between", () => {
    const withoutInterlude = derive(
      log([
        { target: "section-v", from: 0, to: 20_000 },
        { target: "section-v", from: 25_000, to: 45_000 },
      ]),
      50_000
    );
    expect(withoutInterlude.find((o) => o.ruleId === "section_return_count_v1")).toBeUndefined();

    const withInterlude = derive(
      log([
        { target: "section-v", from: 0, to: 20_000 },
        { target: "section-vi", from: 21_000, to: 30_000 },
        { target: "section-v", from: 31_000, to: 45_000 },
      ]),
      50_000
    );
    const observation = withInterlude.find((o) => o.ruleId === "section_return_count_v1");
    expect(observation?.statement).toBe("Returned to Section V once after reading elsewhere.");
  });
});

describe("normalized dwell (§9)", () => {
  it("stays silent until there are enough passages to have a median", () => {
    const observations = derive(
      log([
        { target: "section-ii", from: 0, to: 90_000 },
        { target: "mech-a", section: "section-ii", from: 0, to: 90_000 },
        { target: "abs-a", section: "section-iii", from: 95_000, to: 100_000 },
      ]),
      110_000
    );
    expect(observations.filter((o) => o.ruleId === "passage_dwell_above_median_v1")).toEqual([]);
  });

  it("records the limiting evidence when abstract passages held attention just as well", () => {
    const observations = derive(
      log([
        { target: "section-ii", from: 0, to: 40_000 },
        { target: "mech-a", section: "section-ii", from: 0, to: 20_000 },
        { target: "section-v", from: 40_000, to: 60_000 },
        { target: "mech-b", section: "section-v", from: 40_000, to: 60_000 },
        { target: "section-iii", from: 60_000, to: 140_000 },
        { target: "abs-a", section: "section-iii", from: 60_000, to: 140_000 },
        { target: "section-iv", from: 140_000, to: 200_000 },
        { target: "abs-b", section: "section-iv", from: 140_000, to: 200_000 },
      ]),
      210_000
    );
    expect(
      observations.find((o) => o.ruleId === "abstract_dwell_matches_mechanism_v1")
    ).toBeDefined();
  });
});
