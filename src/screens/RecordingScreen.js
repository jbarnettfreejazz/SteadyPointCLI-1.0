import React, { useCallback, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Dimensions, Switch, BackHandler, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { useLiveSession } from '../state/useLiveSession';
import { orbSize, orbRGB, fmt } from '../utils/dsp';
import { describeReading, readingWindow, sessionViewOf } from '../utils/sessionReading';
import { endSession, noteFeedbackType } from '../services/sessionLogic';
import { onSessionPersisted } from '../services/sessionCheckpoint';
import TremorMap, { TremorMapLegend } from '../components/TremorMap';
import { setAudioHook, getLiveState } from '../state/liveSession';
import * as audioService from '../services/audio';
import { playGuideTrack, stopGuideTrack } from '../services/guideTrackPlayer';
import Sparkline from '../components/Sparkline';
import { useKeepAwake } from '@sayem314/react-native-keep-awake';
import { go } from '../navigation/go';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
// SIXTY-SECOND follow-up: cards span the screen less the page padding (16
// each side); the waveform sits inside the card's padding (12 each side).
const PAGE_PAD = 16;
const SPARK_WIDTH = SCREEN_WIDTH - PAGE_PAD * 2 - 24 - 2;
// Text that must keep its fixed height (rows under the map, the status
// line) grows with the system text size only this far — iOS Dynamic Type
// and Android "Font size" both honour it.
const FIXED_TEXT_SCALE = 1.2;

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

  // FIFTY-SECOND follow-up (Android): the system back button / back gesture
  // would pop this screen without ending the session — the recording, the
  // sound and the BLE stream carried on with no screen showing them. While
  // this screen is focused, back does nothing; End Session is the way out.
  // Focus-scoped because this screen stays mounted under Summary, where
  // back must keep working. iOS unchanged (its swipe-back is left as is).
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
      return () => sub.remove();
    }, [])
  );

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

  // THIRTY-SIXTH follow-up: keep the session record's sound setting in step
  // with the sonification switch (continuous sessions).
  useEffect(() => {
    noteFeedbackType(state.config.feedbackType);
  }, [state.config.feedbackType]);

  // THIRTY-SIXTH follow-up: "Edit Calibration Settings" during a continuous
  // session. Saving applies the values to this session right away and saves
  // them as the app's calibration (same as Settings > Calibration).
  // FIFTY-SEVENTH follow-up: the editor is now its own screen
  // (screens/SessionCalibrationScreen.js), pushed over this one.

  // SIXTY-SECOND follow-up: Simple / Advanced views. Everything shown about
  // the current reading — the circle, its label, the two rows under the
  // map, the Simple View status line and each map dot — comes from
  // describeReading() / classifyReading() in utils/sessionReading.js, so
  // the two views can never disagree. (Replaces the 45th–50th follow-ups'
  // "in-band / actual" text lines, the frequency caption and the X/Y/Z
  // percentage bars.)
  const view = sessionViewOf(state.settings);
  const setView = (v) => {
    if (v !== view) actions.updateSettings({ sessionView: v }); // saved with the settings (App.js)
  };
  const win = readingWindow(state.settings);
  const reading = describeReading(live, win);
  const mapNow = {
    af: typeof live.actualFreqHz === 'number' ? live.actualFreqHz : null,
    ag: live.liveRmsAllG,
    pf: typeof live.pitchFreqHz === 'number' ? live.pitchFreqHz : null,
    pg: live.liveRmsG,
  };
  const hasMapData = Array.isArray(live.mapTrail) && live.mapTrail.length > 0;
  const circle = circleColors(reading.circle.tone, reading.level, c);
  const labelColor = toneColor(reading.label.tone, c);

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

  const soundControls = isContinuous;
  const toggleSound = (on) => actions.updateConfig({ feedbackType: on ? 'both' : 'visual' });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <View style={styles.topBar}>
        <Text style={{ color: c.tx2, fontSize: 15 }}>{fmt(live.elapsed)}</Text>
        <Text style={{ color: c.tx2, fontSize: 15 }}>{isContinuous ? 'Continuous session' : `-${fmt(remaining)}`}</Text>
      </View>

      {!isContinuous && (
        <View style={[styles.progressTrack, { backgroundColor: c.bg3 }]}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: c.tx1 }]} />
        </View>
      )}

      {/* SIXTY-SECOND follow-up: Simple View / Advanced View, remembered
          for the next session (settings.sessionView). */}
      <View accessibilityRole="tablist" style={[styles.switchTrack, { backgroundColor: c.bg3 }]}>
        {[
          ['simple', 'Simple View'],
          ['advanced', 'Advanced View'],
        ].map(([key, text]) => {
          const on = view === key;
          return (
            <Pressable
              key={key}
              onPress={() => setView(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={[styles.switchTab, on && [styles.switchTabOn, { backgroundColor: c.bg1 }]]}>
              <Text
                style={{ fontSize: 16, fontWeight: on ? '700' : '500', color: on ? c.tx1 : c.tx2 }}
                numberOfLines={1}
                maxFontSizeMultiplier={FIXED_TEXT_SCALE}>
                {text}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {view === 'simple' ? (
        <ScrollView contentContainerStyle={styles.simpleScroll} showsVerticalScrollIndicator={false}>
          <View style={styles.simpleCenter}>
            <BigCircle reading={reading} circle={circle} live={live} />
            <Text style={[styles.simpleLabel, { color: labelColor }]} maxFontSizeMultiplier={1.4}>
              {reading.label.text}
            </Text>
            <Text style={{ color: c.tx2, fontSize: 15 }} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.4}>
              {reading.subline}
            </Text>
            <View
              style={[
                styles.statusChip,
                reading.simple ? { backgroundColor: chipColors(reading.simple.tone, c).bg } : { opacity: 0 },
              ]}>
              <Text
                style={{ fontSize: 16, fontWeight: '600', color: reading.simple ? chipColors(reading.simple.tone, c).fg : c.tx2 }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                maxFontSizeMultiplier={FIXED_TEXT_SCALE}>
                {reading.simple ? reading.simple.text : ' '}
              </Text>
            </View>
          </View>

          <View style={styles.bottomStack}>
            {soundControls && (
              <View style={[styles.soundToggleRow, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
                <Text style={{ color: c.tx1, fontSize: 16, fontWeight: '500' }}>Sonification</Text>
                <Switch value={audioEnabled} onValueChange={toggleSound} trackColor={{ false: c.bd2, true: c.info }} />
              </View>
            )}
            <Pressable onPress={handleEnd} accessibilityRole="button" style={[styles.endButton, { backgroundColor: c.bg2, borderColor: c.bd2 }]}>
              <Text style={{ color: c.tx1, fontSize: 17, fontWeight: '700' }}>End Session</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.advScroll} showsVerticalScrollIndicator={false}>
          {/* summary: small circle, label, intensity */}
          <View style={[styles.card, styles.summaryCard, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
            <View style={[styles.smallCircle, { backgroundColor: circle.bg, borderColor: circle.border || circle.bg }]}>
              <Text style={{ color: circle.fg, fontSize: reading.circle.text.length > 2 ? 18 : 22, fontWeight: '700' }} maxFontSizeMultiplier={1}>
                {reading.circle.text}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: labelColor, fontSize: 21, fontWeight: '700' }} numberOfLines={1} maxFontSizeMultiplier={FIXED_TEXT_SCALE}>
                {reading.label.text}
              </Text>
              <Text style={{ color: c.tx2, fontSize: 14 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={FIXED_TEXT_SCALE}>
                {reading.subline}
              </Text>
            </View>
          </View>

          {/* tremor map + three fixed rows */}
          <View style={[styles.card, { backgroundColor: c.bg1, borderColor: c.bd3 }]}>
            <View style={styles.cardHeader}>
              <Text style={{ color: c.tx1, fontSize: 17, fontWeight: '700' }}>Tremor map</Text>
              <Text style={{ color: c.tx2, fontSize: 13 }}>trail: last 60 s</Text>
            </View>
            <TremorMap trail={live.mapTrail || []} current={hasMapData ? mapNow : null} window={win} c={c} />
            {/* SIXTY-THIRD follow-up: frequency · g · intensity as three
                fixed-width fields, so nothing shifts as values change. */}
            <View style={styles.row1} accessible accessibilityLabel={reading.row1.text}>
              {[
                ['hz', reading.row1.hz, styles.fieldHz],
                ['s1', '·', styles.fieldSep],
                ['g', reading.row1.g, styles.fieldG],
                ['s2', '·', styles.fieldSep],
                ['lv', reading.row1.intensity, styles.fieldLevel],
              ].map(([key, text, fieldStyle]) => (
                <Text
                  key={key}
                  style={[styles.row1Field, fieldStyle, { color: toneColor(reading.row1.tone, c) }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  maxFontSizeMultiplier={FIXED_TEXT_SCALE}>
                  {text}
                </Text>
              ))}
            </View>
            <Text
              style={[styles.row2, { color: c.tx1 }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              maxFontSizeMultiplier={FIXED_TEXT_SCALE}>
              {reading.row2 || ' '}
            </Text>
            <TremorMapLegend c={c} />
          </View>

          {/* raw motion */}
          <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
            <View style={styles.cardHeader}>
              <Text style={{ color: c.tx1, fontSize: 16, fontWeight: '700' }}>Raw motion</Text>
              <View style={styles.legendRow}>
                <LegendDot color={c.danger} label="X" textColor={c.tx2} />
                <LegendDot color={c.info} label="Y" textColor={c.tx2} />
                <LegendDot color={c.success} label="Z" textColor={c.tx2} />
              </View>
            </View>
            {live.recentX.length < 8 ? (
              <Text style={{ color: c.tx2, fontSize: 13, height: 56, textAlignVertical: 'center', lineHeight: 56, textAlign: 'center' }}>
                Waiting for device data…
              </Text>
            ) : (
              <Sparkline dataX={live.dispX} dataY={live.dispY} dataZ={live.dispZ} width={SPARK_WIDTH} height={56} colors={c} />
            )}
          </View>

          {soundControls && (
            <View style={styles.buttonRow}>
              <Pressable
                onPress={() => toggleSound(!audioEnabled)}
                accessibilityRole="switch"
                accessibilityState={{ checked: audioEnabled }}
                style={[
                  styles.halfButton,
                  audioEnabled ? { backgroundColor: c.bgInfo, borderColor: c.info } : { backgroundColor: c.bg2, borderColor: c.bd3 },
                ]}>
                <Text style={{ color: audioEnabled ? c.info : c.tx1, fontSize: 16, fontWeight: '700' }} maxFontSizeMultiplier={FIXED_TEXT_SCALE}>
                  {audioEnabled ? 'Sound: On' : 'Sound: Off'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => go(navigation, 'sessionCalibration')}
                accessibilityRole="button"
                style={[styles.halfButton, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
                <Text style={{ color: c.info, fontSize: 16, fontWeight: '700' }} numberOfLines={1} maxFontSizeMultiplier={FIXED_TEXT_SCALE}>
                  Edit Calibration
                </Text>
              </Pressable>
            </View>
          )}

          <Pressable onPress={handleEnd} accessibilityRole="button" style={[styles.endButton, { backgroundColor: c.bg2, borderColor: c.bd2 }]}>
            <Text style={{ color: c.tx1, fontSize: 17, fontWeight: '700' }}>End Session</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// SIXTY-SECOND follow-up: the Simple View's large circle. Its size still
// eases with the display level (as before); colour and text follow the
// reading's state (see describeReading()).
function BigCircle({ reading, circle, live }) {
  const level = reading.kind === 'over' ? 100 : reading.kind === 'zone' || reading.kind === 'ceiling' ? live.displayLevel || 0 : 0;
  const diam = orbSize(level, SCREEN_WIDTH);
  const ring = circle.ring;
  return (
    <View style={styles.orbWrap}>
      <View style={[styles.ring, { width: diam + 72, height: diam + 72, borderRadius: (diam + 72) / 2, borderColor: `rgba(${ring},0.18)` }]} />
      <View style={[styles.ring, { width: diam + 44, height: diam + 44, borderRadius: (diam + 44) / 2, borderColor: `rgba(${ring},0.32)` }]} />
      <View
        style={[
          styles.orb,
          { width: diam, height: diam, borderRadius: diam / 2, backgroundColor: circle.bg },
          circle.border && { borderWidth: 1.5, borderColor: circle.border },
        ]}>
        <Text style={[styles.orbNum, { color: circle.fg }]} maxFontSizeMultiplier={1}>
          {reading.circle.text}
        </Text>
      </View>
    </View>
  );
}

const hexRgb = (hex) => {
  const h = String(hex).replace('#', '');
  if (h.length !== 6) return '128,128,128';
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
};

// Circle colours per state. 'level' keeps the existing green→amber shading
// by intensity; 'inverse' (out of zone) is the text colour, so it's dark in
// light mode and light in dark mode.
export function circleColors(tone, level, c) {
  if (tone === 'level') {
    const [r, g, b] = orbRGB(Math.max(0, Math.min(100, level || 0)));
    return { bg: `rgb(${r},${g},${b})`, fg: '#ffffff', ring: `${r},${g},${b}` };
  }
  if (tone === 'danger') return { bg: c.danger, fg: '#ffffff', ring: hexRgb(c.danger) };
  if (tone === 'grey') return { bg: '#6b6b6b', fg: '#ffffff', ring: '107,107,107' };
  if (tone === 'inverse') return { bg: c.tx1, fg: c.bg1, ring: hexRgb(c.tx1) };
  return { bg: c.bg3, fg: c.tx2, border: c.bd2, ring: '128,128,128' }; // 'empty' (waiting)
}

// Text colours: severity names keep their existing colours.
export function toneColor(tone, c) {
  switch (tone) {
    case 'None':
      return c.success;
    case 'Mild':
    case 'info':
      return c.info;
    case 'Moderate':
      return c.warning;
    case 'High':
    case 'danger':
      return c.danger;
    case 'tx2':
      return c.tx2;
    default:
      return c.tx1;
  }
}

function chipColors(tone, c) {
  if (tone === 'info') return { bg: c.bgInfo, fg: c.info };
  if (tone === 'danger') return { bg: c.bgDanger, fg: c.danger };
  return { bg: c.bg3, fg: c.tx1 };
}

function LegendDot({ color, label, textColor }) {
  return (
    <View style={styles.legendDotWrap}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={{ color: textColor, fontSize: 13 }}>{label}</Text>
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
  container: { flex: 1, paddingTop: 12 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: PAGE_PAD + 4 },
  progressTrack: { marginHorizontal: PAGE_PAD, height: 3, borderRadius: 2, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: '100%' },
  // SIXTY-SECOND follow-up: view switch
  switchTrack: { flexDirection: 'row', marginHorizontal: PAGE_PAD, marginTop: 12, padding: 4, borderRadius: radii.lg, gap: 4 },
  switchTab: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  switchTabOn: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  // Simple View
  simpleScroll: { flexGrow: 1, paddingHorizontal: PAGE_PAD, paddingTop: 8, paddingBottom: 28 },
  simpleCenter: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  orbWrap: { alignItems: 'center', justifyContent: 'center', height: 290, width: '100%' },
  ring: { position: 'absolute', borderWidth: 1.5 },
  orb: { alignItems: 'center', justifyContent: 'center' },
  orbNum: { fontSize: 48, fontWeight: '700' },
  simpleLabel: { fontSize: 26, fontWeight: '700' },
  statusChip: {
    marginTop: 10,
    height: 46,
    maxWidth: '100%',
    paddingHorizontal: 18,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomStack: { gap: 10 },
  soundToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 16,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  // Advanced View
  advScroll: { paddingHorizontal: PAGE_PAD, paddingTop: 12, paddingBottom: 28, gap: 12 },
  card: { borderRadius: radii.xl, borderWidth: 1, padding: 12 },
  summaryCard: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 80 },
  smallCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  row1: { flexDirection: 'row', alignItems: 'center', height: 24, marginTop: 4 },
  row1Field: { fontSize: 16, fontWeight: '700', lineHeight: 24, fontVariant: ['tabular-nums'] },
  fieldHz: { width: '27%', textAlign: 'right' },
  fieldSep: { width: '5%', textAlign: 'center' },
  fieldG: { width: '25%', textAlign: 'center' },
  fieldLevel: { width: '38%', textAlign: 'left' },
  row2: { fontSize: 14.5, textAlign: 'center', height: 21, lineHeight: 21 },
  legendRow: { flexDirection: 'row', alignItems: 'center' },
  legendDotWrap: { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 5 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  halfButton: { flex: 1, minHeight: 52, borderRadius: radii.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  endButton: { minHeight: 56, borderRadius: radii.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
