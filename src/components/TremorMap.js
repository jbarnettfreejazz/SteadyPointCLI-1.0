import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Rect, Line, Circle, Text as SvgText } from 'react-native-svg';
import { classifyReading } from '../utils/sessionReading';

// FIFTIETH follow-up: the Recording screen's live "tremor map".
// SIXTY-SECOND follow-up: redrawn for the Advanced View design.
//
// Frequency across (Hz), motion up (log scale). Two vertical scales:
// intensity on the left (0 at the noise floor, 100 at full scale) and g on
// the right. The zone where sound plays is the blue box:
//   left/right = the tremor band (whole width when band filtering is off)
//   bottom     = noise floor ("0", grey dashed line; grey shading below it)
//   top        = full scale ("your level 100", red dashed line). Above it,
//                inside the band, is shaded red: still counts as 100.
//   upper limit (optional) = dark dashed line; above it, grey: no sound.
// One dot per reading, coloured by what it means (utils/sessionReading.js):
//   blue = in zone, red = above your 100, grey = below threshold,
//   hollow = out of zone (outside the band, or above the upper limit).
// Larger dot = now; smaller = the last MAP_TRAIL_SEC (older = fainter).
// The chart spans more than the settings (about 1–15 Hz, and from below the
// noise floor to above full scale) so readings outside the box still show.

export const MAP_W = 340;
export const MAP_H = 300;
const PAD = { l: 46, r: 38, t: 8, b: 30 };
const X_MIN = 1;

const fmtG = (g) => `${g.toFixed(g < 0.1 ? 3 : 2).replace(/^0(?=\.)/, '')}`;

export function mapScales({ bandMaxHz = 14, noiseFloorG = 0.006, fullScaleG = 0.35, ceilingG = null }) {
  const xMax = Math.max(15, Math.ceil(bandMaxHz + 1));
  const floor = noiseFloorG > 0 ? noiseFloorG : 0.006;
  const yMin = floor / 2.5; // room below the floor for "below threshold" readings
  const yMax = Math.max(fullScaleG * 1.8, (ceilingG || 0) * 1.4, floor * 4);
  const lMin = Math.log10(yMin);
  const lMax = Math.log10(yMax);
  const x = (hz) => PAD.l + ((Math.min(xMax, Math.max(X_MIN, hz)) - X_MIN) / (xMax - X_MIN)) * (MAP_W - PAD.l - PAD.r);
  const y = (g) => {
    const l = Math.log10(Math.max(yMin, Math.min(yMax, g > 0 ? g : yMin)));
    return MAP_H - PAD.b - ((l - lMin) / (lMax - lMin)) * (MAP_H - PAD.t - PAD.b);
  };
  return { x, y, xMax, yMin, yMax };
}

// Dot colours per state; null fill = hollow.
export function dotStyle(kind, c) {
  if (kind === 'zone') return { fill: c.info, stroke: null };
  if (kind === 'over') return { fill: c.danger, stroke: null };
  if (kind === 'below') return { fill: c.tx3, stroke: null };
  return { fill: null, stroke: c.tx1 }; // 'out', 'ceiling'
}

