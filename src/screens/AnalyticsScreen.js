import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import WeeklyBarChart from '../components/WeeklyBarChart';
import {
  build7DayChart,
  byActivityType,
  bySoundFeedback,
  byGuideSource,
  keyInsight,
  getTodaySessions,
  hasScore,
} from '../utils/sessionStats';

export default function AnalyticsScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state } = useStore();
  const allSessions = state.allSessions;

  const totalSess = allSessions.length;
  const totalMins = allSessions.reduce((a, s) => a + s.duration, 0);
  const scoredSessions = allSessions.filter(hasScore);
  const bestScr = scoredSessions.length > 0 ? Math.max(...scoredSessions.map((s) => s.score)) : '—';
  const avgRed =
    allSessions.length > 0
      ? `${Math.round(allSessions.reduce((a, s) => a + s.reduction, 0) / allSessions.length)}%`
      : '—';

  const days = build7DayChart(allSessions);
  const activityRows = byActivityType(allSessions);
  const feedbackRows = bySoundFeedback(allSessions);
  const guideRows = byGuideSource(allSessions);
  const insight = keyInsight(allSessions);
  const todayLive = getTodaySessions(allSessions);
  const todayScored = todayLive.filter(hasScore);
  const todayNote =
    todayLive.length > 0
      ? `${todayLive.length} session${todayLive.length !== 1 ? 's' : ''} today${
          todayScored.length > 0
            ? ` · avg ${Math.round(todayScored.reduce((a, s) => a + s.score, 0) / todayScored.length)}`
            : ''
        }`
      : 'No session today yet';
  const maxGuideAvg = guideRows.length ? Math.max(...guideRows.map((g) => g.avg || 0), 1) : 1;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.h1, { color: c.tx1 }]}>Analytics</Text>

        {/* Summary tiles */}
        <View style={styles.tileGrid}>
          <Tile label="SESSIONS" value={totalSess} sub="all time" c={c} />
          <Tile label="TOTAL MINS" value={totalMins} sub="of practice" c={c} />
          <Tile label="BEST SCORE" value={bestScr} sub="all time" c={c} valueColor={c.success} />
          <Tile label="AVG REDUCTION" value={avgRed} sub="tremor intensity" c={c} valueColor={c.info} />
        </View>

        {/* 7-day trend */}
        <View style={[styles.card, { backgroundColor: c.bg2 }]}>
          <View style={styles.rowBetween}>
            <Text style={{ fontSize: 11, color: c.tx3, letterSpacing: 0.5 }}>7-DAY SCORE TREND</Text>
            <Text style={{ fontSize: 11, color: todayLive.length > 0 ? c.info : c.tx3 }}>{todayNote}</Text>
          </View>
          <View style={{ marginTop: 14, alignItems: 'center' }}>
            <WeeklyBarChart days={days} colors={c} width={310} />
          </View>
        </View>

        {/* By activity type */}
        <SectionLabel text="BY ACTIVITY TYPE" note="avg score" c={c} />
        <View style={styles.threeCol}>
          {activityRows.map((a) => (
            <View key={a.key} style={[styles.actCard, { backgroundColor: c.bg2 }]}>
              <View style={[styles.actIconBox, { backgroundColor: c[a.bg] }]} />
              <Text style={{ fontSize: 10, color: c.tx3, letterSpacing: 0.5, marginBottom: 4 }}>
                {a.label.toUpperCase()}
              </Text>
              <Text style={{ fontSize: 22, fontWeight: '500', color: a.avg !== null ? c.tx1 : c.tx3 }}>
                {a.avg !== null ? a.avg : '—'}
              </Text>
              <Text style={{ fontSize: 10, color: c.tx3, marginTop: 3 }}>
                {a.count} session{a.count !== 1 ? 's' : ''}
              </Text>
            </View>
          ))}
        </View>

        {/* By sound feedback */}
        <SectionLabel text="BY SOUND FEEDBACK" note="avg score" c={c} />
        <View style={styles.twoCol}>
          {feedbackRows.map((f) => (
            <View key={f.label} style={[styles.actCard, { backgroundColor: c.bg2 }]}>
              <View style={styles.rowGap}>
                <Text style={{ fontSize: 11, fontWeight: '500', color: f.best ? c.info : c.tx2 }}>{f.label}</Text>
                {f.best && (
                  <View style={[styles.bestPill, { backgroundColor: c.bgInfo }]}>
                    <Text style={{ fontSize: 9, color: c.info, fontWeight: '500' }}>BEST</Text>
                  </View>
                )}
              </View>
              <Text style={{ fontSize: 22, fontWeight: '500', color: c.tx1, marginTop: 8 }}>
                {f.avg !== null ? f.avg : '—'}
              </Text>
              <Text style={{ fontSize: 10, color: c.tx3, marginTop: 3 }}>
                avg score · {f.count} session{f.count !== 1 ? 's' : ''}
              </Text>
            </View>
          ))}
        </View>

        {/* By guide source */}
        <SectionLabel text="BY GUIDE SOURCE" note="avg score" c={c} />
        <View style={[styles.card, { backgroundColor: c.bg2 }]}>
          {guideRows.length === 0 ? (
            <Text style={{ fontSize: 13, color: c.tx3 }}>No guide data yet</Text>
          ) : (
            guideRows.map((g, i) => (
              <View key={g.key} style={{ marginBottom: i === guideRows.length - 1 ? 0 : 12 }}>
                <View style={styles.rowBetween}>
                  <Text style={{ fontSize: 12, color: c.tx2 }}>{g.label}</Text>
                  <View style={styles.rowGap}>
                    <Text style={{ fontSize: 13, fontWeight: '500', color: c.tx1 }}>{g.avg !== null ? g.avg : '—'}</Text>
                    <Text style={{ fontSize: 10, color: c.tx3 }}>{g.count} sess</Text>
                  </View>
                </View>
                <View style={[styles.barTrack, { backgroundColor: c.bd3 }]}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${g.avg !== null ? Math.round((g.avg / maxGuideAvg) * 100) : 0}%`, backgroundColor: c.info },
                    ]}
                  />
                </View>
              </View>
            ))
          )}
        </View>

        {/* Key insight */}
        <View style={[styles.insightBox, { backgroundColor: c.bgInfo, borderColor: c.bdInfo }]}>
          <Text style={{ fontSize: 10, color: c.info, letterSpacing: 0.5, fontWeight: '500', marginBottom: 4 }}>
            KEY INSIGHT
          </Text>
          <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 20 }}>{insight}</Text>
        </View>

        {/* Session history nav */}
        <Pressable
          onPress={() => navigation.navigate('sessionHistory')}
          style={[styles.historyRow, { backgroundColor: c.bg2 }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: c.tx1 }}>Session history</Text>
            <Text style={{ fontSize: 11, color: c.tx2 }}>{totalSess} sessions recorded</Text>
          </View>
          <Text style={{ color: c.tx3, fontSize: 16 }}>›</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ label, value, sub, c, valueColor }) {
  return (
    <View style={styles.tileWrap}>
      <View style={[styles.tile, { backgroundColor: c.bg2 }]}>
        <Text style={{ fontSize: 10, color: c.tx3, letterSpacing: 0.5, marginBottom: 4 }}>{label}</Text>
        <Text style={{ fontSize: 22, fontWeight: '500', color: valueColor || c.tx1 }}>{value}</Text>
        <Text style={{ fontSize: 10, color: c.tx3, marginTop: 3 }}>{sub}</Text>
      </View>
    </View>
  );
}

function SectionLabel({ text, note, c }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 0.6, color: c.tx3, marginTop: 20, marginBottom: 8 }}>
      {text} <Text style={{ fontWeight: '400' }}>{note}</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 18, paddingBottom: 40 },
  h1: { fontSize: 22, fontWeight: '500', marginBottom: 18 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  tileWrap: { width: '50%', padding: 5 },
  tile: { borderRadius: radii.lg, padding: 12 },
  card: { borderRadius: radii.lg, padding: 14, marginTop: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rowGap: { flexDirection: 'row', alignItems: 'center' },
  threeCol: { flexDirection: 'row', marginHorizontal: -4 },
  twoCol: { flexDirection: 'row', marginHorizontal: -4 },
  actCard: { flex: 1, marginHorizontal: 4, borderRadius: radii.lg, padding: 12 },
  actIconBox: { width: 28, height: 28, borderRadius: 6, marginBottom: 8 },
  bestPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, marginLeft: 6 },
  barTrack: { height: 5, borderRadius: 3, overflow: 'hidden', marginTop: 4 },
  barFill: { height: '100%', borderRadius: 3 },
  insightBox: { borderLeftWidth: 2, padding: 14, borderRadius: radii.md, marginTop: 20 },
  historyRow: { flexDirection: 'row', alignItems: 'center', borderRadius: radii.lg, padding: 14, marginTop: 20 },
});
