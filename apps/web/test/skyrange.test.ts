import { describe, expect, it } from 'vitest';
import { skyElRange, SKY_LO_MAX, SKY_LO_MIN } from '../src/ui/skyRange';

describe('sky plot elevation range', () => {
  it('keeps the old window for near-pole content', () => {
    const [lo, hi] = skyElRange(new Float32Array([-1.5, -0.6, 2]), [new Float32Array([-1.7, -1])], [[-1.2, 0.27]]);
    expect(lo).toBe(SKY_LO_MAX);
    expect(hi).toBeGreaterThanOrEqual(6);
  });
  it('extends below so low Sun tracks, discs and the horizon are not clipped', () => {
    const [lo] = skyElRange(new Float32Array([-4.97, 13.5]), [new Float32Array([-6.03, -0.5])], [[-5.83, 0.27]]);
    expect(lo).toBeLessThanOrEqual(-7);
    const [lo2] = skyElRange(null, [], [[-9.5, 0.27]]);
    expect(lo2).toBeLessThanOrEqual(-10.5);
  });
  it('is capped', () => {
    const [lo, hi] = skyElRange(new Float32Array([-60, 80]), [], []);
    expect(lo).toBe(SKY_LO_MIN);
    expect(hi).toBe(35);
  });
});