export default function TremorMap({ trail = [], current, window: win, c, nowMs = Date.now(), trailSec = 60 }) {
  const { bandOn, minHz, maxHz, noiseFloorG, fullScaleG, ceilingG } = win;
  const s = mapScales({ bandMaxHz: maxHz, noiseFloorG, fullScaleG, ceilingG });
  const plotL = PAD.l;
  const plotR = MAP_W - PAD.r;
  const plotT = PAD.t;
  const plotB = MAP_H - PAD.b;

  const boxL = bandOn ? s.x(minHz) : plotL;
  const boxR = bandOn ? s.x(maxHz) : plotR;
  const yFloor = s.y(noiseFloorG);
  const yFull = s.y(fullScaleG);
  const yCeil = ceilingG ? s.y(ceilingG) : null;
  // Top of the blue box: full scale, or the upper limit if it's lower.
  const blueTop = yCeil != null && yCeil > yFull ? yCeil : yFull;
  // Red "still counts as 100" region: full scale up to the top, or up to an
  // upper limit set above full scale.
  const redTop = yCeil != null && yCeil < yFull ? yCeil : plotT;
  const showRed = !(yCeil != null && yCeil >= yFull);
  // Intensity is linear in g between the floor (0) and full scale (100), so
  // on this log scale intensity 50 sits near the top and 10 mid-chart. Both
  // are labelled at their true heights (unless they'd crowd 0 or 100).
  const midTicks = [10, 50]
    .map((lv) => ({ lv, y: s.y(noiseFloorG + (lv / 100) * (fullScaleG - noiseFloorG)) }))
    .filter((t) => Math.abs(t.y - yFull) > 14 && Math.abs(t.y - yFloor) > 14);

  const xTicks = [];
  for (let hz = 2; hz <= s.xMax - 1; hz += 2) {
    if (bandOn && (Math.abs(hz - minHz) < 0.9 || Math.abs(hz - maxHz) < 0.9)) continue;
    xTicks.push(hz);
  }
  // Right-hand g labels: floor, full scale, the upper limit, and .01 / .1
  // gridlines where they don't crowd those.
  const keyYs = [yFloor, yFull, yCeil].filter((v) => v != null);
  const grid = [0.01, 0.1, 1].filter((g) => g > s.yMin && g < s.yMax && keyYs.every((ky) => Math.abs(s.y(g) - ky) > 12));
  const ceilLabelBelow = yCeil != null && Math.abs(yCeil - yFull) < 14;
  const zoneW = boxR - boxL;

  const age = (p) => Math.max(0, Math.min(1, (nowMs - p.t) / (trailSec * 1000)));
  const past = trail.slice(0, -1);
  const now = current ? classifyReading(current, win) : null;

  const dot = (p, key, r, opacity) => {
    const k = classifyReading(p, win);
    if (k.hz == null || k.kind === 'waiting') return null;
    const st = dotStyle(k.kind, c);
    const cx = s.x(k.hz);
    const cy = s.y(k.g);
    return st.fill ? (
      <Circle key={key} cx={cx} cy={cy} r={r} fill={st.fill} fillOpacity={opacity} />
    ) : (
      <Circle key={key} cx={cx} cy={cy} r={r} fill="none" stroke={st.stroke} strokeOpacity={opacity} strokeWidth={r > 5 ? 2.5 : 1.2} />
    );
  };

  const label = now && now.hz != null ? `${now.hz.toFixed(1)} hertz, ${now.kind === 'out' ? 'out of zone' : now.kind === 'over' ? 'above your level 100' : now.kind === 'below' ? 'below threshold' : now.kind === 'ceiling' ? 'above your upper limit' : 'in zone'}.` : 'No reading.';

  return (
    <View accessible accessibilityLabel={`Tremor map. ${label}`} style={{ width: '100%', aspectRatio: MAP_W / MAP_H }}>
      <Svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} width="100%" height="100%">
        {/* plot frame + faint g gridlines */}
        <Rect x={plotL} y={plotT} width={plotR - plotL} height={plotB - plotT} fill="none" stroke={c.bd3} />
        {grid.map((g) => (
          <Line key={`gl${g}`} x1={plotL} x2={plotR} y1={s.y(g)} y2={s.y(g)} stroke={c.bd3} />
        ))}

        {/* below the noise floor: counts as 0 */}
        <Rect x={plotL} y={yFloor} width={plotR - plotL} height={Math.max(0, plotB - yFloor)} fill={c.tx1} fillOpacity={0.07} />

        {/* above full scale, inside the band: still counts as 100 */}
        {showRed && (
          <Rect x={boxL} y={redTop} width={Math.max(0, zoneW)} height={Math.max(0, yFull - redTop)} fill={c.danger} fillOpacity={0.14} stroke={c.danger} strokeWidth={1} />
        )}
        {/* above the upper limit, inside the band: no sound */}
        {yCeil != null && (
          <Rect x={boxL} y={plotT} width={Math.max(0, zoneW)} height={Math.max(0, yCeil - plotT)} fill={c.tx1} fillOpacity={0.08} />
        )}

        {/* the tremor zone: where sound plays */}
        <Rect
          x={boxL}
          y={blueTop}
          width={Math.max(0, zoneW)}
          height={Math.max(0, yFloor - blueTop)}
          fill={c.info}
          fillOpacity={0.12}
          stroke={c.info}
          strokeWidth={1.5}
        />
        {zoneW >= 64 && (
          <>
            <SvgText x={(boxL + boxR) / 2} y={blueTop + 16} fontSize={11} fontWeight="bold" fill={c.info} textAnchor="middle">
              {zoneW >= 110 ? 'your tremor zone' : 'your tremor'}
            </SvgText>
            {zoneW < 110 && (
              <SvgText x={(boxL + boxR) / 2} y={blueTop + 29} fontSize={11} fontWeight="bold" fill={c.info} textAnchor="middle">
                zone
              </SvgText>
            )}
          </>
        )}

        {/* level 100 and 0 */}
        <Line x1={plotL} x2={plotR} y1={yFull} y2={yFull} stroke={c.danger} strokeDasharray="5 4" strokeWidth={1.5} />
        <SvgText x={plotR - 3} y={yFull - 4} fontSize={11} fontWeight="bold" fill={c.danger} textAnchor="end">
          your level 100
        </SvgText>
        <Line x1={plotL} x2={plotR} y1={yFloor} y2={yFloor} stroke={c.tx2} strokeDasharray="5 4" strokeWidth={1.2} />
        {yCeil != null && (
          <>
            <Line x1={plotL} x2={plotR} y1={yCeil} y2={yCeil} stroke={c.tx1} strokeDasharray="2 3" strokeWidth={1.5} />
            <SvgText x={plotL + 4} y={ceilLabelBelow ? yCeil + 12 : yCeil - 4} fontSize={10} fontWeight="bold" fill={c.tx1} textAnchor="start">
              upper limit
            </SvgText>
          </>
        )}

        {/* left: intensity */}
        <SvgText x={14} y={(yFull + yFloor) / 2} fontSize={11} fontWeight="bold" fill={c.info} textAnchor="middle" transform={`rotate(-90 14 ${(yFull + yFloor) / 2})`}>
          Intensity
        </SvgText>
        <SvgText x={plotL - 6} y={yFull + 4} fontSize={12} fontWeight="bold" fill={c.info} textAnchor="end">
          100
        </SvgText>
        {midTicks.map((t) => (
          <SvgText key={`lv${t.lv}`} x={plotL - 6} y={t.y + 4} fontSize={12} fill={c.tx2} textAnchor="end">
            {t.lv}
          </SvgText>
        ))}
        <SvgText x={plotL - 6} y={yFloor + 4} fontSize={12} fontWeight="bold" fill={c.info} textAnchor="end">
          0
        </SvgText>

        {/* right: g */}
        <SvgText x={plotR + 5} y={plotT + 9} fontSize={11} fill={c.tx2} textAnchor="start">
          g
        </SvgText>
        <SvgText x={plotR + 5} y={yFull + 4} fontSize={11} fill={c.tx2} textAnchor="start">
          {fmtG(fullScaleG)}
        </SvgText>
        <SvgText x={plotR + 5} y={yFloor + 4} fontSize={11} fill={c.tx2} textAnchor="start">
          {fmtG(noiseFloorG)}
        </SvgText>
        {yCeil != null && (
          <SvgText x={plotR + 5} y={yCeil + 4} fontSize={11} fontWeight="bold" fill={c.tx1} textAnchor="start">
            {fmtG(ceilingG)}
          </SvgText>
        )}
        {grid.map((g) => (
          <SvgText key={`gt${g}`} x={plotR + 5} y={s.y(g) + 4} fontSize={11} fill={c.tx2} textAnchor="start">
            {g >= 1 ? '1' : String(g).replace(/^0(?=\.)/, '')}
          </SvgText>
        ))}

        {/* bottom: Hz */}
        {xTicks.map((hz) => (
          <SvgText key={`x${hz}`} x={s.x(hz)} y={plotB + 16} fontSize={12} fill={c.tx2} textAnchor="middle">
            {hz}
          </SvgText>
        ))}
        {bandOn && (
          <>
            <SvgText x={boxL} y={plotB + 16} fontSize={12} fontWeight="bold" fill={c.info} textAnchor="middle">
              {minHz.toFixed(1)}
            </SvgText>
            <SvgText x={boxR} y={plotB + 16} fontSize={12} fontWeight="bold" fill={c.info} textAnchor="middle">
              {maxHz.toFixed(1)}
            </SvgText>
          </>
        )}
        <SvgText x={plotR} y={MAP_H - 2} fontSize={10} fill={c.tx2} textAnchor="end">
          Hz
        </SvgText>

        {/* trail: last minute, older = fainter; then now */}
        {past.map((p, i) => dot(p, `t${i}`, 3.5, 0.15 + 0.45 * (1 - age(p))))}
        {current && dot(current, 'now', 7, 1)}
      </Svg>
    </View>
  );
}

// The legend under the map's text rows (fixed: never changes).
export function TremorMapLegend({ c }) {
  const item = (key, mark, text) => (
    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 20 }}>
      {mark}
      <Text style={{ fontSize: 13, color: c.tx2 }} numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {text}
      </Text>
    </View>
  );
  const filled = (color) => <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: color }} />;
  const hollow = <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: c.tx1 }} />;
  return (
    <View
      accessible
      accessibilityLabel="Legend: blue, in zone. Red, above your 100. Grey, below threshold. Hollow, out of zone."
      style={{ height: 44, justifyContent: 'center', gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18 }}>
        {item('z', filled(c.info), 'in zone')}
        {item('o', filled(c.danger), 'above your 100')}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18 }}>
        {item('b', filled(c.tx3), 'below threshold')}
        {item('x', hollow, 'out of zone')}
      </View>
    </View>
  );
}
