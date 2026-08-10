/**
 * channels invariants, run without vitest.
 *
 * Run: pnpm exec tsx src/services/channels.verify.ts   (from artifacts/api-server)
 *
 * The cases are shared with channels.test.ts, so this runner and CI check exactly
 * the same things. This file is only a reporter.
 */

import { collectChannelCases } from "./channels.cases.js";

const results = collectChannelCases();
const failures = results.filter((r) => !r.ok);

console.log(`\nchannels verification: ${results.length - failures.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}

console.log("all assertions pass\n");
