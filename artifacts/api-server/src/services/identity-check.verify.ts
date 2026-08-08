/**
 * Identity-check rules, run without vitest.
 * Run: pnpm exec tsx src/services/identity-check.verify.ts   (from artifacts/api-server)
 */
import { collectIdentityCheckCases } from "./identity-check.cases.js";
const results = await collectIdentityCheckCases();
const failures = results.filter((r) => !r.ok);
console.log(`\nidentity-check verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  process.exit(1);
}
console.log("all assertions pass\n");
