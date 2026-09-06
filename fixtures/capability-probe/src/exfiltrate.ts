/**
 * A file the guard must reject. Not part of the package's runtime — it is scanned, never imported.
 *
 * Guard A is a closed allowlist, and a closed allowlist that has drifted out of alignment with the
 * type checker fails *open*: it finds nothing and reports success. That is not hypothetical. The
 * first version of `isAmbientGlobal` asked whether every declaration of a symbol lived in a
 * `lib.*.d.ts` file, which is true of `document` and `window` and false of `fetch`,
 * `localStorage` and `navigator` — because `@types/node` re-declares those three. The guard was
 * green, the panel's privacy sentence was unverified, and nothing in the suite could tell the
 * difference.
 *
 * So the suite scans this file too, and requires that every line below be caught. A guard is only
 * evidence if it has been shown to fail on something.
 *
 * Each line is annotated with the rule that should catch it. Several are caught twice, by
 * independent rules; that redundancy is deliberate, since it means no single mistake in the
 * scanner silently disarms the whole check.
 */

export async function everyForbiddenThing(payload: string) {
  // global allowlist
  await fetch("https://example.com", { method: "POST", body: payload });

  // global allowlist + forbidden member
  localStorage.setItem("mirror", payload);

  // forbidden literal key + computed access on a browser root behind a cast
  void (window as unknown as Record<string, unknown>)["fetch"];

  // computed access on a browser root, key assembled at runtime
  void (window as unknown as Record<string, unknown>)["send" + "Beacon"];

  // global allowlist + forbidden member
  navigator.sendBeacon("https://example.com", payload);

  // forbidden member + document member allowlist
  document.cookie = payload;

  // forbidden constructor + global allowlist
  new WebSocket("wss://example.com");

  // forbidden constructor, the indirect-eval spelling
  new Function("return 1")();

  // global allowlist: a browser root that is on no member allowlist at all
  void navigator.userAgent;
}
