/**
 * Billing truth for Stage 03 motion conversion.
 *
 * A vendor render is already spend before its file and take are persisted.
 * These helpers keep that ordering explicit and make the failure copy depend on
 * what actually happened, instead of letting a later database failure claim a
 * paid render was free.
 */

export interface MotionPersistenceSteps<T> {
  settleCost: () => Promise<void>;
  markCostSettled: () => void;
  persistResult: () => Promise<T>;
}

/** Commit the vendor cost before attempting any fallible result persistence. */
export async function settleMotionCostBeforePersist<T>(
  steps: MotionPersistenceSteps<T>,
): Promise<T> {
  await steps.settleCost();
  steps.markCostSettled();
  return steps.persistResult();
}

export interface MotionFailureFacts {
  vendorRequested: boolean;
  vendorReturned: boolean;
  costSettled: boolean;
}

export interface MotionFailureBody {
  costSettled: boolean;
  error: string;
}

/** User-facing failure copy that cannot contradict the vendor and ledger state. */
export function motionConvertFailureBody(
  facts: MotionFailureFacts,
): MotionFailureBody {
  if (!facts.vendorRequested) {
    return {
      costSettled: false,
      error: "The clip could not be made. Nothing was charged.",
    };
  }

  if (facts.costSettled) {
    return {
      costSettled: true,
      error:
        "The clip was rendered and billed, but it could not be saved. That cost has been recorded. Nothing else changed.",
    };
  }

  if (facts.vendorReturned) {
    return {
      costSettled: false,
      error:
        "The clip was rendered and billed, but its cost could not be recorded. This spend is missing from the Cost surface.",
    };
  }

  return {
    costSettled: false,
    error:
      "The clip could not be made. A render had already been requested, so it may still have been billed, and no cost could be recorded for it.",
  };
}
