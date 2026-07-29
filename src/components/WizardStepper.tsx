import "./WizardStepper.css";

type StepItem = {
  id: number;
  title: string;
};

export function WizardStepper(props: {
  steps: StepItem[];
  currentStep: number;
  onSelectStep?: (step: number) => void;
  canAccessStep?: (step: number) => boolean;
}) {
  return (
    <div className="wizardStepper">
      {props.steps.map((step) => {
        const isCurrent = step.id === props.currentStep;
        const isDone = step.id < props.currentStep;
        const isDisabled = props.canAccessStep ? !props.canAccessStep(step.id) : false;
        return (
          <button
            type="button"
            key={step.id}
            className={`wizardStep ${isCurrent ? "current" : ""} ${isDone ? "done" : ""}`}
            onClick={() => props.onSelectStep?.(step.id)}
            disabled={isDisabled}
          >
            <div className="wizardStepBadge">{isDone ? "✓" : step.id}</div>
            <div className="wizardStepText">{step.title}</div>
          </button>
        );
      })}
    </div>
  );
}

