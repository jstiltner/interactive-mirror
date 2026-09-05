/**
 * Claim derivation (spec v0.2 §13, §32, §36, §37, §46).
 *
 * The tests that matter here are the ones that check the mirror stays quiet: a claim withheld for
 * thin evidence is the specified behaviour, not a failure, and the preferred failure mode is
 * insufficient evidence.
 */

import { describe, expect, it } from "vitest";
import { deriveClaims, deriveConfidence, inferenceRules } from "../src/claims";
import {
  MAX_EXPOSED_CLAIMS,
  MIN_ACTIVE_SESSION_MS,
  MIN_MEANINGFUL_PASSAGES,
} from "../src/thresholds";
import { passageManifest } from "../src/manifest";
import type { SessionMetrics } from "../src/observations";
import type { EvidenceType, Observation } from "../src/types";

const manifest = passageManifest.passages;

const ample: SessionMetrics = {
  activeMs: 400_000,
  elapsedMs: 500_000,
  meaningfulPassages: 6,
  meaningfulSections: 8,
};

function obs(
  ruleId: string,
  roots: string[],
  evidenceType: EvidenceType,
  target?: string
): Observation {
  return {
    id: `obs_${ruleId}_${target ?? "session"}`,
    statement: `${ruleId} for ${target ?? "session"}`,
    evidenceEventIds: roots.map((root) => `evt_${root}`),
    evidenceRootIds: roots,
    evidenceType,
    derivedAt: 1000,
    exposureState: "pre",
    ruleId,
    ...(target ? { target } : {}),
  };
}

/** Enough to fire mechanism_affinity_v1 at moderate: 3 roots, 2 evidence types. */
const mechanismEvidence: Observation[] = [
  obs("passage_dwell_above_median_v1", ["root_a"], "dwell", "archive-self-citation"),
  obs("passage_dwell_above_median_v1", ["root_b"], "dwell", "performative-loop"),
  obs("section_return_count_v1", ["root_c"], "return", "section-v"),
];

describe("rule table (§32)", () => {
  it("never allows a rule to exceed moderate confidence (§13)", () => {
    for (const rule of inferenceRules) {
      expect(["low", "moderate"]).toContain(rule.maximumConfidence);
    }
  });

  it("keeps nonlinear reading as an observation rather than an inference", () => {
    const rule = inferenceRules.find((r) => r.id === "nonlinear_reader_v1");
    expect(rule?.promotable).toBe(false);

    const { claims } = deriveClaims(
      [
        obs("section_return_count_v1", ["root_a", "root_b"], "return", "section-v"),
        obs("section_return_count_v1", ["root_c"], "return", "section-ii"),
      ],
      manifest,
      ample,
      10_000
    );
    expect(claims.map((claim) => claim.ruleId)).not.toContain("nonlinear_reader_v1");
  });

  it("authors alternative explanations and a distortion for every rule (§12, §16)", () => {
    for (const rule of inferenceRules) {
      expect(rule.alternatives.length, rule.id).toBeGreaterThanOrEqual(2);
      expect(rule.distortion.length, rule.id).toBeGreaterThan(0);
    }
  });

  it("claims nothing beyond the current session (§24)", () => {
    for (const rule of inferenceRules) {
      expect(rule.inference.toLowerCase()).not.toMatch(
        /\b(you are|personality|always|type|intelligen)/
      );
    }
  });
});

