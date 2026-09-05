/**
 * Store-level invariants for the reader session (spec v0.2 §7, §8, §38, §39, §46).
 *
 * These run in the default node environment against hand-written DOM stubs rather than jsdom.
 * The store touches four browser APIs and no more, which is small enough to fake honestly, and
 * keeping it that way is itself worth a test: if this file needs a real DOM to compile, the
 * instrumentation has grown a dependency the audit view can no longer explain.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mirrorSession } from "../src/session";
import {
  ACTIVITY_PING_MS,
  INTERSECTION_THRESHOLD,
  MIN_MEANINGFUL_EXPOSURE_MS,
} from "../src/thresholds";

type IntersectionCallback = (entries: IntersectionObserverEntry[]) => void;

let observerCallback: IntersectionCallback;
const observed = new Set<Element>();
const listeners = new Map<string, Set<(event?: unknown) => void>>();

function fakeElement(id: string): Element {
  return { id } as unknown as Element;
}

function addListener(type: string, handler: (event?: unknown) => void) {
  const set = listeners.get(type) ?? new Set();
  set.add(handler);
  listeners.set(type, set);
}

function fire(type: string) {
  for (const handler of listeners.get(type) ?? []) handler();
}

function intersect(element: Element, ratio: number) {
  observerCallback([
    { target: element, intersectionRatio: ratio } as unknown as IntersectionObserverEntry,
  ]);
}

/**
 * A real entry, with the geometry the browser supplies. `intersectionRatio` is a fraction of the
 * *element*, so a tall section on a short screen can never reach 0.35 however completely it fills
 * the viewport — which is the §21/§44 defect this geometry exists to exercise.
 */
function intersectGeometry(element: Element, visiblePx: number, elementPx: number, viewportPx: number) {
  observerCallback([
    {
      target: element,
      intersectionRatio: visiblePx / elementPx,
      intersectionRect: { height: visiblePx },
      rootBounds: { height: viewportPx },
    } as unknown as IntersectionObserverEntry,
  ]);
}

beforeEach(() => {
  // performance must be faked alongside the timers: every timestamp in the log comes from
  // performance.now(), so a clock that does not advance would make dwell assertions vacuous.
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
  });
  observed.clear();
  listeners.clear();

  class FakeIntersectionObserver {
    constructor(callback: IntersectionCallback) {
      observerCallback = callback;
    }
    observe(element: Element) {
      observed.add(element);
    }
    unobserve(element: Element) {
      observed.delete(element);
    }
    disconnect() {
      observed.clear();
    }
  }

  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("window", {
    scrollY: 0,
    addEventListener: addListener,
    removeEventListener: () => {},
  });
  vi.stubGlobal("document", {
    visibilityState: "visible",
    addEventListener: addListener,
    removeEventListener: () => {},
  });
});

