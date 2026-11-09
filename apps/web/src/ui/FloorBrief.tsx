import { useId } from "react";

export function FloorBrief({ lines, ready }: { lines: string[]; ready: boolean }) {
  const title = useId();
  return <section className="inbox__brief" aria-labelledby={title}>
    <h2 id={title}>While you were away</h2>
    {!ready ? <p>Checking recent history…</p> : lines.length === 0 ? <p>No recent changes in your scope.</p> : <>
      <ul>{lines.slice(0, 5).map((line) => <li key={line}>{line}</li>)}</ul>
      {lines.length > 5 ? <p>{lines.length - 5} more updates are in your inbox.</p> : null}
    </>}
  </section>;
}
