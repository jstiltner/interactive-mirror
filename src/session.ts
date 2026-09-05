/**
 * The reader session: an append-only event log plus the exposure boundary (spec v0.2 §5-§8,
 * §38, §39).
 *
 * This module deliberately measures and records nothing else. It does not compute dwell, does
 * not count returns, and does not know what a claim is. §35 requires observations to be a pure
 * function of the event log, which is only true if the log is the single place behaviour is
 * written down — the moment this file starts maintaining a running "secondsInSectionV" total,
 * the derivation stops being reproducible from the evidence the UI shows the reader.
 *
 * Nothing here touches the network, localStorage, sessionStorage, or cookies (§3, §23, §42).
 * The whole session lives in module scope and dies with the tab.
 */

import {
  INTERSECTION_THRESHOLD,
  MIN_MEANINGFUL_EXPOSURE_MS,
  INACTIVITY_WINDOW_MS,
  ACTIVITY_PING_MS,
  SCROLL_DIRECTION_MIN_DELTA_PX,
} from "./thresholds";
import type { MirrorSession, ReaderEvent, ReaderEventType, UserResponse } from "./types";

/**
 * Fine-grained so the callback fires for a section taller than the viewport. With the coarse
 * `[0, INTERSECTION_THRESHOLD, 1]` list the browser had no boundary such an element could cross —
 * its ratio is capped at `viewportHeight / elementHeight`, below 0.35 for every numbered section
 * on a phone — so it emitted one entry at 0 and then went quiet. See `isMeaningfullyVisible`.
 */
const OBSERVER_THRESHOLDS = Array.from({ length: 21 }, (_, step) => step / 20);

/**
 * §7, §21. Being looked at means 35% of the element is on screen, *or* the element covers 35% of
 * the screen. A reader on a phone satisfies the second clause and can never satisfy the first;
 * a reader on a desktop usually satisfies the first. One rule, both readers.
 */
function isMeaningfullyVisible(entry: IntersectionObserverEntry): boolean {
  if (entry.intersectionRatio >= INTERSECTION_THRESHOLD) return true;
  const viewportHeight = entry.rootBounds?.height ?? 0;
  if (viewportHeight <= 0) return false;
  return entry.intersectionRect.height / viewportHeight >= INTERSECTION_THRESHOLD;
}

/** Coalesces bursts of events into one React render. */
const NOTIFY_THROTTLE_MS = 250;

/** Live-clock resolution for the readiness UI (see `clock` below). */
const CLOCK_TICK_MS = 1000;

export interface MirrorSnapshot {
  session: MirrorSession;
  /**
   * A monotonic sample that advances roughly once a second while the reader is present, and
   * stops while the tab is hidden or the reader has gone idle.
   *
   * Readiness (§31: "insufficient" vs "ready") depends on accumulated dwell, which keeps
   * growing while a reader sits still and reads — an event log alone would leave the reveal
   * control stuck on a stale answer. This is a rendering aid only: no rule may read it, or
   * the observations stop being reproducible from the events.
   */
  clock: number;
}

const EMPTY_SESSION: MirrorSession = {
  startedAt: 0,
  preExposureEvents: [],
  postExposureEvents: [],
  responses: [],
};

const EMPTY_SNAPSHOT: MirrorSnapshot = Object.freeze({ session: EMPTY_SESSION, clock: 0 });

interface TrackedTarget {
  id: string;
  element: Element;
  /** Passages carry their containing section so a passage event is still section-attributable. */
  section?: string;
}

interface RecordInput {
  type: ReaderEventType;
  section?: string;
  target?: string;
  metadata?: Record<string, string | number | boolean>;
  /**
   * Override for the event's timestamp. Used only by section entry, which is confirmed 2s after
   * the moment it describes (see `promote`).
   */
  timestamp?: number;
}

class MirrorSessionStore {
  private started = false;
  private startedAt = 0;
  private exposureTimestamp: number | undefined;

  /**
   * Two arrays, not one array and a filter (§39). A filter is a rule someone can forget to
   * apply; two arrays are a rule that has to be actively defeated.
   */
  private preExposureEvents: ReaderEvent[] = [];
  private postExposureEvents: ReaderEvent[] = [];
  private responses: UserResponse[] = [];

  private eventSeq = 0;
  private version = 0;
  private clock = 0;

  private listeners = new Set<() => void>();
  private notifyHandle: ReturnType<typeof setTimeout> | null = null;
  private clockHandle: ReturnType<typeof setInterval> | null = null;

  private cachedSnapshot: MirrorSnapshot = EMPTY_SNAPSHOT;
  private cachedVersion = -1;
  private cachedClock = -1;

  private observer: IntersectionObserver | null = null;
  private targets = new Map<string, TrackedTarget>();
  private byElement = new WeakMap<Element, TrackedTarget>();
  /** Targets currently over the visibility threshold but not yet meaningfully exposed. */
  private pending = new Map<string, { since: number; handle: ReturnType<typeof setTimeout> }>();
  /** Targets that cleared the minimum-duration bar and therefore have an open `_enter` event. */
  private open = new Set<string>();

