import { describe, expect, it } from 'vitest';
import { decodeState } from '../src/state/url';
import { fmtHeight, H_TICKS, heightToPos, keyStepHeight, POS_MAX, POS_MIN, POS_STEP, posToHeight, snapHeight, tickPos } from '../src/ui/heightScale';

describe('height above surface: log scale 1–100 m', () => {
  it('maps the ends and the decade to the slider', () => {
    expect(posToHeight(POS_MIN)).toBe(1);
    expect(posToHeight(POS_MAX)).toBe(100);
    expect(heightToPos(10)).toBeCloseTo((POS_MIN + POS_MAX) / 2, 12); // 1–10 m = half of the travel
  });
  it('is fine below 10 m and coarser above', () => {
    expect(snapHeight(2.34)).toBe(2.3);
    expect(snapHeight(37.6)).toBe(38);
    // every 0.1 m below 10 m and every 1 m above is reachable from some slider step
    const reach = new Set<number>();
    for (let p = POS_MIN; p <= POS_MAX + 1e-9; p += POS_STEP) reach.add(posToHeight(p));
    for (let h = 1; h < 10; h = Math.round((h + 0.1) * 10) / 10) expect(reach.has(h)).toBe(true);
    for (let h = 10; h <= 100; h++) expect(reach.has(h)).toBe(true);
  });
  it('round-trips the slider position', () => {
    for (const h of [1, 2, 2.5, 7.3, 10, 15, 64, 100]) expect(posToHeight(heightToPos(h))).toBe(h);
  });
  it('ticks sit on slider steps and still read as their height', () => {
    for (const t of H_TICKS) {
      const k = (tickPos(t) - POS_MIN) / POS_STEP;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
      expect(posToHeight(tickPos(t))).toBe(t);
    }
  });
  it('clamps and formats', () => {
    expect(posToHeight(-5)).toBe(1);
    expect(posToHeight(9)).toBe(100);
    expect(fmtHeight(2)).toBe('2.0 m');
    expect(fmtHeight(38)).toBe('38 m');
  });
  it('URL ?h= is clamped to 1–100 m and snapped (old links with h=0 → 1 m)', () => {
    expect(decodeState('h=0').hObs).toBe(1);
    expect(decodeState('h=250').hObs).toBe(100);
    expect(decodeState('h=3.14159').hObs).toBe(3.1);
  });
  it('keyboard steps by the snap, not the (finer) native range step', () => {
    // a native step from 2 m is 2.018 m, which snaps back to 2.0 m: the slider would not move
    expect(posToHeight(heightToPos(2) + POS_STEP)).toBe(2);
    expect(keyStepHeight(2, 'ArrowUp')).toBe(2.1);
    expect(keyStepHeight(2, 'ArrowRight')).toBe(2.1);
    expect(keyStepHeight(2.1, 'ArrowDown')).toBe(2);
    expect(keyStepHeight(9.9, 'ArrowUp')).toBe(10);
    expect(keyStepHeight(10, 'ArrowUp')).toBe(11);
    expect(keyStepHeight(10, 'ArrowDown')).toBe(9.9);
    expect(keyStepHeight(1, 'ArrowDown')).toBe(1);
    expect(keyStepHeight(100, 'ArrowUp')).toBe(100);
    expect(keyStepHeight(2, 'PageUp')).toBe(5);
    expect(keyStepHeight(2.5, 'PageDown')).toBe(2);
    expect(keyStepHeight(38, 'Home')).toBe(1);
    expect(keyStepHeight(3, 'End')).toBe(100);
    expect(keyStepHeight(3, 'a')).toBeNull();
  });
});
