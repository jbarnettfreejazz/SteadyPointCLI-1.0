import React, { useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useKeepAwake } from '@sayem314/react-native-keep-awake';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { useLiveSession } from '../state/useLiveSession';
import * as live from '../state/liveSession';
import { rmsOf, createSustainedPeakTracker, detectSustainedFrequencyBand } from '../utils/dsp';
import { sendCommand } from '../services/ble';

// Calibration Mode Screens 1 (Setup), 2 (Active Calibration — building to
// peak) and 2b (peak confirmed) — see Calibration_Mode_Design.pdf.
// Combined as internal phases of one screen since they share the same
// live BLE recording context and the transition between them is simple.
export default function CalibrationScreen({ route }) {
  const c = useTheme();
  const navigation = useNavigation();
  const { state } = useStore();
  const liveState = useLiveSession();
  const fromWelcome = route?.params?.fromWelcome === true;

  const [phase, setPhase] = useState('setup'); // 'setup' | 'active'
  const [meterState, setMeterState] = useState({ runningPeak: 0, currentRms: 0, sustainedSeconds: 0, reached: false });
  const trackerRef = useRef(null);
  const pollRef = useRef(null);

  // Keeps the screen awake for the duration of active recording, same
  // reasoning as RecordingScreen — iOS locking the screen would suspend
  // the JS loop polling for the sustained peak.
  useKeepAwake();

  useEffect(() => {
    return () => {
      // Cleanup on unmount (back navigation, etc.) — don't leave a
      // recording running or a poll timer active in the background.
      if (pollRef.current) clearInterval(pollRef.current);
      if (live.getLiveState().isRecording) {
        live.stopRecordingBuffers();
        sendCommand('STOP');
      }
    };
  }, []);

  const startActive = () => {
    trackerRef.current = createSustainedPeakTracker();
    setMeterState({ runningPeak: 0, currentRms: 0, sustainedSeconds: 0, reached: false });
    live.beginSessionBuffers();
    sendCommand('START');
    setPhase('active');

    pollRef.current = setInterval(() => {
      const s = live.getLiveState();
      if (s.recentX.length < 8) return;
      const rms = rmsOf(s.recentX, s.recentY, s.recentZ);
      const result = trackerRef.current.update(rms, Date.now());
      setMeterState(result);
    }, 300);
  };

  const handleLevelReached = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    const { buffer } = live.stopRecordingBuffers();
    sendCommand('STOP');
    const fullScaleG = meterState.runningPeak;
    const band = detectSustainedFrequencyBand(buffer);

    navigation.replace('calibrationResults', {
      fullScaleG,
      // Derived per the design doc: measured min - 1Hz / measured max + 1Hz,
      // buffering the band so it doesn't clip the edges of the user's real
      // tremor range due to measurement noise. Falls back to the current
      // settings' band if nothing sustained was detected (e.g. too short
      // or too gentle a recording) rather than saving something empty.
      tremorBandMinHz: band ? Math.max(0.5, band.minHz - 1) : state.settings.tremorBandMinHz,
      tremorBandMaxHz: band ? band.maxHz + 1 : state.settings.tremorBandMaxHz,
      measuredBand: band,
      fromWelcome,
    });
  };

  if (!state.isConnected) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
        <View style={styles.centerMessage}>
          <Text style={[styles.title, { color: c.tx1 }]}>Connect your device first</Text>
          <Text style={[styles.subtitle, { color: c.tx3 }]}>
            Calibration needs a live connection to your M5Stick to measure your tremor.
          </Text>
          <Pressable onPress={() => navigation.goBack()} style={[styles.secondaryButton, { borderColor: c.bd2 }]}>
            <Text style={{ color: c.tx1, fontWeight: '600' }}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'setup') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[styles.eyebrow, { color: c.tx3 }]}>CALIBRATION MODE</Text>
          <View style={[styles.iconWrap, { backgroundColor: c.info }]} />
          <Text style={[styles.title, { color: c.tx1 }]}>Place the sensor{'\n'}near your tremor</Text>
          <Text style={[styles.subtitle, { color: c.tx3 }]}>
            Secure it close to the source of your tremors — for example in its sleeve on your wrist, or wherever
            you normally position it.
          </Text>

          <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
            <Text style={[styles.cardTitle, { color: c.tx1 }]}>When should I recalibrate?</Text>
            <Text style={[styles.bullet, { color: c.tx2 }]}>
              • You've started (or changed the dose of) a medication that affects your tremors — your "level 100"
              may be different now
            </Text>
            <Text style={[styles.bullet, { color: c.tx2 }]}>• Your tremors feel noticeably stronger lately</Text>
            <Text style={[styles.bullet, { color: c.tx2 }]}>• It's been several months since your last calibration</Text>
          </View>

          <View style={[styles.warningCard, { backgroundColor: c.bgWarning, borderColor: c.bd3 }]}>
            <Text style={[styles.warningText, { color: c.tx1 }]}>
              <Text style={{ fontWeight: '700' }}>Recalibrating to weaker tremors has a tradeoff: </Text>
              past sessions with stronger tremors than your new level 100 will all show as just "100," losing the
              detail that told them apart. If you're tracking a medication trial, it's usually best to wait until
              the trial ends before recalibrating downward, so all of your readings stay comparable on the same
              scale.
            </Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable onPress={startActive} style={[styles.button, { backgroundColor: c.info }]}>
            <Text style={styles.buttonText}>Go</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // phase === 'active'
  // Current intensity relative to the peak found so far — confirmed via
  // user testing the old version (a flat 100% the moment any signal
  // existed) wasn't a meaningful live reading at all.
  const meterPct = meterState.runningPeak > 0 ? Math.min(100, (meterState.currentRms / meterState.runningPeak) * 100) : 0;
  const sustainPct = Math.min(100, (meterState.sustainedSeconds / 5) * 100);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.eyebrow, { color: c.tx3 }]}>CALIBRATION MODE</Text>
        <Text style={[styles.title, { color: c.tx1 }]}>Find your biggest tremor</Text>

        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <Text style={[styles.cardTitle, { color: c.tx1 }]}>Try these, one at a time:</Text>
          <Text style={[styles.bullet, { color: c.tx2 }]}>• Tense or clench the affected area</Text>
          <Text style={[styles.bullet, { color: c.tx2 }]}>• Reach or extend it fully</Text>
          <Text style={[styles.bullet, { color: c.tx2 }]}>• Hold it against light resistance</Text>
          <Text style={[styles.bullet, { color: c.tx2 }]}>• Hold a fixed posture</Text>

          <View style={[styles.warningCard, { backgroundColor: c.bgWarning, borderColor: c.bd3, marginTop: 12 }]}>
            <Text style={[styles.warningText, { color: c.tx1 }]}>
              Keep movements brief (under half a second) — don't swing the limb or move around. We're measuring
              the tremor itself, not the motion.
            </Text>
          </View>
        </View>

        <View style={styles.meterRow}>
          <Text style={{ color: c.tx2, fontSize: 13 }}>Current intensity</Text>
          <Text style={{ color: meterState.reached ? c.success : c.warning, fontSize: 13, fontWeight: '600' }}>
            {meterState.reached ? 'Peak held' : 'Building peak…'}
          </Text>
        </View>
        <View style={[styles.track, { backgroundColor: c.bg3 }]}>
          <View style={[styles.fill, { width: `${meterPct}%`, backgroundColor: meterState.reached ? c.success : c.warning }]} />
        </View>

        <View style={[styles.meterRow, { marginTop: 18 }]}>
          <Text style={{ color: c.tx2, fontSize: 13 }}>Sustained at peak</Text>
          <Text style={{ color: c.tx2, fontSize: 13 }}>{meterState.sustainedSeconds.toFixed(1)}s / 5.0s</Text>
        </View>
        <View style={[styles.track, { backgroundColor: c.bg3 }]}>
          <View style={[styles.fill, { width: `${sustainPct}%`, backgroundColor: c.success }]} />
        </View>

        <Text style={{ color: c.tx3, fontSize: 11, textAlign: 'center', marginTop: 16 }}>
          This same recording is also being used to read your tremor's frequency — no extra step needed.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          disabled={!meterState.reached}
          onPress={handleLevelReached}
          style={[styles.button, { backgroundColor: meterState.reached ? c.success : c.bg3 }]}>
          <Text style={[styles.buttonText, { color: meterState.reached ? '#fff' : c.tx3 }]}>100 Level Reached</Text>
        </Pressable>
        {!meterState.reached && (
          <Text style={[styles.footerNote, { color: c.tx3 }]}>Hold your peak a little longer to unlock this</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between' },
  scroll: { padding: 20, alignItems: 'center' },
  centerMessage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginBottom: 12, alignSelf: 'center' },
  iconWrap: { width: 56, height: 56, borderRadius: radii.lg, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 13, textAlign: 'center', marginBottom: 20, lineHeight: 19 },
  card: { borderRadius: radii.lg, borderWidth: 1, padding: 16, width: '100%', marginBottom: 14 },
  cardTitle: { fontSize: 14, fontWeight: '600', marginBottom: 10 },
  bullet: { fontSize: 13, lineHeight: 20, marginBottom: 4 },
  warningCard: { borderRadius: radii.md, borderWidth: 1, padding: 12, width: '100%' },
  warningText: { fontSize: 12, lineHeight: 18 },
  meterRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginBottom: 6 },
  track: { width: '100%', height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  footer: { padding: 20 },
  button: { borderRadius: radii.lg, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: { borderRadius: radii.lg, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 24, marginTop: 16 },
  footerNote: { fontSize: 11, textAlign: 'center', marginTop: 8 },
});
