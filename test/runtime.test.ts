/**
 * The state machine, the exposure freeze, and contestation (spec v0.2 §17, §18, §19a, §31, §39).
 *
 * The load-bearing tests here are the ones that try to move a claim after the reader has seen it:
 * by reading more, by answering "Wrong", by answering twice. None of them may succeed.
 */

import { describe, expect, it } from "vitest";
import { buildMirrorModel } from "../src/runtime";
import { passageManifest } from "../src/manifest";
import type { MirrorSnapshot } from "../src/session";
import type { Confidence, MirrorSession, UserResponse } from "../src/types";
import { AFTER_EXPOSURE, ATTENTIVE, GLANCE, readingLog, type Span } from "../fixtures/sessions";

const manifest = passageManifest.passages;

const EXPOSED_AT = 190_000;

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
    preExposureEvents: readingLog(options.spans, { until: 180_000, seed: "pre" }),
    postExposureEvents: options.after
      ? readingLog(options.after, {
          from: 195_000,
          until: 265_000,
          seed: "post",
          exposureState: "post",
        })
      : [],
    responses: options.responses ?? [],
  };
  return { session, clock: options.clock };
}

const model = (options: Parameters<typeof snapshot>[0]) =>
  buildMirrorModel(snapshot(options), manifest);

describe("the ordinal scale stops at moderate (§13, §36)", () => {
  // The rule table is checked elsewhere, but a ceiling declared per rule is not the same claim as
  // a ceiling observed on what the reader is actually shown. This checks the output, including
  // after a reader has agreed with everything — the obvious place for a confidence to creep up.
  const everyClaim = [
    model({ spans: ATTENTIVE, clock: EXPOSED_AT, exposureTimestamp: EXPOSED_AT }),
    model({
      spans: ATTENTIVE,
      clock: 270_000,
      exposureTimestamp: EXPOSED_AT,
      after: AFTER_EXPOSURE,
      responses: [
        { id: "res_1", claimId: "claim_mechanism_affinity_v1", response: "endorsed", timestamp: 200_000 },
        { id: "res_2", claimId: "claim_recursive_attention_v1", response: "endorsed", timestamp: 201_000 },
      ],
    }),
  ].flatMap((built) => built.claims);

  it("shows the reader nothing above moderate", () => {
    expect(everyClaim.length).toBeGreaterThan(0);
    for (const claim of everyClaim) {
      expect(["low", "moderate"], claim.id).toContain(claim.confidence);
    }
  });

  it("records nothing above moderate in the history either", () => {
    // The history is what §46 lets a reader audit. A ceiling enforced on the current value but not
    // on the record would leave a claim that had, on paper, once been certain.
    for (const claim of everyClaim) {
      for (const entry of claim.history) {
        const recorded = (entry.payload as { confidence?: string }).confidence;
        if (recorded === undefined) continue;
        expect(["low", "moderate"], `${claim.id}/${entry.type}`).toContain(recorded);
      }
    }
  });

  it("admits nothing else at the type level", () => {
    // Not a runtime assertion — the value of this test is that `tsc` fails if the union is ever
    // widened, because the expected error would stop happening. It is the structural half of the
    // guarantee: the tests above check what the rules produce, this checks what the type permits.
    // @ts-expect-error "high" is not a member of the ordinal scale §13 defines.
    const widened: Confidence = "high";
    expect(widened).toBe("high");
  });
});

