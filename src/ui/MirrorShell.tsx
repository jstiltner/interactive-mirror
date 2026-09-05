import { UNKNOWNS } from "../authored";
import type { Observation } from "../types";

/**
 * The inert shell (spec v0.2 §4, §20, §45).
 *
 * This is what the server renders and what stands in while the mirror's own bundle loads. It is
 * deliberately the honest "not enough evidence" state rather than a skeleton or a spinner: at
 * that moment the component genuinely knows nothing about the reader, and §20 asks it to say so
 * rather than render a guessed reflection that the real one will then contradict.
 *
 * No hooks, no instrumentation, no imports from the session store — nothing in this file may run
 * anything during server render.
 */

export function PanelHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="mirror-heading">{children}</h4>;
}

/**
 * `state` is stamped into the DOM rather than kept in React alone. §31's state machine is a claim
 * about the artifact — that a reflection cannot be shown before the reader asks for it — and a
 * claim that can only be checked by reading minified JavaScript is not one a reader can check.
 * A `data-` attribute survives the production build intact, so the boundary is testable against
 * the deployed page rather than against the source.
 */
export function MirrorFrame({
  children,
  state = "loading",
}: {
  children: React.ReactNode;
  state?: string;
}) {
  return (
    <div className="mirror" data-mirror-root data-mirror-state={state}>
      <div className="mirror__header">
        <h3 className="mirror__title">The mirror</h3>
        <p className="mirror__lede">
          This page has been watching which parts of itself held your attention: how long each
          section and each marked passage stayed on your screen while you were actually here, and
          which references you opened. The measurement stops when the tab is hidden or you stop
          interacting. <strong>None of it leaves your browser</strong> — no request is made, nothing
          is stored, and it is gone when you reload. The rules that turn it into claims are below,
          and in the page source.
        </p>
      </div>
      <div className="mirror__body">{children}</div>
    </div>
  );
}

/**
 * §20, rendered literally. The list of things it cannot infer is authored (§30 invariant 7) and
 * does not grow or shrink with the evidence — a boundary that moved with the sample would not be
 * a boundary.
 */
export function InsufficientEvidence({ observations }: { observations: Observation[] }) {
  return (
    <div className="mirror-stack">
      <div>
        <p className="mirror-prose mirror-prose--lead">I don&apos;t have enough evidence yet.</p>
        <p className="mirror-prose">
          You&apos;ve reached the mirror with too little observable interaction for me to make even
          a weak inference responsibly. The thresholds were not lowered to find something to say.
        </p>
      </div>
      <div>
        <PanelHeading>What I can observe so far</PanelHeading>
        {observations.length === 0 ? (
          <p className="mirror-prose">
            Nothing. No section or marked passage has held your attention long enough to be worth a
            sentence.
          </p>
        ) : (
          <ul className="mirror-list">
            {observations.map((observation) => (
              <li key={observation.id}>{observation.statement}</li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <PanelHeading>What I cannot infer</PanelHeading>
        <ul className="mirror-list">
          {UNKNOWNS.map((unknown) => (
            <li key={unknown}>{unknown}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function MirrorShell() {
  return (
    <MirrorFrame state="loading">
      <InsufficientEvidence observations={[]} />
      <div>
        <button type="button" disabled className="mirror-button mirror-button--inert">
          See what this page thinks
        </button>
        <p className="mirror-note mirror-note--fine mirror-mt-2">
          Nothing has been measured yet. This page has not finished loading its own instruments.
        </p>
      </div>
    </MirrorFrame>
  );
}
