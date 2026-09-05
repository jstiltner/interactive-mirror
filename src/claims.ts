/**
 * The inference rule table and the claim engine (spec v0.2 §11, §13, §16, §32, §36, §37).
 *
 * Deterministic and hand-authored. No model is called, and that is a design decision rather than
 * a scope cut (§11): an LLM would make the demo look better and its epistemology impossible to
 * inspect, which is the opposite of what the essay it sits inside is arguing for.
 *
 * Everything a rule asserts beyond the reader's own behaviour — the alternative explanations, the
 * distortion caveat, the ceiling on confidence — is written down here as authored text rather
 * than generated, because a claim that cannot name its own alternatives is not a claim the reader
 * can argue with.
 */

import {
  MAX_EXPOSED_CLAIMS,
  MIN_ACTIVE_SESSION_MS,
  MIN_ATTENTION_RATIO,
  MIN_EVIDENCE_TYPES_FOR_MODERATE,
  MIN_MEANINGFUL_PASSAGES,
  MIN_ROOTS_FOR_CLAIM,
  MIN_ROOTS_FOR_MODERATE,
} from "./thresholds";
import type { PassageCategory, PassageDefinition } from "./manifest";
import type { SessionMetrics } from "./observations";
import type {
  AlternativeExplanation,
  Claim,
  ClaimHistoryEntry,
  Confidence,
  Observation,
} from "./types";

export type Requirement =
  | { kind: "observations"; ruleId: string; min: number; category?: PassageCategory }
  | { kind: "observations"; ruleId: string; min: number; targets: string[] }
  | { kind: "roots"; ruleId: string; min: number }
  | { kind: "any_of"; requirements: Requirement[] };

export interface InferenceRule {
  id: string;
  /** The candidate claim, phrased as a possibility about this session and nothing wider (§24). */
  inference: string;
  requiredObservations: Requirement[];
  /** Observation rule ids whose presence argues against the claim (§32's limiting evidence). */
  contradictoryObservations: string[];
  /** Authored, and labelled as authored wherever they are shown (§16). */
  alternatives: string[];
  /** How the page's own shape may have produced the behaviour (§12). */
  distortion: string;
  minimumRoots: number;
  /**
   * False means the rule may never become a claim at all — the honest form of the finding is the
   * observation itself. §32 marks nonlinear reading this way.
   *
   * This is a separate boolean rather than a fourth member of the confidence union. `Confidence`
   * is ordinal and two-valued by design (§13), and a union that also carries "not a claim" is not
   * an ordinal scale — it is a scale with an escape hatch, and every consumer then has to
   * remember that the ceiling might not be a confidence level. Keeping the two facts apart means
   * the only values that can ever reach a reader are "low" and "moderate".
   */
  promotable: boolean;
  maximumConfidence: Confidence;
  manifestDependencies: string[];
}

const MECHANISM_ALTERNATIVES = [
  "You were checking whether the formalism was coherent.",
  "Those passages were harder to follow, so they took longer.",
  "You already knew the surrounding philosophical material.",
  "You were interrupted somewhere else on the page.",
];

const STRUCTURAL_DISTORTION =
  "This essay contains more formal machinery in some sections than others. Your behavior may reflect the structure of the page as much as a stable characteristic of you.";

