// Map mode (lazy): OpenLayers view in LUNAR:SPS + custom WebGL terrain layer + vector
// overlays (graticule, PSRs, sites, scenarios, footprint, candidates) + pegman.
import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import OLMap from 'ol/Map';
import View from 'ol/View';
import Layer from 'ol/layer/Layer';
import VectorLayer from 'ol/layer/Vector';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import { LineString, Point, Polygon } from 'ol/geom';
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style';
import GeoJSON from 'ol/format/GeoJSON';
import ScaleLine from 'ol/control/ScaleLine';
import { defaults as defaultControls } from 'ol/control/defaults';
import 'ol/ol.css';
import { formatLatLon, xyToLatLon } from '../core/geo';
import { PRESETS, rankStability, type Candidate } from '../core/suitability';
import { customFromXY, resolveSite } from '../data/sites';
import {
  scenarioColor,
  catalog,
  computeOnline,
  dte,
  footprint,
  hAnt,
  hObs,
  mapEarthAntRequested,
  interval,
  layer,
  lighting,
  mapView,
  mode,
  preset,
  scenarios,
  services,
  showPsr,
  site,
  siteRef,
  slopeLimit,
  time,
  type Layer as LayerId,
} from '../state/store';
import { config } from '../config';
import { cividis, fmtHours, fmtPct } from '../ui/format';
import { fmtHeight } from '../ui/heightScale';
import { TerrainEngine, type AntennaPassState, type FrameLike } from './engine/engine';
import { footprintSquare, latitudeRing, meridian, spsProjection } from './projection';

const LAYERS: { id: LayerId; label: string; hint: string }[] = [
  { id: 'relief', label: 'Terrain (live light)', hint: 'LOLA relief lit by the real Sun at the playhead time; no baked shadows.' },
  { id: 'shadow', label: 'Shadows now', hint: 'Cast shadows (blue) and partially lit penumbra (orange) at the playhead time.' },
  { id: 'illum', label: 'Illumination %', hint: 'Mean visible solar-disk fraction over the selected interval.' },
  { id: 'earth', label: 'Earth visibility %', hint: 'Share of the interval with direct-to-Earth line of sight.' },
  { id: 'dark', label: 'Longest night', hint: 'Longest continuous darkness within the interval (yellow = short).' },
  { id: 'slope', label: 'Slope', hint: 'Terrain slope from the LOLA DEM (5/10/15/20/30° classes).' },
  { id: 'suit', label: 'Suitability', hint: 'Transparent multi-criteria score for an L×L footprint (hatched = slope too steep).' },
];

const KIND_COLOR: Record<string, string> = { 'pgda-5m': '#ffd45e', artemis: '#ff9f6b', clps: '#9be37c', mission: '#c39bff', reference: '#e8edf3', custom: '#e8edf3' };

function siteStyle(name: string, color: string, selected: boolean, showLabel: boolean): Style {
  return new Style({
    image: new CircleStyle({ radius: selected ? 7 : 4, fill: new Fill({ color }), stroke: new Stroke({ color: '#000', width: selected ? 2 : 1 }) }),
    text: showLabel
      ? new Text({ text: name, offsetY: -14, font: '12px system-ui, sans-serif', fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: '#000', width: 3 }) })
      : undefined,
  });
}

