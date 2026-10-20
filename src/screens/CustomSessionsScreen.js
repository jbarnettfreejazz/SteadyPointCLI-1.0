import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { startCustomSession, loadPinnedForEdit, deletePinnedSession } from '../services/sessionLogic';
import CustomSessionRow from '../components/CustomSessionRow';
import { sortByRecentUse } from '../utils/customSessions';

// Every custom session, most recently used first — opened from Home's
// "View all (n)" link. Same rows as Home: tap to start, ✎ to edit, ✕ to
// delete. Editing opens Setup, which returns here when done.
export default function CustomSessionsScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  const sessions = useMemo(() => sortByRecentUse(state.pinnedSessions), [state.pinnedSessions]);

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('home');
  };

  const handleEdit = (id) => {
    loadPinnedForEdit(state, actions, id);
    navigation.navigate('setup');
  };

  const handleDelete = (id, name) => {
    Alert.alert('Delete custom session', `Delete "${name}"? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deletePinnedSession({ state, actions }, id) },
    ]);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Pressable onPress={handleBack} style={styles.backRow} hitSlop={8}>
          <Text style={{ color: c.tx2, fontSize: 18, marginRight: 6 }}>←</Text>
          <Text style={{ color: c.tx2, fontSize: 13 }}>Home</Text>
        </Pressable>

        <Text style={[styles.h1, { color: c.tx1 }]}>Custom Sessions</Text>
        <Text style={[styles.h2, { color: c.tx2 }]}>
          {sessions.length === 0
            ? 'No custom sessions yet'
            : `${sessions.length} saved · most recently used first`}
        </Text>

        <View style={{ gap: 8 }}>
          {sessions.map((s) => (
            <CustomSessionRow
              key={s.id}
              session={s}
              c={c}
              onStart={() => startCustomSession({ state, actions, navigation, session: s })}
              onEdit={() => handleEdit(s.id)}
              onDelete={() => handleDelete(s.id, s.name)}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 18, paddingBottom: 40 },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  h1: { fontSize: 20, fontWeight: '500', marginBottom: 4 },
  h2: { fontSize: 13, marginBottom: 20 },
});
