import React from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WizardStepShellProps {
  title: string;
  description: string;
  children: React.ReactNode;
  onNext: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  canNext: boolean;
  showBack?: boolean;
  showSkip?: boolean;
  nextLabel?: string;
  skipLabel?: string;
}

export function WizardStepShell({
  title,
  description,
  children,
  onNext,
  onBack,
  onSkip,
  canNext,
  showBack = false,
  showSkip = false,
  nextLabel = "Next",
  skipLabel = "Skip for now",
}: WizardStepShellProps) {
  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* Main content area */}
      <div className="max-w-2xl mx-auto px-4 py-8 w-full flex-1">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1 mb-8">{description}</p>

        <div>{children}</div>
      </div>

      {/* Sticky footer button bar */}
      <div className="sticky bottom-0 bg-background border-t border-border py-4 px-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          {/* Left: Back button */}
          <div className="flex-1 flex justify-start">
            {showBack && onBack ? (
              <Button variant="ghost" onClick={onBack} type="button">
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            ) : (
              <span />
            )}
          </div>

          {/* Center: Skip link */}
          <div className="flex-1 flex justify-center">
            {showSkip && onSkip ? (
              <button
                type="button"
                onClick={onSkip}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
              >
                {skipLabel}
              </button>
            ) : null}
          </div>

          {/* Right: Next button */}
          <div className="flex-1 flex justify-end">
            <Button
              variant="default"
              onClick={onNext}
              disabled={!canNext}
              type="button"
            >
              {nextLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
