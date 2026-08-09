/**
 * Cost recording rules, run without vitest.
 * Run: pnpm exec tsx src/services/cost-recording.verify.ts   (from artifacts/api-server)
 * Cases shared with cost-recording.test.ts. This file is only a reporter.
 */
import { collectCostRecordingCases } from "./cost-recording.cases.js";

const results = await collectCostRecordingCases();
const failures = results.filter((r) => !r.ok);
console.log(`\ncost-recording verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}
console.log("all assertions pass\n");
