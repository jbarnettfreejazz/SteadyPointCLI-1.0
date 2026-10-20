import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
import { INTENSITY_BANDS } from '../utils/intensityStats';
import { shortDate, axisTicks } from '../utils/analyticsStats';

// TWENTY-SEVENTH follow-up: charts for the redesigned Analytics screen.
// Both draw in a fixed 320-wide coordinate space scaled to the card width
// (same approach as IntensityChart.js). Sessions are spaced evenly along x
// (several on one day would otherwise pile up), with date labels underneath.

const W = 320;
const PAD_L = 28;
const PAD_R = 10;

function xFor(i, n, innerW) {
  return n <= 1 ? PAD_L + innerW / 2 : PAD_L + (i / (n - 1)) * innerW;
}

function Empty({ c, text }) {
  return (
    <View style={styles.empty}>
      <Text style={{ fontSize: 12, color: c.tx3 }}>{text}</Text>
    </View>
  );
}

// One dot per session (median intensity, coloured by band), a blue 3-session
// rolling-average line, dashed band boundaries at 20/45/70, and a vertical
// marker for each session that has a note (label = the note, shortened).
export function IntensityTrendChart({ trend, c, height = 180 }) {
  const { points, rolling, markers } = trend;
  if (points.length === 0) return <Empty c={c} text="No measured sessions in this period" />;
  const H = height;
  const padT = 22;
  const padB = 18;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - padT - padB;
  const n = points.length;
  const x = (i) => xFor(i, n, innerW);
  const y = (v) => padT + innerH * (1 - Math.max(0, Math.min(100, v)) / 100);
  const line = rolling.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  // Marker labels: skip a label (keep its line) if it would overlap the
  // previous one; keep each label inside the chart.
  const LABEL_MAX = 16;
  let lastLabelRight = -Infinity;
  const markerEls = markers.map((m) => {
    const mx = x(m.index);
    const text = m.text.length > LABEL_MAX ? `${m.text.slice(0, LABEL_MAX - 1)}…` : m.text;
    const w = Math.min(110, text.length * 4.6 + 12);
    const left = Math.max(PAD_L, Math.min(W - PAD_R - w, mx - w / 2));
    const showLabel = left >= lastLabelRight + 4;
    if (showLabel) lastLabelRight = left + w;
    return (
      <React.Fragment key={`m${m.index}`}>
        <Line x1={mx} x2={mx} y1={padT - 2} y2={padT + innerH} stroke={c.info} strokeWidth="1" strokeDasharray="3 3" />
        {showLabel && (
          <>
            <Rect x={left} y={2} width={w} height={14} rx={7} fill={c.info} />
            <SvgText x={left + w / 2} y={12} fontSize="8.5" fontWeight="600" fill="#ffffff" textAnchor="middle">
              {text}
            </SvgText>
          </>
        )}
      </React.Fragment>
    );
  });

  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {[0, 20, 45, 70, 100].map((lv) => (
        <React.Fragment key={lv}>
          <Line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={y(lv)}
            y2={y(lv)}
            stroke={c.bd3}
            strokeWidth="0.6"
            strokeDasharray={lv === 0 || lv === 100 ? undefined : '3 3'}
          />
          <SvgText x={PAD_L - 6} y={y(lv) + 3} fontSize="8" fill={c.tx3} textAnchor="end">
            {lv}
          </SvgText>
        </React.Fragment>
      ))}
      {markerEls}
      {n > 1 && <Path d={line} fill="none" stroke={c.info} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {points.map((p, i) => (
        <Circle key={i} cx={x(i)} cy={y(p.median)} r={n > 60 ? 2.2 : 3.5} fill={c[p.band.color]} />
      ))}
      {axisTicks(n).map((i) => (
        <SvgText
          key={`t${i}`}
          x={x(i)}
          y={H - 4}
          fontSize="8"
          fill={c.tx3}
          textAnchor={n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
          {shortDate(points[i].dateKey)}
        </SvgText>
      ))}
    </Svg>
  );
}

// Time in bands: one 100% stacked bar per session (None at the bottom, then
// Mild, Moderate, High), or — in line view — one line per band showing its
// share per session.
export function BandsOverTimeChart({ sessions, view = 'bars', c, height = 160 }) {
  if (sessions.length === 0) return <Empty c={c} text="No measured sessions in this period" />;
  const H = height;
  const padT = 8;
  const padB = 18;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - padT - padB;
  const n = sessions.length;
  const y = (pct) => padT + innerH * (1 - pct / 100);
  const slot = innerW / n;
  const barW = Math.max(1.5, Math.min(14, slot * 0.7));
  const barX = (i) => PAD_L + slot * i + (slot - barW) / 2;
  const lineX = (i) => xFor(i, n, innerW);
  const tickX = view === 'bars' ? (i) => barX(i) + barW / 2 : lineX;

  return (
    <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {[0, 50, 100].map((p) => (
        <React.Fragment key={p}>
          <Line x1={PAD_L} x2={W - PAD_R} y1={y(p)} y2={y(p)} stroke={c.bd3} strokeWidth="0.6" strokeDasharray={p === 50 ? '3 3' : undefined} />
          <SvgText x={PAD_L - 5} y={y(p) + 3} fontSize="8" fill={c.tx3} textAnchor="end">
            {`${p}%`}
          </SvgText>
        </React.Fragment>
      ))}
      {view === 'bars'
        ? sessions.map((sess, i) => {
            let base = 0;
            return INTENSITY_BANDS.map((b) => {
              const share = sess.pct[b.key];
              if (!share) return null;
              const top = base + share;
              const rect = (
                <Rect key={`${i}${b.key}`} x={barX(i)} y={y(top)} width={barW} height={(innerH * share) / 100} fill={c[b.color]} />
              );
              base = top;
              return rect;
            });
          })
        : INTENSITY_BANDS.map((b) => (
            <React.Fragment key={b.key}>
              {n > 1 && (
                <Path
                  d={sessions.map((sess, i) => `${i === 0 ? 'M' : 'L'}${lineX(i).toFixed(1)},${y(sess.pct[b.key]).toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke={c[b.color]}
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              )}
              {n <= 40 && sessions.map((sess, i) => <Circle key={`${b.key}${i}`} cx={lineX(i)} cy={y(sess.pct[b.key])} r={2} fill={c[b.color]} />)}
            </React.Fragment>
          ))}
      {axisTicks(n).map((i) => (
        <SvgText
          key={`t${i}`}
          x={tickX(i)}
          y={H - 4}
          fontSize="8"
          fill={c.tx3}
          textAnchor={n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
          {shortDate(sessions[i].dateKey)}
        </SvgText>
      ))}
    </Svg>
  );
}

// Legend shared by both cards: coloured dot + label per band.
export function BandLegend({ c }) {
  return (
    <View style={styles.legend}>
      {INTENSITY_BANDS.map((b) => (
        <View key={b.key} style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: c[b.color] }]} />
          <Text style={{ fontSize: 11, color: c.tx2 }}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { height: 90, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
