import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Rect, Line, Circle, Text as SvgText } from 'react-native-svg';

// FIFTIETH follow-up: the Recording screen's live "tremor map".
//
// Frequency across (Hz), intensity up (g, log scale). The shaded box is the
// current settings — where the sound plays:
//   left/right = the tremor band (whole width when band filtering is off,
//                since then every frequency sounds)
//   bottom     = noise floor
//   top        = the upper limit when one is set; otherwise the box is open
//                at the top (above full scale the sound stays at full
//                volume) and full scale is a dashed line.
// Dots:
//   filled  = the in-band reading (what drives the sound): in-band
//             frequency, in-band g
//   hollow  = the actual reading (strongest frequency in all motion, and
//             all-motion g) — drawn when it differs from the in-band one
//   faint   = the same, for the last MAP_TRAIL_SEC (older = fainter)
// The chart spans more than the settings (about 1–15 Hz, and from below the
// noise floor to above full scale) so readings outside the box still show.

const W = 320;
const H = 190;
const PAD = { l: 38, r: 10, t: 10, b: 24 };
const X_MIN = 1;

const fmtG = (g) => `${g.toFixed(g < 0.1 ? 3 : 2).replace(/^0(?=\.)/, '')}`;

export function mapScales({ bandMaxHz = 14, noiseFloorG = 0.006, fullScaleG = 0.35, ceilingG = null }) {
  const xMax = Math.max(15, Math.ceil(bandMaxHz + 1));
  const yMin = Math.min(noiseFloorG > 0 ? noiseFloorG / 2 : 0.003, 0.003);
  const yMax = Math.max(1, fullScaleG * 2, (ceilingG || 0) * 1.5);
  const lMin = Math.log10(yMin);
  const lMax = Math.log10(yMax);
  const x = (hz) => PAD.l + ((Math.min(xMax, Math.max(X_MIN, hz)) - X_MIN) / (xMax - X_MIN)) * (W - PAD.l - PAD.r);
  const y = (g) => {
    const l = Math.log10(Math.max(yMin, Math.min(yMax, g > 0 ? g : yMin)));
    return H - PAD.b - ((l - lMin) / (lMax - lMin)) * (H - PAD.t - PAD.b);
  };
  return { x, y, xMax, yMin, yMax };
}

// Whether the hollow "actual" dot is worth drawing: there's an actual
// reading and it differs from the in-band one (to 0.1 Hz) or there is none.
const showActual = (p) => p.af != null && (p.pf == null || p.af.toFixed(1) !== p.pf.toFixed(1));

export default function TremorMap({ trail = [], current, window: win, c, nowMs = Date.now(), trailSec = 60 }) {
  const { bandOn, minHz, maxHz, noiseFloorG, fullScaleG, ceilingG } = win;
  const s = mapScales({ bandMaxHz: maxHz, noiseFloorG, fullScaleG, ceilingG });

  const boxL = bandOn ? s.x(minHz) : PAD.l;
  const boxR = bandOn ? s.x(maxHz) : W - PAD.r;
  const boxB = s.y(noiseFloorG);
  const boxT = ceilingG ? s.y(ceilingG) : PAD.t;

  const xTicks = [];
  for (let hz = 2; hz <= s.xMax - 1; hz += 2) {
    if (bandOn && (Math.abs(hz - minHz) < 0.9 || Math.abs(hz - maxHz) < 0.9)) continue;
    xTicks.push(hz);
  }

  const age = (p) => Math.max(0, Math.min(1, (nowMs - p.t) / (trailSec * 1000)));
  const past = trail.slice(0, -1);

  return (
    <View
      accessible
      accessibilityLabel={`Tremor map. ${
        current?.pf != null ? `In-band ${current.pf.toFixed(1)} hertz.` : 'No in-band reading.'
      } ${current && showActual(current) ? `Actual ${current.af.toFixed(1)} hertz.` : ''}`}>
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {/* plot frame */}
        <Rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="none" stroke={c.bd3} />

        {/* the settings box: where sound plays */}
        <Rect
          x={boxL}
          y={boxT}
          width={Math.max(0, boxR - boxL)}
          height={Math.max(0, boxB - boxT)}
          fill={c.info}
          fillOpacity={0.1}
          stroke={c.info}
          strokeWidth={1.5}
        />
        {/* open top: full scale as a dashed line */}
        {!ceilingG && (
          <Line x1={boxL} x2={boxR} y1={s.y(fullScaleG)} y2={s.y(fullScaleG)} stroke={c.info} strokeDasharray="4 3" strokeWidth={1} />
        )}

        {/* axes labels */}
        {xTicks.map((hz) => (
          <SvgText key={`x${hz}`} x={s.x(hz)} y={H - PAD.b + 13} fontSize={9} fill={c.tx3} textAnchor="middle">
            {hz}
          </SvgText>
        ))}
        <SvgText x={W - PAD.r} y={H - 2} fontSize={9} fill={c.tx3} textAnchor="end">
          Hz
        </SvgText>
        {bandOn && (
          <>
            <SvgText x={boxL} y={H - PAD.b + 13} fontSize={9} fontWeight="bold" fill={c.info} textAnchor="middle">
              {minHz.toFixed(1)}
            </SvgText>
            <SvgText x={boxR} y={H - PAD.b + 13} fontSize={9} fontWeight="bold" fill={c.info} textAnchor="middle">
              {maxHz.toFixed(1)}
            </SvgText>
          </>
        )}
        <SvgText x={PAD.l - 4} y={boxB + 3} fontSize={9} fontWeight="bold" fill={c.info} textAnchor="end">
          {fmtG(noiseFloorG)}
        </SvgText>
        <SvgText x={PAD.l - 4} y={(ceilingG ? boxT : s.y(fullScaleG)) + 3} fontSize={9} fontWeight="bold" fill={c.info} textAnchor="end">
          {fmtG(ceilingG || fullScaleG)}
        </SvgText>
        <SvgText x={PAD.l - 4} y={PAD.t + 8} fontSize={9} fill={c.tx3} textAnchor="end">
          g
        </SvgText>

        {/* trail: last minute, older = fainter */}
        {past.map((p, i) => {
          const o = 0.12 + 0.45 * (1 - age(p));
          return (
            <React.Fragment key={`t${i}`}>
              {showActual(p) && (
                <Circle cx={s.x(p.af)} cy={s.y(p.ag)} r={2.5} fill="none" stroke={c.tx2} strokeOpacity={o} />
              )}
              {p.pf != null && <Circle cx={s.x(p.pf)} cy={s.y(p.pg)} r={2.5} fill={c.info} fillOpacity={o} />}
            </React.Fragment>
          );
        })}

        {/* now */}
        {current && showActual(current) && (
          <Circle cx={s.x(current.af)} cy={s.y(current.ag)} r={6} fill="none" stroke={c.tx1} strokeWidth={2} />
        )}
        {current?.pf != null && <Circle cx={s.x(current.pf)} cy={s.y(current.pg)} r={6} fill={c.info} />}
      </Svg>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 2 }}>
        <Text style={{ fontSize: 10, color: c.tx3 }}>
          <Text style={{ color: c.info }}>●</Text> in-band (sound)
        </Text>
        <Text style={{ fontSize: 10, color: c.tx3 }}>○ actual (all motion)</Text>
        <Text style={{ fontSize: 10, color: c.tx3 }}>last {trailSec} s</Text>
      </View>
      {!bandOn && (
        <Text style={{ fontSize: 10, color: c.tx3, textAlign: 'center', marginTop: 2 }}>
          Band filtering off: all frequencies sound
        </Text>
      )}
    </View>
  );
}
