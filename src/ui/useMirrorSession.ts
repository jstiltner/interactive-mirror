"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { passageManifest } from "../manifest";
import { buildMirrorModel, type MirrorModel } from "../runtime";
import { mirrorSession, type MirrorSnapshot } from "../session";

export interface MirrorTarget {
  /** DOM id of the element to observe. Sections use their essay anchor; passages use §34 ids. */
  id: string;
  /** Set for passages: the section the passage lives inside. Omitted for sections themselves. */
  section?: string;
}

/** Live view of the session. Server render sees an empty session, which is accurate (§4). */
export function useMirrorSnapshot(): MirrorSnapshot {
  return useSyncExternalStore(
    mirrorSession.subscribe,
    mirrorSession.getSnapshot,
    mirrorSession.getServerSnapshot
  );
}

/**
 * The derived model. Memoised on snapshot identity only — derivation is pure (§35), so an
 * unchanged session cannot yield a changed model, and a changed one always yields a fresh
 * snapshot object.
 */
export function useMirrorModel(): MirrorModel {
  const snapshot = useMirrorSnapshot();
  return useMemo(() => buildMirrorModel(snapshot, passageManifest.passages), [snapshot]);
}

/**
 * Starts instrumentation and binds it to the essay's elements by id. Mounted once, by the page,
 * inside an effect so nothing observes anything during server render (§4).
 *
 * Elements are resolved from the DOM rather than threaded through refs, which keeps the essay
 * body plain prose markup: an author adding a section writes a heading and an id, not a
 * measurement callback.
 */
export function useMirrorInstrumentation(targets: MirrorTarget[]): void {
  useEffect(() => {
    for (const target of targets) {
      const element = document.getElementById(target.id);
      if (!element) continue;
      if (target.section) mirrorSession.registerPassage(target.id, element, target.section);
      else mirrorSession.registerSection(target.id, element);
    }
    mirrorSession.start();
    return () => {
      mirrorSession.stop();
    };
    // targets is a module-level constant; identity is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
