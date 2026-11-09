import { useId, useState } from "react";

export interface CrowdSimulatorProps {
  /** Demo threshold only. Not a venue figure. */
  capacity: number;
  max?: number;
  initial?: number;
}

/**
 * Rehearsal-only fallback for the demo if the camera feed drops. It keeps its own local state and never
 * feeds the board, so it cannot change what live mode shows.
 */
export function CrowdSimulator({ capacity, max = 120, initial = 0 }: CrowdSimulatorProps) {
  const [crowd, setCrowd] = useState(Math.min(max, initial));
  const titleId = useId();
  const sliderId = useId();
  const over = Math.max(0, crowd - capacity);

  return (
    <section className="panel sim" aria-labelledby={titleId}>
      <h3 id={titleId} className="panel__title">
        Crowd simulator (rehearsal only)
      </h3>
      <p className="panel__sub">Demo override. It does not change the board. The capacity below is a demo value, not a venue figure.</p>
      <p className="sim__count">
        <span className="sim__number">{crowd}</span>
        <span>
          of {capacity} demo seats, {over > 0 ? `${over} over` : "within"} capacity
        </span>
      </p>
      <div className="sim__dots" aria-hidden="true">
        {Array.from({ length: max }, (_, index) => (
          <span key={index} className="sim__dot" data-state={index < crowd ? (index < capacity ? "in" : "over") : "empty"} />
        ))}
      </div>
      <label htmlFor={sliderId} className="sim__label">
        Simulate crowd
      </label>
      <input
        id={sliderId}
        className="sim__range"
        type="range"
        min={0}
        max={max}
        step={1}
        value={crowd}
        aria-valuetext={`${crowd} people, ${over > 0 ? `${over} over` : "within"} the demo capacity of ${capacity}`}
        onChange={(event) => setCrowd(Number(event.target.value))}
      />
    </section>
  );
}