  private lastActivityAt = 0;
  private lastActivityPingAt = -Infinity;
  private lastScrollY = 0;
  private scrollDirection: "down" | "up" | null = null;
  private directionRun = 0;

  private readonly handleActivity = () => this.noteActivity();
  private readonly handleScroll = () => {
    this.noteActivity();
    this.noteScroll();
  };
  private readonly handleVisibility = () => {
    const state = document.visibilityState;
    this.record({ type: "visibility_change", metadata: { state } });
    if (state === "visible") this.noteActivity();
  };

  // --- lifecycle -----------------------------------------------------------------------

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.startedAt = performance.now();
    this.lastActivityAt = this.startedAt;
    this.clock = this.startedAt;
    this.lastScrollY = window.scrollY;

    this.observer = new IntersectionObserver((entries) => this.handleIntersections(entries), {
      threshold: OBSERVER_THRESHOLDS,
    });
    for (const target of this.targets.values()) this.observer.observe(target.element);

    window.addEventListener("scroll", this.handleScroll, { passive: true });
    window.addEventListener("pointermove", this.handleActivity, { passive: true });
    window.addEventListener("pointerdown", this.handleActivity, { passive: true });
    window.addEventListener("keydown", this.handleActivity, { passive: true });
    document.addEventListener("visibilitychange", this.handleVisibility);

