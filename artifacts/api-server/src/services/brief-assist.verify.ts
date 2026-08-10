/**
 * brief-assist invariants, run without vitest.
 *
 * Run: pnpm exec tsx src/services/brief-assist.verify.ts   (from artifacts/api-server)
 *
 * The cases are shared with brief-assist.test.ts. This file is only a reporter.
 */

import { collectBriefAssistCases } from "./brief-assist.cases.js";

const results = collectBriefAssistCases();
const failures = results.filter((r) => !r.ok);

console.log(`\nbrief-assist verification: ${results.length - failures.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}

console.log("all assertions pass\n");
