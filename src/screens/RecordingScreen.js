import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Dimensions, Switch, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { useLiveSession } from '../state/useLiveSession';
import { orbSize, orbRGB, fmt } from '../utils/dsp';
import { endSession, applyCalibrationDuringSession, noteFeedbackType, pitchRangeFor } from '../services/sessionLogic';
import { onSessionPersisted } from '../services/sessionCheckpoint';
import CalibrationEditor from '../components/CalibrationEditor';
import TremorMap from '../components/TremorMap';
import { setAudioHook, getLiveState } from '../state/liveSession';
import * as audioService from '../services/audio';
import { playGuideTrack, stopGuideTrack } from '../services/guideTrackPlayer';
import Sparkline from '../components/Sparkline';
import { useKeepAwake } from '@sayem314/react-native-keep-awake';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SPARK_CARD_WIDTH = SCREEN_WIDTH * 0.9;
const SPARK_WIDTH = SPARK_CARD_WIDTH - 24; // minus sparkCard's horizontal padding (12 each side)

// FORTY-SEVENTH follow-up: g value next to the intensity %, e.g. ".70g"
// (3 decimals below 0.1 g, e.g. ".045g").
function formatG(g) {
  const v = typeof g === 'number' && isFinite(g) && g > 0 ? g : 0;
  return `${v.toFixed(v < 0.1 ? 3 : 2).replace(/^0(?=\.)/, '')}g`;
}

