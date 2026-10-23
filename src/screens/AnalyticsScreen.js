import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { startSimilarSession } from '../services/sessionLogic';
import { bandFor, INTENSITY_BANDS, displayScale } from '../utils/intensityStats';
import {
  PERIODS,
  ACTIVITY_TYPES,
  periodSessions,
  overview,
  calmestSession,
  intensityTrend,
  bandsOverTime,
  byActivity,
  soundAndGuide,
  frequencySummary,
  longDate,
} from '../utils/analyticsStats';
import { IntensityTrendChart, BandsOverTimeChart, BandLegend } from '../components/AnalyticsCharts';
import { ActivityIcon, BrainIcon, BookIcon, WalkIcon } from '../components/TabIcons';

// TWENTY-SEVENTH follow-up: Analytics redesigned around intensity — the
// SteadyPoint Score is gone from this screen. Sections (per the design):
// period selector, Sessions / Avg intensity, Your calmest session, intensity
// trend, time in bands, by activity type, sound & guide, dominant frequency.
// Lower intensity is better throughout. Numbers come from
// utils/analyticsStats.js.

const TYPE_FILTERS = [{ key: 'all', label: 'All types' }, ...ACTIVITY_TYPES];
const ACTIVITY_ICON = {
  meditative: { Icon: BrainIcon, bg: 'bgInfo', color: 'info' },
  engaged: { Icon: BookIcon, bg: 'bgSuccess', color: 'success' },
  active: { Icon: WalkIcon, bg: 'bgWarning', color: 'warning' },
};

