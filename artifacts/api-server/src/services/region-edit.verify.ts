/**
 * Region-edit geometry and drift, run without vitest.
 * Run: pnpm exec tsx src/services/region-edit.verify.ts   (from artifacts/api-server)
 * Cases shared with region-edit.test.ts. This file is only a reporter.
 */
import { collectRegionEditCases } from "./region-edit.cases.js";

const results = collectRegionEditCases();
const failures = results.filter((r) => !r.ok);
console.log(`\nregion-edit verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}
console.log("all assertions pass\n");
