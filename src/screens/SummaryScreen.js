import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import ScoreRing from '../components/ScoreRing';
import { persistSave } from '../services/persistence';

export default function SummaryScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  const r = state.results;
  const [note, setNote] = useState('');
  const [noteModalVisible, setNoteModalVisible] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');

  // state.scoreAnim is toggled true ~450ms after arriving here by
  // endSession() in sessionLogic.js, driving the ring's fill-in.

  if (!r) {
    navigation.navigate('home');
    return null;
  }

  const insight =
    r.reduction >= 30
      ? `Your tremor intensity fell ${r.reduction}% — a strong parasympathetic response. Consistent practice deepens this effect.`
      : r.reduction >= 15
      ? `A ${r.reduction}% reduction in tremor intensity. Your nervous system is responding. Keep building the habit.`
      : 'Early in your practice. Even small reductions train the neural pathways that lead to larger shifts over time.';

  const stats = [
    { label: 'REDUCTION', val: `${r.reduction}%`, sub: 'tremor intensity', hi: true },
    { label: 'DURATION', val: `${r.duration} min`, sub: 'session length', hi: false },
    { label: 'DOMINANT FREQ', val: `${typeof r.peakFreq === 'number' ? r.peakFreq.toFixed(1) : r.peakFreq} Hz`, sub: 'peak signal', hi: false },
    { label: 'INTENSITY SHIFT', val: `${r.startLevel}→${r.endLevel}`, sub: 'start vs end', hi: false },
  ];

  const openNoteModal = () => {
    setNoteDraft(note); // start the draft from whatever's already committed
    setNoteModalVisible(true);
  };

  const saveNoteDraft = () => {
    setNote(noteDraft.trim());
    setNoteModalVisible(false);
  };

  const cancelNoteDraft = () => {
    setNoteModalVisible(false); // discard noteDraft — committed `note` is untouched
  };

  const handleReturnHome = async () => {
    const trimmed = note.trim();
    if (trimmed && r.sessionId != null) {
      actions.updateSession(r.sessionId, { note: trimmed });
      // Compute the post-update snapshot explicitly rather than reading
      // state.allSessions again — the dispatch above hasn't been applied
      // to the store yet at this point in the function (dispatch is async).
      const nextAllSessions = state.allSessions.map((s) => (s.id === r.sessionId ? { ...s, note: trimmed } : s));
      await persistSave({ ...state, allSessions: nextAllSessions });
    }
    navigation.navigate('home');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={{ fontSize: 10, letterSpacing: 1, color: c.tx3, marginBottom: 4 }}>SESSION COMPLETE</Text>
        <Text style={[styles.headline, { color: c.tx1 }]}>
          {r.score == null ? 'Session too short to score.' : r.score >= 70 ? 'Well done.' : 'Good effort.'}
        </Text>

        <View style={styles.ringWrap}>
          <ScoreRing
            size={128}
            strokeWidth={7}
            score={state.scoreAnim ? r.score || 0 : 0}
            color={c.info}
            trackColor={c.bd3}
            centerLabel={r.score != null ? r.score : '—'}
            subLabel="STEADYPOINT"
            textColor={c.tx1}
            subTextColor={c.tx3}
          />
        </View>

        <View style={styles.statsGrid}>
          {stats.map((s) => (
            <View key={s.label} style={[styles.statBox, { backgroundColor: c.bg2 }]}>
              <Text style={{ fontSize: 10, letterSpacing: 0.5, color: c.tx3, marginBottom: 4 }}>{s.label}</Text>
              <Text style={{ fontSize: 20, fontWeight: '500', color: s.hi ? c.success : c.tx1, marginBottom: 2 }}>{s.val}</Text>
              <Text style={{ fontSize: 11, color: c.tx3 }}>{s.sub}</Text>
            </View>
          ))}
        </View>

        {r.samples > 0 && (
          <View style={[styles.samplesRow, { backgroundColor: c.bg2 }]}>
            <Text style={{ fontSize: 12, color: c.tx3 }}>
              {r.samples.toLocaleString()} samples captured · {r.duration} min
            </Text>
          </View>
        )}

        <View style={[styles.insightBox, { backgroundColor: c.bgInfo, borderColor: c.bdInfo }]}>
          <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 20 }}>{insight}</Text>
        </View>

        <Text style={[styles.label, { color: c.tx3 }]}>NOTE</Text>
        <Pressable onPress={openNoteModal} style={[styles.noteRow, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          {note ? (
            <Text numberOfLines={3} style={{ fontSize: 14, color: c.tx1, lineHeight: 20 }}>
              {note}
            </Text>
          ) : (
            <Text style={{ fontSize: 14, color: c.tx3 }}>Add context about this session (optional)</Text>
          )}
        </Pressable>

        <Pressable onPress={handleReturnHome} style={[styles.primaryButton, { backgroundColor: c.tx1 }]}>
          <Text style={{ color: c.bg1, fontWeight: '700' }}>Return to home</Text>
        </Pressable>
      </ScrollView>

      {/* Dedicated full-screen note editor — the note field previously sat
          inline near the bottom of a scrolling page, and KeyboardAvoidingView
          alone wasn't enough to keep it visible above the keyboard. Putting
          the input in its own screen with the field pinned near the TOP
          gives it room the keyboard can never reach. */}
      <Modal visible={noteModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={cancelNoteDraft}>
        <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.modalHeader}>
              <Pressable onPress={cancelNoteDraft} hitSlop={8}>
                <Text style={{ fontSize: 15, color: c.tx2 }}>Cancel</Text>
              </Pressable>
              <Text style={{ fontSize: 15, fontWeight: '600', color: c.tx1 }}>Session Note</Text>
              <Pressable onPress={saveNoteDraft} hitSlop={8}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: c.info }}>Save</Text>
              </Pressable>
            </View>
            <TextInput
              value={noteDraft}
              onChangeText={setNoteDraft}
              placeholder="Add context about this session — how you felt, what you were doing, anything worth remembering"
              placeholderTextColor={c.tx3}
              multiline
              autoFocus
              textAlignVertical="top"
              style={[styles.modalTextarea, { color: c.tx1, backgroundColor: c.bg1 }]}
            />
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40 },
  headline: { fontSize: 20, fontWeight: '500', marginBottom: 20 },
  ringWrap: { alignItems: 'center', marginBottom: 24 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  statBox: { width: '47%', borderRadius: radii.md, padding: 12 },
  samplesRow: { padding: 10, borderRadius: radii.md, marginBottom: 14, alignItems: 'center' },
  insightBox: { borderLeftWidth: 2, padding: 14, borderRadius: radii.md, marginBottom: 20 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  noteRow: { borderWidth: 1, borderRadius: radii.lg, padding: 14, minHeight: 52, justifyContent: 'center', marginBottom: 20 },
  primaryButton: { paddingVertical: 15, borderRadius: radii.xl, alignItems: 'center' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  modalTextarea: { flex: 1, padding: 18, fontSize: 16, lineHeight: 24 },
});
