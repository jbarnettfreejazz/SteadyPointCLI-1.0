import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import ScoreRing from '../components/ScoreRing';
import { sessionInsight } from '../utils/sessionStats';
import { startSimilarSession } from '../services/sessionLogic';

export default function SessionDetailScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  const s = state.selectedSession;

  if (!s) {
    navigation.navigate('sessionHistory');
    return null;
  }

  const guide = s.guideSource ? s.guideSource.charAt(0).toUpperCase() + s.guideSource.slice(1) : 'No guide';
  const act = s.activityType ? s.activityType.charAt(0).toUpperCase() + s.activityType.slice(1) : '';
  const sound = s.feedbackType === 'both' || s.feedbackType === 'audio' ? 'Sound on' : 'No sound';
  const tags = [act, `${s.duration} min`, sound, guide];

  const stats = [
    { label: 'REDUCTION', val: `${s.reduction}%`, sub: 'tremor intensity', hi: true },
    { label: 'DURATION', val: `${s.duration} min`, sub: 'session length', hi: false },
    { label: 'DOMINANT FREQ', val: `${typeof s.freq === 'number' ? s.freq.toFixed(1) : s.freq} Hz`, sub: 'peak signal', hi: false },
    { label: 'INTENSITY SHIFT', val: `${s.startLevel}→${s.endLevel}`, sub: 'start vs end', hi: false },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={() => navigation.navigate('sessionHistory')} style={styles.backRow} hitSlop={8}>
          <Text style={{ color: c.tx2, fontSize: 18, marginRight: 6 }}>←</Text>
          <Text style={{ color: c.tx2, fontSize: 13 }}>Session History</Text>
        </Pressable>

        <Text style={{ fontSize: 12, color: c.tx3, marginBottom: 2 }}>
          {s.date} · {s.time}
        </Text>
        <Text style={[styles.h1, { color: c.tx1 }]}>{s.label}</Text>

        <View style={styles.tagRow}>
          {tags.map((t) => (
            <View key={t} style={[styles.tagPill, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
              <Text style={{ fontSize: 11, color: c.tx2 }}>{t}</Text>
            </View>
          ))}
        </View>

        <View style={styles.ringWrap}>
          <ScoreRing
            size={128}
            strokeWidth={7}
            score={s.score || 0}
            color={c.info}
            trackColor={c.bd3}
            centerLabel={s.score != null ? s.score : '—'}
            subLabel="STEADYPOINT"
            textColor={c.tx1}
            subTextColor={c.tx3}
          />
        </View>

        <View style={styles.statsGrid}>
          {stats.map((st) => (
            <View key={st.label} style={styles.statWrap}>
              <View style={[styles.statBox, { backgroundColor: c.bg2 }]}>
                <Text style={{ fontSize: 10, color: c.tx3, letterSpacing: 0.5, marginBottom: 4 }}>{st.label}</Text>
                <Text style={{ fontSize: 20, fontWeight: '500', color: st.hi ? c.success : c.tx1, marginBottom: 2 }}>
                  {st.val}
                </Text>
                <Text style={{ fontSize: 11, color: c.tx3 }}>{st.sub}</Text>
              </View>
            </View>
          ))}
        </View>

        {!!s.note && (
          <View style={[styles.noteBox, { backgroundColor: c.bg2 }]}>
            <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: c.tx3, marginBottom: 6 }}>NOTE</Text>
            <Text style={{ fontSize: 13, color: c.tx1, lineHeight: 20 }}>{s.note}</Text>
          </View>
        )}

        <View style={[styles.insightBox, { backgroundColor: c.bgInfo, borderColor: c.bdInfo }]}>
          <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 20 }}>{sessionInsight(s.reduction)}</Text>
        </View>

        {s.fullScaleG != null && (
          <Text style={{ fontSize: 11, color: c.tx3, textAlign: 'center', marginBottom: 16 }}>
            Calibrated to {s.fullScaleG}g full-scale
          </Text>
        )}

        <Pressable
          onPress={() => startSimilarSession({ state, actions, navigation, session: s })}
          style={[styles.primaryButton, { backgroundColor: c.tx1 }]}>
          <Text style={{ color: c.bg1, fontWeight: '700' }}>Start similar session</Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('sessionHistory')}
          style={[styles.secondaryButton, { backgroundColor: c.bg2, borderColor: c.bd2 }]}>
          <Text style={{ color: c.tx1, fontWeight: '700' }}>Back to history</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 18, paddingBottom: 40 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  h1: { fontSize: 20, fontWeight: '500', marginBottom: 12 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20 },
  tagPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, marginRight: 4, marginBottom: 4 },
  ringWrap: { alignItems: 'center', marginBottom: 24 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginBottom: 16 },
  statWrap: { width: '50%', padding: 5 },
  statBox: { borderRadius: radii.lg, padding: 12 },
  insightBox: { borderLeftWidth: 2, padding: 14, borderRadius: radii.md, marginBottom: 20 },
  noteBox: { padding: 14, borderRadius: radii.md, marginBottom: 20 },
  primaryButton: { paddingVertical: 15, borderRadius: radii.xl, alignItems: 'center', marginBottom: 10 },
  secondaryButton: { paddingVertical: 15, borderRadius: radii.xl, alignItems: 'center', borderWidth: 1 },
});