afterEach(() => {
  mirrorSession.reset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const events = () => {
  const { session } = mirrorSession.getSnapshot();
  return session;
};

describe("section exposure (§7)", () => {
  it("does not record a visit for a section that is never meaningfully exposed", () => {
    const el = fakeElement("section-v");
    mirrorSession.registerSection("section-v", el);
    mirrorSession.start();

    intersect(el, INTERSECTION_THRESHOLD);
    vi.advanceTimersByTime(MIN_MEANINGFUL_EXPOSURE_MS - 100);
    intersect(el, 0);
    vi.advanceTimersByTime(MIN_MEANINGFUL_EXPOSURE_MS);

    const sectionEvents = events().preExposureEvents.filter((e) => e.section === "section-v");
    expect(sectionEvents).toEqual([]);
  });

  it("records enter and exit once the minimum duration is cleared", () => {
    const el = fakeElement("section-v");
    mirrorSession.registerSection("section-v", el);
    mirrorSession.start();
    const enteredAt = performance.now();

    intersect(el, 0.5);
    vi.advanceTimersByTime(MIN_MEANINGFUL_EXPOSURE_MS);
    vi.advanceTimersByTime(20_000);
    intersect(el, 0);

    const log = events().preExposureEvents.filter((e) => e.section === "section-v");
    expect(log.map((e) => e.type)).toEqual(["section_enter", "section_exit"]);
    // Timestamped from the moment of visibility, not the moment it qualified: a 22-second visit
    // must not be recorded as a 20-second one.
    expect(log[0].timestamp).toBeCloseTo(enteredAt, 0);
    expect(log[1].timestamp - log[0].timestamp).toBeGreaterThanOrEqual(22_000);
  });

  it("treats boundary jitter as a single continuous visit (§8)", () => {
    const el = fakeElement("section-v");
    mirrorSession.registerSection("section-v", el);
    mirrorSession.start();

    intersect(el, 0.5);
    vi.advanceTimersByTime(MIN_MEANINGFUL_EXPOSURE_MS);
    intersect(el, 0.6);
    intersect(el, 0.4);
    vi.advanceTimersByTime(1000);

    const log = events().preExposureEvents.filter((e) => e.section === "section-v");
    expect(log.map((e) => e.type)).toEqual(["section_enter"]);
  });

  it("measures a tall section on a short viewport (§21, §44)", () => {
    const el = fakeElement("section-v");
    mirrorSession.registerSection("section-v", el);
    mirrorSession.start();

    // A 1800px section filling a 400px phone viewport. intersectionRatio is 400/1800 = 0.22,
    // below the 0.35 element-area threshold — the section is entirely on screen and the
    // one-sided test would still call it unseen.
    intersectGeometry(el, 400, 1800, 400);
    vi.advanceTimersByTime(MIN_MEANINGFUL_EXPOSURE_MS + 1000);
    intersectGeometry(el, 0, 1800, 400);

    const log = events().preExposureEvents.filter((e) => e.section === "section-v");
    expect(log.map((e) => e.type)).toEqual(["section_enter", "section_exit"]);
  });

  it("does not count a sliver of a tall section as a visit", () => {
    const el = fakeElement("section-v");
    mirrorSession.registerSection("section-v", el);
    mirrorSession.start();

    // 100px of an 1800px section on a 400px viewport: 0.06 of the element, 0.25 of the screen.
    // Neither clause is met, so this is scrolling past, not reading.
    intersectGeometry(el, 100, 1800, 400);
    vi.advanceTimersByTime(MIN_MEANINGFUL_EXPOSURE_MS + 1000);

    const log = events().preExposureEvents.filter((e) => e.section === "section-v");
    expect(log).toEqual([]);
  });
});

describe("activity (§6)", () => {
  it("throttles continuing interaction to one record per window", () => {
    mirrorSession.start();

    for (let i = 0; i < 50; i += 1) fire("pointermove");
    vi.advanceTimersByTime(ACTIVITY_PING_MS + 1);
    for (let i = 0; i < 50; i += 1) fire("pointermove");

    const pings = events().preExposureEvents.filter((e) => e.type === "activity");
    expect(pings).toHaveLength(2);
  });
});

describe("exposure boundary (§38, §39)", () => {
  it("puts the reveal click itself on the post-exposure side", () => {
    mirrorSession.start();
    fire("pointermove");
    mirrorSession.reveal();

    const { preExposureEvents, postExposureEvents } = events();
    expect(preExposureEvents.map((e) => e.type)).toEqual(["activity"]);
    expect(postExposureEvents.map((e) => e.type)).toEqual(["mirror_open"]);
  });

  it("cannot re-open the boundary once it has closed", () => {
    mirrorSession.start();
    const first = mirrorSession.reveal();
    vi.advanceTimersByTime(5000);
    const second = mirrorSession.reveal();

    expect(second).toBe(first);
    expect(events().postExposureEvents.filter((e) => e.type === "mirror_open")).toHaveLength(1);
  });

  it("keeps post-exposure reading out of the pre-exposure collection entirely", () => {
    const el = fakeElement("section-x");
    mirrorSession.registerSection("section-x", el);
    mirrorSession.start();
    mirrorSession.reveal();

    intersect(el, 0.9);
    vi.advanceTimersByTime(MIN_MEANINGFUL_EXPOSURE_MS + 60_000);
    intersect(el, 0);

    const { preExposureEvents, postExposureEvents } = events();
    expect(preExposureEvents.some((e) => e.section === "section-x")).toBe(false);
    expect(postExposureEvents.filter((e) => e.section === "section-x")).toHaveLength(2);
  });

  it("appends contested responses without resolving or replacing them (§17)", () => {
    mirrorSession.start();
    mirrorSession.reveal();
    mirrorSession.attachResponse("claim_1", "disputed");
    vi.advanceTimersByTime(1000);
    mirrorSession.attachResponse("claim_1", "qualified");

    const { responses } = events();
    expect(responses.map((r) => r.response)).toEqual(["disputed", "qualified"]);
    expect(new Set(responses.map((r) => r.id)).size).toBe(2);
  });
});
