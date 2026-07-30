/**
 * Brief @ mention rules, run without vitest.
 * Run: pnpm exec tsx src/services/brief-mentions.verify.ts   (from artifacts/api-server)
 * Cases shared with brief-mentions.test.ts. This file is only a reporter.
 * No placeholder env needed: brief-mentions.ts imports nothing but types.
 */
import { collectBriefMentionCases } from "./brief-mentions.cases.js";

const results = await collectBriefMentionCases();
const failures = results.filter((r) => !r.ok);
console.log(`\nbrief-mentions verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}
console.log("all assertions pass\n");
