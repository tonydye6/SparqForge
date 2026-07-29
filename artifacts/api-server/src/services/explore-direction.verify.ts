/**
 * Directed-prompt assembly for stage 03, run without vitest.
 * Run: pnpm exec tsx src/services/explore-direction.verify.ts   (from artifacts/api-server)
 * Cases shared with explore-direction.test.ts. This file is only a reporter.
 *
 * Why this one needs placeholder env and the other verify runners do not:
 * these cases reach the shared machinery in creative-direction.ts on purpose
 * (mergeReferenceSlots, slotDescriptionForAsset), and that module imports the
 * db and Gemini clients, both of which THROW AT IMPORT when their variables are
 * absent. The functions under test issue no query and make no model call, so a
 * placeholder is accurate rather than a fudge: nothing connects. Real values are
 * never overwritten, so on Replit this runs against the real environment.
 *
 * The alternative was to copy those two functions somewhere db-free, and a
 * second copy of asset budgeting is the exact mistake that caused the bug these
 * cases exist to prevent.
 */

export {};

process.env.DATABASE_URL ||= "postgresql://unused:unused@localhost:5432/unused";
process.env.AI_INTEGRATIONS_TOKEN ||= "verify-placeholder";
process.env.GEMINI_API_KEY ||= "verify-placeholder";
process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ||= "http://localhost:1/v1beta";
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ||= "http://localhost:1";

const { collectExploreDirectionCases } = await import("./explore-direction.cases.js");

const results = await collectExploreDirectionCases();
const failures = results.filter((r) => !r.ok);
console.log(`\nexplore-direction verification: ${results.length - failures.length} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) {
    console.log(`  FAIL  ${f.name}${f.detail === undefined ? "" : ` · got ${JSON.stringify(f.detail)}`}`);
  }
  process.exit(1);
}
console.log("all assertions pass\n");