export default function AnalyticsScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  // THIRTY-FOURTH follow-up: start on the user's last chosen range
  // (settings.analyticsPeriod, saved across launches); 30D if none yet.
  const [periodKey, setPeriodKeyState] = useState(() =>
    PERIODS.some((p) => p.key === state.settings?.analyticsPeriod) ? state.settings.analyticsPeriod : '30d',
  );
  const setPeriodKey = (key) => {
    setPeriodKeyState(key);
    if (state.settings?.analyticsPeriod !== key) actions.updateSettings({ analyticsPeriod: key });
  };
  const [calmType, setCalmType] = useState('all');
  const [trendType, setTrendType] = useState('all');
  const [trendMenuOpen, setTrendMenuOpen] = useState(false);
  const [bandsView, setBandsView] = useState('bars');
  // THIRTY-SECOND follow-up: 'band' (tremor band) or 'all' (All motion).
  const [trendView, setTrendView] = useState('band');

  const period = PERIODS.find((p) => p.key === periodKey);
  // THIRTIETH follow-up: every session on the current full scale / noise floor.
  const scale = useMemo(() => displayScale(state.settings), [state.settings]);
  const items = useMemo(() => periodSessions(state.allSessions, periodKey, scale), [state.allSessions, periodKey, scale]);
  const ov = overview(items);
  const calmest = calmestSession(items, calmType);
  const trend = intensityTrend(items, trendType, { view: trendView, scale });
  const bands = bandsOverTime(items);
  const activity = byActivity(items);
  const sg = soundAndGuide(items);
  const freq = frequencySummary(items);
  const bandColor = (v) => (v == null ? c.tx3 : c[bandFor(v).color]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header + history link (with total recorded sessions) */}
        <View style={styles.headerRow}>
          <Text style={[styles.h1, { color: c.tx1 }]}>Analytics</Text>
          <Pressable
            onPress={() => navigation.navigate('sessionHistory')}
            hitSlop={6}
            style={[styles.historyPill, { backgroundColor: c.bg2, borderColor: c.bd3 }]}
            accessibilityRole="button">
            <Text style={{ fontSize: 12, fontWeight: '600', color: c.info }}>
              All sessions history ({state.allSessions.length})
            </Text>
            <Text style={{ fontSize: 14, color: c.info, marginLeft: 4 }}>›</Text>
          </Pressable>
        </View>

        {/* Period selector */}
        <View style={[styles.segment, { backgroundColor: c.bg2 }]}>
          {PERIODS.map((p) => {
            const on = p.key === periodKey;
            return (
              <Pressable
                key={p.key}
                onPress={() => setPeriodKey(p.key)}
                style={[styles.segmentItem, on && { backgroundColor: c.info }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: on ? '#ffffff' : c.tx2 }}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Sessions / Avg intensity */}
        <View style={styles.twoCol}>
          <View style={[styles.tile, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
            <Text style={[styles.eyebrow, { color: c.tx3 }]}>SESSIONS</Text>
            <Text style={[styles.bigNum, { color: c.tx1 }]}>{ov.count}</Text>
            <Text style={{ fontSize: 11, color: c.tx3 }}>{period.sub}</Text>
          </View>
          <View style={[styles.tile, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
            <Text style={[styles.eyebrow, { color: c.tx3 }]}>AVG INTENSITY</Text>
            <Text style={[styles.bigNum, { color: bandColor(ov.avgIntensity) }]}>{ov.avgIntensity ?? '—'}</Text>
            <Text style={{ fontSize: 11, color: c.tx3 }}>{period.sub}</Text>
          </View>
        </View>

        {/* Your calmest session */}
        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <Text style={[styles.eyebrow, { color: c.tx3 }]}>YOUR CALMEST SESSION</Text>
          <View style={styles.chipRow}>
            {TYPE_FILTERS.map((t) => {
              const on = t.key === calmType;
              return (
                <Pressable
                  key={t.key}
                  onPress={() => setCalmType(t.key)}
                  style={[styles.chip, { backgroundColor: on ? c.info : c.bg1, borderColor: on ? c.info : c.bd3 }]}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: on ? '#ffffff' : c.tx1 }}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {calmest ? (
            <>
              <View style={styles.calmHead}>
                <Text style={[styles.calmNum, { color: c[calmest.info.band.color] }]}>{calmest.info.median}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: c[calmest.info.band.color] }}>
                    {calmest.info.band.label} band
                    {calmest.pctBelowAvg > 0 ? ` · ${calmest.pctBelowAvg}% below your ${calmType === 'all' ? '' : `${calmType} `}avg` : ''}
                  </Text>
                  <Text style={{ fontSize: 12, color: c.tx3, marginTop: 2 }}>
                    {longDate(calmest.s.dateKey)}
                    {calmest.s.time ? ` · ${calmest.s.time}` : ''}
                  </Text>
                </View>
              </View>
              <View style={styles.detailGrid}>
                <Detail label="ACTIVITY" value={cap(calmest.s.activityType) || '—'} c={c} />
                <Detail label="LENGTH" value={calmest.s.isContinuous ? `${calmest.s.duration} min · continuous` : `${calmest.s.duration} min`} c={c} />
                <Detail label="SOUND" value={calmest.s.feedbackType === 'both' || calmest.s.feedbackType === 'audio' ? 'On' : 'Off'} c={c} />
                <Detail label="GUIDE" value={calmest.s.guideSource ? 'With guide' : 'No guide'} c={c} />
              </View>
              <Pressable
                onPress={() => startSimilarSession({ state, actions, navigation, session: calmest.s })}
                style={[styles.primaryButton, { backgroundColor: c.tx1 }]}>
                <Text style={{ color: c.bg1, fontWeight: '700' }}>Start similar session</Text>
              </Pressable>
            </>
          ) : (
            <Text style={{ fontSize: 13, color: c.tx3, paddingVertical: 12 }}>
              No measured {calmType === 'all' ? '' : `${calmType} `}sessions {period.key === 'all' ? 'yet' : `in the ${period.sub}`}.
            </Text>
          )}
        </View>

        {/* Intensity trend */}
        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.eyebrow, { color: c.tx3 }]}>{period.chartTitle}</Text>
              <Text style={[styles.cardTitle, { color: c.tx1 }]}>{trend.subtitle}</Text>
            </View>
            <Pressable
              onPress={() => setTrendMenuOpen((o) => !o)}
              style={[styles.dropdown, { borderColor: c.bd3, backgroundColor: c.bg1 }]}
              accessibilityRole="button">
              <Text style={{ fontSize: 12, color: c.tx1 }}>{TYPE_FILTERS.find((t) => t.key === trendType).label} ⌄</Text>
            </Pressable>
          </View>
          {trendMenuOpen && (
            <View style={[styles.menu, { borderColor: c.bd3, backgroundColor: c.bg1 }]}>
              {TYPE_FILTERS.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => {
                    setTrendType(t.key);
                    setTrendMenuOpen(false);
                  }}
                  style={styles.menuItem}>
                  <Text style={{ fontSize: 13, color: t.key === trendType ? c.info : c.tx1, fontWeight: t.key === trendType ? '600' : '400' }}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {/* THIRTY-SECOND follow-up: tremor band vs all motion */}
          <View style={[styles.miniSegment, { backgroundColor: c.bg1, borderColor: c.bd3, alignSelf: 'flex-start', marginLeft: 0, marginBottom: 8 }]}>
            {[
              { key: 'band', label: 'Tremor band' },
              { key: 'all', label: 'All motion' },
            ].map((v) => {
              const on = v.key === trendView;
              return (
                <Pressable key={v.key} onPress={() => setTrendView(v.key)} style={[styles.miniSegItem, on && { backgroundColor: c.info }]}>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: on ? '#ffffff' : c.tx2 }}>{v.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <IntensityTrendChart
            trend={trend}
            c={c}
            emptyText={trendView === 'all' ? 'No sessions with all-motion data in this period' : undefined}
          />
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: c.tx3 }]} />
              <Text style={{ fontSize: 11, color: c.tx2 }}>Session (band color)</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.lineKey, { backgroundColor: c.info }]} />
              <Text style={{ fontSize: 11, color: c.tx2 }}>3-session avg</Text>
            </View>
            {trend.markers.some((m) => m.kind === 'note') && (
              <View style={styles.legendItem}>
                <View style={[styles.markerKey, { backgroundColor: c.info }]} />
                <Text style={{ fontSize: 11, color: c.tx2 }}>Session note</Text>
              </View>
            )}
            {trend.markers.some((m) => m.kind === 'band') && (
              <View style={styles.legendItem}>
                <View style={[styles.markerKey, { backgroundColor: c.tx3 }]} />
                <Text style={{ fontSize: 11, color: c.tx2 }}>Band change</Text>
              </View>
            )}
          </View>
          {trendView === 'all' && (
            <Text style={{ fontSize: 11, color: c.tx3, marginTop: 8 }}>
              All motion counts every frequency, including voluntary movement, so it reads higher than tremor-band intensity
              but stays comparable across band changes. Available for sessions recorded from this update on.
            </Text>
          )}
        </View>

        {/* Time in bands */}
        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.eyebrow, { color: c.tx3 }]}>TIME IN BANDS</Text>
              <Text style={[styles.cardTitle, { color: c.tx1 }]}>{bands.subtitle}</Text>
            </View>
            <View style={[styles.miniSegment, { backgroundColor: c.bg1, borderColor: c.bd3 }]}>
              {[
                { key: 'bars', label: 'Bars' },
                { key: 'lines', label: 'Lines' },
              ].map((v) => {
                const on = v.key === bandsView;
                return (
                  <Pressable key={v.key} onPress={() => setBandsView(v.key)} style={[styles.miniSegItem, on && { backgroundColor: c.info }]}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: on ? '#ffffff' : c.tx2 }}>{v.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <BandsOverTimeChart sessions={bands.sessions} view={bandsView} c={c} />
          <BandLegend c={c} />
          <Text style={{ fontSize: 11, color: c.tx3, marginTop: 8 }}>
            {bandsView === 'bars'
              ? 'One bar per session, showing how its time split across the bands.'
              : 'Each line shows one band’s share of each session.'}
          </Text>
        </View>

        {/* By activity type */}
        <SectionLabel text="BY ACTIVITY TYPE" note="avg intensity" c={c} />
        <View style={styles.threeCol}>
          {activity.map((a) => {
            const { Icon, bg, color } = ACTIVITY_ICON[a.key];
            return (
              <View key={a.key} style={[styles.actCard, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
                <View style={[styles.actIconBox, { backgroundColor: c[bg] }]}>
                  <Icon color={c[color]} size={16} />
                </View>
                <Text style={[styles.eyebrow, { color: c.tx3 }]}>{a.label.toUpperCase()}</Text>
                <Text style={[styles.midNum, { color: bandColor(a.avgIntensity) }]}>{a.avgIntensity ?? '—'}</Text>
                <MiniBandBar pct={a.pct} c={c} />
                <Text style={{ fontSize: 10, color: c.tx3, marginTop: 6 }}>
                  {a.count} session{a.count !== 1 ? 's' : ''}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Sound & guide */}
        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <Text style={[styles.eyebrow, { color: c.tx3 }]}>
            SOUND & GUIDE <Text style={{ fontWeight: '400' }}>avg intensity</Text>
          </Text>
          <View style={styles.sgGrid}>
            <SgTile label="Sound on" g={sg.soundOn} c={c} bandColor={bandColor} />
            <SgTile label="Sound off" g={sg.soundOff} c={c} bandColor={bandColor} />
            <SgTile label="With guide" g={sg.withGuide} c={c} bandColor={bandColor} />
            <SgTile label="Without guide" g={sg.withoutGuide} c={c} bandColor={bandColor} />
          </View>
        </View>

        {/* Dominant frequency */}
        <View style={[styles.card, styles.freqCard, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <ActivityIcon color={c.info} size={20} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.eyebrow, { color: c.tx3, marginBottom: 2 }]}>AVG DOMINANT FREQUENCY</Text>
            <Text style={{ fontSize: 11, color: c.tx3 }}>
              {period.sub}
              {freq.trend ? ` · ${freq.trend}` : ''}
            </Text>
          </View>
          <Text style={{ fontSize: 24, fontWeight: '600', color: c.tx1 }}>
            {freq.avgHz != null ? freq.avgHz.toFixed(1) : '—'}
            <Text style={{ fontSize: 13, fontWeight: '400', color: c.tx2 }}> Hz</Text>
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function Detail({ label, value, c }) {
  return (
    <View style={styles.detailWrap}>
      <View style={[styles.detail, { backgroundColor: c.bg1 }]}>
        <Text style={[styles.eyebrow, { color: c.tx3, marginBottom: 2 }]}>{label}</Text>
        <Text style={{ fontSize: 13, fontWeight: '600', color: c.tx1 }}>{value}</Text>
      </View>
    </View>
  );
}

function MiniBandBar({ pct, c }) {
  return (
    <View style={[styles.miniBar, { backgroundColor: c.bd3 }]}>
      {pct &&
        INTENSITY_BANDS.filter((b) => pct[b.key] > 0).map((b) => (
          <View key={b.key} style={{ flex: pct[b.key], backgroundColor: c[b.color] }} />
        ))}
    </View>
  );
}

function SgTile({ label, g, c, bandColor }) {
  return (
    <View style={styles.sgWrap}>
      <View style={[styles.sgTile, { backgroundColor: c.bg1 }]}>
        <Text style={{ fontSize: 12, color: c.tx2, marginBottom: 4 }}>{label}</Text>
        <Text style={[styles.midNum, { color: bandColor(g.avgIntensity) }]}>{g.avgIntensity ?? '—'}</Text>
        <Text style={{ fontSize: 10, color: c.tx3, marginTop: 2 }}>
          {g.count} session{g.count !== 1 ? 's' : ''}
        </Text>
      </View>
    </View>
  );
}

function SectionLabel({ text, note, c }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: c.tx3, marginTop: 6, marginBottom: 8 }}>
      {text} <Text style={{ fontWeight: '400' }}>{note}</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 18, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  h1: { fontSize: 22, fontWeight: '600' },
  historyPill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  segment: { flexDirection: 'row', borderRadius: radii.md, padding: 3, marginBottom: 14 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radii.md - 2 },
  twoCol: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  tile: { flex: 1, borderWidth: 1, borderRadius: radii.lg, padding: 14 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6 },
  bigNum: { fontSize: 30, fontWeight: '600', marginBottom: 2 },
  midNum: { fontSize: 24, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: 14, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: '500' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  calmHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  calmNum: { fontSize: 40, fontWeight: '700' },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 12 },
  detailWrap: { width: '50%', padding: 4 },
  detail: { borderRadius: radii.md, padding: 10 },
  primaryButton: { paddingVertical: 14, borderRadius: radii.xl, alignItems: 'center' },
  dropdown: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 10, paddingVertical: 6, marginLeft: 8 },
  menu: { borderWidth: 1, borderRadius: radii.md, marginBottom: 8, alignSelf: 'flex-end', minWidth: 140 },
  menuItem: { paddingHorizontal: 12, paddingVertical: 9 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  lineKey: { width: 14, height: 2, borderRadius: 1 },
  markerKey: { width: 1.5, height: 12 },
  miniSegment: { flexDirection: 'row', borderWidth: 1, borderRadius: radii.md, padding: 2, marginLeft: 8 },
  miniSegItem: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.md - 2 },
  threeCol: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  actCard: { flex: 1, borderWidth: 1, borderRadius: radii.lg, padding: 10 },
  actIconBox: { width: 28, height: 28, borderRadius: 6, marginBottom: 8, alignItems: 'center', justifyContent: 'center' },
  miniBar: { flexDirection: 'row', height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 6 },
  sgGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  sgWrap: { width: '50%', padding: 4 },
  sgTile: { borderRadius: radii.md, padding: 12 },
  freqCard: { flexDirection: 'row', alignItems: 'center' },
});
