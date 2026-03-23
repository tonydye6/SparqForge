import React from "react";
import { Link } from "wouter";
import { CheckCircle2, XCircle, PartyPopper, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WizardStepShell } from "@/components/setup/WizardStepShell";

interface StepReadinessCheckProps {
  brandId: string | null;
  readiness: {
    ready?: boolean;
    missing?: string[];
    checks?: Record<string, { passed: boolean; label: string; count?: number }>;
  } | null;
  onBack: () => void;
  goToStep: (index: number) => void;
}

const READINESS_TO_STEP: Record<string, number> = {
  logo: 1,
  fonts: 2,
  voice: 3,
  platformRules: 4,
  templates: 5,
  approvedAssets: 6,
};

// Ordered list of check keys to render consistently
const CHECK_KEYS = ["logo", "fonts", "voice", "platformRules", "templates", "approvedAssets"];

export default function StepReadinessCheck({
  readiness,
  onBack,
  goToStep,
}: StepReadinessCheckProps) {
  const isReady = readiness?.ready === true;
  const checks = readiness?.checks ?? {};

  return (
    <WizardStepShell
      title={isReady ? "Setup Complete" : "Setup Review"}
      description={
        isReady
          ? "You're all set to start creating content"
          : "Review your setup status"
      }
      canNext={false}
      showBack={true}
      showSkip={false}
      nextLabel=""
      onNext={() => {}}
      onBack={onBack}
    >
      {isReady ? (
        /* ── Celebration state ──────────────────────────────────── */
        <div className="flex flex-col items-center gap-6 py-8 text-center">
          <style>{`
            @keyframes sparq-pop-in {
              0%   { transform: scale(0);   opacity: 0; }
              60%  { transform: scale(1.2); opacity: 1; }
              80%  { transform: scale(0.9); }
              100% { transform: scale(1);   opacity: 1; }
            }
            .sparq-party-icon {
              animation: sparq-pop-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both;
            }
          `}</style>

          <PartyPopper
            className="sparq-party-icon w-20 h-20 text-primary"
            aria-hidden="true"
          />

          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-foreground">
              Your brand is ready!
            </h2>
            <p className="text-sm text-muted-foreground">
              Everything is set up for content generation
            </p>
          </div>

          <Button asChild size="lg" className="mt-2">
            <Link to="/">
              Open Campaign Studio
              <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        </div>
      ) : (
        /* ── Incomplete state ───────────────────────────────────── */
        <div className="space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Almost there!</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Complete these items to start generating content
            </p>
          </div>

          <ul className="space-y-3" role="list" aria-label="Setup checklist">
            {CHECK_KEYS.map((key) => {
              const check = checks[key];
              if (!check) return null;

              return (
                <li
                  key={key}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {check.passed ? (
                      <CheckCircle2
                        className="w-5 h-5 flex-shrink-0 text-green-500"
                        aria-label="Passed"
                      />
                    ) : (
                      <XCircle
                        className="w-5 h-5 flex-shrink-0 text-destructive"
                        aria-label="Incomplete"
                      />
                    )}
                    <span className="text-sm font-medium text-foreground truncate">
                      {check.label}
                    </span>
                    {check.count !== undefined && (
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        ({check.count})
                      </span>
                    )}
                  </div>

                  {!check.passed && READINESS_TO_STEP[key] !== undefined && (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => goToStep(READINESS_TO_STEP[key])}
                      className="flex-shrink-0"
                    >
                      Go back
                      <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </WizardStepShell>
  );
}
