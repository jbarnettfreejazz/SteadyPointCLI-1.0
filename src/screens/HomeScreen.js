import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { useBLE } from '../services/useBLE';
import ScoreRing from '../components/ScoreRing';
import { BrainIcon, BookIcon, WalkIcon } from '../components/TabIcons';
import { startSession, resetSetupConfig, loadPinnedForEdit, deletePinnedSession } from '../services/sessionLogic';

// Same three quick-start templates as the original HTML's TEMPLATES const.
// Note: "Taking a Walk" used a Spotify guide in the original, but Spotify
// integration isn't built yet, so this defaults to no guide for now.
// Being reconsidered for a later version — flip to true to bring the
// "MY SESSIONS" section back. Underlying data/persistence/edit/delete
// logic is untouched either way.
const FEATURE_MY_SESSIONS = false;

const TEMPLATES = [
  { name: 'Meditating', activityType: 'meditative', feedbackType: 'visual', guideSource: null, duration: 5, iconBg: 'bgInfo', iconColor: 'info', Icon: BrainIcon },
  { name: 'Reading', activityType: 'engaged', feedbackType: 'both', guideSource: null, duration: 10, iconBg: 'bgSuccess', iconColor: 'success', Icon: BookIcon },
  { name: 'Taking a Walk', activityType: 'active', feedbackType: 'visual', guideSource: null, duration: 20, iconBg: 'bgWarning', iconColor: 'warning', Icon: WalkIcon },
];

const DAY_MS = 86400000;

// Ported from renderHome()'s ring/sparkline/streak derivation — demo-mode
// stub values plus the real-mode calculation from allSessions.
function useHomeStats(state) {
  return useMemo(() => {
    if (state.appMode !== 'real') {
      return {
        ringScore: 68,
        ringLabel: 'CALM',
        ringDesc: 'Moderate tremor',
        lastSessionNote: 'Last session: 2 h ago · Score 74',
        sparkValues: [42, 58, 71, 65, 74, 68],
        streakDays: 12,
        avgScore7: 71,
        totalSess: 32,
      };
    }

    const allSessions = state.allSessions;
    const recent = allSessions[0]; // addSession unshifts, so index 0 is most recent
    let ringScore = 0,
      ringLabel = 'NO DATA',
      ringDesc = 'No sessions yet',
      lastSessionNote = 'No sessions recorded yet';
    if (recent) {
      ringScore = recent.score;
      if (recent.score == null) {
        ringLabel = 'NOT SCORED';
        ringDesc = 'Session too short to score';
        lastSessionNote = `Last session: ${recent.time} · Not scored`;
      } else {
        ringLabel = recent.score >= 70 ? 'CALM' : recent.score >= 45 ? 'MODERATE' : 'ELEVATED';
        ringDesc = recent.score >= 70 ? 'Mostly low tremor' : recent.score >= 45 ? 'Moderate tremor' : 'Elevated tremor';
        lastSessionNote = `Last session: ${recent.time} · Score ${recent.score}`;
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sparkValues = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(today.getTime() - (5 - i) * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      const daySessions = allSessions.filter((s) => s.dateKey === key && s.score != null);
      return daySessions.length ? Math.round(daySessions.reduce((a, s) => a + s.score, 0) / daySessions.length) : 0;
    });

    const last7Keys = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today.getTime() - i * DAY_MS);
      return d.toISOString().slice(0, 10);
    });
    const last7 = allSessions.filter((s) => last7Keys.includes(s.dateKey) && s.score != null);
    const avgScore7 = last7.length ? Math.round(last7.reduce((a, s) => a + s.score, 0) / last7.length) : 0;
    const totalSess = allSessions.length;

    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(today.getTime() - i * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      if (allSessions.some((s) => s.dateKey === key)) streak++;
      else break;
    }

    return { ringScore, ringLabel, ringDesc, lastSessionNote, sparkValues, streakDays: streak, avgScore7, totalSess };
  }, [state.appMode, state.allSessions]);
}