    this.clockHandle = setInterval(() => this.tick(), CLOCK_TICK_MS);
    this.bump();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener("scroll", this.handleScroll);
    window.removeEventListener("pointermove", this.handleActivity);
    window.removeEventListener("pointerdown", this.handleActivity);
    window.removeEventListener("keydown", this.handleActivity);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    for (const p of this.pending.values()) clearTimeout(p.handle);
    this.pending.clear();
    if (this.clockHandle !== null) clearInterval(this.clockHandle);
    this.clockHandle = null;
    if (this.notifyHandle !== null) clearTimeout(this.notifyHandle);
    this.notifyHandle = null;
  }

  /** Test-only. Returns the store to the state it has before any reader has arrived. */
  reset() {
    this.stop();
    this.startedAt = 0;
    this.exposureTimestamp = undefined;
    this.preExposureEvents = [];
    this.postExposureEvents = [];
    this.responses = [];
    this.targets.clear();
    this.open.clear();
    this.eventSeq = 0;
    this.lastActivityPingAt = -Infinity;
    this.scrollDirection = null;
    this.directionRun = 0;
    this.bump();
  }

  // --- registration --------------------------------------------------------------------

  registerSection(id: string, element: Element) {
    this.registerTarget({ id, element });
  }

  registerPassage(id: string, element: Element, section: string) {
    this.registerTarget({ id, element, section });
  }

  private registerTarget(target: TrackedTarget) {
    const existing = this.targets.get(target.id);
    if (existing?.element === target.element) return;
    if (existing) {
      this.observer?.unobserve(existing.element);
      this.byElement.delete(existing.element);
    }
    this.targets.set(target.id, target);
    this.byElement.set(target.element, target);
    this.observer?.observe(target.element);
  }

  unregister(id: string) {
    const target = this.targets.get(id);
    if (!target) return;
    this.observer?.unobserve(target.element);
    this.byElement.delete(target.element);
    this.targets.delete(id);
    const pending = this.pending.get(id);
    if (pending) {
      clearTimeout(pending.handle);
      this.pending.delete(id);
    }
    if (this.open.has(id)) this.closeTarget(target, performance.now());
  }

  // --- reader-initiated events ---------------------------------------------------------

  noteCitationOpen(referenceId: string, section?: string) {
    this.noteActivity();
    this.record({ type: "citation_open", target: referenceId, section });
    this.flush();
  }

  noteClaimOpen(claimId: string) {
    this.noteActivity();
    this.record({ type: "claim_open", target: claimId });
    this.flush();
  }

  /**
   * §38. The boundary moves first and the `mirror_open` event is recorded second, so the click
   * that reveals the mirror is itself post-exposure evidence. Idempotent: a second call cannot
   * re-open the boundary, because "the claims were frozen at the moment you asked" has to stay
   * true even if the control is double-clicked.
   */
  reveal(): number {
    if (this.exposureTimestamp !== undefined) return this.exposureTimestamp;
    this.exposureTimestamp = performance.now();
    this.record({ type: "mirror_open" });
    this.flush();
    return this.exposureTimestamp;
  }

  attachResponse(claimId: string, response: UserResponse["response"]) {
    this.noteActivity();
    const timestamp = performance.now();
    this.responses = [
      ...this.responses,
      { id: `res_${this.responses.length + 1}`, claimId, response, timestamp },
    ];
    this.record({ type: "claim_response", target: claimId, metadata: { response }, timestamp });
    this.flush();
  }

  // --- instrumentation -----------------------------------------------------------------

  private handleIntersections(entries: IntersectionObserverEntry[]) {
    const now = performance.now();
    for (const entry of entries) {
      const target = this.byElement.get(entry.target);
      if (!target) continue;

      const visible = isMeaningfullyVisible(entry);
      if (visible) {
        if (this.open.has(target.id) || this.pending.has(target.id)) continue;
        const handle = setTimeout(() => this.promote(target.id), MIN_MEANINGFUL_EXPOSURE_MS);
        this.pending.set(target.id, { since: now, handle });
      } else {
        const pending = this.pending.get(target.id);
        if (pending) {
          // Never meaningfully exposed. §8: three pixels across a boundary is not a visit, so
          // this leaves no trace in the log at all rather than a zero-length one.
          clearTimeout(pending.handle);
          this.pending.delete(target.id);
        }
        if (this.open.has(target.id)) this.closeTarget(target, now);
      }
    }
  }

  private promote(id: string) {
    const pending = this.pending.get(id);
    const target = this.targets.get(id);
    if (!pending || !target) return;
    this.pending.delete(id);
    this.open.add(id);
    // Timestamped at the moment the section became visible, not at the moment that visibility
    // became meaningful — otherwise every visit silently loses its first two seconds. The cost
    // is that the log is append-ordered rather than timestamp-ordered by up to
    // MIN_MEANINGFUL_EXPOSURE_MS; derivations sort by timestamp.
    this.record({
      type: "section_enter",
      section: target.section ?? target.id,
      target: target.section ? target.id : undefined,
      timestamp: pending.since,
    });
    this.flush();
  }

  private closeTarget(target: TrackedTarget, now: number) {
    this.open.delete(target.id);
    this.record({
      type: "section_exit",
      section: target.section ?? target.id,
      target: target.section ? target.id : undefined,
      timestamp: now,
    });
    this.flush();
  }

  private noteActivity() {
    const now = performance.now();
    this.lastActivityAt = now;
    if (now - this.lastActivityPingAt < ACTIVITY_PING_MS) return;
    this.lastActivityPingAt = now;
    this.record({ type: "activity", timestamp: now });
  }

  private noteScroll() {
    const y = window.scrollY;
    const delta = y - this.lastScrollY;
    this.lastScrollY = y;
    if (delta === 0) return;
    const direction = delta > 0 ? "down" : "up";
    if (direction === this.scrollDirection) {
      this.directionRun += Math.abs(delta);
      return;
    }
    this.directionRun = Math.abs(delta);
    if (this.directionRun < SCROLL_DIRECTION_MIN_DELTA_PX) return;
    const previous = this.scrollDirection;
    this.scrollDirection = direction;
    if (previous === null) return;
    this.record({ type: "scroll_direction_change", metadata: { direction } });
  }

  private tick() {
    const now = performance.now();
    if (document.visibilityState !== "visible") return;
    if (now - this.lastActivityAt > INACTIVITY_WINDOW_MS) return;
    this.clock = now;
    this.flush();
  }

  // --- log -----------------------------------------------------------------------------

  private record({ type, section, target, metadata, timestamp }: RecordInput) {
    if (!this.started) return;
    const event: ReaderEvent = {
      id: `evt_${++this.eventSeq}`,
      type,
      timestamp: timestamp ?? performance.now(),
      exposureState: this.exposureTimestamp === undefined ? "pre" : "post",
      ...(section ? { section } : {}),
      ...(target ? { target } : {}),
      ...(metadata ? { metadata } : {}),
    };
    // Classification is by the moment of recording, not by the event's timestamp. The two differ
    // only for a section entry confirmed just after the reveal click, and in that case the
    // conservative answer is "post": post-exposure evidence can never strengthen a claim, so
    // erring this way can only cost the mirror a claim, never manufacture one.
    if (event.exposureState === "pre") this.preExposureEvents = [...this.preExposureEvents, event];
    else this.postExposureEvents = [...this.postExposureEvents, event];
    this.bump();
  }

  // --- subscription --------------------------------------------------------------------

  private bump() {
    this.version += 1;
  }

  private flush() {
    if (this.notifyHandle !== null) return;
    this.notifyHandle = setTimeout(() => {
      this.notifyHandle = null;
      for (const listener of this.listeners) listener();
    }, NOTIFY_THROTTLE_MS);
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): MirrorSnapshot => {
    if (this.cachedVersion !== this.version || this.cachedClock !== this.clock) {
      this.cachedVersion = this.version;
      this.cachedClock = this.clock;
      this.cachedSnapshot = {
        session: {
          startedAt: this.startedAt,
          ...(this.exposureTimestamp === undefined
            ? {}
            : { exposureTimestamp: this.exposureTimestamp }),
          preExposureEvents: this.preExposureEvents,
          postExposureEvents: this.postExposureEvents,
          responses: this.responses,
        },
        clock: this.clock,
      };
    }
    return this.cachedSnapshot;
  };

  /** Server render sees a reader who has done nothing, which is the truth at that point (§4). */
  readonly getServerSnapshot = (): MirrorSnapshot => EMPTY_SNAPSHOT;
}

export const mirrorSession = new MirrorSessionStore();

export { EMPTY_SNAPSHOT };
