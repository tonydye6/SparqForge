import { useSetupWizard } from "@/hooks/useSetupWizard";
import { WIZARD_STEPS } from "@/lib/setup-defaults";
import { StepIndicator } from "@/components/setup/StepIndicator";
import { StepCreateBrand } from "@/components/setup/StepCreateBrand";
import StepUploadLogo from "@/components/setup/StepUploadLogo";
import StepUploadFont from "@/components/setup/StepUploadFont";
import { StepConfigureVoice } from "@/components/setup/StepConfigureVoice";
import { StepPlatformRules } from "@/components/setup/StepPlatformRules";
import { StepCreateTemplate } from "@/components/setup/StepCreateTemplate";
import StepUploadAsset from "@/components/setup/StepUploadAsset";
import StepReadinessCheck from "@/components/setup/StepReadinessCheck";

export default function SetupWizard() {
  const wizard = useSetupWizard();
  const { currentStepIndex, stepStatuses, skippedSteps, brandId, readiness, isLoading } = wizard;

  const stepProps = {
    brandId,
    readiness: readiness ?? null,
    onNext: wizard.next,
    onBack: wizard.back,
    onSkip: wizard.skip,
    setBrandId: wizard.setBrandId,
    goToStep: wizard.goToStep,
  };

  function renderStep() {
    switch (currentStepIndex) {
      case 0:
        return <StepCreateBrand {...stepProps} />;
      case 1:
        return <StepUploadLogo {...stepProps} />;
      case 2:
        return <StepUploadFont {...stepProps} />;
      case 3:
        return <StepConfigureVoice {...stepProps} />;
      case 4:
        return <StepPlatformRules {...stepProps} />;
      case 5:
        return <StepCreateTemplate {...stepProps} />;
      case 6:
        return <StepUploadAsset {...stepProps} />;
      case 7:
        return <StepReadinessCheck {...stepProps} />;
      default:
        return null;
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <span className="text-xl font-bold text-primary p-6">SparqMake</span>
        <span className="text-sm text-muted-foreground p-6">
          Step {currentStepIndex + 1} of 8
        </span>
      </div>

      {/* Step indicator */}
      <div className="px-6 pb-6">
        <StepIndicator
          steps={WIZARD_STEPS}
          currentIndex={currentStepIndex}
          statuses={stepStatuses}
          skippedSteps={skippedSteps}
          onStepClick={wizard.goToStep}
        />
      </div>

      {/* Main content */}
      <div className="flex justify-center">
        {isLoading ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          renderStep()
        )}
      </div>
    </div>
  );
}