export default function HomeScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  const { connect, disconnect } = useBLE();
  const stats = useHomeStats(state);

  // Mirrors quickStart(tpl) — launches the session immediately rather than
  // opening Setup for review, for both the built-in templates and any
  // pinned custom session types.
  const quickStart = (tpl) => {
    startSession({
      state,
      actions,
      navigation,
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
    Alert.alert('Remove session type', `Remove "${name}" from Home?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deletePinnedSession({ state, actions }, id) },
    ]);
  };

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
                {state.isConnected ? 'M5StickC Plus connected' : state.bleConnecting ? 'Connecting…' : 'Not connected'}
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

        {/* Today's baseline: score ring + 7-day bar sparkline */}
        <View style={[styles.baselineCard, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <ScoreRing
            size={84}
            strokeWidth={5}
            score={stats.ringScore}
            color={c.info}
            trackColor={c.bd3}
            centerLabel={stats.ringScore || '—'}
            subLabel={stats.ringLabel}
            textColor={c.tx1}
            subTextColor={c.tx3}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: c.tx3, marginBottom: 3 }}>Today's baseline</Text>
            <Text style={{ fontSize: 15, fontWeight: '500', color: c.tx1, marginBottom: 4 }}>{stats.ringDesc}</Text>
            <Text style={{ fontSize: 11, color: c.tx2, marginBottom: 8 }}>{stats.lastSessionNote}</Text>
            <View style={styles.barsRow}>
              {stats.sparkValues.map((v, i) => (
                <View
                  key={i}
                  style={[
                    styles.bar,
                    {
                      height: Math.max(2, Math.round(v * 0.44)),
                      backgroundColor: i === stats.sparkValues.length - 1 ? c.info : c.bd2,
                    },
                  ]}
                />
              ))}
              <Text style={{ fontSize: 10, color: c.tx3, marginLeft: 4 }}>7 days</Text>
            </View>
          </View>
        </View>

        {/* Streak / avg / total stats */}
        <View style={styles.statsRow}>
          <View style={[styles.statBox, { backgroundColor: c.bg2 }]}>
            <Text style={{ fontSize: 10, color: c.tx3, letterSpacing: 0.5, marginBottom: 4 }}>STREAK</Text>
            <Text style={{ fontSize: 22, fontWeight: '500', color: c.tx1 }}>
              {stats.streakDays} <Text style={{ fontSize: 13, fontWeight: '400', color: c.tx2 }}>days</Text>
            </Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: c.bg2 }]}>
            <Text style={{ fontSize: 10, color: c.tx3, letterSpacing: 0.5, marginBottom: 4 }}>7-DAY AVG</Text>
            <Text style={{ fontSize: 22, fontWeight: '500', color: c.tx1 }}>{stats.avgScore7}</Text>
          </View>
        </View>

        {/* Pinned custom sessions — hidden for now (FEATURE_MY_SESSIONS),
            being reconsidered for a later version. All underlying data/logic
            (pinnedSessions state, save/edit/delete, auto-pin-on-note-and-start
            in sessionLogic.js) is untouched — this only hides the display. */}
        {FEATURE_MY_SESSIONS && state.pinnedSessions.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: c.tx3, marginTop: 8 }]}>MY SESSIONS</Text>
            <View style={{ gap: 8 }}>
              {state.pinnedSessions.map((s) => {
                const guideLabel = s.guideSource === 'phone' ? (s.guideName ? 'Local audio' : '⚠ Reselect audio') : 'No guide';
                const soundLabel = s.feedbackType === 'both' || s.feedbackType === 'audio' ? 'Sound on' : 'No sound';
                const actLabel = s.activityType.charAt(0).toUpperCase() + s.activityType.slice(1);
                return (
                  <View key={s.id} style={[styles.pinnedRow, { backgroundColor: c.bgInfo, borderColor: c.bdInfo }]}>
                    <Pressable style={styles.pinnedMain} onPress={() => quickStart(s)}>
                      <Text style={{ color: c.info, fontWeight: '600', marginBottom: 2 }}>{s.name}</Text>
                      <Text style={{ color: c.tx2, fontSize: 11 }}>
                        {actLabel} · {s.duration} min · {soundLabel} · {guideLabel}
                      </Text>
                    </Pressable>
                    <View style={styles.pinnedActions}>
                      <Pressable onPress={() => handleEditPinned(s.id)} hitSlop={8} style={styles.iconButton}>
                        <Text style={{ color: c.tx2, fontSize: 14 }}>✎</Text>
                      </Pressable>
                      <Pressable onPress={() => handleDeletePinned(s.id, s.name)} hitSlop={8} style={styles.iconButton}>
                        <Text style={{ color: c.tx3, fontSize: 14 }}>✕</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
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
  pinnedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  pinnedMain: { flex: 1, minWidth: 0, paddingRight: 8 },
  pinnedActions: { flexDirection: 'row' },
  iconButton: { padding: 6, marginLeft: 2 },
  configureButton: { marginTop: 16, paddingVertical: 15, borderRadius: radii.xl, alignItems: 'center' },
});
