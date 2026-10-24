import React, { useId } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path, Line, Text as SvgText } from 'react-native-svg';

// Ported from the team's PWA IntensityChart.tsx — a filled area chart of
// tremor intensity (0-100) over the session duration, color-segmented by
// severity band via a vertical gradient: None (<20, success), Mild
// (20-44), Moderate (45-69, warning), High (70+, danger). Geometry and
// gradient-stop math translated directly (unchanged) from the PWA
// original; only the rendering layer changed, from raw web SVG elements
// to their react-native-svg equivalents, and CSS color variables to this
// app's own theme colors.
// THIRTY-SIXTH follow-up: optional `peaks` (the highest reading in each
// point's time slice, drawn as a faint line above the area — long sessions
// average many readings per point) and `events` (calibration changes and
// reconnects during the session, [{ atSec, kind }], drawn as dashed
// markers). Durations of 90+ minutes are labelled in hours.
const EVENT_LABELS = { scale: 'Calibration', band: 'Band', reconnect: 'Reconnected' };

export function durationLabel(durationSec) {
  const mins = Math.max(1, Math.round(durationSec / 60));
  if (mins < 90) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// THIRTY-SEVENTH follow-up: long-session view. When the session's start
// time is known (`startedAt`, saved since the thirty-sixth follow-up) and it
// ran an hour or more, the bottom axis shows time of day — start time on the
// left, end time on the right and whole hours in between — and the chart is
// taller. Time spent disconnected before a reconnect (event gapSec) is
// added back, so clock times after a gap are right.
export const LONG_SESSION_SEC = 60 * 60;

function clockLabel(ms, withMinutes = true) {
  const d = new Date(ms);
  const h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return withMinutes ? `${h12}:${d.getMinutes().toString().padStart(2, '0')} ${ampm}` : `${h12} ${ampm}`;
}

// Wall-clock time (ms) at `sec` seconds of recorded session time.
export function clockAt(startedAtMs, sec, events = []) {
  const gaps = (events || []).filter((e) => e.kind === 'reconnect' && e.gapSec > 0 && e.atSec <= sec);
  return startedAtMs + (sec + gaps.reduce((t, e) => t + e.gapSec, 0)) * 1000;
}

// Hour ticks (as recorded-time seconds) for the long-session axis.
export function hourTicks(startedAtMs, durationSec, events = []) {
  const endMs = clockAt(startedAtMs, durationSec, events);
  const spanH = (endMs - startedAtMs) / 3600000;
  const step = Math.max(1, Math.ceil(spanH / 5)); // at most ~5 hour labels
  const first = new Date(startedAtMs);
  first.setMinutes(0, 0, 0);
  const ticks = [];
  for (let ms = first.getTime() + 3600000; ms < endMs; ms += 3600000) {
    if (new Date(ms).getHours() % step !== 0) continue;
    // recorded-time position of this clock time (remove gaps before it)
    let sec = (ms - startedAtMs) / 1000;
    for (const e of (events || []).filter((x) => x.kind === 'reconnect' && x.gapSec > 0).sort((a, b) => a.atSec - b.atSec)) {
      if (sec > e.atSec) sec = Math.max(e.atSec, sec - e.gapSec);
    }
    ticks.push({ sec, label: clockLabel(ms, false) });
  }
  return ticks;
}

export default function IntensityChart({ trace, durationSec, height, colors, peaks, events, startedAt }) {
  const gid = useId().replace(/:/g, '');
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : NaN;
  const longView = Number.isFinite(startedAtMs) && durationSec >= LONG_SESSION_SEC;
  const W = 320;
  const H = height ?? (longView ? 180 : 140);
  const padL = 26;
  const padR = 8;
  const padT = 8;
  const padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  if (!trace || trace.length < 2) {
    return (
      <View style={[styles.emptyBox, { backgroundColor: colors.bg2 }]}>
        <Text style={{ fontSize: 12, color: colors.tx3 }}>Not enough data to draw a session trace.</Text>
      </View>
    );
  }

  const n = trace.length;
  const x = (i) => padL + (i / (n - 1)) * innerW;
  const y = (v) => padT + innerH * (1 - Math.min(100, Math.max(0, v)) / 100);

  const line = trace.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

  // Gradient stops are positioned top (level 100) to bottom (level 0).
  const stop = (level) => `${(100 - level).toFixed(0)}%`;

  const peakLine =
    Array.isArray(peaks) && peaks.length === n
      ? peaks.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
      : null;
  const ex = (atSec) => padL + Math.max(0, Math.min(1, durationSec > 0 ? atSec / durationSec : 0)) * innerW;
  const markers = (events || []).filter((e) => typeof e.atSec === 'number' && EVENT_LABELS[e.kind]);
  const ticks = longView
    ? hourTicks(startedAtMs, durationSec, events).filter((tk) => ex(tk.sec) > padL + 36 && ex(tk.sec) < W - padR - 40)
    : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.bg2 }]}>
      <Text style={[styles.eyebrow, { color: colors.tx3 }]}>
        INTENSITY OVER SESSION
        {longView
          ? ` · ${clockLabel(startedAtMs)} – ${clockLabel(clockAt(startedAtMs, durationSec, events))}`
          : ''}
      </Text>
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <Defs>
          <LinearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={colors.danger} stopOpacity="0.55" />
            <Stop offset={stop(70)} stopColor={colors.danger} stopOpacity="0.5" />
            <Stop offset={stop(70)} stopColor={colors.warning} stopOpacity="0.45" />
            <Stop offset={stop(45)} stopColor={colors.warning} stopOpacity="0.4" />
            <Stop offset={stop(45)} stopColor={colors.warning} stopOpacity="0.32" />
            <Stop offset={stop(20)} stopColor={colors.success} stopOpacity="0.3" />
            <Stop offset="100%" stopColor={colors.success} stopOpacity="0.12" />
          </LinearGradient>
          <LinearGradient id={`stroke-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={colors.danger} />
            <Stop offset={stop(70)} stopColor={colors.danger} />
            <Stop offset={stop(70)} stopColor={colors.warning} />
            <Stop offset={stop(45)} stopColor={colors.warning} />
            <Stop offset={stop(45)} stopColor={colors.success} />
            <Stop offset="100%" stopColor={colors.success} />
          </LinearGradient>
        </Defs>

        {[0, 20, 45, 70, 100].map((lv) => (
          <React.Fragment key={lv}>
            <Line
              x1={padL}
              x2={W - padR}
              y1={y(lv)}
              y2={y(lv)}
              stroke={colors.bd3}
              strokeWidth="0.5"
              strokeDasharray={lv === 0 ? undefined : '2 3'}
            />
            <SvgText x={padL - 6} y={y(lv) + 3} textAnchor="end" fontSize="8" fill={colors.tx3}>
              {lv}
            </SvgText>
          </React.Fragment>
        ))}

        <Path d={area} fill={`url(#fill-${gid})`} />
        {peakLine && <Path d={peakLine} fill="none" stroke={colors.tx3} strokeWidth="0.8" strokeOpacity="0.6" strokeLinejoin="round" />}
        <Path d={line} fill="none" stroke={`url(#stroke-${gid})`} strokeWidth="1.6" strokeLinejoin="round" />

        {markers.map((e, i) => (
          <React.Fragment key={`e${i}`}>
            <Line x1={ex(e.atSec)} x2={ex(e.atSec)} y1={padT} y2={padT + innerH} stroke={colors.tx2} strokeWidth="0.8" strokeDasharray="2 2" />
            <SvgText
              x={ex(e.atSec) > W - 60 ? ex(e.atSec) - 2 : ex(e.atSec) + 2}
              y={padT + 7}
              fontSize="7"
              fill={colors.tx2}
              textAnchor={ex(e.atSec) > W - 60 ? 'end' : 'start'}>
              {EVENT_LABELS[e.kind]}
            </SvgText>
          </React.Fragment>
        ))}

        {ticks.map((tk, i) => (
          <React.Fragment key={`h${i}`}>
            <Line x1={ex(tk.sec)} x2={ex(tk.sec)} y1={padT + innerH} y2={padT + innerH + 3} stroke={colors.tx3} strokeWidth="0.6" />
            <SvgText x={ex(tk.sec)} y={H - 5} fontSize="8" fill={colors.tx3} textAnchor="middle">
              {tk.label}
            </SvgText>
          </React.Fragment>
        ))}
        <SvgText x={padL} y={H - 5} fontSize="8" fill={colors.tx3}>
          {longView ? clockLabel(startedAtMs) : '0:00'}
        </SvgText>
        <SvgText x={W - padR} y={H - 5} fontSize="8" fill={colors.tx3} textAnchor="end">
          {longView ? clockLabel(clockAt(startedAtMs, durationSec, events)) : durationLabel(durationSec)}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 12, paddingTop: 12, paddingHorizontal: 8, paddingBottom: 4 },
  eyebrow: { fontSize: 10, letterSpacing: 0.7, marginBottom: 6, marginLeft: 18 },
  emptyBox: { borderRadius: 12, padding: 16 },
});