export default function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [engStatus, setEngStatus] = useState('');
  const [antPass, setAntPass] = useState<AntennaPassState>({ state: 'off' });
  const [hover, setHover] = useState('');
  const [pegArmed, setPegArmed] = useState(false);
  const [cands, setCands] = useState<(Candidate & { lat: number; lon: number })[] | null>(null);
  const [candBusy, setCandBusy] = useState(false);
  const engineRef = useRef<TerrainEngine | null>(null);
  const mapRef = useRef<OLMap | null>(null);
  const candSrc = useRef(new VectorSource());
  const pegRef = useRef(false);
  const regionLayer = useRef(new ImageLayer({ opacity: 0.8, visible: false }));
  const [region, setRegion] = useState<{ label: string; busy?: boolean; error?: string } | null>(null);
  pegRef.current = pegArmed;

  useEffect(() => {
    const dem = services.dem;
    const eph = services.eph;
    if (!el.current || !dem || !eph) {
      setErr('Terrain data not loaded yet — build it with `make data-min`.');
      return;
    }
    let engine: TerrainEngine;
    try {
      engine = new TerrainEngine(dem, eph);
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    engineRef.current = engine;
    const proj = spsProjection();
    const terrain = new Layer({ render: (fs) => engine.render(fs as unknown as FrameLike) });
    engine.onNeedRender = () => terrain.changed();
    engine.onStatus = setEngStatus;
    engine.onAntenna = setAntPass;

    // graticule
    const grat = new VectorSource();
    for (let lat = -89; lat >= -81; lat -= 1) {
      const f = new Feature(new LineString(latitudeRing(lat)));
      f.set('label', `${-lat}°S`);
      grat.addFeature(f);
    }
    // context Moon (outside the polar data): coarse graticule down to the equator
    for (const lat of [-70, -60, -50, -40, -30, -20, -10, 0]) {
      const f = new Feature(new LineString(latitudeRing(lat, 360)));
      f.set('label', lat === 0 ? 'equator' : `${-lat}°S`);
      grat.addFeature(f);
    }
    for (let lon = -150; lon <= 180; lon += 30) grat.addFeature(new Feature(new LineString(meridian(lon, 0, -89.9, 120))));
    // edge of the high-resolution polar data (everything outside is LOLA global 16 px/deg context)
    const edge = new Feature(new LineString(latitudeRing(-80, 360)));
    edge.set('label', '80°S · end of high-res polar data (outside: global context)');
    edge.set('edge', true);
    grat.addFeature(edge);
    const gratLayer = new VectorLayer({
      source: grat,
      style: (f) =>
        new Style({
          stroke: f.get('edge')
            ? new Stroke({ color: 'rgba(255,200,90,0.55)', width: 1.5, lineDash: [6, 5] })
            : new Stroke({ color: 'rgba(255,255,255,0.16)', width: 1 }),
          text: f.get('label')
            ? new Text({ text: f.get('label'), placement: 'line', font: '10px system-ui', fill: new Fill({ color: 'rgba(255,255,255,0.55)' }) })
            : undefined,
        }),
    });

    // PSRs
    const psrSrc = new VectorSource();
    fetch(services.dataBase + 'psr.geojson')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) psrSrc.addFeatures(new GeoJSON().readFeatures(j, { dataProjection: proj, featureProjection: proj }));
      })
      .catch(() => undefined);
    const psrLayer = new VectorLayer({
      source: psrSrc,
      style: new Style({ stroke: new Stroke({ color: 'rgba(120,200,255,0.75)', width: 1 }), fill: new Fill({ color: 'rgba(120,200,255,0.06)' }) }),
    });

    // sites, scenarios, selection/footprint, candidates
    const siteSrc = new VectorSource();
    const siteLayer = new VectorLayer({ source: siteSrc, declutter: true });
    const selSrc = new VectorSource();
    const selLayer = new VectorLayer({ source: selSrc });
    const candLayer = new VectorLayer({ source: candSrc.current });

    const v = mapView.peek();
    const view = new View({
      projection: proj,
      center: v ? [v.x, v.y] : [0, 0],
      resolution: v?.res ?? 330,
      minResolution: 0.6,
      maxResolution: 12000,
      // the whole southern hemisphere (context Moon) can be shown; the analysis stays inside 80°S
      extent: [-TerrainEngine.OUTER_HALF, -TerrainEngine.OUTER_HALF, TerrainEngine.OUTER_HALF, TerrainEngine.OUTER_HALF],
      constrainOnlyCenter: true,
      enableRotation: false,
    });
    const map = new OLMap({
      target: el.current,
      layers: [terrain, regionLayer.current, gratLayer, psrLayer, siteLayer, selLayer, candLayer],
      view,
      controls: defaultControls({ rotate: false, attribution: false }).extend([new ScaleLine({ units: 'metric', bar: false })]),
    });
    mapRef.current = map;

    const disposers: (() => void)[] = [];
    // store → engine params
    disposers.push(
      effect(() => {
        const pr = PRESETS[preset.value];
        engine.params = {
          time: time.value,
          interval: interval.value,
          layer: layer.value,
          obsH: hObs.value,
          // Earth share from the antenna height: only on demand (config.mapEarthAntenna, ADR-122)
          antH: hAnt.value !== hObs.value && (config.mapEarthAntenna === 'layer' || mapEarthAntRequested.value) ? hAnt.value : null,
          dte: dte.value,
          footprint: footprint.value,
          weights: pr.weights,
          slopeLimit: slopeLimit.value,
          darkRef: pr.darkRef,
          lighting: lighting.value,
        };
        terrain.changed();
      }),
    );
    disposers.push(effect(() => psrLayer.setVisible(showPsr.value)));
    // sites
    disposers.push(
      effect(() => {
        const cur = site.value;
        const res = mapView.value?.res ?? 330;
        siteSrc.clear();
        for (const s of catalog.value) {
          if (s.lat > -80) continue;
          const r = resolveSite({ kind: 'catalog', id: s.id }, catalog.value)!;
          const f = new Feature(new Point([r.x, r.y]));
          f.set('siteId', s.id);
          const selected = cur?.id === s.id;
          f.setStyle(siteStyle(s.name, KIND_COLOR[s.kind] ?? '#fff', selected, selected || res < 120));
          siteSrc.addFeature(f);
        }
      }),
    );
    // selection marker, footprint, scenarios
    disposers.push(
      effect(() => {
        const cur = site.value;
        const L = footprint.value;
        selSrc.clear();
        scenarios.value.forEach((sc, i) => {
          const r = resolveSite(sc.site, catalog.value);
          if (!r) return;
          const f = new Feature(new Point([r.x, r.y]));
          f.setStyle(
            new Style({
              image: new RegularShape({ points: 4, radius: 9, angle: Math.PI / 4, fill: new Fill({ color: scenarioColor(i) }), stroke: new Stroke({ color: '#000', width: 1.5 }) }),
            }),
          );
          selSrc.addFeature(f);
        });
        if (!cur) return;
        const ring = new Feature(new Point([cur.x, cur.y]));
        ring.setStyle(
          new Style({
            image: new CircleStyle({ radius: 11, stroke: new Stroke({ color: '#ffd45e', width: 2.5 }) }),
            text: cur.kind === 'custom' ? new Text({ text: cur.name, offsetY: -20, font: '12px system-ui', fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: '#000', width: 3 }) }) : undefined,
          }),
        );
        selSrc.addFeature(ring);
        const sq = new Feature(new Polygon([footprintSquare(cur.x, cur.y, L)]));
        sq.setStyle(new Style({ stroke: new Stroke({ color: '#ffd45e', width: 1.5 }), fill: new Fill({ color: 'rgba(255,212,94,0.12)' }) }));
        selSrc.addFeature(sq);
      }),
    );
    // fly to a site chosen in the panel (not when it was set by a click on the map)
    let skipFly = false;
    let lastSiteId = site.peek()?.id;
    disposers.push(
      effect(() => {
        const s = site.value;
        if (!s || s.id === lastSiteId) return;
        lastSiteId = s.id;
        if (skipFly) {
          skipFly = false;
          return;
        }
        view.animate({ center: [s.x, s.y], resolution: Math.min(view.getResolution() ?? 300, 90), duration: 700 });
      }),
    );
    map.on('moveend', () => {
      const c = view.getCenter()!;
      mapView.value = { x: c[0], y: c[1], res: view.getResolution() ?? 300 };
    });
    let lastHover = 0;
    map.on('pointermove', (e) => {
      const now = performance.now();
      if (now - lastHover < 60) return;
      lastHover = now;
      const [x, y] = e.coordinate;
      const { lat, lon } = xyToLatLon(x, y);
      let txt = formatLatLon(lat, lon, 3);
      const d = services.dem;
      if (d) {
        const h = d.height(x, y, (view.getResolution() ?? 50) * 0.5);
        if (Number.isFinite(h)) txt += ` · ${Math.round(h)} m`;
      }
      const vals = layer.peek() === 'relief' || layer.peek() === 'shadow' || layer.peek() === 'slope' ? null : engine.valuesAt(x, y);
      if (vals) {
        txt += ` · sun ${fmtPct(vals.illum)} · Earth ${fmtPct(vals.earth)}${vals.earthAntH ? ` (${vals.earthAntH} m antenna)` : ''} · longest night ${fmtHours(vals.dark)}`;
        if (vals.slopeMax !== undefined) txt += ` · max slope ${vals.slopeMax.toFixed(1)}° · relief ${vals.relief!.toFixed(1)} m`;
      }
      setHover(txt);
    });
    map.on('singleclick', (e) => {
      const hit = map.forEachFeatureAtPixel(e.pixel, (f) => f, { hitTolerance: 6, layerFilter: (l) => l === siteLayer });
      skipFly = true;
      if (hit && hit.get('siteId')) siteRef.value = { kind: 'catalog', id: hit.get('siteId') };
      else siteRef.value = customFromXY(e.coordinate[0], e.coordinate[1]);
      if (pegRef.current) {
        setPegArmed(false);
        view.animate({ center: e.coordinate, resolution: 2, duration: 900 }, () => (mode.value = 'pano'));
      }
    });
    return () => {
      disposers.forEach((d) => d());
      map.setTarget(undefined);
      engine.dispose();
      engineRef.current = null;
      mapRef.current = null;
    };
  }, []);

  const findCandidates = () => {
    const eng = engineRef.current;
    if (!eng) return;
    setCandBusy(true);
    setTimeout(() => {
      // pool = up to 40 distinct spots (non-maximum suppressed); robustness = share of
      // Monte-Carlo weight draws in which a spot stays in the top 5 of that pool
      const r = eng.candidates(40, 0);
      const pr = PRESETS[preset.peek()];
      if (!r) {
        setCands([]);
        setCandBusy(false);
        return;
      }
      const pool: Candidate[] = r.cands.map((c, i) => ({ i, x: c.x, y: c.y, score: c.score, features: c.f }));
      const cs = pool.slice(0, 8);
      const stab = rankStability(pool, cs, pr.weights, footprint.peek(), slopeLimit.peek(), pr.darkRef, 200, 5);
      const out = cs.map((c, k) => ({ ...c, rankStability: stab[k], ...xyToLatLon(c.x, c.y) }));
      candSrc.current.clear();
      out.forEach((c, k) => {
        const f = new Feature(new Point([c.x, c.y]));
        f.setStyle(
          new Style({
            image: new CircleStyle({ radius: 9, fill: new Fill({ color: cividis(c.score) }), stroke: new Stroke({ color: '#fff', width: 1.5 }) }),
            text: new Text({ text: String(k + 1), font: 'bold 11px system-ui', fill: new Fill({ color: '#000' }) }),
          }),
        );
        candSrc.current.addFeature(f);
      });
      setCands(out);
      setCandBusy(false);
    }, 10);
  };

  // Region overview: compute service if online, else the pre-baked static heatmaps (DATA.md §6)
  const loadRegion = async () => {
    const pr = PRESETS[preset.peek()];
    const [t0, t1] = interval.peek();
    setRegion({ label: 'Requesting region heatmap…', busy: true });
    const show = (png: string, meta: { bbox: number[] }, label: string) => {
      regionLayer.current.setSource(new ImageStatic({ url: png, imageExtent: meta.bbox, projection: spsProjection() }));
      regionLayer.current.setVisible(true);
      setRegion({ label });
    };
    try {
      const r = await fetch(services.computeBase + 'v1/heatmap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ t0: new Date(t0).toISOString(), t1: new Date(t1).toISOString(), preset: pr.id, footprintM: footprint.peek(), slopeLimitDeg: slopeLimit.peek(), dteThreshold: dte.peek() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { png: string; meta: { bbox: number[] } };
      const png = j.png.startsWith('/api/') ? services.computeBase + j.png.slice('/api/'.length) : j.png;
      show(png, j.meta, `Server region heatmap (${pr.label}, ${new Date(t0).toISOString().slice(0, 10)} → ${new Date(t1).toISOString().slice(0, 10)})`);
      return;
    } catch {
      /* fall back to the static pre-baked set */
    }
    try {
      const idx = (await (await fetch(services.dataBase + 'heatmaps/index.json')).json()) as { items: { id: string; preset: string; t0: string; t1: string; url: string; meta: string }[] };
      const items = idx.items.filter((i) => i.preset === pr.id);
      if (!items.length) throw new Error('no pre-baked heatmap for this preset');
      const best = items.reduce((a, b) => (Math.abs(Date.parse(a.t0) - t0) <= Math.abs(Date.parse(b.t0) - t0) ? a : b));
      const meta = (await (await fetch(services.dataBase + 'heatmaps/' + best.meta)).json()) as { bbox: number[] };
      show(services.dataBase + 'heatmaps/' + best.url, meta, `Pre-baked heatmap (compute service offline): ${best.t0.slice(0, 10)} → ${best.t1.slice(0, 10)}`);
    } catch (e) {
      regionLayer.current.setVisible(false);
      setRegion({ label: '', error: `Region heatmap unavailable: ${(e as Error).message}` });
    }
  };

  const L = layer.value;
  const pr = PRESETS[preset.value];
  return (
    <div class="mapwrap">
      <div ref={el} class="map" />
      {err && <div class="notice warn map-err">{err}</div>}
      <div class="map-ui top-left">
        <div class="layer-switch" role="radiogroup" aria-label="Map layer">
          {LAYERS.map((l) => (
            <label class={L === l.id ? 'on' : ''} title={l.hint}>
              <input type="radio" name="layer" checked={L === l.id} onChange={() => (layer.value = l.id)} />
              {l.label}
            </label>
          ))}
        </div>
        <Legend layer={L} darkRef={pr.darkRef} />
        {(L === 'earth' || L === 'suit') && <AntennaLayerCtl pass={antPass} />}
        {L === 'suit' && (
          <div class="suit-ctl">
            <label>
              Preset
              <select value={preset.value} onChange={(e) => {
                const v = (e.target as HTMLSelectElement).value as 'lander' | 'base';
                preset.value = v;
                slopeLimit.value = PRESETS[v].slopeLimit;
              }}>
                <option value="lander">{PRESETS.lander.label}</option>
                <option value="base">{PRESETS.base.label}</option>
              </select>
            </label>
            <label>
              Footprint {footprint.value} m
              <input type="range" min={5} max={100} step={5} value={footprint.value} onChange={(e) => (footprint.value = +(e.target as HTMLInputElement).value)} />
            </label>
            <label>
              Max slope {slopeLimit.value}°
              <input type="range" min={3} max={20} step={1} value={slopeLimit.value} onChange={(e) => (slopeLimit.value = +(e.target as HTMLInputElement).value)} />
            </label>
            <button class="btn small" onClick={findCandidates} disabled={candBusy}>
              {candBusy ? 'Scoring…' : 'Find best spots in view'}
            </button>
            {cands && (
              <ol class="cands">
                {cands.length === 0 && <li class="muted">No location passes the hard constraints here.</li>}
                {cands.map((c) => (
                  <li>
                    <button class="linkish" onClick={() => (siteRef.value = customFromXY(c.x, c.y, `Candidate ${(c.score * 100).toFixed(0)}`))}>
                      score {(c.score * 100).toFixed(0)} · sun {fmtPct(c.features.illum)} · night {fmtHours(c.features.dark)}
                    </button>
                    <span class={`stab ${c.rankStability! >= 0.8 ? 'good' : c.rankStability! >= 0.5 ? '' : 'bad'}`} title="Share of 200 Monte-Carlo weight draws (Dirichlet around the preset) in which this spot stays in the top 5 of the 40 best distinct spots in view — robustness, not probability">
                      {Math.round(c.rankStability! * 100)}% top-5
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <div class="row-btns">
              <button class="btn small" onClick={loadRegion} disabled={region?.busy}>
                Region overview (server)
              </button>
              {region && !region.busy && !region.error && (
                <button class="btn small" onClick={() => { regionLayer.current.setVisible(false); setRegion(null); }}>
                  Hide
                </button>
              )}
            </div>
            {region && <div class={`hint ${region.error ? 'warn' : ''}`}>{region.error ?? region.label}</div>}
            <div class="hint">Weights: sun {pr.weights.illum} · night {pr.weights.dark} · Earth {pr.weights.earth} · slope {pr.weights.slope} · relief {pr.weights.relief}. No trained model — every term is in docs/METRICS.md.</div>
          </div>
        )}
      </div>
      <div class="map-ui top-right">
        <button class={`btn pegman ${pegArmed ? 'armed' : ''}`} onClick={() => setPegArmed(!pegArmed)} title="Drop the explorer: click, then click on the map to stand there in the panorama" aria-pressed={pegArmed}>
          🧑‍🚀 {pegArmed ? 'Click the map…' : 'Stand here'}
        </button>
        <div class="seg small">
          <button class={lighting.value === 'enhanced' ? 'on' : ''} onClick={() => (lighting.value = 'enhanced')} title="Adds a faint fill light so shadowed terrain stays readable">
            Enhanced
          </button>
          <button class={lighting.value === 'realistic' ? 'on' : ''} onClick={() => (lighting.value = 'realistic')} title="Direct sunlight only: shadows are pitch black">
            Realistic
          </button>
        </div>
        <label class="chk">
          <input type="checkbox" checked={showPsr.value} onChange={(e) => (showPsr.value = (e.target as HTMLInputElement).checked)} /> PSRs (&gt; 1 km²)
        </label>
        {computeOnline.value === false && L === 'suit' && <div class="badge">compute service offline — client GPU only</div>}
      </div>
      <div class="map-ui bottom-left">
        <div class="readout">{hover || 'Move the cursor over the terrain'}</div>
        {engStatus && <div class="readout muted">{engStatus}</div>}
      </div>
    </div>
  );
}

/**
 * Which height the Earth share on the map comes from, and (in "button" mode) the request to
 * recompute it for the antenna. Shown for the Earth-visibility and Suitability layers only.
 */
function AntennaLayerCtl({ pass }: { pass: AntennaPassState }) {
  const ha = hAnt.value;
  const ho = hObs.value;
  if (ha === ho) return <div class="hint ant-ctl">Earth from {fmtHeight(ho)} (observer = antenna height)</div>;
  const button = config.mapEarthAntenna === 'button';
  const requested = !button || mapEarthAntRequested.value;
  return (
    <div class="hint ant-ctl">
      {!requested ? (
        <>
          <span>Earth shown from the {fmtHeight(ho)} observer height.</span>{' '}
          <button class="btn small" onClick={() => (mapEarthAntRequested.value = true)} title="Second horizon pass on the GPU for this view (a few seconds)">
            Use the {fmtHeight(ha)} antenna
          </button>
        </>
      ) : pass.state === 'ready' ? (
        <>
          <span class="c-earth">Earth from the {fmtHeight(pass.h)} antenna.</span>
          {button && (
            <>
              {' '}
              <button class="btn small" onClick={() => (mapEarthAntRequested.value = false)}>
                Observer height
              </button>
            </>
          )}
        </>
      ) : pass.state === 'computing' ? (
        <span>
          Computing Earth from the {fmtHeight(pass.h)} antenna… {pass.pct}% <span class="muted">(showing the {fmtHeight(ho)} observer meanwhile)</span>
        </span>
      ) : (
        <span class="muted">Earth from the {fmtHeight(ha)} antenna: waiting for the view…</span>
      )}
    </div>
  );
}

function Legend({ layer: L, darkRef }: { layer: LayerId; darkRef: number }) {
  if (L === 'relief' || L === 'shadow')
    return (
      <div class="legend">
        {L === 'shadow' ? (
          <>
            <span class="sw" style={{ background: '#1f3a80' }} /> shadow <span class="sw" style={{ background: '#ff9a26' }} /> partial Sun disk
          </>
        ) : (
          <span class="muted">Lit by the real Sun at the playhead · texture procedural</span>
        )}
      </div>
    );
  if (L === 'slope')
    return (
      <div class="legend">
        {[
          ['#eff2de', '<5°'],
          ['#bfde9e', '5–10'],
          ['#fccc5c', '10–15'],
          ['#f58c3d', '15–20'],
          ['#cc4052', '20–30'],
          ['#6b1a73', '>30°'],
        ].map(([c, t]) => (
          <span class="lg-item">
            <span class="sw" style={{ background: c }} />
            {t}
          </span>
        ))}
      </div>
    );
  const [lo, hi] = L === 'dark' ? [`≥${fmtHours(darkRef)}`, '0 h'] : L === 'suit' ? ['0', '1'] : ['0%', '100%'];
  return (
    <div class="legend">
      <span>{lo}</span>
      <span class="bar" style={{ background: `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1].map((x) => cividis(x)).join(',')})` }} />
      <span>{hi}</span>
    </div>
  );
}
