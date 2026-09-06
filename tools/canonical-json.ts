/**
 * Deterministic serialization for anything that gets hashed.
 *
 * `JSON.stringify` preserves insertion order, which means moving a field within an object literal
 * would change the digest without changing behaviour. A digest that trips on cosmetic edits gets
 * regenerated reflexively, and a check people regenerate without reading is not a check. Sorting
 * keys makes the hash a statement about the *values* in the ruleset and nothing else.
 *
 * Array order is preserved deliberately: the rule table is evaluated in order and §32 caps the
 * number of exposed claims, so reordering the rules can change which claims a reader sees.
 */

export type Canonical =
  | string
  | number
  | boolean
  | null
  | readonly Canonical[]
  | { readonly [key: string]: Canonical };

export function canonicalJson(value: Canonical): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, Canonical>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(",")}}`;
}
