import {
  motionConvertFailureBody,
  settleMotionCostBeforePersist,
} from "./motion-convert.js";

export interface Case {
  name: string;
  ok: boolean;
  detail?: unknown;
}

export async function collectMotionConvertCases(): Promise<Case[]> {
  const cases: Case[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) =>
    cases.push(detail === undefined ? { name, ok } : { name, ok, detail });

  {
    const order: string[] = [];
    const value = await settleMotionCostBeforePersist({
      settleCost: async () => {
        order.push("settle");
      },
      markCostSettled: () => {
        order.push("marked");
      },
      persistResult: async () => {
        order.push("persist");
        return "saved";
      },
    });
    check(
      "cost commits before motion persistence begins",
      order.join(",") === "settle,marked,persist",
      order,
    );
    check(
      "successful persistence returns its result",
      value === "saved",
      value,
    );
  }

  {
    let costSettled = false;
    const order: string[] = [];
    let threw = false;
    try {
      await settleMotionCostBeforePersist({
        settleCost: async () => {
          order.push("settle");
        },
        markCostSettled: () => {
          costSettled = true;
          order.push("marked");
        },
        persistResult: async () => {
          order.push("persist");
          throw new Error("take insert failed");
        },
      });
    } catch {
      threw = true;
    }
    const body = motionConvertFailureBody({
      vendorRequested: true,
      vendorReturned: true,
      costSettled,
    });
    check(
      "a later take failure still leaves the vendor cost settled",
      threw && costSettled,
      { threw, costSettled },
    );
    check(
      "a later take failure happens only after settlement",
      order.join(",") === "settle,marked,persist",
      order,
    );
    check(
      "a paid render persistence failure cannot be reported as uncharged",
      body.costSettled &&
        body.error.includes("billed") &&
        body.error.includes("cost has been recorded") &&
        !body.error.includes("Nothing was charged"),
      body,
    );
  }

  {
    let persisted = false;
    let marked = false;
    let threw = false;
    try {
      await settleMotionCostBeforePersist({
        settleCost: async () => {
          throw new Error("ledger unavailable");
        },
        markCostSettled: () => {
          marked = true;
        },
        persistResult: async () => {
          persisted = true;
        },
      });
    } catch {
      threw = true;
    }
    check(
      "result persistence never starts when cost settlement fails",
      threw && !marked && !persisted,
      { threw, marked, persisted },
    );
  }

  {
    const beforeVendor = motionConvertFailureBody({
      vendorRequested: false,
      vendorReturned: false,
      costSettled: false,
    });
    const returnedUnsettled = motionConvertFailureBody({
      vendorRequested: true,
      vendorReturned: true,
      costSettled: false,
    });
    const requestedUnknown = motionConvertFailureBody({
      vendorRequested: true,
      vendorReturned: false,
      costSettled: false,
    });
    check(
      "only a pre-vendor failure says nothing was charged",
      beforeVendor.error.includes("Nothing was charged"),
    );
    check(
      "a returned render with a ledger failure names missing spend",
      returnedUnsettled.error.includes("billed") &&
        returnedUnsettled.error.includes("missing"),
      returnedUnsettled,
    );
    check(
      "an unresolved vendor request says it may have been billed",
      requestedUnknown.error.includes("may still have been billed"),
      requestedUnknown,
    );
  }

  return cases;
}
