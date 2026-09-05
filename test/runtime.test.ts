/**
 * The state machine, the exposure freeze, and contestation (spec v0.2 §17, §18, §19a, §31, §39).
 *
 * The load-bearing tests here are the ones that try to move a claim after the reader has seen it:
 * by reading more, by answering "Wrong", by answering twice. None of them may succeed.
 */

import { describe, expect, it } from "vitest";
import { buildMirrorModel } from "../src/runtime";
import { passageManifest } from "../src/manifest";
import { ACTIVITY_PING_MS } from "../src/thresholds";
import type { MirrorSnapshot } from "../src/session";
import type { MirrorSession, ReaderEvent, UserResponse } from "../src/types";

const manifest = passageManifest.passages;

interface Span {
  target: string;
  section?: string;
  from: number;
  to: number;
}

/**
 * A log with activity pings dense enough that the reader is never idle. `seed` keeps event ids
 * unique across the pre- and post-exposure arrays of the same session.
 */
function log(spans: Span[], from: number, to: number, seed: string): ReaderEvent[] {
  let seq = 0;
  const events: ReaderEvent[] = [];
  const next = (event: Omit<ReaderEvent, "id" | "exposureState">): ReaderEvent => ({
    id: `evt_${seed}_${++seq}`,
    exposureState: seed === "pre" ? "pre" : "post",
    ...event,
  });

  for (let t = from; t <= to; t += ACTIVITY_PING_MS) {
    events.push(next({ type: "activity", timestamp: t }));
  }
  for (const span of spans) {
    const section = span.section ?? span.target;
    const target = span.section ? span.target : undefined;
    events.push(next({ type: "section_enter", timestamp: span.from, section, target }));
    events.push(next({ type: "section_exit", timestamp: span.to, section, target }));
  }
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * A reader who lingers on the two mechanism passages, skims two abstract ones, and comes back to
 * Section II. Enough for mechanism_affinity_v1 and recursive_attention_v1 at moderate.
 */
const READING: Span[] = [
  { target: "section-ii", from: 0, to: 60_000 },
  { target: "archive-self-citation", section: "section-ii", from: 0, to: 60_000 },
  { target: "section-iii", from: 60_000, to: 80_000 },
  { target: "intuition-limits", section: "section-iii", from: 60_000, to: 80_000 },
  { target: "section-iv", from: 80_000, to: 100_000 },
  { target: "revealed-preference-limits", section: "section-iv", from: 80_000, to: 100_000 },
  { target: "section-v", from: 100_000, to: 160_000 },
  { target: "performative-loop", section: "section-v", from: 100_000, to: 160_000 },
  { target: "section-ii", from: 160_000, to: 180_000 },
];

/** Barely arrived: one section, half a minute, no passage measured against any median. */
const GLANCE: Span[] = [{ target: "section-ii", from: 0, to: 20_000 }];

const EXPOSED_AT = 190_000;

/** Section X, read for a minute after the reveal. The §19a case. */
const AFTER: Span[] = [{ target: "section-x", from: 200_000, to: 265_000 }];

function snapshot(options: {
  spans: Span[];
  clock: number;
  exposureTimestamp?: number;
  after?: Span[];
  responses?: UserResponse[];
}): MirrorSnapshot {
  const session: MirrorSession = {
    startedAt: 0,
    ...(options.exposureTimestamp === undefined
      ? {}
      : { exposureTimestamp: options.exposureTimestamp }),
    preExposureEvents: log(options.spans, 0, 180_000, "pre"),
    postExposureEvents: options.after ? log(options.after, 195_000, 265_000, "post") : [],
    responses: options.responses ?? [],
  };
  return { session, clock: options.clock };
}

const model = (options: Parameters<typeof snapshot>[0]) =>
  buildMirrorModel(snapshot(options), manifest);

describe("state machine (§31)", () => {
  it("collects quietly while there is not yet a claim to make", () => {
    const collecting = model({ spans: GLANCE, clock: 40_000 });
    expect(collecting.state).toBe("collecting");
    expect(collecting.claims).toEqual([]);
  });

  it("reaches ready without showing anything the reader has not asked for", () => {
    const ready = model({ spans: READING, clock: EXPOSED_AT });
    expect(ready.state).toBe("ready");
    expect(ready.observations.length).toBeGreaterThan(0);
    expect(ready.claims).toEqual([]);
  });

  it("exposes on the reveal, and moves to post_exposure only once the reader answers", () => {
    const exposed = model({ spans: READING, clock: EXPOSED_AT, exposureTimestamp: EXPOSED_AT });
    expect(exposed.state).toBe("exposed");
    expect(exposed.claims.length).toBeGreaterThan(0);
    expect(exposed.claims.every((claim) => claim.status === "exposed")).toBe(true);
    expect(exposed.claims.every((claim) => claim.exposedAt === EXPOSED_AT)).toBe(true);

    const answered = model({
      spans: READING,
      clock: 210_000,
      exposureTimestamp: EXPOSED_AT,
      responses: [
        {
          id: "res_1",
          claimId: "claim_mechanism_affinity_v1",
          response: "disputed",
          timestamp: 200_000,
        },
      ],
    });
    expect(answered.state).toBe("post_exposure");
  });

  it("says so rather than lowering a threshold when the reader reveals too early", () => {
    const insufficient = model({
      spans: GLANCE,
      clock: 40_000,
      exposureTimestamp: 40_000,
    });
    expect(insufficient.state).toBe("insufficient");
    expect(insufficient.claims).toEqual([]);
  });
});

describe("the exposure freeze (§18, §38)", () => {
  it("derives the claims as of the reveal, not as of the render", () => {
    const atReveal = model({ spans: READING, clock: EXPOSED_AT, exposureTimestamp: EXPOSED_AT });
    const muchLater = model({ spans: READING, clock: 900_000, exposureTimestamp: EXPOSED_AT });
    expect(muchLater.derivedAt).toBe(EXPOSED_AT);
    expect(muchLater.claims).toEqual(atReveal.claims);
  });

  it("leaves the claims untouched however much the reader reads afterwards", () => {
    const before = model({ spans: READING, clock: EXPOSED_AT, exposureTimestamp: EXPOSED_AT });
    const after = model({
      spans: READING,
      clock: 270_000,
      exposureTimestamp: EXPOSED_AT,
      after: AFTER,
    });
    expect(after.claims).toEqual(before.claims);
    expect(after.postExposureObservations.length).toBeGreaterThan(0);
  });
});

describe("the partition holds (§19a, §39)", () => {
  it("never lets a post-exposure observation into a claim's evidence", () => {
    const after = model({
      spans: READING,
      clock: 270_000,
      exposureTimestamp: EXPOSED_AT,
      after: AFTER,
    });
    const attached = new Set(after.claims.flatMap((claim) => claim.supportingObservationIds));
    const contradicting = new Set(after.claims.flatMap((c) => c.contradictingObservationIds));
    for (const observation of after.postExposureObservations) {
      expect(attached.has(observation.id)).toBe(false);
      expect(contradicting.has(observation.id)).toBe(false);
    }
  });

  it("reads Section X after the reveal through the same rules, from the other collection", () => {
    const after = model({
      spans: READING,
      clock: 270_000,
      exposureTimestamp: EXPOSED_AT,
      after: AFTER,
    });
    const sectionX = after.postExposureObservations.find(
      (observation) => observation.target === "section-x"
    );
    expect(sectionX?.ruleId).toBe("section_dwell_v1");
    expect(sectionX?.exposureState).toBe("post");
  });

  it("shows nothing post-exposure before the boundary exists", () => {
    expect(model({ spans: READING, clock: EXPOSED_AT }).postExposureObservations).toEqual([]);
  });
});

describe("contestation (§17)", () => {
  const respond = (response: UserResponse["response"], timestamp: number, id: string) => ({
    id,
    claimId: "claim_mechanism_affinity_v1",
    response,
    timestamp,
  });

  const base = model({ spans: READING, clock: EXPOSED_AT, exposureTimestamp: EXPOSED_AT });
  const original = base.claims.find((claim) => claim.id === "claim_mechanism_affinity_v1")!;

  it("attaches 'Wrong' to the claim without making the claim false", () => {
    const disputed = model({
      spans: READING,
      clock: 210_000,
      exposureTimestamp: EXPOSED_AT,
      responses: [respond("disputed", 200_000, "res_1")],
    });
    const claim = disputed.claims.find((c) => c.id === original.id)!;

    expect(claim.status).toBe("disputed");
    expect(claim.confidence).toBe(original.confidence);
    expect(claim.statement).toBe(original.statement);
    expect(claim.supportingObservationIds).toEqual(original.supportingObservationIds);
    expect(claim.contradictingObservationIds).toEqual(original.contradictingObservationIds);

    const attached = claim.history.filter((entry) => entry.type === "user_response_attached");
    expect(attached).toHaveLength(1);
    expect(attached[0].payload).toEqual({ response: "disputed", confidence: original.confidence });
  });

  it("does not promote the claim to a fact when the reader agrees", () => {
    const endorsed = model({
      spans: READING,
      clock: 210_000,
      exposureTimestamp: EXPOSED_AT,
      responses: [respond("endorsed", 200_000, "res_1")],
    });
    const claim = endorsed.claims.find((c) => c.id === original.id)!;
    expect(claim.epistemicType).toBe("inferred");
    expect(claim.confidence).toBe(original.confidence);
    expect(claim.temporalValidity.scope).toBe("session");
  });

  it("appends a second answer rather than replacing the first", () => {
    const twice = model({
      spans: READING,
      clock: 220_000,
      exposureTimestamp: EXPOSED_AT,
      responses: [respond("disputed", 200_000, "res_1"), respond("qualified", 210_000, "res_2")],
    });
    const claim = twice.claims.find((c) => c.id === original.id)!;
    const attached = claim.history.filter((entry) => entry.type === "user_response_attached");
    expect(attached.map((entry) => entry.payload.response)).toEqual(["disputed", "qualified"]);
    expect(claim.status).toBe("qualified");
  });

  it("leaves the other claims alone", () => {
    const disputed = model({
      spans: READING,
      clock: 210_000,
      exposureTimestamp: EXPOSED_AT,
      responses: [respond("disputed", 200_000, "res_1")],
    });
    for (const claim of disputed.claims) {
      if (claim.id === original.id) continue;
      expect(claim.status).toBe("exposed");
    }
  });
});

describe("provenance (§45, §46)", () => {
  it("can resolve every visible claim's evidence back to a visible observation", () => {
    const exposed = model({ spans: READING, clock: EXPOSED_AT, exposureTimestamp: EXPOSED_AT });
    const shown = new Set(exposed.observations.map((observation) => observation.id));

    expect(exposed.claims.length).toBeGreaterThan(0);
    for (const claim of exposed.claims) {
      expect(claim.supportingObservationIds.length).toBeGreaterThan(0);
      for (const id of claim.supportingObservationIds) expect(shown.has(id)).toBe(true);
    }
  });

  it("can resolve every visible observation back to events in the log it was derived from", () => {
    const exposed = model({ spans: READING, clock: EXPOSED_AT, exposureTimestamp: EXPOSED_AT });
    const logged = new Set(
      snapshot({ spans: READING, clock: EXPOSED_AT }).session.preExposureEvents.map((e) => e.id)
    );
    for (const observation of exposed.observations) {
      expect(observation.evidenceEventIds.length).toBeGreaterThan(0);
      for (const id of observation.evidenceEventIds) expect(logged.has(id)).toBe(true);
    }
  });
});

describe("reproducibility (§35)", () => {
  it("builds the same model twice from the same session", () => {
    const options = {
      spans: READING,
      clock: 270_000,
      exposureTimestamp: EXPOSED_AT,
      after: AFTER,
      responses: [
        {
          id: "res_1",
          claimId: "claim_mechanism_affinity_v1",
          response: "qualified" as const,
          timestamp: 200_000,
        },
      ],
    };
    expect(model(options)).toEqual(model(options));
  });
});
