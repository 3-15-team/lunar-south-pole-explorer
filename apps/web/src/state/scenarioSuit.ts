// Colour of each pinned scenario (card chip / stripe, map marker): its Suitability from the numbers
// the card already shows — sunlight, longest night, Earth contact — on the map layer's cividis ramp.
import { computed } from '@preact/signals';
import { intervalScore, PRESETS } from '../core/suitability';
import { cividis } from '../ui/format';
import { preset, scenarioResults, scenarios } from './store';

export interface ScenarioSuit {
  score: number | null; // [0,1]; null while the scenario's metrics are loading
  color: string;
  label: string;
}

const PENDING = '#4a5361';

export const scenarioSuit = computed<Record<string, ScenarioSuit>>(() => {
  const pr = PRESETS[preset.value];
  const res = scenarioResults.value;
  const out: Record<string, ScenarioSuit> = {};
  for (const sc of scenarios.value) {
    const m = res[sc.id]?.base?.metrics;
    if (!m) {
      out[sc.id] = { score: null, color: PENDING, label: 'Suitability: computing…' };
      continue;
    }
    const s = intervalScore({ illum: m.illumFrac, dark: m.longestDarkH, earth: m.earthFrac }, pr.weights, pr.darkRef);
    out[sc.id] = { score: s, color: cividis(s), label: `Suitability ${s.toFixed(2)} — sunlight, longest night, Earth contact (${pr.label}); slope not included` };
  }
  return out;
});