export const inferenceRules: InferenceRule[] = [
  {
    id: "mechanism_affinity_v1",
    inference: "You may have spent more attention on mechanisms than on abstract framing.",
    requiredObservations: [
      {
        kind: "observations",
        ruleId: "passage_dwell_above_median_v1",
        min: 2,
        category: "mechanism",
      },
      { kind: "roots", ruleId: "section_return_count_v1", min: 1 },
    ],
    contradictoryObservations: ["abstract_dwell_matches_mechanism_v1", "uniform_dwell_v1"],
    alternatives: MECHANISM_ALTERNATIVES,
    distortion: STRUCTURAL_DISTORTION,
    minimumRoots: MIN_ROOTS_FOR_CLAIM,
    promotable: true,
    maximumConfidence: "moderate",
    manifestDependencies: ["archive-self-citation", "performative-loop", "epistemic-history-record"],
  },
  {
    id: "recursive_attention_v1",
    inference: "Recursive or self-referential mechanisms may have held your attention.",
    requiredObservations: [
      {
        kind: "observations",
        ruleId: "passage_dwell_above_median_v1",
        min: 1,
        targets: ["archive-self-citation", "performative-loop"],
      },
      {
        kind: "any_of",
        requirements: [
          { kind: "roots", ruleId: "section_return_count_v1", min: 1 },
          { kind: "roots", ruleId: "citation_open_count_v1", min: 1 },
        ],
      },
    ],
    contradictoryObservations: ["uniform_dwell_v1"],
    alternatives: [
      "Those two passages are among the essay's densest, and density is not preference.",
      "The notation slowed you down.",
      "You had already met performative prediction or the looping effect elsewhere.",
      "Something outside the page interrupted you while those passages were on screen.",
    ],
    distortion: STRUCTURAL_DISTORTION,
    minimumRoots: MIN_ROOTS_FOR_CLAIM,
    promotable: true,
    maximumConfidence: "moderate",
    manifestDependencies: ["archive-self-citation", "performative-loop"],
  },
  {
    id: "evidence_inspection_v1",
    inference: "You may be inclined to inspect how a claim is supported.",
    requiredObservations: [
      {
        kind: "any_of",
        requirements: [
          { kind: "roots", ruleId: "citation_open_count_v1", min: 2 },
          { kind: "roots", ruleId: "section_return_count_v1", min: 2 },
        ],
      },
    ],
    // The limiting evidence in §32 is ordinary linear reading, which is the absence of these
    // observations rather than an observation of its own. The rule simply does not fire.
    contradictoryObservations: [],
    alternatives: [
      "You were checking a citation you already knew.",
      "The reference chips are inline and easy to hit by accident.",
      "You were looking for a specific source rather than examining support.",
    ],
    distortion:
      "The citations in this essay are inline chips rather than footnotes, which makes opening one much cheaper than it would be in print.",
    minimumRoots: MIN_ROOTS_FOR_CLAIM,
    promotable: true,
    maximumConfidence: "moderate",
    manifestDependencies: [],
  },
  {
    id: "nonlinear_reader_v1",
    inference: "You have read parts of this essay out of order.",
    requiredObservations: [{ kind: "roots", ruleId: "section_return_count_v1", min: 2 }],
    contradictoryObservations: [],
    alternatives: [
      "Momentum scrolling carried you back over a boundary.",
      "You were looking for something you had already read.",
    ],
    distortion:
      "Long sections and a small viewport put more boundaries in the way, so the same reading looks more nonlinear on a phone.",
    minimumRoots: MIN_ROOTS_FOR_CLAIM,
    // §32 prefers this as an observation: "you scrolled back twice" is already the finding, and
    // dressing it up as an inference about the reader adds interpretation without adding evidence.
    promotable: false,
    maximumConfidence: "low",
    manifestDependencies: [],
  },
];

export const ruleById = new Map(inferenceRules.map((rule) => [rule.id, rule]));

// --- plain language --------------------------------------------------------------------

/**
 * §41 asks that the rule be stated in plain language next to the claim, on the grounds that a
 * rule the reader cannot read is not a rule they can argue with. These sentences are generated
 * from the requirement structures rather than written alongside them, so a threshold cannot be
 * changed in one place and left describing itself wrongly in the other.
 */
const OBSERVATION_LABELS: Record<string, string> = {
  section_dwell_v1: "sustained reading in a section",
  passage_dwell_above_median_v1: "a passage read for longer per word than your median passage",
  abstract_dwell_matches_mechanism_v1: "equal attention to the abstract and mechanical passages",
  uniform_dwell_v1: "attention spread evenly across every passage",
  section_return_count_v1: "a return to a section after reading elsewhere",
  citation_open_count_v1: "an opened reference citation",
  scroll_direction_reversal_v1: "a reversal of reading direction",
  claim_inspection_count_v1: "an opened claim derivation",
};

function label(ruleId: string): string {
  return OBSERVATION_LABELS[ruleId] ?? ruleId;
}

