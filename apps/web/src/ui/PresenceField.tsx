import { useEffect, useId, useRef } from "react";
import { AgentActivity } from "./AgentActivity";
import type { AgentActivity as Activity } from "../inbox/agentActivity";
import { PRESENCE_TIERS, type PresenceCounts, type PresenceTier } from "../api/types";

export interface PresenceFieldProps {
  counts: PresenceCounts;
  variant: "hero" | "compact";
  maxBlobs?: number;
  agentActivity?: Activity[];
}

const TIER_NAME: Record<PresenceTier, { plural: string; singular: string }> = {
  attendee: { plural: "Attendees", singular: "attendee" },
  speaker: { plural: "Speakers", singular: "speaker" },
  staff: { plural: "Staff", singular: "staff" },
  organizer: { plural: "Organizers", singular: "organizer" },
};

const TIER_NUMBER: Record<PresenceTier, number> = { attendee: 0, speaker: 1, staff: 2, organizer: 3 };

const FALLBACK_COLOR: Record<PresenceTier, string> = {
  attendee: "#3DD6B0",
  speaker: "#8B7CFF",
  staff: "#2F6FEB",
  organizer: "#15161A",
};

const RADIUS_FACTOR: Record<PresenceTier, number> = { attendee: 1, speaker: 1.3, staff: 1, organizer: 1.15 };

const POP_MS = 450;
const RING_MS = 1300;
const FADE_MS = 600;
const GOLDEN_ANGLE = 2.399963229728653;
const MAX_RINGS = 24;

export function presenceUnit(total: number, maxBlobs: number): number {
  return total > maxBlobs ? Math.ceil(total / maxBlobs) : 1;
}

function summary(counts: PresenceCounts, total: number): string {
  const person = total === 1 ? "person" : "people";
  const part = (tier: PresenceTier) => `${counts[tier]} ${counts[tier] === 1 ? TIER_NAME[tier].singular : TIER_NAME[tier].plural.toLowerCase()}`;
  return `${total} ${person} checked in: ${part("attendee")}, ${part("speaker")}, ${part("staff")}, ${part("organizer")}.`;
}

interface Blob {
  slot: number;
  x: number;
  y: number;
  born: number;
  dieAt: number | null;
  seedA: number;
  seedB: number;
}

interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Ring {
  tier: PresenceTier;
  x: number;
  y: number;
  start: number;
}

interface Field {
  blobs: Record<PresenceTier, Blob[]>;
  zones: Record<PresenceTier, Zone>;
  rings: Ring[];
  colors: Record<PresenceTier, string>;
  ringColor: string;
  baseRadius: number;
  width: number;
  height: number;
  dpr: number;
  targets: Record<PresenceTier, number>;
  last: number;
}

function emptyBlobs(): Record<PresenceTier, Blob[]> {
  return { attendee: [], speaker: [], staff: [], organizer: [] };
}

function createField(baseRadius: number): Field {
  const zone: Zone = { x: 0, y: 0, w: 0, h: 0 };
  return {
    blobs: emptyBlobs(),
    zones: { attendee: { ...zone }, speaker: { ...zone }, staff: { ...zone }, organizer: { ...zone } },
    rings: [],
    colors: { ...FALLBACK_COLOR },
    ringColor: "rgba(21,22,26,0.55)",
    baseRadius,
    width: 0,
    height: 0,
    dpr: 1,
    targets: { attendee: 0, speaker: 0, staff: 0, organizer: 0 },
    last: 0,
  };
}

function radiusFor(field: Field, tier: PresenceTier): number {
  return field.baseRadius * RADIUS_FACTOR[tier];
}

/** Packing geometry for one cluster: spacing and the ellipse scale that fits the zone. */
function packing(field: Field, tier: PresenceTier) {
  const zone = field.zones[tier];
  const count = Math.max(1, field.targets[tier]);
  const r = radiusFor(field, tier);
  const aspect = zone.h > 0 ? Math.sqrt(zone.w / zone.h) : 1;
  const ax = aspect;
  const ay = 1 / aspect;
  const desired = (2 * r + 4) * 0.55;
  const fitX = (zone.w / 2 - r - 2) / (Math.sqrt(count) * ax);
  const fitY = (zone.h / 2 - r - 2) / (Math.sqrt(count) * ay);
  const spacing = Math.max(1.2, Math.min(desired, fitX, fitY));
  const drawRadius = Math.min(r, Math.max(2, spacing * 0.9));
  return { spacing, ax, ay, drawRadius };
}

function homeOf(field: Field, tier: PresenceTier, slot: number, geometry: ReturnType<typeof packing>) {
  const zone = field.zones[tier];
  const cx = zone.x + zone.w / 2;
  const cy = zone.y + zone.h / 2;
  const radius = geometry.spacing * Math.sqrt(slot + 0.5);
  const angle = slot * GOLDEN_ANGLE;
  return { x: cx + Math.cos(angle) * radius * geometry.ax, y: cy + Math.sin(angle) * radius * geometry.ay };
}

