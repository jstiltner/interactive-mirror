/**
 * The mirror's state machine and the exposure-frozen model (spec v0.2 §17, §18, §19, §19a, §31,
 * §38, §39).
 *
 * This is the only place the two event collections are both read, and it is deliberately the
 * least clever file in the directory. The pre-exposure claims and the post-exposure observations
 * are produced by two separate calls to the same pure derivation, from two separate arrays, and
 * there is no code path here that unions them — the panel's promise that a post-exposure
 * observation is "preserved separately" is meant to be checkable by reading this function rather
 * than believed.
 *
 * Freezing needs no snapshot or memo. Once `exposureTimestamp` is set the pre-exposure array can
 * no longer grow, and derivation is pure (§35), so re-deriving from it at any later moment
 * necessarily reproduces the same claims. The claims are frozen because their inputs are.
 */

import { deriveClaims, type ClaimDerivation } from "./claims";
import { deriveObservations, sessionMetrics, type SessionMetrics } from "./observations";
import type { PassageDefinition } from "./manifest";
import type { MirrorSnapshot } from "./session";
import type { Claim, ClaimHistoryEntry, MirrorState, Observation, UserResponse } from "./types";

export interface MirrorModel {
  state: MirrorState;
  /**
   * The instant the pre-exposure derivation describes: the reveal click once it has happened,
   * and the live clock before that. Every claim below is an answer to "as of when?" and this is
   * the answer.
   */
  derivedAt: number;
  metrics: SessionMetrics;
  observations: Observation[];
  /** Empty until the reader asks. §31 evaluates candidates while collecting; it does not show them. */
  claims: Claim[];
  withheld: ClaimDerivation["withheld"];
  /** §19, §19a. Derived from the other array, shown separately, fed back into nothing. */
  postExposureObservations: Observation[];
  responses: UserResponse[];
}

/**
 * §17 and §31. Exposure and the reader's answers are recorded as history entries. Neither touches
 * the claim's confidence, its supporting observations, or its statement.
 *
 * `status` moves to the reader's most recent answer, which is a record of what they said rather
 * than a verdict on whether the claim is true. "Wrong" does not make the claim false and does not
 * lower its confidence: a response to a claim you have already been shown is not independent
 * evidence about that claim, and treating it as such is the failure the essay is describing.
 */
function expose(claim: Claim, exposedAt: number, responses: readonly UserResponse[]): Claim {
  const mine = responses
    .filter((response) => response.claimId === claim.id)
    .sort((a, b) => a.timestamp - b.timestamp);

  const history: ClaimHistoryEntry[] = [
    ...claim.history,
    {
      id: `${claim.id}_exposed`,
      claimId: claim.id,
      timestamp: exposedAt,
      type: "claim_exposed",
      payload: { confidence: claim.confidence },
    },
    ...mine.map<ClaimHistoryEntry>((response) => ({
      id: `${claim.id}_${response.id}`,
      claimId: claim.id,
      timestamp: response.timestamp,
      type: "user_response_attached",
      // The confidence is written into the entry so the history shows it not moving.
      payload: { response: response.response, confidence: claim.confidence },
    })),
  ];

  return {
    ...claim,
    status: mine.length === 0 ? "exposed" : mine[mine.length - 1].response,
    exposedAt,
    history,
  };
}

/**
 * §45. A claim whose evidence chain cannot be reconstructed is suppressed rather than shown
 * without it. Nothing in the current derivation can produce an unresolvable claim — the claims
 * are built from these same observations moments earlier — but the panel's provenance panel is
 * only meaningful if "every visible claim can show its evidence" is enforced somewhere rather
 * than assumed, and this is the seam where a future rule could break it.
 */
function provenanceResolves(claim: Claim, observations: readonly Observation[]): boolean {
  const known = new Set(observations.map((observation) => observation.id));
  return (
    claim.supportingObservationIds.length > 0 &&
    claim.supportingObservationIds.every((id) => known.has(id))
  );
}

export function buildMirrorModel(
  snapshot: MirrorSnapshot,
  manifest: readonly PassageDefinition[]
): MirrorModel {
  const { session, clock } = snapshot;
  const exposedAt = session.exposureTimestamp;
  const derivedAt = Math.max(exposedAt ?? clock, session.startedAt);

  const observations = deriveObservations(session.preExposureEvents, manifest, {
    now: derivedAt,
    exposureState: "pre",
  });
  const metrics = sessionMetrics(session.preExposureEvents, manifest, derivedAt);
  const derivation = deriveClaims(observations, manifest, metrics, derivedAt);
  const withheld = [...derivation.withheld];
  const candidates = derivation.claims.filter((claim) => {
    if (provenanceResolves(claim, observations)) return true;
    withheld.push({ ruleId: claim.ruleId, reason: "evidence chain could not be reconstructed" });
    return false;
  });

  if (exposedAt === undefined) {
    return {
      state: candidates.length > 0 ? "ready" : "collecting",
      derivedAt,
      metrics,
      observations,
      claims: [],
      withheld,
      postExposureObservations: [],
      responses: [],
    };
  }

  const claims = candidates.map((claim) => expose(claim, exposedAt, session.responses));
  const state: MirrorState =
    claims.length === 0 ? "insufficient" : session.responses.length > 0 ? "post_exposure" : "exposed";

  return {
    state,
    derivedAt,
    metrics,
    observations,
    claims,
    withheld,
    postExposureObservations: deriveObservations(session.postExposureEvents, manifest, {
      now: Math.max(clock, exposedAt),
      exposureState: "post",
    }),
    responses: session.responses,
  };
}
