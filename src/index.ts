/**
 * The package's public surface.
 *
 * The exports are grouped by their place in the epistemic chain — event, observation, claim,
 * exposure, interface — because that chain is the argument the package exists to make, and a
 * reader who opens this file first should be able to see it without opening a second one.
 *
 * Every stage is exported, not just the component. A host that could only mount `MirrorPanel`
 * would have to take the pipeline behind it on trust, which is the position §41 exists to refuse.
 * `deriveObservations`, `deriveClaims` and `buildMirrorModel` are pure functions of an event log
 * (§35), so anyone can run the same reading through them and compare the result against what the
 * panel displayed.
 */

// --- the five epistemic objects (§30) ---------------------------------------------------

export type {
  AlternativeExplanation,
  Claim,
  ClaimHistoryEntry,
  ClaimStatus,
  Confidence,
  EvidenceType,
  ExposureState,
  MirrorSession,
  MirrorState,
  Observation,
  ReaderEvent,
  ReaderEventType,
  TemporalValidity,
  UserResponse,
} from "./types";

// --- what the rules are allowed to depend on --------------------------------------------

export { THRESHOLDS } from "./thresholds";
export { PACKAGE_VERSION, RULESET_VERSION } from "./version";
export {
  PASSAGE_MANIFEST_VERSION,
  passageManifest,
  passagesWithCategory,
} from "./manifest";
export type { PassageCategory, PassageDefinition } from "./manifest";
export { MEASUREMENT_DISTORTIONS, UNKNOWNS } from "./authored";

// --- measurement (the only module that touches the browser) -----------------------------

export { mirrorSession } from "./session";
export type { MirrorSnapshot } from "./session";

// --- derivation (pure) ------------------------------------------------------------------

export { deriveObservations, sessionMetrics } from "./observations";
export type { SessionMetrics } from "./observations";
export {
  alternativeExplanations,
  deriveClaims,
  deriveConfidence,
  describeRule,
  evaluateSufficiency,
  inferenceRules,
  ruleById,
} from "./claims";
export type { InferenceRule } from "./claims";
export { buildMirrorModel } from "./runtime";
export type { MirrorModel } from "./runtime";

// --- interface --------------------------------------------------------------------------

export { default as MirrorPanel } from "./ui/MirrorPanel";
export { default as MirrorShell } from "./ui/MirrorShell";
export { default as Passage } from "./ui/Passage";
export {
  useMirrorInstrumentation,
  useMirrorModel,
  useMirrorSnapshot,
} from "./ui/useMirrorSession";
export type { MirrorTarget } from "./ui/useMirrorSession";
