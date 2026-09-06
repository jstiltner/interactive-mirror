/**
 * Writes `src/generated/source-spans.ts`. Run via `npm run generate:source-spans` from the
 * package root after moving a rule. `test/identity.test.ts` fails until you do.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { computeSourceSpans, renderSourceSpans } from "./source-spans";

const spans = computeSourceSpans(process.cwd());

writeFileSync(
  path.join(process.cwd(), "src/generated/source-spans.ts"),
  renderSourceSpans(spans),
  "utf8"
);

process.stdout.write(`source-spans: ${Object.keys(spans).length} rules\n`);