export function describeRequirement(
  requirement: Requirement,
  manifest: readonly PassageDefinition[]
): string {
  if (requirement.kind === "any_of") {
    return requirement.requirements.map((r) => describeRequirement(r, manifest)).join(", or ");
  }
  if (requirement.kind === "roots") {
    const episodes = requirement.min === 1 ? "episode" : "separate episodes";
    return `${requirement.min} ${episodes} of ${label(requirement.ruleId)}`;
  }
  if ("targets" in requirement) {
    const names = requirement.targets.map(
      (id) => manifest.find((passage) => passage.id === id)?.label ?? id
    );
    return `${requirement.min} instance of ${label(requirement.ruleId)}, on ${names.join(" or ")}`;
  }
  const scope = requirement.category
    ? `, on passages this essay's own manifest marks as ${requirement.category}`
    : "";
  return `${requirement.min} instances of ${label(requirement.ruleId)}${scope}`;
}

/** The whole rule as one sentence: what has to be true, and what would argue against it. */
export function describeRule(rule: InferenceRule, manifest: readonly PassageDefinition[]): string {
  const required = rule.requiredObservations
    .map((requirement) => describeRequirement(requirement, manifest))
    .join("; and ");
  const roots = `across at least ${rule.minimumRoots} independent behavioural episodes`;
  const limiting =
    rule.contradictoryObservations.length === 0
      ? ""
      : ` It drops back to low confidence in the presence of ${rule.contradictoryObservations
          .map(label)
          .join(" or ")}.`;
  return `Fires on ${required}, ${roots}.${limiting}`;
}

export function alternativeExplanations(rule: InferenceRule, claimId: string) {
  return rule.alternatives.map<AlternativeExplanation>((statement, index) => ({
    id: `alt_${rule.id}_${index + 1}`,
    claimId,
    statement,
    source: "author_defined",
  }));
}

// --- matching --------------------------------------------------------------------------

function matches(
  requirement: Requirement,
  observations: readonly Observation[],
  manifest: readonly PassageDefinition[]
): Observation[] | null {
  if (requirement.kind === "any_of") {
    for (const alternative of requirement.requirements) {
      const found = matches(alternative, observations, manifest);
      if (found) return found;
    }
    return null;
  }

  const candidates = observations.filter((observation) => {
    if (observation.ruleId !== requirement.ruleId) return false;
    if (requirement.kind === "roots") return true;
    if ("targets" in requirement) {
      return observation.target !== undefined && requirement.targets.includes(observation.target);
    }
    if (requirement.category) {
      const passage = manifest.find((entry) => entry.id === observation.target);
      return passage?.categories.includes(requirement.category) ?? false;
    }
    return true;
  });

  if (requirement.kind === "roots") {
    const roots = new Set(candidates.flatMap((observation) => observation.evidenceRootIds));
    return roots.size >= requirement.min ? candidates : null;
  }
  return candidates.length >= requirement.min ? candidates : null;
}

// --- confidence ------------------------------------------------------------------------

export interface Sufficiency {
  sampleSufficient: boolean;
  measurementAcceptable: boolean;
}

export function evaluateSufficiency(metrics: SessionMetrics): Sufficiency {
  return {
    sampleSufficient:
      metrics.activeMs >= MIN_ACTIVE_SESSION_MS &&
      metrics.meaningfulPassages >= MIN_MEANINGFUL_PASSAGES,
    measurementAcceptable:
      metrics.elapsedMs > 0 && metrics.activeMs / metrics.elapsedMs >= MIN_ATTENTION_RATIO,
  };
}

/**
 * §36. A candidate begins at low and may reach moderate only when every condition holds. There
 * is no branch above moderate — "relatively strong" is not a tier this version can express (§13),
 * and the type system is the enforcement.
 */
export function deriveConfidence(
  rule: InferenceRule,
  supporting: readonly Observation[],
  contradicting: readonly Observation[],
  sufficiency: Sufficiency
): Confidence {
  const roots = new Set(supporting.flatMap((observation) => observation.evidenceRootIds));
  const types = new Set(supporting.map((observation) => observation.evidenceType));
  // Named for what it tests — whether *this evidence* clears the moderate bar. Distinct from
  // `rule.promotable`, which is about whether the rule may become a claim at all.
  const evidenceClearsModerateBar =
    roots.size >= MIN_ROOTS_FOR_MODERATE &&
    types.size >= MIN_EVIDENCE_TYPES_FOR_MODERATE &&
    sufficiency.sampleSufficient &&
    sufficiency.measurementAcceptable &&
    contradicting.length === 0;
  if (!evidenceClearsModerateBar) return "low";
  return rule.maximumConfidence;
}

