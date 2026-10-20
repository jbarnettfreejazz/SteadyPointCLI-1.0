import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { useBLE } from '../services/useBLE';
import ScoreRing from '../components/ScoreRing';
import { sessionIntensity, bandFor } from '../utils/intensityStats';
import { todayKey } from '../utils/sessionStats';
import { shortDate } from '../utils/analyticsStats';
import { BrainIcon, BookIcon, WalkIcon, InfinityIcon } from '../components/TabIcons';
import { startSession, startCustomSession, resetSetupConfig, loadPinnedForEdit, deletePinnedSession } from '../services/sessionLogic';
import CustomSessionRow from '../components/CustomSessionRow';
import { HOME_CUSTOM_SESSION_LIMIT, sortByRecentUse } from '../utils/customSessions';

// "CUSTOM SESSIONS" section (formerly "MY SESSIONS", hidden behind
// FEATURE_MY_SESSIONS while being reconsidered) — re-enabled with the two
// most recently used custom sessions here and a "View all (n)" link to the
// Custom Sessions screen when there are more. Set to false to hide it again.
const FEATURE_CUSTOM_SESSIONS = true;

// Same three quick-start templates as the original HTML's TEMPLATES const.
// Note: "Taking a Walk" used a Spotify guide in the original, but Spotify
// integration isn't built yet, so this defaults to no guide for now.

const TEMPLATES = [
  { name: 'Meditating', activityType: 'meditative', feedbackType: 'visual', guideSource: null, duration: 5, iconBg: 'bgInfo', iconColor: 'info', Icon: BrainIcon },
  { name: 'Reading', activityType: 'engaged', feedbackType: 'both', guideSource: null, duration: 10, iconBg: 'bgSuccess', iconColor: 'success', Icon: BookIcon },
  { name: 'Taking a Walk', activityType: 'active', feedbackType: 'visual', guideSource: null, duration: 20, iconBg: 'bgWarning', iconColor: 'warning', Icon: WalkIcon },
];

// Continuous Session — runs with no fixed duration until manually ended.
// duration: null makes totalSeconds falsy in startSession()/startTimers(),
// which already skips auto-completion entirely in that case — no new
// timer logic needed, just relying on existing behavior. No guide, per
// explicit scope. Always starts with feedbackType: 'visual' (sound off)
// — sonification can be turned on mid-session instead, via a toggle on
// RecordingScreen.js shown only for continuous sessions (not a
// pre-session choice here anymore).
const CONTINUOUS_TEMPLATE = {
  name: 'Continuous Session',
  activityType: 'engaged',
  feedbackType: 'visual',
  guideSource: null,
  duration: null,
  iconBg: 'bgInfo',
  iconColor: 'info',
  Icon: InfinityIcon,
};

const DAY_MS = 86400000;

// How long since the last completed Calibration Mode run before Home
// nudges the user to recalibrate. Not a hard requirement — just a
// reminder, since a tremor's frequency/amplitude can drift over time
// (particularly relevant for essential tremor, whose frequency is known
// to shift somewhat with age/disease duration) and a stale calibration
// makes the tremor-band-based intensity filtering (see dsp.js's
// bandLimitedRms()) less accurate. Only shown when lastCalibratedAt is
// actually set — a user who's never run Calibration Mode (e.g. an
// existing user grandfathered straight to hasCalibrated: true, see
// persistence.js) isn't nagged into starting it.
const RECALIBRATION_REMINDER_DAYS = 90;

// TWENTY-EIGHTH follow-up: no SteadyPoint Score. The ring shows the most
// recent session's MEDIAN intensity coloured by its band (lower is calmer),
// the bars show each of the last 7 days' average intensity (the mean of
// that day's session medians — same "average intensity" as Analytics), and
// the 7-DAY AVG tile is the mean of every measured session's median over
// those 7 days. Sessions too short to measure are skipped (sessionIntensity).
const RING_DESC = {
  none: 'Calm — little or no tremor',
  mild: 'Mostly mild tremor',
  moderate: 'Moderate tremor',
  high: 'Higher tremor',
};

const avgOf = (nums) => (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null);

