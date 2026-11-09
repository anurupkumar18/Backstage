import { CrowdSimulator } from "./CrowdSimulator";

export interface DevPanelProps {
  onBumpVersion(): void;
  onProbeDeniedApprove(): void;
  onDropNextResponse(): void;
  onReset(): void;
  onCheckInWave?: () => void;
}

export function DevPanel({ onBumpVersion, onProbeDeniedApprove, onDropNextResponse, onReset, onCheckInWave }: DevPanelProps) {
  return (
    <details className="dev-panel">
      <summary>Mock controls (rehearsal only)</summary>
      <ul className="dev-panel__list">
        <li>
          <button type="button" className="btn btn--quiet" onClick={onBumpVersion}>
            Simulate another operator
          </button>
          <span>The next action returns a stale version conflict.</span>
        </li>
        <li>
          <button type="button" className="btn btn--quiet" onClick={onProbeDeniedApprove}>
            Try approve as current role
          </button>
          <span>Sends an approve request even when your role cannot approve.</span>
        </li>
        <li>
          <button type="button" className="btn btn--quiet" onClick={onDropNextResponse}>
            Drop the next response
          </button>
          <span>The server commits, the reply is lost, and the client retries with the same key.</span>
        </li>
        {onCheckInWave ? (
          <li>
            <button type="button" className="btn btn--quiet" onClick={onCheckInWave}>
              Simulate a check-in wave (mock)
            </button>
            <span>Adds anonymous check-ins to the presence counts. Mock mode only.</span>
          </li>
        ) : null}
        <li>
          <button type="button" className="btn btn--quiet" onClick={onReset}>
            Reset scenario
          </button>
          <span>Returns the incident to its starting state.</span>
        </li>
      </ul>
      <CrowdSimulator capacity={80} initial={96} />
    </details>
  );
}
