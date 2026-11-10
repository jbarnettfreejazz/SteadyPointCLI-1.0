// SIXTY-SECOND follow-up: what the current reading means, for the Simple and
// Advanced views of the Recording screen (and each dot on the tremor map).
//
// One function decides which state a reading is in, so the circle, the two
// text rows under the map, the Simple View status line and every map dot
// always agree. Pure — no React, no platform code — so it is the same on
// iOS and Android and is tested directly (tests/logic/test17.mjs).
//
// A reading is { af, ag, pf, pg } — the same shape liveSession.js keeps in
// mapTrail:
//   pf / pg = in-band frequency / in-band g (what drives intensity + sound;
//             pf is null at intensity 0 and for edge spill)
//   af / ag = strongest frequency in all motion / all-motion g (af is null
//             when all motion is at or below the noise floor)
//
// States (kind):
//   'zone'    in the tremor zone: intensity 1-99, sound follows it
//   'over'    in the zone, at or above full scale: counts as 100
//   'ceiling' in the zone but above the optional upper limit: no sound
//   'below'   at or below the noise floor: counts as 0
//   'out'     outside the tremor band (or spill from outside it): no sound
//   'waiting' no reading yet this session

export const SESSION_VIEWS = ['simple', 'advanced'];

export function sessionViewOf(settings) {
  return settings?.sessionView === 'advanced' ? 'advanced' : 'simple';
}

// The settings box the readings are judged against.
export function readingWindow(settings = {}) {
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const minHz = num(settings.tremorBandMinHz, 3);
  const maxHz = num(settings.tremorBandMaxHz, 14);
  const ceiling = num(settings.intensityCeilingG, null);
  return {
    bandOn: !!settings.bandFilterEnabled && maxHz > minHz,
    minHz,
    maxHz,
    noiseFloorG: num(settings.noiseFloorG, 0.006),
    fullScaleG: num(settings.fullScaleG, 0.35),
    ceilingG: ceiling != null && ceiling > 0 ? ceiling : null,
  };
}

const isNum = (v) => typeof v === 'number' && isFinite(v);
const inBand = (hz, win) => hz >= win.minHz - 0.05 && hz <= win.maxHz + 0.05;

// Which state one reading is in, and where its dot goes on the map
// (hz = null: no frequency to place it at, so no dot).
export function classifyReading(p, win) {
  if (!p) return { kind: 'waiting', hz: null, g: null };
  const pg = isNum(p.pg) ? p.pg : 0;
  const ag = isNum(p.ag) ? p.ag : 0;
  const pf = isNum(p.pf) ? p.pf : null;
  const af = isNum(p.af) ? p.af : null;
  const above = pg > win.noiseFloorG; // intensity > 0 (rmsToLevel's rule)
  if (above && (pf != null || !win.bandOn)) {
    const hz = pf ?? af;
    if (win.ceilingG != null && pg > win.ceilingG) return { kind: 'ceiling', hz, g: pg };
    if (pg >= win.fullScaleG) return { kind: 'over', hz, g: pg };
    return { kind: 'zone', hz, g: pg };
  }
  // Band filtering on and nothing sounding in the band: either spill from a
  // tremor just outside the band (intensity > 0 but no in-band frequency) or
  // motion whose strongest frequency is outside the band.
  if (win.bandOn && ((above && pf == null) || (af != null && !inBand(af, win)))) {
    return { kind: 'out', hz: af, g: ag };
  }
  return { kind: 'below', hz: af != null && (!win.bandOn || inBand(af, win)) ? af : null, g: pg };
}

// ".041 g" / ".48 g" / "1.24 g" (3 decimals below 0.1 g, as elsewhere).
export function fmtGSpaced(g) {
  const v = isNum(g) && g > 0 ? g : 0;
  return `${v.toFixed(v < 0.1 ? 3 : 2).replace(/^0(?=\.)/, '')} g`;
}
// ".041g" — the summary line's existing style ("34% (.041g) intensity").
export function fmtGTight(g) {
  return fmtGSpaced(g).replace(' g', 'g');
}
const fmtHz = (hz) => hz.toFixed(1);
// Band edges as in the design: "4–8 Hz", "4.5–8 Hz".
const fmtEdge = (hz) => String(Math.round(hz * 10) / 10);

