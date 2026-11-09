import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { PRESENCE_TIERS, type PresenceTier } from "../api/types";

export interface JoinPageProps {
  onJoin(tier: PresenceTier): Promise<{ ok: boolean; message: string }>;
  joinedTier: PresenceTier | null;
}

export const JOIN_PRIVACY_NOTE =
  "Counts only. The floor display shows how many people picked each option. No names, faces or identities are stored.";

const OPTIONS: Record<PresenceTier, { label: string; tier: number; hint: string; cluster: string }> = {
  attendee: { label: "Attendee", tier: 0, hint: "Here for the talks and the hallway.", cluster: "Attendees" },
  speaker: { label: "Speaker", tier: 1, hint: "Giving a talk or on a panel.", cluster: "Speakers" },
  staff: { label: "Staff", tier: 2, hint: "Volunteer, venue, AV or IT crew.", cluster: "Staff" },
  organizer: { label: "Organizer", tier: 3, hint: "Running the event.", cluster: "Organizers" },
};

export function JoinPage({ onJoin, joinedTier }: JoinPageProps) {
  const ids = useId();
  const titleId = `${ids}-title`;
  const introId = `${ids}-intro`;
  const doneId = `${ids}-done`;
  const [choice, setChoice] = useState<PresenceTier | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [localTier, setLocalTier] = useState<PresenceTier | null>(null);
  const [editing, setEditing] = useState(false);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const moved = useRef(false);

  const joined = editing ? null : (joinedTier ?? localTier);

  useEffect(() => {
    if (!moved.current) return;
    if (joined) doneRef.current?.focus();
    else firstRadioRef.current?.focus();
  }, [joined]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!choice) {
      setMessage("Choose one option to continue.");
      return;
    }
    setBusy(true);
    setMessage(`Joining as ${OPTIONS[choice].label}...`);
    try {
      const result = await onJoin(choice);
      setMessage(result.message);
      if (result.ok) {
        moved.current = true;
        setLocalTier(choice);
        setEditing(false);
      }
    } catch {
      setMessage("Could not join. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="join" aria-labelledby={joined ? doneId : titleId}>
      <div className="join__signals" aria-hidden="true">
        {PRESENCE_TIERS.map((tier) => (
          <span key={tier} className="join__signal" data-tier={tier}>
            <span className="join__signal-dot" />
            {OPTIONS[tier].cluster}
          </span>
        ))}
      </div>

      <div className="join__sheet">
        <p className="join__brand">BACKSTAGE</p>

        {joined ? (
          <div className="join__done">
            <div className="join__you" data-tier={joined} aria-hidden="true">
              <span className="join__ring" />
              <svg className="join__blob" viewBox="0 0 100 100" focusable="false">
                <path d="M50 8C72 6 93 22 92 48C91 74 76 94 50 92C24 91 8 74 9 50C10 26 28 10 50 8Z" />
              </svg>
            </div>
            <h1 id={doneId} ref={doneRef} tabIndex={-1} className="join__title">
              You're in.
            </h1>
            <p className="join__text">
              Your dot is now in the {OPTIONS[joined].cluster} cluster on the floor display, as {OPTIONS[joined].label} (Tier{" "}
              {OPTIONS[joined].tier}).
            </p>
            <p className="join__text join__text--quiet">This only changes where your dot appears. It grants no permissions.</p>
            <button
              type="button"
              className="join__secondary"
              onClick={() => {
                moved.current = true;
                setChoice(joined);
                setEditing(true);
                setMessage("");
              }}
            >
              Change how I'm here
            </button>
          </div>
        ) : (
          <form className="join__form" onSubmit={submit} aria-describedby={introId} aria-busy={busy || undefined}>
            <h1 id={titleId} className="join__title">
              How are you here today?
            </h1>
            <p id={introId} className="join__text">
              Pick one. It only changes where your dot appears on the floor display. It grants no permissions.
            </p>
            <fieldset className="join__options" disabled={busy}>
              <legend className="sr-only">I'm here as</legend>
              {PRESENCE_TIERS.map((tier, index) => {
                const option = OPTIONS[tier];
                const inputId = `${ids}-${tier}`;
                return (
                  <div key={tier} className="join__option" data-tier={tier}>
                    <input
                      ref={index === 0 ? firstRadioRef : undefined}
                      id={inputId}
                      type="radio"
                      name={`${ids}-tier`}
                      value={tier}
                      checked={choice === tier}
                      onChange={() => {
                        setChoice(tier);
                        setMessage("");
                      }}
                      aria-describedby={`${inputId}-hint`}
                    />
                    <label htmlFor={inputId}>
                      <span className="join__option-dot" aria-hidden="true" />
                      <span className="join__option-name">{option.label}</span>
                      <span className="join__option-tier">Tier {option.tier}</span>
                      <span id={`${inputId}-hint`} className="join__option-hint">
                        {option.hint}
                      </span>
                    </label>
                  </div>
                );
              })}
            </fieldset>
            <button type="submit" className="join__continue" disabled={busy} aria-busy={busy || undefined}>
              {busy ? "Joining..." : "Continue"}
            </button>
          </form>
        )}

        <p role="status" aria-live="polite" className="join__message">
          {message}
        </p>
        <p className="join__privacy">{JOIN_PRIVACY_NOTE}</p>
      </div>
    </section>
  );
}
