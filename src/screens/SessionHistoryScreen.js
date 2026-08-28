import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { getTodaySessions, groupPastSessionsByDay, scoreColor, scoreTextColor } from '../utils/sessionStats';

export default function SessionHistoryScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  const allSessions = state.allSessions;

  const todayLive = getTodaySessions(allSessions);
  const pastGroups = groupPastSessionsByDay(allSessions);

  const openSession = (session) => {
    actions.setSelectedSession(session);
    navigation.navigate('sessionDetail');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={() => navigation.navigate('analytics')} style={styles.backRow} hitSlop={8}>
          <Text style={{ color: c.tx2, fontSize: 18, marginRight: 6 }}>←</Text>
          <Text style={{ color: c.tx2, fontSize: 13 }}>Analytics</Text>
        </Pressable>

        <Text style={[styles.h1, { color: c.tx1 }]}>Session History</Text>

        {/* Tab bar — matches the original's "This week" / "All sessions" tabs.
            Note: in the original HTML, these tabs don't actually filter the
            list below (histFilter only affects which tab looks active) —
            preserved as-is here to match the original's real behavior. */}
        <View style={[styles.tabBar, { backgroundColor: c.bg2 }]}>
          <Pressable
            onPress={() => actions.setHistFilter('week')}
            style={[styles.tab, state.histFilter === 'week' && { backgroundColor: c.bg1 }]}>
            <Text style={{ fontSize: 13, fontWeight: '500', color: state.histFilter === 'week' ? c.tx1 : c.tx3 }}>
              This week
            </Text>
          </Pressable>
          <Pressable
            onPress={() => actions.setHistFilter('all')}
            style={[styles.tab, state.histFilter === 'all' && { backgroundColor: c.bg1 }]}>
            <Text style={{ fontSize: 13, fontWeight: '500', color: state.histFilter === 'all' ? c.tx1 : c.tx3 }}>
              All sessions
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.dayLabel, { color: c.tx3 }]}>TODAY</Text>
        {todayLive.length === 0 ? (
          <Text style={{ fontSize: 13, color: c.tx3, paddingVertical: 8 }}>No sessions today yet</Text>
        ) : (
          todayLive.map((s) => <SessionRow key={s.id} s={s} c={c} onPress={() => openSession(s)} />)
        )}

        {pastGroups.map((group) => (
          <View key={group.dateKey}>
            <Text style={[styles.dayLabel, { color: c.tx3 }]}>{group.label.toUpperCase()}</Text>
            {group.sessions.map((s) => (
              <SessionRow key={s.id} s={s} c={c} onPress={() => openSession(s)} />
            ))}
          </View>
        ))}

        {todayLive.length === 0 && pastGroups.length === 0 && (
          <Text style={{ fontSize: 13, color: c.tx3, paddingVertical: 8 }}>No past sessions recorded</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SessionRow({ s, c, onPress }) {
  const guide = s.guideSource ? s.guideSource.charAt(0).toUpperCase() + s.guideSource.slice(1) : 'No guide';
  const act = s.activityType ? s.activityType.charAt(0).toUpperCase() + s.activityType.slice(1) : '';
  return (
    <Pressable onPress={onPress} style={styles.sessRow}>
      <View style={[styles.scoreBadge, { backgroundColor: scoreColor(s.score, c) }]}>
        <Text style={{ color: scoreTextColor(s.score, c), fontWeight: '600', fontSize: 14 }}>
          {s.score != null ? s.score : '—'}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '500', color: c.tx1 }}>
          {s.label}
        </Text>
        <Text style={{ fontSize: 11, color: c.tx3 }}>
          {s.time} · {s.duration} min · {act} · {guide}
        </Text>
      </View>
      <Text style={{ color: c.tx3, fontSize: 14 }}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 18, paddingBottom: 40 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  h1: { fontSize: 20, fontWeight: '500', marginBottom: 16 },
  tabBar: { flexDirection: 'row', borderRadius: radii.md, padding: 3, marginBottom: 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radii.md - 2 },
  dayLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginTop: 16, marginBottom: 6 },
  sessRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  scoreBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
