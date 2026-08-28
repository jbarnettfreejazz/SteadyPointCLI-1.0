import React from 'react';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';

// Ported from the bar-building logic inside renderAnalytics(). Each day is
// a rounded bar sized to its average score (0-100 scale), with today
// highlighted. If today has no session yet, it renders as a dashed
// "pending" outline instead of a solid bar.
export default function WeeklyBarChart({ days, colors, width = 330 }) {
  const barGap = 4;
  const chartH = 64;
  const barW = (width - barGap * (days.length - 1)) / days.length;

  return (
    <Svg width={width} height={chartH + 20} viewBox={`0 0 ${width} ${chartH + 20}`}>
      {days.map((d, i) => {
        const x = i * (barW + barGap);
        const hasScore = d.avg !== null;

        if (d.isToday && !hasScore) {
          const pendingH = Math.round(0.35 * chartH);
          const py = chartH - pendingH;
          return (
            <React.Fragment key={d.key}>
              <Rect
                x={x}
                y={py}
                width={barW}
                height={pendingH}
                rx={3}
                fill="none"
                stroke={colors.bdInfo}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                opacity={0.6}
              />
              <SvgText x={x + barW / 2} y={chartH + 13} fontSize="10" fill={colors.info} textAnchor="middle" fontWeight="500">
                {d.label}
              </SvgText>
              <SvgText x={x + barW / 2} y={py - 4} fontSize="10" fill={colors.tx3} textAnchor="middle">
                —
              </SvgText>
            </React.Fragment>
          );
        }

        const bh = hasScore ? Math.max(4, Math.round((d.avg / 100) * chartH)) : 0;
        const y = chartH - bh;
        const fill = d.isToday ? colors.info : colors.bd2;
        const lblClr = d.isToday ? colors.info : colors.tx3;
        return (
          <React.Fragment key={d.key}>
            <Rect x={x} y={y} width={barW} height={bh} rx={3} fill={fill} />
            <SvgText
              x={x + barW / 2}
              y={chartH + 13}
              fontSize="10"
              fill={lblClr}
              textAnchor="middle"
              fontWeight={d.isToday ? '500' : '400'}>
              {d.label}
            </SvgText>
            {hasScore && (
              <SvgText x={x + barW / 2} y={y - 4} fontSize="10" fill={lblClr} textAnchor="middle">
                {d.avg}
              </SvgText>
            )}
          </React.Fragment>
        );
      })}
    </Svg>
  );
}