describe("minimum evidence (§37)", () => {
  it("withholds a claim whose observations trace back to one behavioural episode", () => {
    const sameRoot: Observation[] = [
      obs("passage_dwell_above_median_v1", ["root_a"], "dwell", "archive-self-citation"),
      obs("passage_dwell_above_median_v1", ["root_a"], "dwell", "performative-loop"),
      obs("section_return_count_v1", ["root_a"], "return", "section-v"),
    ];
    const { claims, withheld } = deriveClaims(sameRoot, manifest, ample, 10_000);
    expect(claims.map((claim) => claim.ruleId)).not.toContain("mechanism_affinity_v1");
    expect(withheld.some((entry) => entry.reason.includes("independent evidence root"))).toBe(true);
  });

  it("withholds every claim when the reader has barely been here", () => {
    const thin: SessionMetrics = {
      activeMs: MIN_ACTIVE_SESSION_MS - 1,
      elapsedMs: MIN_ACTIVE_SESSION_MS,
      meaningfulPassages: MIN_MEANINGFUL_PASSAGES,
      meaningfulSections: 3,
    };
    const { claims, withheld } = deriveClaims(mechanismEvidence, manifest, thin, 10_000);
    expect(claims).toEqual([]);
    expect(withheld.every((entry) => entry.reason.includes("§37"))).toBe(true);
  });

  it("fires when the evidence is genuinely independent", () => {
    const { claims } = deriveClaims(mechanismEvidence, manifest, ample, 10_000);
    const claim = claims.find((c) => c.ruleId === "mechanism_affinity_v1");
    expect(claim).toBeDefined();
    expect(claim!.epistemicType).toBe("inferred");
    expect(claim!.status).toBe("candidate");
    expect(claim!.temporalValidity.scope).toBe("session");
    expect(claim!.confidence).toBe("moderate");
  });

  it("never exposes more than three claims", () => {
    const { claims } = deriveClaims(
      [
        ...mechanismEvidence,
        obs("citation_open_count_v1", ["root_d", "root_e"], "citation"),
        obs("passage_dwell_above_median_v1", ["root_f"], "dwell", "epistemic-history-record"),
      ],
      manifest,
      ample,
      10_000
    );
    expect(claims.length).toBeLessThanOrEqual(MAX_EXPOSED_CLAIMS);
  });
});

describe("confidence (§36)", () => {
  const rule = inferenceRules.find((r) => r.id === "mechanism_affinity_v1")!;
  const sufficient = { sampleSufficient: true, measurementAcceptable: true };

  it("stays low on a single kind of evidence however many roots there are", () => {
    const supporting = [
      obs("passage_dwell_above_median_v1", ["root_a"], "dwell", "archive-self-citation"),
      obs("passage_dwell_above_median_v1", ["root_b"], "dwell", "performative-loop"),
      obs("passage_dwell_above_median_v1", ["root_c"], "dwell", "epistemic-history-record"),
    ];
    expect(deriveConfidence(rule, supporting, [], sufficient)).toBe("low");
  });

  it("stays low when the measurement was mostly absence", () => {
    expect(
      deriveConfidence(rule, mechanismEvidence, [], {
        sampleSufficient: true,
        measurementAcceptable: false,
      })
    ).toBe("low");
  });

  it("drops back to low when contradictory evidence is present rather than averaging it away", () => {
    const contradiction = [obs("uniform_dwell_v1", ["root_z"], "dwell")];
    expect(deriveConfidence(rule, mechanismEvidence, contradiction, sufficient)).toBe("low");
  });

  it("keeps contradictions attached to the claim instead of discarding them", () => {
    const { claims } = deriveClaims(
      [...mechanismEvidence, obs("uniform_dwell_v1", ["root_z"], "dwell")],
      manifest,
      ample,
      10_000
    );
    const claim = claims.find((c) => c.ruleId === "mechanism_affinity_v1");
    expect(claim!.contradictingObservationIds).toHaveLength(1);
    expect(claim!.confidence).toBe("low");
  });
});

describe("claim history (§30 invariants)", () => {
  it("records creation and every piece of attached evidence", () => {
    const { claims } = deriveClaims(mechanismEvidence, manifest, ample, 10_000);
    const claim = claims.find((c) => c.ruleId === "mechanism_affinity_v1")!;
    expect(claim.history[0].type).toBe("claim_created");
    expect(claim.history.filter((entry) => entry.type === "evidence_attached")).toHaveLength(
      claim.supportingObservationIds.length
    );
    expect(claim.exposedAt).toBeUndefined();
  });

  it("is reproducible: the same observations yield the same claims", () => {
    const first = deriveClaims(mechanismEvidence, manifest, ample, 10_000);
    const second = deriveClaims(mechanismEvidence, manifest, ample, 10_000);
    expect(first).toEqual(second);
  });
});
