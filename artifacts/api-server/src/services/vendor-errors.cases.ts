/**
 * A configuration fault must not be reported as a creative one.
 * Every string below is a real error observed on 2026-08-23.
 */
import { describeVendorConfigError } from "../lib/vendor-errors.js";

export interface CaseResult { name: string; ok: boolean; detail?: string }

export function runCases(): CaseResult[] {
  const out: CaseResult[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    out.push({ name, ok, detail: ok ? undefined : String(detail) });

  // Verbatim from /tmp/api2.log, the second failure mode.
  const blocked = new Error('API error occurred: {"error":{"code":403,"status":"PERMISSION_DENIED",' +
    '"message":"Requests to this API generativelanguage.googleapis.com method ' +
    'google.learning.gemini.api.interactions.v1beta.InteractionsService.CreateInteractionHttp are blocked.",' +
    '"details":[{"reason":"API_KEY_SERVICE_BLOCKED","metadata":{"service":"generativelanguage.googleapis.com"}}]}}');
  const msgBlocked = describeVendorConfigError(blocked);
  check("a restricted key is named as a restricted key", /restricted/i.test(msgBlocked ?? ""), msgBlocked);
  check("and it says which API to allow",
    (msgBlocked ?? "").includes("generativelanguage.googleapis.com"), msgBlocked);
  check("and it still says nothing was charged",
    /Nothing was changed or charged/.test(msgBlocked ?? ""), msgBlocked);

  // Verbatim from /tmp/api.log, the first failure mode.
  const proxy = new Error("CreateInteractionClientError: Endpoint: 'POST /interactions' is not supported.");
  const msgProxy = describeVendorConfigError(proxy);
  check("the proxy endpoint error is explained as a MISSING KEY, not a broken endpoint",
    /no direct Google AI key/i.test(msgProxy ?? ""), msgProxy);
  check("and it lists the variables to set", /GEMINI_API_KEY/.test(msgProxy ?? ""), msgProxy);

  check("an invalid key is distinguished from a restricted one",
    /invalid/i.test(describeVendorConfigError(new Error("API key not valid. Please pass a valid API key.")) ?? ""));
  check("a disabled service is distinguished too",
    /disabled/i.test(describeVendorConfigError(
      new Error("Generative Language API has not been used in project 12345 before or it is disabled")) ?? ""));
  check("a bare PERMISSION_DENIED is still called a configuration fault",
    /configuration fault/i.test(describeVendorConfigError(new Error("PERMISSION_DENIED")) ?? ""));

  /*
   * The other half of the contract: a real creative or transport failure must
   * return null so the caller's own wording survives. A recogniser that claims
   * everything is a config fault is worse than none.
   */
  check("a model refusal is NOT a config fault",
    describeVendorConfigError(new Error("The model refused to generate this content")) === null);
  check("a timeout is NOT a config fault",
    describeVendorConfigError(new Error("ETIMEDOUT: socket hang up")) === null);
  check("a rate limit is NOT a config fault",
    describeVendorConfigError(new Error("429 RESOURCE_EXHAUSTED: quota exceeded")) === null);
  check("undefined and null are safe", describeVendorConfigError(undefined) === null && describeVendorConfigError(null) === null);
  check("a plain string error is matched", describeVendorConfigError("API_KEY_INVALID") !== null);

  // The live error arrived nested several levels deep inside `cause`.
  check("it digs through nested cause chains",
    describeVendorConfigError(new Error("request failed", { cause: new Error("wrapped", { cause: blocked }) })) !== null);
  check("a cyclic error object does not hang it", (() => {
    const a: Record<string, unknown> = { message: "API_KEY_SERVICE_BLOCKED" };
    a.self = a;
    return describeVendorConfigError(a) !== null;
  })());

  return out;
}
