import { useColorScheme } from 'react-native';

// Ported 1:1 from the :root and @media(prefers-color-scheme:dark) blocks
// in steadypoint_v5.html.
export const lightColors = {
  bg1: '#ffffff',
  bg2: '#f7f7f5',
  bg3: '#f0f0ec',
  bgInfo: '#eff6ff',
  bgSuccess: '#f0fdf4',
  bgWarning: '#fffbeb',
  bgDanger: '#fef2f2',
  tx1: '#0f0f0f',
  tx2: '#525252',
  tx3: '#8a8a8a',
  info: '#2563eb',
  success: '#16a34a',
  warning: '#d97706',
  danger: '#dc2626',
  bd3: 'rgba(0,0,0,0.10)',
  bd2: 'rgba(0,0,0,0.18)',
  bd1: 'rgba(0,0,0,0.28)',
  bdInfo: '#2563eb',
};

export const darkColors = {
  bg1: '#191919',
  bg2: '#242424',
  bg3: '#2e2e2e',
  bgInfo: '#1e2d42',
  bgSuccess: '#1a2d1e',
  bgWarning: '#2d2410',
  bgDanger: '#2d1818',
  tx1: '#f0ede8',
  tx2: '#a0a0a0',
  tx3: '#606060',
  info: '#60a5fa',
  success: '#4ade80',
  warning: '#fbbf24',
  danger: '#f87171',
  bd3: 'rgba(255,255,255,0.10)',
  bd2: 'rgba(255,255,255,0.18)',
  bd1: 'rgba(255,255,255,0.28)',
  bdInfo: '#60a5fa',
};

export const radii = { md: 8, lg: 12, xl: 16 };

export function useTheme() {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkColors : lightColors;
}
