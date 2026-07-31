/**
 * Phase 5 brand-record rules, run without vitest.
 * Run: pnpm exec tsx src/services/brand-completeness.verify.ts   (from artifacts/api-server)
 * Cases shared with brand-completeness.test.ts. This file is only a reporter.
 */
import { collectBrandCompletenessCases } from "./brand-completeness.cases.js";

const results = await collectBrandCompletenessCases();
const failures = results.filter((r) => !r.ok);
console.log(`\nbrand-completeness verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}
console.log("all assertions pass\n");
