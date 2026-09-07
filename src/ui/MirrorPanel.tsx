"use client";

import { useEffect, useRef, useState } from "react";
import { MEASUREMENT_DISTORTIONS, UNKNOWNS } from "../authored";
import { describeRule, ruleById } from "../claims";
import {
  InsufficientEvidence,
  MirrorFrame,
  PanelHeading,
  RuleSourceLink,
} from "./MirrorShell";
import { describeIdentity, type MirrorBuildIdentity } from "../identity";
import { passageManifest } from "../manifest";
import { approximateSeconds } from "../observations";
import { mirrorSession } from "../session";
import { useMirrorModel } from "./useMirrorSession";
import type { Claim, Observation, UserResponse } from "../types";

/**
 * The reader-facing mirror (spec v0.2 §1, §17, §19, §19a, §20, §21, §22, §40, §41, §43).
 *
 * Two things in here are the point rather than the chrome. The first is that nothing is shown
 * until the reader presses the button: the claims exist in memory from about two minutes in, and
 * withholding them until they are asked for is what makes the exposure timestamp mean something.
 * The second is that the response buttons are wired to `attachResponse` and to nothing else —
 * pressing "Wrong" writes a line into the claim's history and leaves the claim, its evidence and
 * its confidence exactly where they were.
 *
 * The four categories are rendered in §40's order and are always all four, including for a reader
 * on a phone whose session qualified for no inference at all (§21). A category that disappears
 * when it would be inconvenient is not a category.
 */

const RESPONSES: { label: string; value: UserResponse["response"] }[] = [
  { label: "Accurate", value: "endorsed" },
  { label: "Wrong", value: "disputed" },
  { label: "More complicated", value: "qualified" },
];

const RESPONSE_LABELS: Record<UserResponse["response"], string> = {
  endorsed: "accurate",
  disputed: "wrong",
  qualified: "more complicated",
};

const manifest = passageManifest.passages;

function ObservationList({ observations }: { observations: Observation[] }) {
  return (
    <ul className="mirror-list">
      {observations.map((observation) => (
        <li key={observation.id}>{observation.statement}</li>
      ))}
    </ul>
  );
}