describe("state machine (§31)", () => {
  it("collects quietly while there is not yet a claim to make", () => {
    const collecting = model({ spans: GLANCE, clock: 40_000 });
    expect(collecting.state).toBe("collecting");
    expect(collecting.claims).toEqual([]);
  });

  it("reaches ready without showing anything the reader has not asked for", () => {
    const ready = model({ spans: ATTENTIVE, clock: EXPOSED_AT });
    expect(ready.state).toBe("ready");
    expect(ready.observations.length).toBeGreaterThan(0);
    expect(ready.claims).toEqual([]);
  });

  it("exposes on the reveal, and moves to post_exposure only once the reader answers", () => {
    const exposed = model({ spans: ATTENTIVE, clock: EXPOSED_AT, exposureTimestamp: EXPOSED_AT });
    expect(exposed.state).toBe("exposed");
    expect(exposed.claims.length).toBeGreaterThan(0);
    expect(exposed.claims.every((claim) => claim.status === "exposed")).toBe(true);
    expect(exposed.claims.every((claim) => claim.exposedAt === EXPOSED_AT)).toBe(true);

    const answered = model({
      spans: ATTENTIVE,
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
    const atReveal = model({ spans: ATTENTIVE, clock: EXPOSED_AT, exposureTimestamp: EXPOSED_AT });
    const muchLater = model({ spans: ATTENTIVE, clock: 900_000, exposureTimestamp: EXPOSED_AT });
    expect(muchLater.derivedAt).toBe(EXPOSED_AT);
    expect(muchLater.claims).toEqual(atReveal.claims);
  });

  it("leaves the claims untouched however much the reader reads afterwards", () => {
    const before = model({ spans: ATTENTIVE, clock: EXPOSED_AT, exposureTimestamp: EXPOSED_AT });
    const after = model({
      spans: ATTENTIVE,
      clock: 270_000,
      exposureTimestamp: EXPOSED_AT,
      after: AFTER_EXPOSURE,
    });
    expect(after.claims).toEqual(before.claims);
    expect(after.postExposureObservations.length).toBeGreaterThan(0);
  });
});

describe("the partition holds (§19a, §39)", () => {
  it("never lets a post-exposure observation into a claim's evidence", () => {
    const after = model({
      spans: ATTENTIVE,
      clock: 270_000,
      exposureTimestamp: EXPOSED_AT,
      after: AFTER_EXPOSURE,
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
      spans: ATTENTIVE,
      clock: 270_000,
      exposureTimestamp: EXPOSED_AT,
      after: AFTER_EXPOSURE,
    });
    const sectionX = after.postExposureObservations.find(
      (observation) => observation.target === "section-x"
    );
    expect(sectionX?.ruleId).toBe("section_dwell_v1");
    expect(sectionX?.exposureState).toBe("post");
  });

  it("shows nothing post-exposure before the boundary exists", () => {
    expect(model({ spans: ATTENTIVE, clock: EXPOSED_AT }).postExposureObservations).toEqual([]);
  });
});

describe("contestation (§17)", () => {
  const respond = (response: UserResponse["response"], timestamp: number, id: string) => ({
    id,
    claimId: "claim_mechanism_affinity_v1",
    response,
    timestamp,
  });

  const base = model({ spans: ATTENTIVE, clock: EXPOSED_AT, exposureTimestamp: EXPOSED_AT });
  const original = base.claims.find((claim) => claim.id === "claim_mechanism_affinity_v1")!;

  it("attaches 'Wrong' to the claim without making the claim false", () => {
    const disputed = model({
      spans: ATTENTIVE,
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
      spans: ATTENTIVE,
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
      spans: ATTENTIVE,
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
      spans: ATTENTIVE,
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
    const exposed = model({ spans: ATTENTIVE, clock: EXPOSED_AT, exposureTimestamp: EXPOSED_AT });
    const shown = new Set(exposed.observations.map((observation) => observation.id));

    expect(exposed.claims.length).toBeGreaterThan(0);
    for (const claim of exposed.claims) {
      expect(claim.supportingObservationIds.length).toBeGreaterThan(0);
      for (const id of claim.supportingObservationIds) expect(shown.has(id)).toBe(true);
    }
  });

  it("can resolve every visible observation back to events in the log it was derived from", () => {
    const exposed = model({ spans: ATTENTIVE, clock: EXPOSED_AT, exposureTimestamp: EXPOSED_AT });
    const logged = new Set(
      snapshot({ spans: ATTENTIVE, clock: EXPOSED_AT }).session.preExposureEvents.map((e) => e.id)
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
      spans: ATTENTIVE,
      clock: 270_000,
      exposureTimestamp: EXPOSED_AT,
      after: AFTER_EXPOSURE,
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