// --- claim construction ----------------------------------------------------------------

export interface ClaimDerivation {
  claims: Claim[];
  /** Rules that matched but were held back, with the reason, for the audit view (§25, §48). */
  withheld: { ruleId: string; reason: string }[];
}

/**
 * Builds the candidate claims from pre-exposure observations.
 *
 * The claim histories are reconstructed here rather than accumulated as the session runs. That is
 * only honest because derivation is pure (§35): re-running it over the same log produces the same
 * history, so a reconstructed entry says exactly what a recorded one would have.
 */
export function deriveClaims(
  observations: readonly Observation[],
  manifest: readonly PassageDefinition[],
  metrics: SessionMetrics,
  now: number
): ClaimDerivation {
  const sufficiency = evaluateSufficiency(metrics);
  const claims: Claim[] = [];
  const withheld: ClaimDerivation["withheld"] = [];

  for (const rule of inferenceRules) {
    if (!rule.promotable) continue;

    const matched = rule.requiredObservations.map((requirement) =>
      matches(requirement, observations, manifest)
    );
    if (matched.some((result) => result === null)) continue;

    const supporting = [...new Set(matched.flat() as Observation[])];
    const contradicting = observations.filter((observation) =>
      rule.contradictoryObservations.includes(observation.ruleId)
    );
    const roots = [...new Set(supporting.flatMap((observation) => observation.evidenceRootIds))];

    if (roots.length < rule.minimumRoots) {
      withheld.push({
        ruleId: rule.id,
        reason: `${roots.length} independent evidence root${roots.length === 1 ? "" : "s"}, ${rule.minimumRoots} required`,
      });
      continue;
    }
    if (!sufficiency.sampleSufficient) {
      withheld.push({ ruleId: rule.id, reason: "sample below the minimum in §37" });
      continue;
    }

    const claimId = `claim_${rule.id}`;
    const confidence = deriveConfidence(rule, supporting, contradicting, sufficiency);
    const createdAt = Math.min(now, ...supporting.map((observation) => observation.derivedAt));

    const history: ClaimHistoryEntry[] = [
      {
        id: `${claimId}_h1`,
        claimId,
        timestamp: createdAt,
        type: "claim_created",
        payload: { ruleId: rule.id, confidence: "low" },
      },
      ...supporting.map<ClaimHistoryEntry>((observation, index) => ({
        id: `${claimId}_h${index + 2}`,
        claimId,
        timestamp: observation.derivedAt,
        type: "evidence_attached",
        payload: { observationId: observation.id, evidenceType: observation.evidenceType },
      })),
    ];
    if (confidence !== "low") {
      history.push({
        id: `${claimId}_h${history.length + 1}`,
        claimId,
        timestamp: now,
        type: "confidence_changed",
        payload: { from: "low", to: confidence, roots: roots.length },
      });
    }

    claims.push({
      id: claimId,
      statement: rule.inference,
      epistemicType: "inferred",
      status: "candidate",
      createdAt,
      confidence,
      supportingObservationIds: supporting.map((observation) => observation.id),
      contradictingObservationIds: contradicting.map((observation) => observation.id),
      evidenceRootIds: roots,
      alternativeExplanationIds: alternativeExplanations(rule, claimId).map((alt) => alt.id),
      temporalValidity: {
        scope: "session",
        validFrom: createdAt,
        lastSupportedAt: now,
        note: "session_behavior_only",
      },
      history,
      ruleId: rule.id,
    });
  }

  // Strongest first, then capped. If the cap ever bites, the reader is better served by two
  // defensible claims than by three (§32).
  claims.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "moderate" ? -1 : 1;
    return b.evidenceRootIds.length - a.evidenceRootIds.length;
  });
  for (const extra of claims.slice(MAX_EXPOSED_CLAIMS)) {
    withheld.push({ ruleId: extra.ruleId, reason: "beyond the three-claim maximum" });
  }

  return { claims: claims.slice(0, MAX_EXPOSED_CLAIMS), withheld };
}