function ClaimCard({
  claim,
  observations,
  responses,
  identity,
}: {
  claim: Claim;
  observations: Map<string, Observation>;
  responses: UserResponse[];
  identity: MirrorBuildIdentity;
}) {
  const [open, setOpen] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const rule = ruleById.get(claim.ruleId);

  // §22 focus management: opening the derivation moves the reader into it, so a keyboard or
  // screen-reader user lands on the evidence rather than having it appear silently below them.
  useEffect(() => {
    if (open) detailRef.current?.focus();
  }, [open]);

  if (!rule) return null;

  const toggle = () => {
    // Opening the derivation is itself post-exposure reading behaviour, and is logged as such.
    if (!open) mirrorSession.noteClaimOpen(claim.id);
    setOpen((wasOpen) => !wasOpen);
  };

  const resolve = (ids: string[]) =>
    ids
      .map((id) => observations.get(id))
      .filter((observation): observation is Observation => observation !== undefined);
  const support = resolve(claim.supportingObservationIds);
  const against = resolve(claim.contradictingObservationIds);
  const detailId = `${claim.id}_detail`;

  return (
    <li
      className="mirror-claim"
      data-mirror-claim
      data-claim-id={claim.id}
      data-rule-id={claim.ruleId}
      data-confidence={claim.confidence}
    >
      <div className="mirror-claim__head">
        <p className="mirror-claim__statement" data-mirror-claim-statement>
          {claim.statement}
        </p>
        <span className="mirror-claim__confidence" data-confidence={claim.confidence}>
          {claim.confidence} confidence
        </span>
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={detailId}
        data-mirror-claim-toggle
        className="mirror-button mirror-button--link mirror-mt-2"
      >
        {open ? "Hide" : "What this was derived from"}
      </button>

      {open && (
        <div
          id={detailId}
          ref={detailRef}
          tabIndex={-1}
          data-mirror-claim-detail
          className="mirror-claim__detail"
        >
          <div className="mirror-detail">
            <h6 className="mirror-detail__title">Evidence</h6>
            <ul className="mirror-detail__list">
              {support.map((observation) => (
                <li key={observation.id}>
                  {observation.statement}{" "}
                  <RuleSourceLink identity={identity} ruleId={observation.ruleId} />
                </li>
              ))}
            </ul>
            <p className="mirror-detail__aside">
              Drawn from{" "}
              {claim.evidenceRootIds.length === 1
                ? "one behavioural episode"
                : `${claim.evidenceRootIds.length} separate behavioural episodes`}
              . {describeRule(rule, manifest)}
            </p>
            {/* §41's last link: rule id to the exact lines, at the revision now deployed. */}
            <p className="mirror-detail__aside">
              Rule: <RuleSourceLink identity={identity} ruleId={rule.id} />
            </p>
          </div>

          {against.length > 0 && (
            <div className="mirror-detail">
              <h6 className="mirror-detail__title">Evidence against</h6>
              <ul className="mirror-detail__list">
                {against.map((observation) => (
                  <li key={observation.id}>{observation.statement}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mirror-detail">
            <h6 className="mirror-detail__title">Plausible alternatives</h6>
            <p className="mirror-detail__aside">
              Written by the author of this page in advance, not found in your behaviour.
            </p>
            <ul className="mirror-detail__list">
              {rule.alternatives.map((alternative) => (
                <li key={alternative}>{alternative}</li>
              ))}
            </ul>
          </div>

          <div className="mirror-detail">
            <h6 className="mirror-detail__title">Possible distortion</h6>
            <p>{rule.distortion}</p>
          </div>
        </div>
      )}

      <div className="mirror-responses">
        {RESPONSES.map(({ label, value }) => (
          <button
            key={value}
            type="button"
            onClick={() => mirrorSession.attachResponse(claim.id, value)}
            className="mirror-button"
            data-mirror-response={value}
          >
            {label}
          </button>
        ))}
      </div>

      <div aria-live="polite">
        {responses.length > 0 && (
          <div className="mirror-claim__history">
            <p className="mirror-claim__history-lead">
              Your response has been attached to the inference.
            </p>
            <ol className="mirror-claim__history-list" data-mirror-claim-history>
              {responses.map((response) => (
                <li key={response.id}>
                  You marked this <strong>{RESPONSE_LABELS[response.response]}</strong>. The claim,
                  its evidence and its confidence are unchanged.
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * `identity` is required, not optional with a fallback. A host that forgets it fails `tsc`, which
 * is the point: an optional build identity would degrade to a panel whose audit links go nowhere,
 * and a broken link is worse than an absent one — it looks like verification.
 */
export default function MirrorPanel({ identity }: { identity: MirrorBuildIdentity }) {
  const model = useMirrorModel();
  const [showRules, setShowRules] = useState(false);
  const exposed = model.state !== "collecting" && model.state !== "ready";

  const observations = new Map(
    model.observations.map((observation) => [observation.id, observation])
  );
  const ruleDistortions = [
    ...new Set(
      model.claims
        .map((claim) => ruleById.get(claim.ruleId)?.distortion)
        .filter((distortion): distortion is string => distortion !== undefined)
    ),
  ];

  if (!exposed) {
    return (
      <MirrorFrame identity={identity} state={model.state}>
        <div>
          <p className="mirror-prose mirror-mb-3">
            {model.state === "ready"
              ? "There is now enough here to say something. Nothing has been shown to you, and nothing about what you do next has been fixed, until you ask."
              : "Not enough yet. Reading on will give it more to work with; asking now is also a legitimate answer, and you will be told what it could not conclude."}
          </p>
          <p className="mirror-note mirror-mb-4">
            {approximateSeconds(model.metrics.activeMs)} of active reading,{" "}
            {model.metrics.meaningfulSections} section
            {model.metrics.meaningfulSections === 1 ? "" : "s"} and{" "}
            {model.metrics.meaningfulPassages} marked passage
            {model.metrics.meaningfulPassages === 1 ? "" : "s"} measured so far.
          </p>
          <button
            type="button"
            onClick={() => mirrorSession.reveal()}
            className="mirror-button mirror-button--primary"
            data-mirror-reveal
          >
            See what this page thinks
          </button>
          <p className="mirror-note mirror-note--fine mirror-mt-2">
            Pressing this fixes the claims at that instant. Everything you do afterwards is kept
            separately and cannot change them.
          </p>
        </div>
        <MirrorRules identity={identity} showRules={showRules} onToggle={() => setShowRules((was) => !was)} />
      </MirrorFrame>
    );
  }

  return (
    <MirrorFrame identity={identity} state={model.state}>
      {model.state === "insufficient" ? (
        <InsufficientEvidence observations={model.observations} />
      ) : (
        <>
          <div>
            <PanelHeading>Observed</PanelHeading>
            <p className="mirror-note mirror-mb-2">
              As it stood when you asked, {approximateSeconds(model.metrics.elapsedMs)} into this
              page view. These do not change from here.
            </p>
            <ObservationList observations={model.observations} />
          </div>

          <div>
            <PanelHeading>Inferred</PanelHeading>
            <ul className="mirror-claims">
              {model.claims.map((claim) => (
                <ClaimCard
                  key={claim.id}
                  claim={claim}
                  observations={observations}
                  responses={model.responses.filter((r) => r.claimId === claim.id)}
                  identity={identity}
                />
              ))}
            </ul>
          </div>

          <div>
            <PanelHeading>Unknown</PanelHeading>
            <ul className="mirror-list">
              {UNKNOWNS.map((unknown) => (
                <li key={unknown}>{unknown}</li>
              ))}
            </ul>
          </div>
        </>
      )}

      <div>
        <PanelHeading>Possible distortion</PanelHeading>
        <ul className="mirror-list">
          {[...MEASUREMENT_DISTORTIONS, ...ruleDistortions].map((distortion) => (
            <li key={distortion}>{distortion}</li>
          ))}
        </ul>
      </div>

      <div aria-live="polite" data-mirror-post-exposure>
        <PanelHeading>Since viewing your reflection</PanelHeading>
        {model.postExposureObservations.length === 0 ? (
          <p className="mirror-prose">Nothing measured yet.</p>
        ) : (
          <>
            <p className="mirror-prose mirror-mb-2">New observations are available.</p>
            <ObservationList observations={model.postExposureObservations} />
            <p className="mirror-prose mirror-prose--lead mirror-mt-3">Model update: withheld</p>
            <p className="mirror-note">
              <em>Post-exposure observations preserved separately.</em>
            </p>
            {model.claims.length > 0 && (
              <p className="mirror-prose mirror-mt-2">
                Some of this may fit the claims above. None of it is being used to strengthen them.
                There is no version of you who read this far without having been described, so
                reading that follows the description cannot be told apart from a response to it.
              </p>
            )}
          </>
        )}
      </div>

      <MirrorRules identity={identity} showRules={showRules} onToggle={() => setShowRules((was) => !was)} />
    </MirrorFrame>
  );
}

function MirrorRules({
  identity,
  showRules,
  onToggle,
}: {
  identity: MirrorBuildIdentity;
  showRules: boolean;
  onToggle: () => void;
}) {
  const described = describeIdentity(identity);
  return (
    <div className="mirror-rules">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={showRules}
        aria-controls="mirror-rules"
        className="mirror-button mirror-button--link"
        data-mirror-rules-toggle
      >
        {showRules ? "Hide the rules" : "The rules, in plain language"}
      </button>
      {showRules && (
        <div id="mirror-rules" className="mirror-rules__body">
          <p className="mirror-note">
            This is the whole inference engine. No model is called and no heuristic is learned: a
            handful of thresholds, written by hand in advance, over measurements of your own reading
            compared against your own median. Two measurements of the same stretch of reading count
            as one piece of evidence, not two, which is why a rule can need three separate episodes
            and still not fire. Confidence is capped at moderate by construction — a few minutes of
            one person&apos;s scrolling cannot support a stronger claim than that — and answering{" "}
            <em>accurate</em> does not raise it, because a response to a claim you have already been
            shown is not independent evidence about that claim.
          </p>
          <ol className="mirror-rules__list">
            {[...ruleById.values()].map((rule) => (
              <li key={rule.id} className="mirror-rule" data-mirror-rule data-rule-id={rule.id}>
                <span className="mirror-rule__inference">{rule.inference}</span>{" "}
                <span className="mirror-rule__ceiling">
                  (
                  {rule.promotable
                    ? `${rule.maximumConfidence} confidence at most`
                    : "never promoted to a claim — the observation is the honest form"}
                  )
                </span>{" "}
                <RuleSourceLink identity={identity} ruleId={rule.id} />
                <br />
                {describeRule(rule, manifest)}
              </li>
            ))}
          </ol>

          {/*
            The four identifiers that make the links above mean something. Split across two
            repositories on purpose: three describe this package, and the commit is supplied by
            the site that installed it, because a file cannot contain the hash of the commit
            containing it.
          */}
          <dl className="mirror-identity-list" data-mirror-identity-detail>
            <dt>package</dt>
            <dd>{described.packageVersion}</dd>
            <dt>ruleset</dt>
            <dd>{described.rulesetVersion}</dd>
            <dt>manifest</dt>
            <dd>{described.manifestVersion}</dd>
            <dt>commit</dt>
            <dd>
              <a href={described.treeUrl} rel="noopener noreferrer" target="_blank">
                {described.commit}
              </a>
            </dd>
          </dl>
        </div>
      )}
    </div>
  );
}