function useHomeStats(state) {
  return useMemo(() => {
    if (state.appMode !== 'real') {
      return {
        ringInfo: { valid: true, median: 32, band: bandFor(32) },
        ringEmptyLabel: 'NO DATA',
        ringDesc: RING_DESC.mild,
        lastSessionNote: 'Last session: 2 h ago · Median 32',
        dayValues: [48, 41, null, 36, 38, 30, 32],
        streakDays: 12,
        avg7: 38,
        totalSess: 32,
      };
    }

    const allSessions = state.allSessions;
    const recent = allSessions[0]; // addSession unshifts, so index 0 is most recent
    let ringInfo = { valid: false, median: null, band: null },
      ringDesc = 'No sessions yet',
      lastSessionNote = 'No sessions recorded yet',
      ringEmptyLabel = 'NO DATA';
    if (recent) {
      ringInfo = sessionIntensity(recent);
      const when = recent.dateKey === todayKey() ? recent.time : `${shortDate(recent.dateKey)}, ${recent.time}`;
      if (!ringInfo.valid) {
        ringDesc = 'Session too short to measure';
        ringEmptyLabel = 'TOO SHORT';
        lastSessionNote = `Last session: ${when} · Not measured`;
      } else {
        ringDesc = RING_DESC[ringInfo.band.key];
        lastSessionNote = `Last session: ${when} · Median ${ringInfo.median}`;
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Oldest -> newest (today last), 7 days.
    const last7Keys = Array.from({ length: 7 }, (_, i) => new Date(today.getTime() - (6 - i) * DAY_MS).toISOString().slice(0, 10));
    const mediansByDay = {};
    for (const s of allSessions) {
      if (!last7Keys.includes(s.dateKey)) continue;
      const info = sessionIntensity(s);
      if (info.valid) (mediansByDay[s.dateKey] = mediansByDay[s.dateKey] || []).push(info.median);
    }
    const dayValues = last7Keys.map((k) => avgOf(mediansByDay[k] || []));
    const avg7 = avgOf(Object.values(mediansByDay).flat());
    const totalSess = allSessions.length;

    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(today.getTime() - i * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      if (allSessions.some((s) => s.dateKey === key)) streak++;
      else break;
    }

    return { ringInfo, ringEmptyLabel, ringDesc, lastSessionNote, dayValues, streakDays: streak, avg7, totalSess };
  }, [state.appMode, state.allSessions]);
}

export default function HomeScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  const { connect, disconnect } = useBLE();
  const stats = useHomeStats(state);

  const needsRecalibration = useMemo(() => {
    const last = state.settings.lastCalibratedAt;
    if (!last) return false; // never calibrated — handled by Settings' "Open Calibration" button, not a nudge
    const days = (Date.now() - new Date(last).getTime()) / DAY_MS;
    return days >= RECALIBRATION_REMINDER_DAYS;
  }, [state.settings.lastCalibratedAt]);

  // Mirrors quickStart(tpl) — launches a built-in template immediately rather
  // than opening Setup for review. (Custom sessions use startCustomSession().)
  const quickStart = (tpl) => {
    startSession({
      state,
      actions,
      navigation,
      origin: 'quickStart',
      overrides: {
        config: {
          feedbackType: tpl.feedbackType,
          activityType: tpl.activityType,
          activityNote: '',
          duration: tpl.duration,
        },
        guideMediaSource: tpl.guideSource || null,
        guideMediaName: tpl.guideSource === 'phone' ? tpl.guideName || '' : '',
        guideMediaPath: tpl.guideSource === 'phone' ? tpl.guidePath || null : null,
      },
    });
  };

  const handleEditPinned = (id) => {
    loadPinnedForEdit(state, actions, id);
    navigation.navigate('setup');
  };

  const handleDeletePinned = (id, name) => {
    Alert.alert('Delete custom session', `Delete "${name}"? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deletePinnedSession({ state, actions }, id) },
    ]);
  };

  const customSessions = useMemo(() => sortByRecentUse(state.pinnedSessions), [state.pinnedSessions]);

  const handleConfigureNew = () => {
    resetSetupConfig(actions);
    navigation.navigate('setup');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <Text style={[styles.h1, { color: c.tx1 }]}>SteadyPoint</Text>
          {state.appMode === 'demo' && (
            <View style={[styles.pill, { backgroundColor: c.bgInfo }]}>
              <Text style={{ color: c.info, fontSize: 11, fontWeight: '600' }}>DEMO</Text>
            </View>
          )}
        </View>

        {/* BLE connection card */}
        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <View style={styles.rowBetween}>
            <View style={styles.rowGap}>
              <View style={[styles.dot, { backgroundColor: state.isConnected ? c.success : c.tx3 }]} />
              <Text style={{ color: c.tx1, fontWeight: '600' }}>
                {state.isConnected
                  ? `${state.connectedDeviceName || 'Device'} connected`
                  : state.bleConnecting
                  ? 'Connecting…'
                  : 'Not connected'}
              </Text>
            </View>
            <Pressable
              onPress={state.isConnected ? disconnect : connect}
              disabled={state.bleConnecting}
              style={[styles.smallButton, { borderColor: c.bd2 }]}>
              <Text style={{ color: c.tx1, fontWeight: '600', fontSize: 13 }}>
                {state.isConnected ? 'Disconnect' : 'Connect'}
              </Text>
            </Pressable>
          </View>
          {!!state.bleError && <Text style={{ color: c.danger, fontSize: 12, marginTop: 8 }}>{state.bleError}</Text>}
        </View>

        {needsRecalibration && (
          <View style={[styles.card, { backgroundColor: c.bgWarning, borderColor: c.bd3 }]}>
            <Text style={{ color: c.tx1, fontWeight: '600', marginBottom: 4 }}>Time to recalibrate?</Text>
            <Text style={{ color: c.tx2, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>
              It's been a while since your last calibration. Tremor can change over time — recalibrating keeps your
              full-scale amplitude and frequency band accurate.
            </Text>
            <Pressable
              onPress={() => navigation.navigate('calibration', { fromWelcome: false })}
              style={[styles.smallButton, { borderColor: c.warning, alignSelf: 'flex-start' }]}>
              <Text style={{ color: c.warning, fontWeight: '600', fontSize: 13 }}>Recalibrate</Text>
            </Pressable>
          </View>
        )}

        {/* Last session's median intensity + 7-day average-intensity bars */}
        <View style={[styles.baselineCard, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <ScoreRing
            size={84}
            strokeWidth={5}
            score={stats.ringInfo.valid ? stats.ringInfo.median : 0}
            color={stats.ringInfo.valid ? c[stats.ringInfo.band.color] : c.bd3}
            trackColor={c.bd3}
            centerLabel={stats.ringInfo.valid ? stats.ringInfo.median : '—'}
            subLabel={stats.ringInfo.valid ? stats.ringInfo.band.label.toUpperCase() : stats.ringEmptyLabel}
            textColor={c.tx1}
            subTextColor={stats.ringInfo.valid ? c[stats.ringInfo.band.color] : c.tx3}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: c.tx3, marginBottom: 3 }}>Median intensity</Text>
            <Text style={{ fontSize: 15, fontWeight: '500', color: c.tx1, marginBottom: 4 }}>{stats.ringDesc}</Text>
            <Text style={{ fontSize: 11, color: c.tx2, marginBottom: 8 }}>{stats.lastSessionNote}</Text>
            <View style={styles.barsRow}>
              {stats.dayValues.map((v, i) => (
                <View
                  key={i}
                  style={[
                    styles.bar,
                    {
                      height: v == null ? 2 : Math.max(3, Math.round(v * 0.44)),
                      backgroundColor: v == null ? c.bd2 : c[bandFor(v).color],
                    },
                  ]}
                />
              ))}
              <Text style={{ fontSize: 10, color: c.tx3, marginLeft: 4 }}>7 days</Text>
            </View>
          </View>
        </View>

        {/* Streak / 7-day average intensity */}
        <View style={styles.statsRow}>
          <View style={[styles.statBox, { backgroundColor: c.bg2 }]}>
            <Text style={{ fontSize: 10, color: c.tx3, letterSpacing: 0.5, marginBottom: 4 }}>STREAK</Text>
            <Text style={{ fontSize: 22, fontWeight: '500', color: c.tx1 }}>
              {stats.streakDays} <Text style={{ fontSize: 13, fontWeight: '400', color: c.tx2 }}>days</Text>
            </Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: c.bg2 }]}>
            <Text style={{ fontSize: 10, color: c.tx3, letterSpacing: 0.5, marginBottom: 4 }}>7-DAY AVG INTENSITY</Text>
            {stats.avg7 == null ? (
              <Text style={{ fontSize: 22, fontWeight: '500', color: c.tx3 }}>—</Text>
            ) : (
              <Text style={{ fontSize: 22, fontWeight: '500', color: c.tx1 }}>
                {stats.avg7}{' '}
                <Text style={{ fontSize: 13, fontWeight: '600', color: c[bandFor(stats.avg7).color] }}>
                  {bandFor(stats.avg7).label}
                </Text>
              </Text>
            )}
          </View>
        </View>

        {/* Custom sessions — the two most recently used; "View all (n)"
            opens the Custom Sessions screen when there are more. */}
        {FEATURE_CUSTOM_SESSIONS && customSessions.length > 0 && (
          <>
            <View style={[styles.sectionHeaderRow, { marginTop: 8 }]}>
              <Text style={[styles.sectionLabel, { color: c.tx3, marginBottom: 0 }]}>CUSTOM SESSIONS</Text>
              {customSessions.length > HOME_CUSTOM_SESSION_LIMIT && (
                <Pressable onPress={() => navigation.navigate('customSessions')} hitSlop={8} accessibilityRole="link">
                  <Text style={{ color: c.info, fontSize: 12, fontWeight: '600' }}>View all ({customSessions.length})</Text>
                </Pressable>
              )}
            </View>
            <View style={{ gap: 8 }}>
              {customSessions.slice(0, HOME_CUSTOM_SESSION_LIMIT).map((s) => (
                <CustomSessionRow
                  key={s.id}
                  session={s}
                  c={c}
                  onStart={() => startCustomSession({ state, actions, navigation, session: s })}
                  onEdit={() => handleEditPinned(s.id)}
                  onDelete={() => handleDeletePinned(s.id, s.name)}
                />
              ))}
            </View>
          </>
        )}

        {/* Quick start templates */}
        <Text style={[styles.sectionLabel, { color: c.tx3, marginTop: 20 }]}>QUICK START</Text>
        <View style={{ gap: 8 }}>
          {TEMPLATES.map((tpl) => {
            const guide = tpl.guideSource ? tpl.guideSource.charAt(0).toUpperCase() + tpl.guideSource.slice(1) : 'No guide';
            const sound = tpl.feedbackType === 'both' ? 'Sound on' : 'No sound';
            const act = tpl.activityType.charAt(0).toUpperCase() + tpl.activityType.slice(1);
            return (
              <Pressable
                key={tpl.name}
                onPress={() => quickStart(tpl)}
                style={[styles.quickRow, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
                <View style={[styles.quickIconBox, { backgroundColor: c[tpl.iconBg] }]}>
                  <tpl.Icon color={c[tpl.iconColor]} size={20} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14, fontWeight: '500', color: c.tx1, marginBottom: 2 }}>{tpl.name}</Text>
                  <Text style={{ fontSize: 11, color: c.tx3 }}>
                    {act} · {tpl.duration} min · {sound} · {guide}
                  </Text>
                </View>
                <Text style={{ fontSize: 12, fontWeight: '500', color: c.info }}>Start →</Text>
              </Pressable>
            );
          })}

          <Pressable
            onPress={() => quickStart(CONTINUOUS_TEMPLATE)}
            style={[styles.quickRow, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
            <View style={[styles.quickIconBox, { backgroundColor: c[CONTINUOUS_TEMPLATE.iconBg] }]}>
              <CONTINUOUS_TEMPLATE.Icon color={c[CONTINUOUS_TEMPLATE.iconColor]} size={20} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: c.tx1, marginBottom: 2 }}>Continuous Session</Text>
              <Text style={{ fontSize: 11, color: c.tx3 }}>Runs until you stop it · Sonification can be turned on during the session · No guide</Text>
            </View>
            <Text style={{ fontSize: 12, fontWeight: '500', color: c.info }}>Start →</Text>
          </Pressable>
        </View>

        <Pressable onPress={handleConfigureNew} style={[styles.configureButton, { backgroundColor: c.tx1 }]}>
          <Text style={{ color: c.bg1, fontWeight: '700' }}>Configure new session</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 18, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  h1: { fontSize: 24, fontWeight: '700' },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  card: { borderWidth: 1, borderRadius: radii.lg, padding: 14, marginBottom: 12 },
  baselineCard: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: 14,
    marginBottom: 12,
  },
  barsRow: { flexDirection: 'row', gap: 3, alignItems: 'flex-end' },
  bar: { width: 5, borderRadius: 2 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statBox: { flex: 1, borderRadius: radii.lg, padding: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  smallButton: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 6 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  quickIconBox: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  configureButton: { marginTop: 16, paddingVertical: 15, borderRadius: radii.xl, alignItems: 'center' },
});