function applyTargets(field: Field, targets: Record<PresenceTier, number>, now: number, animate: boolean) {
  for (const tier of PRESENCE_TIERS) {
    const target = targets[tier];
    field.targets[tier] = target;
    const alive = field.blobs[tier].filter((blob) => blob.dieAt === null);
    if (target > alive.length) {
      const geometry = packing(field, tier);
      for (let slot = alive.length; slot < target; slot += 1) {
        const home = homeOf(field, tier, slot, geometry);
        field.blobs[tier].push({
          slot,
          x: home.x,
          y: home.y,
          born: animate ? now : Number.NEGATIVE_INFINITY,
          dieAt: null,
          seedA: Math.random(),
          seedB: Math.random(),
        });
        if (animate && field.rings.length < MAX_RINGS) field.rings.push({ tier, x: home.x, y: home.y, start: now });
      }
    } else if (target < alive.length) {
      const doomed = alive.slice(target);
      if (animate) {
        for (const blob of doomed) blob.dieAt = now;
      } else {
        field.blobs[tier] = field.blobs[tier].filter((blob) => !doomed.includes(blob));
      }
    }
  }
}

function step(field: Field, now: number, dt: number, still: boolean) {
  for (const tier of PRESENCE_TIERS) {
    const blobs = field.blobs[tier];
    const geometry = packing(field, tier);
    const amplitude = still ? 0 : Math.min(geometry.spacing * 0.35, 4);
    const zone = field.zones[tier];
    const ease = still ? 1 : Math.min(1, dt * 0.004);
    for (const blob of blobs) {
      const home = homeOf(field, tier, blob.slot, geometry);
      const phase = now * 0.00028 * (0.7 + blob.seedA * 0.6);
      const tx = home.x + Math.sin(phase + blob.seedB * 6.28) * amplitude;
      const ty = home.y + Math.cos(phase * 0.83 + blob.seedA * 6.28) * amplitude;
      blob.x += (tx - blob.x) * ease;
      blob.y += (ty - blob.y) * ease;
    }
    if (!still) {
      const minDist = geometry.drawRadius * 2.1;
      for (let i = 0; i < blobs.length; i += 1) {
        const a = blobs[i];
        if (!a) continue;
        for (let j = i + 1; j < blobs.length; j += 1) {
          const b = blobs[j];
          if (!b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy;
          if (distSq > 0 && distSq < minDist * minDist) {
            const dist = Math.sqrt(distSq);
            const push = ((minDist - dist) / dist) * 0.5;
            a.x -= dx * push;
            a.y -= dy * push;
            b.x += dx * push;
            b.y += dy * push;
          }
        }
      }
    }
    for (const blob of blobs) {
      blob.x = Math.min(zone.x + zone.w - 1, Math.max(zone.x + 1, blob.x));
      blob.y = Math.min(zone.y + zone.h - 1, Math.max(zone.y + 1, blob.y));
    }
    field.blobs[tier] = blobs.filter((blob) => blob.dieAt === null || now - blob.dieAt < FADE_MS);
  }
  field.rings = field.rings.filter((ring) => now - ring.start < RING_MS);
}

function easeOutBack(t: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function draw(ctx: CanvasRenderingContext2D, field: Field, now: number, still: boolean) {
  ctx.setTransform(field.dpr, 0, 0, field.dpr, 0, 0);
  ctx.clearRect(0, 0, field.width, field.height);

  for (const tier of PRESENCE_TIERS) {
    const geometry = packing(field, tier);
    const color = field.colors[tier];
    for (const blob of field.blobs[tier]) {
      let scale = 1;
      let alpha = 1;
      if (!still) {
        const age = Math.min(1, (now - blob.born) / POP_MS);
        scale = age >= 1 ? 1 : Math.max(0.01, easeOutBack(age));
        alpha = age;
        if (blob.dieAt !== null) alpha = Math.max(0, 1 - (now - blob.dieAt) / FADE_MS);
      }
      const r = geometry.drawRadius * scale;
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      const gradient = ctx.createRadialGradient(blob.x - r * 0.3, blob.y - r * 0.3, r * 0.1, blob.x, blob.y, r);
      gradient.addColorStop(0, "rgba(255,255,255,0.55)");
      gradient.addColorStop(0.35, color);
      gradient.addColorStop(1, color);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(blob.x, blob.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (tier === "speaker") {
        ctx.strokeStyle = field.ringColor;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, r + 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  if (!still) {
    for (const ring of field.rings) {
      const t = (now - ring.start) / RING_MS;
      const base = packing(field, ring.tier).drawRadius;
      ctx.globalAlpha = 0.45 * (1 - t) * (1 - t);
      ctx.strokeStyle = field.colors[ring.tier];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, base + 2 + base * 2.2 * t, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

export function PresenceField({ counts, variant, maxBlobs = 160, agentActivity }: PresenceFieldProps) {
  const titleId = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoneRefs = useRef<Partial<Record<PresenceTier, HTMLLIElement | null>>>({});
  const fieldRef = useRef<Field | null>(null);
  const targetsRef = useRef<Record<PresenceTier, number>>({ attendee: 0, speaker: 0, staff: 0, organizer: 0 });
  const redrawRef = useRef<(() => void) | null>(null);

  const total = PRESENCE_TIERS.reduce((sum, tier) => sum + Math.max(0, counts[tier]), 0);
  const unit = presenceUnit(total, maxBlobs);
  const targets: Record<PresenceTier, number> = {
    attendee: Math.ceil(Math.max(0, counts.attendee) / unit),
    speaker: Math.ceil(Math.max(0, counts.speaker) / unit),
    staff: Math.ceil(Math.max(0, counts.staff) / unit),
    organizer: Math.ceil(Math.max(0, counts.organizer) / unit),
  };
  targetsRef.current = targets;
  const targetsKey = PRESENCE_TIERS.map((tier) => targets[tier]).join(",");

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const motion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    let reduced = motion?.matches ?? false;
    const field = createField(variant === "hero" ? 7 : 4);
    fieldRef.current = field;
    let frame = 0;

    const readColors = () => {
      const style = getComputedStyle(canvas);
      for (const tier of PRESENCE_TIERS) {
        const value = style.getPropertyValue(`--presence-${tier}`).trim();
        if (value) field.colors[tier] = value;
      }
      const ring = style.getPropertyValue("--presence-ring").trim();
      if (ring) field.ringColor = ring;
    };

    const measure = () => {
      const box = stage.getBoundingClientRect();
      field.width = Math.max(1, box.width);
      field.height = Math.max(1, box.height);
      field.dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.round(field.width * field.dpr);
      canvas.height = Math.round(field.height * field.dpr);
      canvas.style.width = `${field.width}px`;
      canvas.style.height = `${field.height}px`;
      for (const tier of PRESENCE_TIERS) {
        const cell = zoneRefs.current[tier];
        if (!cell) continue;
        const rect = cell.getBoundingClientRect();
        const label = cell.querySelector<HTMLElement>(".presence__label");
        const labelHeight = label ? label.getBoundingClientRect().bottom - rect.top + 6 : 0;
        field.zones[tier] = {
          x: rect.left - box.left + 4,
          y: rect.top - box.top + labelHeight,
          w: Math.max(1, rect.width - 8),
          h: Math.max(1, rect.height - labelHeight - 4),
        };
      }
      readColors();
    };

    const renderStatic = () => {
      step(field, 0, 0, true);
      draw(ctx, field, 0, true);
    };

    const loop = (time: number) => {
      const dt = field.last === 0 ? 16 : Math.min(64, time - field.last);
      field.last = time;
      step(field, time, dt, false);
      draw(ctx, field, time, false);
      frame = window.requestAnimationFrame(loop);
    };

    const start = () => {
      window.cancelAnimationFrame(frame);
      field.last = 0;
      if (reduced) renderStatic();
      else frame = window.requestAnimationFrame(loop);
    };

    measure();
    applyTargets(field, targetsRef.current, performance.now(), false);
    start();

    redrawRef.current = () => {
      applyTargets(field, targetsRef.current, performance.now(), !reduced);
      if (reduced) renderStatic();
    };

    const onMotionChange = () => {
      reduced = motion?.matches ?? false;
      applyTargets(field, targetsRef.current, performance.now(), false);
      start();
    };
    motion?.addEventListener("change", onMotionChange);

    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            measure();
            if (reduced) renderStatic();
          })
        : null;
    observer?.observe(stage);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      motion?.removeEventListener("change", onMotionChange);
      redrawRef.current = null;
      fieldRef.current = null;
    };
  }, [variant]);

  useEffect(() => {
    redrawRef.current?.();
  }, [targetsKey]);

  return (
    <section className={`presence presence--${variant}`} aria-labelledby={titleId}>
      <h2 id={titleId} className="presence__title">
        Checked in
      </h2>
      {agentActivity ? <AgentActivity activity={agentActivity} /> : null}
      <p className="presence__summary">{summary(counts, total)}</p>
      <div className="presence__stage" ref={stageRef}>
        <canvas ref={canvasRef} className="presence__canvas" aria-hidden="true" />
        <ul className="presence__zones">
          {PRESENCE_TIERS.map((tier) => (
            <li
              key={tier}
              className="presence__zone"
              data-tier={tier}
              ref={(node) => {
                zoneRefs.current[tier] = node;
              }}
            >
              <p className="presence__label">
                <span className="presence__count">{counts[tier]}</span>
                <span className="presence__name">{TIER_NAME[tier].plural}</span>
                <span className="presence__tier">Tier {TIER_NUMBER[tier]}</span>
              </p>
            </li>
          ))}
        </ul>
      </div>
      {unit > 1 ? <p className="presence__caption">{`1 dot ≈ ${unit} people`}</p> : null}
    </section>
  );
}
