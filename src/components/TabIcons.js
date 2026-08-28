import React from 'react';
import Svg, { Path, Polyline, Circle } from 'react-native-svg';

const common = (color, size) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: color,
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

export function HomeIcon({ color = '#000', size = 22 }) {
  return (
    <Svg {...common(color, size)}>
      <Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <Polyline points="9 22 9 12 15 12 15 22" />
    </Svg>
  );
}

export function ActivityIcon({ color = '#000', size = 22 }) {
  return (
    <Svg {...common(color, size)}>
      <Polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </Svg>
  );
}

export function BulbIcon({ color = '#000', size = 22 }) {
  return (
    <Svg {...common(color, size)}>
      <Path d="M9 18h6" />
      <Path d="M10 21h4" />
      <Path d="M12 3a6 6 0 0 0-6 6c0 2.5 1.5 4 2.5 5.5.5.8 1 1.5 1 2.5h5c0-1 .5-1.7 1-2.5C16.5 13.5 18 12 18 9a6 6 0 0 0-6-6z" />
    </Svg>
  );
}

export function SettingsIcon({ color = '#000', size = 22 }) {
  return (
    <Svg {...common(color, size)}>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  );
}

// Quick Start card icons, matching the original's icon:'ti-brain' / 'ti-book' /
// 'ti-walk' assignments for Meditating/Reading/Taking a Walk. These are close
// conceptual equivalents (brain / open book / walking figure) rather than
// pixel-exact recreations of the specific Tabler glyphs — Tabler's site is
// JS-rendered and its CDN doesn't expose the raw vector paths in a way this
// environment could reliably fetch, so these are drawn to match the concept.
export function BrainIcon({ color = '#000', size = 22 }) {
  return (
    <Svg {...common(color, size)}>
      <Path d="M9.5 2a3.5 3.5 0 0 0-3.5 3.5c0 .6.15 1.16.4 1.66A3.5 3.5 0 0 0 4 10.5c0 1.2.53 2.27 1.36 3A3.5 3.5 0 0 0 6 17a3.5 3.5 0 0 0 3.5 3.5A3.5 3.5 0 0 0 13 17V5.5A3.5 3.5 0 0 0 9.5 2z" />
      <Path d="M14.5 2a3.5 3.5 0 0 1 3.5 3.5c0 .6-.15 1.16-.4 1.66A3.5 3.5 0 0 1 20 10.5c0 1.2-.53 2.27-1.36 3A3.5 3.5 0 0 1 18 17a3.5 3.5 0 0 1-3.5 3.5A3.5 3.5 0 0 1 11 17V5.5A3.5 3.5 0 0 1 14.5 2z" />
    </Svg>
  );
}

export function BookIcon({ color = '#000', size = 22 }) {
  return (
    <Svg {...common(color, size)}>
      <Path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <Path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </Svg>
  );
}

export function WalkIcon({ color = '#000', size = 22 }) {
  return (
    <Svg {...common(color, size)}>
      <Circle cx="13" cy="4" r="1.5" fill={color} stroke="none" />
      <Path d="M6 21l3-8-1-5 5-1 3 4h3" />
      <Path d="M9.5 21l2-6 2 2 3 1" />
    </Svg>
  );
}
