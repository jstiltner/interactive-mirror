/**
 * Data schemas for the Section VIII mirror (spec v0.2 §30).
 *
 * The shapes here are the point of the component, not incidental plumbing. The essay argues
 * that a user model should preserve the history of its claims rather than a polished
 * conclusion, so the code keeps five epistemic objects physically distinct — event,
 * observation, claim, user response, claim history — instead of collapsing them into one
 * mutable "profile" record. Anything that reads like ceremony here is usually an invariant.
 */

export type ExposureState = "pre" | "post";

/**
 * Ordinal, and deliberately two-valued. The spec's full scale contemplates a third tier
 * ("relatively strong"), but §13 puts it out of scope for v1 and asks that no reachable code
 * path produce it: a few minutes of one reader's scrolling cannot support a strong claim, and
 * an essay arguing that point should not ship a widget that contradicts it. Widening this
 * union is therefore a substantive change, not a typing convenience.
 */
export type Confidence = "low" | "moderate";

export type ClaimStatus = "candidate" | "exposed" | "endorsed" | "disputed" | "qualified";

export type ReaderEventType =
  | "section_enter"
  | "section_exit"
  | "scroll_direction_change"
  | "passage_return"
  | "visibility_change"
  | "citation_open"
  | "mirror_open"
  | "claim_open"
  | "claim_response"
  /**
   * Not in the spec's §30 list. Added because §6 makes dwell depend on "recent user activity
   * is within inactivity window", and §35 requires observations to be a pure function of the
   * event log — so the activity signal has to live in the log rather than in a side channel
   * the rules read out of band. Throttled hard (see ACTIVITY_PING_MS) so a scroll gesture
   * contributes a handful of records rather than hundreds.
   */
  | "activity";

export interface ReaderEvent {
  id: string;
  type: ReaderEventType;
  /** Milliseconds since the session started, from performance.now(). Monotonic. */
  timestamp: number;
  /** Section id, for section-scoped events. */
  section?: string;
  /** Passage id, reference id, or claim id, depending on type. */
  target?: string;
  exposureState: ExposureState;
  metadata?: Record<string, string | number | boolean>;
}

export interface Observation {
  id: string;
  /** Reader-facing sentence. Describes what happened, never what it supposedly means (§5). */
  statement: string;
  evidenceEventIds: string[];
  /**
   * The independent behavioural episodes behind this observation (§14, §33). Two observations
   * derived from one 94-second visit share a root, and confidence counts roots rather than
   * observations — which is the whole point, since counting observations is precisely how an
   * archive starts citing itself.
   */
  evidenceRootIds: string[];
  /** Coarse kind of evidence, for the "diversity of evidence types" test in §36. */
  evidenceType: EvidenceType;
  /**
   * Section or passage the observation is about. Not in §30's schema; required because §32's
   * rules quantify over passage categories ("above-median dwell on >= 2 mechanism passages"),
   * which a rule cannot check against a bare sentence without parsing English back out of it.
   */
  target?: string;
  derivedAt: number;
  exposureState: ExposureState;
  ruleId: string;
}

export type EvidenceType = "dwell" | "return" | "citation" | "provenance" | "sequence";

export interface AlternativeExplanation {
  id: string;
  claimId: string;
  statement: string;
  /** Always authored. These are not discovered from behaviour and must not be presented as if
   *  they were (§16). */
  source: "author_defined";
}

export interface TemporalValidity {
  scope: "session";
  validFrom: number;
  lastSupportedAt: number;
  note: "session_behavior_only" | "insufficient_evidence" | "post_exposure_boundary";
}

export interface ClaimHistoryEntry {
  id: string;
  claimId: string;
  timestamp: number;
  type:
    | "claim_created"
    | "evidence_attached"
    | "confidence_changed"
    | "claim_exposed"
    | "user_response_attached"
    | "post_exposure_observation_recorded";
  payload: Record<string, unknown>;
}

export interface Claim {
  id: string;
  statement: string;
  epistemicType: "inferred";
  status: ClaimStatus;
  createdAt: number;
  exposedAt?: number;
  confidence: Confidence;
  supportingObservationIds: string[];
  contradictingObservationIds: string[];
  evidenceRootIds: string[];
  /**
   * Ids into the rule's authored alternatives. Stored as references, not copies, because these
   * are properties of the rule rather than findings about the reader (§16) — inlining them into
   * the claim would blur exactly the line the component exists to draw.
   */
  alternativeExplanationIds: string[];
  temporalValidity: TemporalValidity;
  history: ClaimHistoryEntry[];
  ruleId: string;
}

export interface UserResponse {
  id: string;
  claimId: string;
  response: "endorsed" | "disputed" | "qualified";
  timestamp: number;
}

export interface MirrorSession {
  startedAt: number;
  exposureTimestamp?: number;
  /**
   * Physically separate collections rather than one array with a boolean filter (§39). A
   * filter is a rule someone can forget to apply; two arrays are a rule the type system helps
   * enforce, and the non-merging guarantee is the central constraint of the experiment.
   */
  preExposureEvents: ReaderEvent[];
  postExposureEvents: ReaderEvent[];
  responses: UserResponse[];
}

/** What the reveal control has to work with, and therefore which UI state applies (§31). */
export type MirrorState =
  | "collecting"
  | "insufficient"
  | "ready"
  | "exposed"
  | "post_exposure";
