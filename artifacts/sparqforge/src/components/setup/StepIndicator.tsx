import React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  steps: Array<{ label: string }>;
  currentIndex: number;
  statuses: Array<{ complete: boolean }>;
  skippedSteps: Set<number>;
  onStepClick: (index: number) => void;
}

export function StepIndicator({
  steps,
  currentIndex,
  statuses,
  skippedSteps,
  onStepClick,
}: StepIndicatorProps) {
  return (
    <div className="overflow-x-auto w-full">
      <div className="flex items-start min-w-max px-4 py-2">
        {steps.map((step, index) => {
          const isComplete = statuses[index]?.complete;
          const isSkipped = skippedSteps.has(index);
          const isCurrent = index === currentIndex;

          return (
            <React.Fragment key={index}>
              {/* Step circle + label */}
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onStepClick(index)}
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    isComplete &&
                      !isSkipped &&
                      "bg-emerald-500 text-white",
                    isSkipped &&
                      "bg-amber-500 text-white",
                    isCurrent &&
                      !isComplete &&
                      !isSkipped &&
                      "bg-background text-foreground ring-2 ring-primary",
                    !isCurrent &&
                      !isComplete &&
                      !isSkipped &&
                      "bg-muted text-muted-foreground"
                  )}
                  aria-label={`Step ${index + 1}: ${step.label}`}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isComplete && !isSkipped ? (
                    <Check className="w-4 h-4" />
                  ) : isSkipped ? (
                    <Minus className="w-4 h-4" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </button>

                <span className="text-xs text-muted-foreground max-w-[64px] text-center truncate leading-tight">
                  {step.label}
                </span>
              </div>

              {/* Connecting line (not after last step) */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-px mt-4 mx-1 min-w-[16px]",
                    statuses[index]?.complete && !skippedSteps.has(index)
                      ? "bg-emerald-500"
                      : "bg-muted"
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
