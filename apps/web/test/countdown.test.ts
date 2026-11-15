import { describe, expect, it } from 'vitest';
import { countdownMs, eventsValid } from '../src/state/countdown';
import { fmtCountdown } from '../src/ui/format';

const H = 3_600_000;
const D = 24 * H;
const m = { now: { t: 0 }, sunNext: { t: 10 * H }, earthNext: { t: 30 * H } };

describe('event countdown validity', () => {
  it('is valid from the reference time until the first upcoming transition', () => {
    expect(eventsValid(m, 0)).toBe(true);
    expect(eventsValid(m, 9.9 * H)).toBe(true);
    expect(eventsValid(m, 10 * H)).toBe(false); // sunset passed: must refresh, not count negative
    expect(eventsValid(m, -1)).toBe(false); // playhead moved before the reference
  });
  it('re-checks daily when no transition was found within the horizon', () => {
    const none = { now: { t: 0 }, sunNext: null, earthNext: null };
    expect(eventsValid(none, 23 * H)).toBe(true);
    expect(eventsValid(none, D)).toBe(false);
  });
  it('never yields a negative countdown', () => {
    expect(countdownMs(m, m.sunNext, 4 * H)).toBe(6 * H);
    expect(countdownMs(m, m.sunNext, 12 * H)).toBeNull();
    expect(countdownMs(m, m.earthNext, 12 * H)).toBe(18 * H);
    expect(countdownMs(m, m.sunNext, -H)).toBeNull();
    expect(fmtCountdown(null)).toBe('…');
    expect(fmtCountdown(6 * H)).toBe('6 h 0 min');
  });
});
