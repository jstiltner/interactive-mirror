/**
 * Writes `src/ruleset.digest.json`. Run via `npm run generate:ruleset-digest` after a deliberate
 * change to the thresholds or the rule table — and bump `RULESET_VERSION` in the same commit,
 * because the version string is what a reader is shown and the digest is only what proves it.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { RULESET_VERSION } from "../src/version";
import { rulesetDigest } from "./ruleset-digest";

const digest = rulesetDigest();

writeFileSync(
  path.join(process.cwd(), "src/ruleset.digest.json"),
  JSON.stringify({ algorithm: "sha256", rulesetVersion: RULESET_VERSION, digest }, null, 2) + "\n",
  "utf8"
);

process.stdout.write(`ruleset ${RULESET_VERSION}: ${digest}\n`);