// Everything the two views show for the current reading.
//   live: the live session store (useLiveSession())
//   win:  readingWindow(settings)
// Returns:
//   kind
//   circle:  { text, tone }      tone: 'level' (green→amber by intensity),
//                                'danger', 'grey', 'inverse', 'empty'
//   label:   { text, tone }      tone: a severity colour name or 'tx1'/'tx2'
//   subline: string              under the label
//   row1:    { text, tone }      first line under the map; tone 'info' | 'danger' | 'tx1'
//   row2:    string              second line under the map
//   simple:  { text, tone } | null   Simple View status line; tone 'info' | 'danger' | 'neutral'
//   level:   number | null       the intensity number shown (null: none)
export function describeReading(live, win) {
  const hasData = Array.isArray(live?.mapTrail) && live.mapTrail.length > 0;
  if (!hasData) {
    return {
      kind: 'waiting',
      circle: { text: '—', tone: 'empty' },
      label: { text: 'Starting…', tone: 'tx2' },
      subline: 'Waiting for device data…',
      row1: { text: '—', tone: 'tx1' },
      row2: 'Waiting for device data…',
      simple: null,
      level: null,
    };
  }
  const now = { af: live.actualFreqHz, ag: live.liveRmsAllG, pf: live.pitchFreqHz, pg: live.liveRmsG };
  const { kind, hz, g } = classifyReading(now, win);
  const hzPart = hz != null ? `${fmtHz(hz)} Hz · ` : '';
  const zoneText = win.bandOn ? `(${fmtEdge(win.minHz)}–${fmtEdge(win.maxHz)} Hz)` : '';
  // The circle and rows show the same number. While in the zone it's the
  // display level (eased toward the reading, as before), never shown as 0
  // since the reading itself is above the noise floor.
  const shown = Math.max(1, Math.min(99, Math.round(isNum(live.displayLevel) ? live.displayLevel : 1)));
  const sevLabel = live.liveSev || 'Mild';
  const displayG = isNum(live.displayG) && live.displayG > 0 && kind === 'zone' ? live.displayG : g;

  if (kind === 'over') {
    return {
      kind,
      circle: { text: '100', tone: 'danger' },
      label: { text: 'High', tone: 'danger' },
      subline: `>100% (${fmtGTight(g)}) intensity`,
      row1: { text: `${hzPart}${fmtGSpaced(g)} · intensity 100 (max)`, tone: 'danger' },
      row2: 'above your level 100 — still counts as 100',
      simple: { text: 'Above your level 100 — counts as 100', tone: 'danger' },
      level: 100,
    };
  }
  if (kind === 'ceiling') {
    return {
      kind,
      circle: { text: String(shown), tone: 'level' },
      label: { text: sevLabel, tone: sevLabel },
      subline: `${shown}% (${fmtGTight(displayG)}) intensity`,
      row1: { text: `${hzPart}${fmtGSpaced(g)} · intensity ${shown}`, tone: 'tx1' },
      row2: 'above your upper limit — no sound',
      simple: { text: 'Above your upper limit — no sound', tone: 'neutral' },
      level: shown,
    };
  }
  if (kind === 'zone') {
    return {
      kind,
      circle: { text: String(shown), tone: 'level' },
      label: { text: sevLabel, tone: sevLabel },
      subline: `${shown}% (${fmtGTight(displayG)}) intensity`,
      row1: { text: `${hzPart}${fmtGSpaced(displayG)} · intensity ${shown}`, tone: 'info' },
      row2: win.bandOn ? `inside your tremor zone ${zoneText}` : 'all frequencies count (band filtering off)',
      simple: {
        text: win.bandOn ? `Inside your tremor zone ${zoneText}` : 'All frequencies count',
        tone: 'info',
      },
      level: shown,
    };
  }
  if (kind === 'out') {
    let row2 = 'just outside your tremor zone — no sound';
    let simple = 'Just outside your tremor zone';
    if (hz != null && hz < win.minHz) {
      row2 = `${fmtHz(win.minHz - hz)} Hz below your tremor zone — no sound`;
      simple = `${fmtHz(hz)} Hz · below your tremor zone`;
    } else if (hz != null && hz > win.maxHz) {
      row2 = `${fmtHz(hz - win.maxHz)} Hz above your tremor zone — no sound`;
      simple = `${fmtHz(hz)} Hz · above your tremor zone`;
    }
    return {
      kind,
      circle: { text: '—', tone: 'inverse' },
      label: { text: 'Out of zone', tone: 'tx1' },
      subline: 'Outside your frequency range · no sound',
      row1: { text: `${hzPart}${fmtGSpaced(g)}`, tone: 'tx1' },
      row2,
      simple: { text: simple, tone: 'neutral' },
      level: null,
    };
  }
  // below
  return {
    kind: 'below',
    circle: { text: '0', tone: 'grey' },
    label: { text: 'None', tone: 'tx2' },
    subline: `0% (${fmtGTight(g)}) intensity`,
    row1: { text: `${hzPart}${fmtGSpaced(g)} · intensity 0`, tone: 'tx1' },
    row2: 'below your tremor threshold — counts as 0',
    simple: { text: 'Below your tremor threshold', tone: 'neutral' },
    level: 0,
  };
}
