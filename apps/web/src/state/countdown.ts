// Validity of the "Sunset in / Earthrise in …" countdowns. The worker computes the next transitions
// from a reference time m.now.t; they stay correct only while the playhead t is in
// [m.now.t, first upcoming transition). Outside that window the numbers are stale and must be
// recomputed (and never shown as negative durations).

const DAY = 86_400_000;

export interface EventsRef {
  now: { t: number };
  sunNext: { t: number } | null;
  earthNext: { t: number } | null;
}

/** True while the transitions in `m` are still the next ones as seen from playhead `t`. */
export function eventsValid(m: EventsRef, t: number): boolean {
  // null = "no change within the search horizon": re-check daily so "> 60 d" never drifts
  const cap = m.now.t + DAY;
  const next = Math.min(m.sunNext?.t ?? cap, m.earthNext?.t ?? cap);
  return t >= m.now.t && t < next;
}

/** Milliseconds from `t` to transition `ev`, or null when the value is stale (awaiting a refresh). */
export function countdownMs(m: EventsRef, ev: { t: number }, t: number): number | null {
  return t >= m.now.t && t < ev.t ? ev.t - t : null;
}
