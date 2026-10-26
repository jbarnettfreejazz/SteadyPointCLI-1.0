import React, { useState, useRef, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useKeepAwake } from '@sayem314/react-native-keep-awake';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { useLiveSession } from '../state/useLiveSession';
import * as live from '../state/liveSession';
import { rmsOf, createSustainedPeakDetector, detectSustainedFrequencyBand, combinedDominantFreq } from '../utils/dsp';
import { finishReadiness, calibrationResult, MIN_CALIBRATION_SECONDS, defaultCalibrationPatch } from '../utils/calibrationWizard';
import { sendCommand } from '../services/ble';
import { logCalibration } from '../services/calibrationLogger';

// Flip to true to log calibration data: the current baseline settings
// when calibration starts, each raw RMS reading and tracker state during
// Active Calibration, and the final computed values when calibration
// completes. Logs to both the console (for local Xcode-connected
// testing) and a file via calibrationLogger.js (the only practical way
// to get this data back from a remote TestFlight tester, who has no
// Metro/debugger connection to see console.log() output) — see that
// file's own comments for why. Matches the same toggleable-flag pattern
// as SONIFICATION_DEBUG_LOGGING in audio.js.
const CALIBRATION_DEBUG_LOGGING = true;

// Calibration Mode Screens 1 (Setup), 2 (Active Calibration — building to
// peak) and 2b (peak confirmed) — see Calibration_Mode_Design.pdf.
// Combined as internal phases of one screen since they share the same
// live BLE recording context and the transition between them is simple.
export default function CalibrationScreen({ route }) {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  const liveState = useLiveSession();
  const fromWelcome = route?.params?.fromWelcome === true;

  const [phase, setPhase] = useState('setup'); // 'setup' | 'active'
  const EMPTY_METER = { currentRms: 0, elapsedSec: 0, detector: createSustainedPeakDetector().state() };
  const [meterState, setMeterState] = useState(EMPTY_METER);
  const trackerRef = useRef(null);
  const pollRef = useRef(null);
  const startedAtRef = useRef(0);

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
    if (CALIBRATION_DEBUG_LOGGING) {
      const msg =
        'baseline settings — FULL_SCALE_G=' +
        state.settings.fullScaleG +
        ' TREMOR_BAND_MIN_HZ=' +
        state.settings.tremorBandMinHz +
        ' TREMOR_BAND_MAX_HZ=' +
        state.settings.tremorBandMaxHz +
        ' NOISE_FLOOR_G=' +
        state.settings.noiseFloorG;
      console.log('[calibration]', msg);
      logCalibration(msg);
    }
    // THIRTY-NINTH follow-up: Flutter's detector (see dsp.js
    // createSustainedPeakDetector), fed the same ~2-second readings sessions
    // use, sampled every 100 ms.
    trackerRef.current = createSustainedPeakDetector();
    startedAtRef.current = Date.now();
    setMeterState(EMPTY_METER);
    live.beginSessionBuffers({ keepRawSamples: true }); // THIRTY-SIXTH follow-up: band detection needs the raw samples
    sendCommand('START');
    setPhase('active');

    // Same ~1 s warm-up as sessions before a reading counts.
    const WARMUP_SAMPLES = 50;
    let tick = 0;
    pollRef.current = setInterval(() => {
      const s = live.getLiveState();
      const now = Date.now();
      const elapsedSec = (now - startedAtRef.current) / 1000;
      if (s.recentX.length < WARMUP_SAMPLES) {
        setMeterState((prev) => ({ ...prev, elapsedSec }));
        return;
      }
      const rms = rmsOf(s.recentX, s.recentY, s.recentZ);
      const detector = trackerRef.current.addSample(now, rms);
      tick += 1;

      // Logged every third reading (~300 ms), as before.
      if (CALIBRATION_DEBUG_LOGGING && tick % 3 === 0) {
        // Live frequency reading, for visibility into what's being detected
        // as the recording progresses — purely informational; the band
        // saved by calibration comes from the batch analysis at the end.
        // Gated behind a minimum RMS (same threshold as the batch detector)
        // so noise isn't reported as a frequency.
        const MIN_RMS_FOR_LIVE_FREQ = 0.01;
        let liveFreqHz = null;
        if (rms >= MIN_RMS_FOR_LIVE_FREQ) {
          const sr = s.packetTimes.length > 1 ? s.packetTimes.length / 2 : 50;
          liveFreqHz = combinedDominantFreq(s.freqWinX, s.freqWinY, s.freqWinZ, sr, 100);
        }
        const fmtG = (v) => (v == null ? 'null' : v.toFixed(4));
        const msg =
          'rms=' +
          rms.toFixed(4) +
          ' runningPeak=' +
          fmtG(detector.runningPeakG) +
          ' bestSustained=' +
          fmtG(detector.bestSustainedG) +
          ' bestBrief=' +
          fmtG(detector.bestBriefG) +
          ' held=' +
          detector.peakWasSustained +
          ' elapsed=' +
          elapsedSec.toFixed(1) +
          ' liveFreqHz=' +
          (liveFreqHz != null ? liveFreqHz.toFixed(2) : 'null');
        console.log('[calibration]', msg);
        logCalibration(msg);
      }
      setMeterState({ currentRms: rms, elapsedSec, detector });
    }, 100);
  };

  const completeCalibration = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    const detector = trackerRef.current.state();
    const { buffer } = live.stopRecordingBuffers();
    sendCommand('STOP');
    const band = detectSustainedFrequencyBand(buffer);
    const result = calibrationResult({ fullScaleG: detector.fullScaleG, band, current: state.settings });

    if (CALIBRATION_DEBUG_LOGGING) {
      const msg =
        'final computed values — FULL_SCALE_G=' +
        result.fullScaleG.toFixed(4) +
        (result.fullScaleAdjusted ? ` (measured ${result.measuredFullScaleG.toFixed(4)}, kept within limits)` : '') +
        ' peakHeld=' +
        detector.peakWasSustained +
        ' bestSustained=' +
        (detector.bestSustainedG ?? 0).toFixed(4) +
        ' bestBrief=' +
        (detector.bestBriefG ?? 0).toFixed(4) +
        ' measuredBand=' +
        (band ? `${band.minHz.toFixed(2)}-${band.maxHz.toFixed(2)}Hz` : 'none detected') +
        ' TREMOR_BAND_MIN_HZ=' +
        result.tremorBandMinHz.toFixed(2) +
        ' TREMOR_BAND_MAX_HZ=' +
        result.tremorBandMaxHz.toFixed(2) +
        ' NOISE_FLOOR_G=' +
        state.settings.noiseFloorG +
        ' (unchanged — not measured by calibration)' +
        ' recordingSamples=' +
        buffer.length;
      console.log('[calibration]', msg);
      logCalibration(msg);
    }

    navigation.replace('calibrationResults', {
      fullScaleG: result.fullScaleG,
      measuredFullScaleG: result.measuredFullScaleG,
      fullScaleAdjusted: result.fullScaleAdjusted,
      // Measured min - 1 Hz / max + 1 Hz; kept at the current settings when
      // no sustained band was detected (band filtering then stays off).
      tremorBandMinHz: result.tremorBandMinHz,
      tremorBandMaxHz: result.tremorBandMaxHz,
      measuredBand: band,
      peakHeld: detector.peakWasSustained,
      fromWelcome,
    });
  };

  // THIRTY-NINTH follow-up: Finish is offered once there's a real tremor
  // and at least MIN_CALIBRATION_SECONDS of recording. If the strongest
  // effort was only brief, warn first.
  const handleLevelReached = () => {
    const detector = trackerRef.current.state();
    if (!finishReadiness(detector, meterState.elapsedSec).ready) return;
    if (detector.peakWasSustained) {
      completeCalibration();
      return;
    }
    Alert.alert(
      'Your strongest tremor was brief',
      'It wasn’t held for a full second, so your level 100 would be based on a brief burst and may be less accurate. ' +
        'Try holding your biggest tremor a little longer.',
      [
        { text: 'Keep calibrating', style: 'cancel' },
        { text: 'Continue anyway', onPress: completeCalibration },
      ],
    );
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
          {/* FORTIETH follow-up: first launch can skip with the default
              calibration; otherwise (Settings or Home's reminder) Cancel
              returns without changing anything. */}
          {fromWelcome ? (
            <Pressable
              onPress={() => {
                actions.updateSettings(defaultCalibrationPatch());
                navigation.reset({ index: 0, routes: [{ name: 'mainTabs' }] });
              }}
              style={[styles.footerButton, { borderColor: c.bd2 }]}
              accessibilityRole="button">
              <Text style={{ color: c.tx1, fontWeight: '600' }}>Use default values</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => navigation.goBack()}
              style={[styles.footerButton, { borderColor: c.bd2 }]}
              accessibilityRole="button">
              <Text style={{ color: c.tx1, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // phase === 'active'
  // THIRTY-NINTH follow-up display:
  //  - Current intensity: the live reading relative to the strongest so far.
  //  - Strongest effort held: the best 1-second level as a share of the best
  //    brief peak; 80% or more counts as held.
  //  - Recording: time so far, with the minimum needed before Finish.
  const d = meterState.detector;
  const readiness = finishReadiness(d, meterState.elapsedSec);
  const meterPct = d.runningPeakG > 0 ? Math.min(100, (meterState.currentRms / d.runningPeakG) * 100) : 0;
  const heldPct = d.bestSustainedG != null && d.bestBriefG ? Math.min(100, (d.bestSustainedG / d.bestBriefG) * 100) : 0;
  const heldKnown = d.bestSustainedG != null && d.bestBriefG != null;
  const recordPct = Math.min(100, (meterState.elapsedSec / MIN_CALIBRATION_SECONDS) * 100);
  const footerNote =
    readiness.reason === 'noTremor'
      ? 'No tremor detected yet — try the movements above'
      : readiness.reason === 'tooShort'
      ? `Keep going — at least ${MIN_CALIBRATION_SECONDS} seconds of recording needed`
      : !d.peakWasSustained
      ? 'Try to hold your biggest tremor for a full second'
      : 'Tap when you’ve reached your biggest tremor';

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
              the tremor itself, not the motion. Then hold your strongest tremor for at least a second: that level
              becomes your level 100.
            </Text>
          </View>
        </View>

        <View style={styles.meterRow}>
          <Text style={{ color: c.tx2, fontSize: 13 }}>Current intensity</Text>
        </View>
        <View style={[styles.track, { backgroundColor: c.bg3 }]}>
          <View style={[styles.fill, { width: `${meterPct}%`, backgroundColor: c.warning }]} />
        </View>
        <Text style={{ color: c.tx3, fontSize: 11, marginTop: 4, alignSelf: 'flex-start' }}>
          Compared with your strongest tremor so far.
        </Text>

        <View style={[styles.meterRow, { marginTop: 18 }]}>
          <Text style={{ color: c.tx2, fontSize: 13 }}>Strongest tremor held</Text>
          <Text
            style={{
              color: !heldKnown ? c.tx3 : d.peakWasSustained ? c.success : c.warning,
              fontSize: 13,
              fontWeight: '600',
            }}>
            {!heldKnown ? '—' : d.peakWasSustained ? 'Held ✓' : 'Brief'}
          </Text>
        </View>
        <View style={[styles.track, { backgroundColor: c.bg3 }]}>
          <View
            style={[styles.fill, { width: `${heldPct}%`, backgroundColor: d.peakWasSustained ? c.success : c.warning }]}
          />
        </View>
        <Text style={{ color: c.tx3, fontSize: 11, marginTop: 4, alignSelf: 'flex-start' }}>
          How much of your strongest tremor you held for a full second (80% or more counts as held).
        </Text>

        <View style={[styles.meterRow, { marginTop: 18 }]}>
          <Text style={{ color: c.tx2, fontSize: 13 }}>Recording</Text>
          <Text style={{ color: c.tx2, fontSize: 13 }}>
            {meterState.elapsedSec.toFixed(1)}s{meterState.elapsedSec < MIN_CALIBRATION_SECONDS ? ` / ${MIN_CALIBRATION_SECONDS}.0s minimum` : ''}
          </Text>
        </View>
        <View style={[styles.track, { backgroundColor: c.bg3 }]}>
          <View style={[styles.fill, { width: `${recordPct}%`, backgroundColor: c.info }]} />
        </View>

        <Text style={{ color: c.tx3, fontSize: 11, textAlign: 'center', marginTop: 16 }}>
          This same recording is also being used to read your tremor's frequency — no extra step needed.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          disabled={!readiness.ready}
          onPress={handleLevelReached}
          accessibilityRole="button"
          accessibilityState={{ disabled: !readiness.ready }}
          style={[styles.button, { backgroundColor: readiness.ready ? c.success : c.bg3 }]}>
          <Text style={[styles.buttonText, { color: readiness.ready ? '#fff' : c.tx3 }]}>100 Level Reached</Text>
        </Pressable>
        <Text style={[styles.footerNote, { color: c.tx3 }]}>{footerNote}</Text>
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
  footerButton: { borderRadius: radii.lg, borderWidth: 1, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
});