export default function RecordingScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();
  const live = useLiveSession();

  // Without this, iOS locks the screen after its normal auto-lock timeout
  // (commonly 5 min), which suspends the app and stops all JS execution —
  // including the BLE packet/metrics processing loop — even though the
  // BLE connection itself stays alive at the native level. That's what
  // made a long session appear to "pause": data kept flowing over
  // Bluetooth, but nothing was left running to process or record it.
  useKeepAwake();

  const audioEnabled = state.config.feedbackType === 'audio' || state.config.feedbackType === 'both';
  const hasGuideTrack = state.guideMediaSource === 'phone' && !!state.guideMediaPath;

  // Mirrors the original's initAudio()-on-start / silenceAudio() on end.
  // Unlike the original (and unlike an earlier version of this port), we
  // deliberately do NOT destroy/recreate the AudioContext between sessions.
  // React Navigation keeps this screen mounted underneath Summary (so
  // unmount-based cleanup doesn't fire right when a session ends — endSession()
  // in sessionLogic.js calls silenceAudio() directly for that), and closing +
  // rebuilding a fresh native AudioContext back-to-back was unreliable on
  // this library's current version (session 2 audio would silently fail).
  // Building the graph once and just muting/unmuting it via gain sidesteps both.
  //
  // FIFTEENTH follow-up: this effect also re-runs whenever the in-session
  // sonification toggle flips (audioEnabled is its dependency). Toggling
  // OFF runs the cleanup below -> silenceAudio(), which since the
  // THIRTEENTH follow-up also hard-mutes masterGain — but that mute was
  // only ever undone by startSession(), so toggling back ON re-registered
  // the hook while masterGain stayed at 0: silent for the rest of the
  // session. Fix: unmuteAudio() here too. Guarded on isRecording so this
  // can never re-enable audio after End Session (RecordingScreen stays
  // mounted under Summary) — on first mount startSession() has already
  // set isRecording via beginSessionBuffers() before navigating here.
  useEffect(() => {
    if (!audioEnabled) return undefined;
    if (!getLiveState().isRecording) return undefined;
    audioService.initAudio(); // idempotent — no-ops if already built
    audioService.unmuteAudio();
    audioService.resumeAudio(); // EIGHTEENTH follow-up: un-pause the engine silenceAudio() suspended
    setAudioHook((rx, ry, rz, level, sr, freqWin, pitchFreqHz) =>
      audioService.updateAudio(rx, ry, rz, level, sr, freqWin, pitchFreqHz),
    );
    return () => {
      audioService.silenceAudio();
      setAudioHook(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioEnabled]);

  // Guide-track (background music/guidance file) playback — independent of
  // the sonification above, using react-native-sound rather than the
  // AudioContext (see guideTrackPlayer.js for why). Mirrors the original's
  // auto-play-on-session-start behavior for the guide <audio> element.
  useEffect(() => {
    if (!hasGuideTrack) return undefined;
    playGuideTrack(state.guideMediaPath);
    return () => stopGuideTrack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGuideTrack, state.guideMediaPath]);

  const isContinuous = !state.config.duration;
  const total = isContinuous ? 0 : state.config.duration * 60;
  const remaining = isContinuous ? 0 : Math.max(0, total - live.elapsed);
  const progress = isContinuous ? 0 : Math.min(1, live.elapsed / total);

  const diam = orbSize(live.displayLevel, SCREEN_WIDTH);
  const [r, g, b] = orbRGB(live.displayLevel);
  const orbColor = `rgb(${r},${g},${b})`;

  const severityColor =
    live.liveSev === 'None'
      ? c.success
      : live.liveSev === 'Mild'
      ? c.info
      : live.liveSev === 'Moderate'
      ? c.warning
      : c.danger;

  // THIRTY-SIXTH follow-up: keep the session record's sound setting in step
  // with the sonification switch (continuous sessions).
  useEffect(() => {
    noteFeedbackType(state.config.feedbackType);
  }, [state.config.feedbackType]);

  // THIRTY-SIXTH follow-up: "Edit Calibration Settings" during a continuous
  // session. Saving applies the values to this session right away and saves
  // them as the app's calibration (same as Settings > Calibration).
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const handleCalibrationSave = (patch) => {
    actions.updateSettings({ ...patch, calibrationSource: 'manual', calibrationSetAt: new Date().toISOString() });
    applyCalibrationDuringSession(patch);
    setCalibrationOpen(false);
  };

  // FORTY-FIFTH follow-up: in "Pitch follows: Frequency" mode, the number
  // under the ring shows the frequency that actually drives the pitch
  // (liveSession pitchFreqHz — the tremorPeakFrequency() reading), with a
  // bar showing where it sits between the lowest note (band minimum) and
  // the highest (band maximum). Since the FORTY-NINTH follow-up the same
  // text and bar also show in Intensity mode (labelled just "frequency").
  const pitchByFrequency = state.settings.sonificationMode === 'frequency';
  // At rest (no reading, sound faded out) the readout clears to "—" and the
  // marker disappears, so the screen matches the silence.
  //
  // FORTY-SEVENTH follow-up: the text says whether the tremor is in the
  // band (the pitch range — the tremor band, or 3–14 Hz with band
  // filtering off), using actualFreqHz, the strongest frequency in all
  // motion:
  //   in the band      → "in-band 4.7 Hz"
  //   outside the band → "actual: 3.5 Hz, in-band: --"
  //   actual and in-band differ → "actual: 3.5 Hz, in-band: 4.1 Hz"
  //                      (see FORTY-EIGHTH follow-up below)
  // The marker shows the in-band frequency, and is hidden when there's none.
  const pitchRange = pitchRangeFor(state.settings);
  const inRange = (f) => f >= pitchRange.minHz - 0.05 && f <= pitchRange.maxHz + 0.05;
  const actualFreq = typeof live.actualFreqHz === 'number' ? live.actualFreqHz : null;
  const pitchFreq = typeof live.pitchFreqHz === 'number' && inRange(live.pitchFreqHz) ? live.pitchFreqHz : null;
  const actualInBand = actualFreq != null && inRange(actualFreq);
  const inBandFreq = actualInBand ? pitchFreq ?? actualFreq : pitchFreq;
  // FORTY-EIGHTH follow-up: "actual" is shown whenever it differs from the
  // in-band reading (as displayed, to 0.1 Hz) — also when both are in the
  // band — not only when the actual frequency is outside the band.
  //
  // FIFTIETH follow-up: the frequency text now sits under the tremor map
  // (components/TremorMap.js), which replaces the bar, and adds the g and,
  // with band filtering on, how far the actual frequency is from the band:
  //   same   → "in-band 4.7 Hz (.12g)"
  //   differ → "actual: 3.5 Hz (.20g) · 0.5 Hz below band"
  //            "in-band: --"   or   "in-band: 4.1 Hz (.012g)"
  // plus "· silent above upper limit" while the upper limit mutes the sound.
  const fmtHz = (f) => f.toFixed(1);
  const bandOn =
    !!state.settings.bandFilterEnabled && state.settings.tremorBandMaxHz > state.settings.tremorBandMinHz;
  const showBoth = actualFreq != null && (inBandFreq == null || fmtHz(actualFreq) !== fmtHz(inBandFreq));
  const ceilingNote = live.mutedReason === 'ceiling' ? ' · silent above upper limit' : '';
  let actualLine = null;
  let inBandLine = '—';
  if (showBoth) {
    let away = '';
    if (bandOn && actualFreq < state.settings.tremorBandMinHz) {
      away = ` · ${fmtHz(state.settings.tremorBandMinHz - actualFreq)} Hz below band`;
    } else if (bandOn && actualFreq > state.settings.tremorBandMaxHz) {
      away = ` · ${fmtHz(actualFreq - state.settings.tremorBandMaxHz)} Hz above band`;
    }
    actualLine = `actual: ${fmtHz(actualFreq)} Hz (${formatG(live.liveRmsAllG)})${away}`;
    inBandLine = `in-band: ${inBandFreq != null ? `${fmtHz(inBandFreq)} Hz (${formatG(live.liveRmsG)})` : '--'}${
      inBandFreq != null ? ceilingNote : ''
    }`;
  } else if (inBandFreq != null) {
    inBandLine = `in-band ${fmtHz(inBandFreq)} Hz (${formatG(live.liveRmsG)})${ceilingNote}`;
  }
  const mapWindow = {
    bandOn,
    minHz: state.settings.tremorBandMinHz ?? 3,
    maxHz: state.settings.tremorBandMaxHz ?? 14,
    noiseFloorG: typeof state.settings.noiseFloorG === 'number' ? state.settings.noiseFloorG : 0.006,
    fullScaleG: typeof state.settings.fullScaleG === 'number' ? state.settings.fullScaleG : 0.35,
    ceilingG: typeof state.settings.intensityCeilingG === 'number' && state.settings.intensityCeilingG > 0 ? state.settings.intensityCeilingG : null,
  };
  const mapNow = {
    af: actualFreq,
    ag: live.liveRmsAllG,
    pf: typeof live.pitchFreqHz === 'number' ? live.pitchFreqHz : null,
    pg: live.liveRmsG,
  };

  const handleEnd = () => {
    endSession({ state, actions, navigation, secs: live.elapsed, byTimer: false });
  };

  // Connectivity guard — if the M5Stick is powered off or drops out of range
  // mid-session, useBLE's onDisconnected handler flips state.isConnected to
  // false, but nothing was watching for that here: the session just kept
  // running with a frozen last-known intensity reading. This effect watches
  // for a true->false transition while this screen is mounted (i.e. a
  // session is actually in progress) and force-ends the session rather than
  // leaving it to run forever on stale data — especially important for
  // Continuous Sessions, which have no timer to eventually stop them.
  const wasConnectedRef = useRef(state.isConnected);
  useEffect(() => {
    if (wasConnectedRef.current && !state.isConnected) {
      endSession({ state, actions, navigation, secs: live.elapsed, byTimer: false, disconnected: true });
    }
    wasConnectedRef.current = state.isConnected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isConnected]);

  // Auto-persist once a session lands in allSessions (endSession dispatches
  // asynchronously, so we save from an effect rather than right after calling it).
  // THIRTY-SIXTH follow-up: watches the list itself, not just its length — a
  // continued session's end updates its existing record. Once saved, a
  // finished session's checkpoint is removed.
  const firstRenderRef = useRef(true);
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    if (state.allSessions.length > 0) {
      persistSaveLatest(state).then(() => onSessionPersisted());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.allSessions]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <View style={styles.topBar}>
        <Text style={{ color: c.tx2, fontSize: 13 }}>{fmt(live.elapsed)}</Text>
        {!isContinuous && <Text style={{ color: c.tx2, fontSize: 13 }}>-{fmt(remaining)}</Text>}
      </View>

      {!isContinuous && (
        <View style={[styles.progressTrack, { backgroundColor: c.bg3 }]}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: c.tx1 }]} />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.orbWrap}>
          <View
            style={[
              styles.ring,
              {
                width: diam + 72,
                height: diam + 72,
                borderRadius: (diam + 72) / 2,
                borderColor: `rgba(${r},${g},${b},0.18)`,
              },
            ]}
          />
          <View
            style={[
              styles.ring,
              {
                width: diam + 44,
                height: diam + 44,
                borderRadius: (diam + 44) / 2,
                borderColor: `rgba(${r},${g},${b},0.32)`,
              },
            ]}
          />
          <View style={[styles.orb, { width: diam, height: diam, borderRadius: diam / 2, backgroundColor: orbColor }]}>
            <Text style={styles.orbNum}>{live.displayLevel}</Text>
          </View>
        </View>

        <View style={styles.sevRow}>
          <Text style={[styles.sevLabel, { color: severityColor }]}>{live.liveSev}</Text>
          <Text style={{ color: c.tx3, fontSize: 12 }}>
            {live.displayLevel}% ({formatG(live.displayG)}) intensity
          </Text>
        </View>

        {isContinuous && (
          <View style={[styles.soundToggleRow, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
            <Text style={{ color: c.tx1, fontSize: 14, fontWeight: '500' }}>Sonification</Text>
            <Switch
              value={audioEnabled}
              onValueChange={(on) => actions.updateConfig({ feedbackType: on ? 'both' : 'visual' })}
              trackColor={{ false: c.bd2, true: c.info }}
            />
          </View>
        )}

        {isContinuous && (
          <Pressable
            onPress={() => setCalibrationOpen(true)}
            style={[styles.calibrationButton, { backgroundColor: c.bg2, borderColor: c.bd3 }]}
            accessibilityRole="button">
            <Text style={{ color: c.info, fontSize: 14, fontWeight: '600' }}>Edit Calibration Settings</Text>
          </Pressable>
        )}

        {/* FIFTIETH follow-up: tremor map (both modes, with or without
            sound) — the settings box, the in-band and actual readings, and
            the last minute's trail — with the numbers underneath. */}
        <View style={styles.mapWrap}>
          <TremorMap trail={live.mapTrail || []} current={mapNow} window={mapWindow} c={c} />
          {actualLine && (
            <Text style={{ color: c.tx1, fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 6 }}>{actualLine}</Text>
          )}
          <Text style={{ color: c.tx1, fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: actualLine ? 2 : 6 }}>
            {inBandLine}
          </Text>
          {pitchByFrequency && (
            <Text style={{ color: c.tx3, fontSize: 11, textAlign: 'center' }}>pitch follows the in-band frequency</Text>
          )}
        </View>

        <View style={styles.axisRow}>
          {[
            ['X', live.liveXpct],
            ['Y', live.liveYpct],
            ['Z', live.liveZpct],
          ].map(([axis, pct]) => (
            <View key={axis} style={styles.axisItem}>
              <Text style={{ color: c.tx3, fontSize: 11, marginBottom: 4 }}>{axis}</Text>
              <View style={[styles.axisTrack, { backgroundColor: c.bg3 }]}>
                <View style={[styles.axisFill, { width: `${pct}%`, backgroundColor: c.tx2 }]} />
              </View>
              <Text style={{ color: c.tx3, fontSize: 11, marginTop: 4 }}>{pct}%</Text>
            </View>
          ))}
        </View>

        {live.recentX.length < 8 ? (
          <Text style={{ color: c.tx3, fontSize: 12, marginTop: 16 }}>Waiting for device data…</Text>
        ) : (
          <View style={[styles.sparkCard, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
            <View style={styles.sparkHeaderRow}>
              <Text style={{ color: c.tx3, fontSize: 11 }}>X · Y · Z waveforms</Text>
              <Text style={{ color: severityColor, fontSize: 12, fontWeight: '600' }}>{live.liveSev}</Text>
            </View>
            <View style={styles.legendRow}>
              <LegendDot color={c.danger} label="X" textColor={c.tx3} />
              <LegendDot color={c.info} label="Y" textColor={c.tx3} />
              <LegendDot color={c.success} label="Z" textColor={c.tx3} />
            </View>
            <Sparkline
              dataX={live.dispX}
              dataY={live.dispY}
              dataZ={live.dispZ}
              width={SPARK_WIDTH}
              height={44}
              colors={c}
            />
          </View>
        )}

        <Pressable
          onPress={handleEnd}
          style={[styles.endButton, { backgroundColor: c.bg2, borderColor: c.bd2 }]}>
          <Text style={{ color: c.tx1, fontWeight: '700' }}>End Session</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={calibrationOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCalibrationOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: c.bg1 }}>
          <ScrollView
            contentContainerStyle={styles.modalScroll}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets>
            <Text style={{ fontSize: 20, fontWeight: '600', color: c.tx1, marginBottom: 4 }}>Calibration</Text>
            <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 19, marginBottom: 8 }}>
              Changes apply to this session right away and are saved as your calibration settings. The session keeps
              recording while you edit.
            </Text>
            {calibrationOpen && (
              <CalibrationEditor
                settings={state.settings}
                onSave={handleCalibrationSave}
                onCancel={() => setCalibrationOpen(false)}
                c={c}
                context="session"
              />
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function LegendDot({ color, label, textColor }) {
  return (
    <View style={styles.legendDotWrap}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={{ color: textColor, fontSize: 10 }}>{label}</Text>
    </View>
  );
}

// Deferred import to avoid a circular-import edge case between
// sessionLogic.js and persistence.js during the initial save trigger.
function persistSaveLatest(state) {
  const { persistSave } = require('../services/persistence');
  return persistSave(state);
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', paddingTop: 12 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingHorizontal: 20 },
  progressTrack: { width: '90%', height: 3, borderRadius: 2, marginTop: 8, marginBottom: 8, overflow: 'hidden' },
  progressFill: { height: '100%' },
  scroll: { flexGrow: 1, alignItems: 'center', paddingBottom: 28, width: '100%' },
  orbWrap: { alignItems: 'center', justifyContent: 'center', height: 260 },
  ring: { position: 'absolute', borderWidth: 1 },
  orb: { alignItems: 'center', justifyContent: 'center' },
  orbNum: { color: '#fff', fontSize: 32, fontWeight: '700' },
  sevRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  soundToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '90%',
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  calibrationButton: {
    width: '90%',
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  modalScroll: { padding: 20, paddingBottom: 40 },
  mapWrap: { width: '94%', marginTop: 10 },
  sevLabel: { fontSize: 18, fontWeight: '700' },
  axisRow: { flexDirection: 'row', gap: 16, marginTop: 24, width: '80%' },
  axisItem: { flex: 1, alignItems: 'center' },
  axisTrack: { width: '100%', height: 6, borderRadius: 3, overflow: 'hidden' },
  axisFill: { height: '100%' },
  sparkCard: { width: '90%', marginTop: 24, padding: 12, borderRadius: radii.lg, borderWidth: 1 },
  sparkHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  legendDotWrap: { flexDirection: 'row', alignItems: 'center', marginRight: 12 },
  legendDot: { width: 10, height: 2, borderRadius: 1, marginRight: 4 },
  endButton: {
    marginTop: 24,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: radii.xl,
    borderWidth: 1,
  },
});
