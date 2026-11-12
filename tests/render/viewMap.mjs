// Renders the real TremorMap component to map.html for a visual check
// (not part of npm test). SIXTY-SECOND follow-up: the design's four states,
// SIXTY-THIRD: the tester's settings (floor 0, band from 0.5 Hz),
// the upper limit, band filtering off, and dark mode.
import { build } from 'esbuild'; import plugin from './plugin.mjs'; import fs from 'fs';
await build({ entryPoints: ['entryMap.js'], bundle: true, format: 'esm', platform: 'node', outfile: 'outMap.mjs', plugins: [plugin], loader: { '.js': 'jsx' }, jsx: 'transform', logLevel: 'error', external: ['react', 'react-test-renderer'] });
const React = (await import('react')).default; const TR = (await import('react-test-renderer')).default; const { act } = TR;
const { TremorMap } = await import('./outMap.mjs');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const light = { info: '#2563eb', danger: '#dc2626', tx1: '#0f0f0f', tx2: '#525252', tx3: '#8a8a8a', bd3: 'rgba(0,0,0,0.10)', bg1: '#fff' };
const dark = { info: '#60a5fa', danger: '#f87171', tx1: '#f0ede8', tx2: '#a0a0a0', tx3: '#606060', bd3: 'rgba(255,255,255,0.10)', bg1: '#191919' };
const now = Date.now();
const tr = (pts) => pts.map((p, i) => ({ t: now - (pts.length - i) * 3000, ...p }));
const BAND = { bandOn: true, minHz: 4, maxHz: 8, noiseFloorG: 0.006, fullScaleG: 0.35, ceilingG: null };
const cases = [
  ['(i) in zone', BAND, light, tr([{ pf: 5.8, pg: 0.015 }, { pf: 5.5, pg: 0.02 }, { pf: 5.2, pg: 0.03 }, { pf: 4.9, pg: 0.05 }]), { pf: 4.7, pg: 0.041, af: 4.7, ag: 0.05 }],
  ['(ii) above 100', BAND, light, tr([{ pf: 5.2, pg: 0.15 }, { pf: 5.4, pg: 0.25 }, { pf: 5.8, pg: 0.3 }, { pf: 5.6, pg: 0.4 }]), { pf: 5.6, pg: 0.48, af: 5.6, ag: 0.5 }],
  ['(iii) below threshold', BAND, light, tr([{ pf: 6.4, pg: 0.009 }, { pf: null, pg: 0.005, af: 6.0, ag: 0.007 }, { pf: null, pg: 0.004, af: 5.6, ag: 0.007 }]), { pf: null, pg: 0.004, af: 5.2, ag: 0.007 }],
  ['(iv) out of zone', BAND, light, tr([{ pf: null, pg: 0.003, af: 3.1, ag: 0.015 }, { pf: null, pg: 0.003, af: 2.8, ag: 0.02 }, { pf: null, pg: 0.003, af: 2.6, ag: 0.025 }]), { pf: null, pg: 0.003, af: 2.4, ag: 0.03 }],
  ['upper limit .20 g', { ...BAND, ceilingG: 0.2 }, light, tr([{ pf: 6, pg: 0.1 }, { pf: 6.1, pg: 0.15 }]), { pf: 6.2, pg: 0.25, af: 6.2, ag: 0.26 }],
  ['band off', { ...BAND, bandOn: false, minHz: 3, maxHz: 14 }, light, tr([{ pf: 2, pg: 0.04 }]), { pf: 2.1, pg: 0.05, af: 2.1, ag: 0.05 }],
  ["tester: floor 0, 0.5–12 Hz, FS 1.0", { bandOn: true, minHz: 0.5, maxHz: 12, noiseFloorG: 0, fullScaleG: 1, ceilingG: null }, light, tr([{ pf: 4.2, pg: 0.004 }, { pf: 4.1, pg: 0.01 }, { pf: 4, pg: 0.015 }]), { pf: 4, pg: 0.02, af: 4, ag: 0.05 }],
  ['dark, in zone', BAND, dark, tr([{ pf: 5.5, pg: 0.02 }, { pf: null, pg: 0.003, af: 3, ag: 0.02 }]), { pf: 4.7, pg: 0.041, af: 4.7, ag: 0.05 }],
];
const toSvg = (n) => { if (typeof n === 'string' || typeof n === 'number') return String(n); const map = { Svg: 'svg', Rect: 'rect', Line: 'line', Circle: 'circle', SvgText: 'text' };
  const tag = map[n.type]; const kids = (n.children || []).map(toSvg).join(''); if (!tag) return kids;
  const camel = (k) => k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  const attrs = Object.entries(n.props).filter(([k, v]) => k !== 'children' && v != null && typeof v !== 'object' && typeof v !== 'function').map(([k, v]) => `${k === 'viewBox' ? k : camel(k)}="${v}"`).join(' ');
  return `<${tag} ${tag === 'svg' ? 'xmlns="http://www.w3.org/2000/svg" ' : ''}${attrs}>${kids}</${tag}>`; };
let html = '<html><body style="font-family:-apple-system,sans-serif;margin:0;display:grid;grid-template-columns:repeat(4,360px);gap:10px;padding:10px">';
for (const [label, win, c, trail, cur] of cases) {
  let r; act(() => { r = TR.create(React.createElement(TremorMap, { trail: [...trail, { t: now, ...cur }], current: cur, window: win, c, nowMs: now })); });
  const svgNode = (function f(n) { if (!n || typeof n !== 'object') return null; if (n.type === 'Svg') return n; for (const k of n.children || []) { const x = f(k); if (x) return x; } return null; })(r.toJSON());
  html += `<div style="background:${c.bg1};color:${c.tx1};padding:8px"><p style="margin:0 0 4px">${label}</p>` + toSvg(svgNode).replace('width="100%" height="100%"', 'width="340" height="300"') + '</div>';
}
fs.writeFileSync('map.html', html + '</body></html>');
