import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { useLiveSession } from '../state/useLiveSession';
import { orbSize, orbRGB, fmt } from '../utils/dsp';
import { endSession } from '../services/sessionLogic';
import { setAudioHook } from '../state/liveSession';
import * as audioService from '../services/audio';
import { playGuideTrack, stopGuideTrack } from '../services/guideTrackPlayer';
import Sparkline from '../components/Sparkline';
import { useKeepAwake } from '@sayem314/react-native-keep-awake';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SPARK_CARD_WIDTH = SCREEN_WIDTH * 0.9;
const SPARK_WIDTH = SPARK_CARD_WIDTH - 24; // minus sparkCard's horizontal padding (12 each side)

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

  // Per-axis mute toggles — local to this screen (resets fresh every new
  // session, since this screen remounts for each one) but the actual
  // muting takes effect in audio.js immediately, independent of the
  // update cadence. See setVoiceMuted() there for why it lives there.
  const [mutedVoices, setMutedVoices] = useState({ cello: false, viola: false, violin: false });
  const toggleMute = (voice) => {
    setMutedVoices((prev) => {
      const next = { ...prev, [voice]: !prev[voice] };
      audioService.setVoiceMuted(voice, next[voice]);
      return next;
    });
  };

  // Mirrors the original's initAudio()-on-start / silenceAudio() on end.
  // Unlike the original (and unlike an earlier version of this port), we
  // deliberately do NOT destroy/recreate the AudioContext between sessions.
  // React Navigation keeps this screen mounted underneath Summary (so
  // unmount-based cleanup doesn't fire right when a session ends — endSession()
  // in sessionLogic.js calls silenceAudio() directly for that), and closing +
  // rebuilding a fresh native AudioContext back-to-back was unreliable on
  // this library's current version (session 2 audio would silently fail).
  // Building the graph once and just muting/unmuting it via gain sidesteps both.
  useEffect(() => {
    if (!audioEnabled) return undefined;
    audioService.initAudio(); // idempotent — no-ops if already built
    setAudioHook((rx, ry, rz) => audioService.updateAudio(rx, ry, rz));
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

  const total = state.config.duration * 60;
  const remaining = Math.max(0, total - live.elapsed);
  const progress = Math.min(1, live.elapsed / total);

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

  const handleEnd = () => {
    endSession({ state, actions, navigation, secs: live.elapsed, byTimer: false });
  };

  // Auto-persist once a session lands in allSessions (endSession dispatches
  // asynchronously, so we save from an effect rather than right after calling it).
  useEffect(() => {
    if (state.allSessions.length > 0) {
      persistSaveLatest(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.allSessions.length]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <View style={styles.topBar}>
        <Text style={{ color: c.tx2, fontSize: 13 }}>{fmt(live.elapsed)}</Text>
        <Text style={{ color: c.tx2, fontSize: 13 }}>-{fmt(remaining)}</Text>
      </View>

      <View style={[styles.progressTrack, { backgroundColor: c.bg3 }]}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: c.tx1 }]} />
      </View>

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
          <Text style={{ color: c.tx3, fontSize: 12 }}>{live.displayLevel}% intensity</Text>
        </View>

        <Text style={{ color: c.tx2, fontSize: 13, marginTop: 4, textAlign: 'center' }}>
          {live.liveFreqHz > 0 ? `${live.liveFreqHz.toFixed(1)} Hz` : '—'}
        </Text>

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

        {audioEnabled && (
          <View style={[styles.muteCard, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
            <Text style={{ color: c.tx3, fontSize: 11, marginBottom: 10 }}>SOUND — TAP TO MUTE</Text>
            <View style={styles.muteRow}>
              {[
                ['cello', 'X', 'Cello', c.danger],
                ['viola', 'Y', 'Viola', c.info],
                ['violin', 'Z', 'Violin', c.success],
              ].map(([voice, axis, label, color]) => {
                const isMuted = mutedVoices[voice];
                return (
                  <Pressable
                    key={voice}
                    onPress={() => toggleMute(voice)}
                    style={[
                      styles.muteButton,
                      { backgroundColor: isMuted ? c.bg3 : `${color}22`, borderColor: isMuted ? c.bd2 : color },
                    ]}>
                    <View style={[styles.muteDot, { backgroundColor: isMuted ? c.tx3 : color }]} />
                    <Text style={{ color: isMuted ? c.tx3 : c.tx1, fontWeight: '600', fontSize: 14 }}>{label}</Text>
                    <Text style={{ color: c.tx3, fontSize: 10, marginTop: 1 }}>{axis} axis</Text>
                    <Text style={{ color: isMuted ? c.tx3 : color, fontSize: 11, fontWeight: '600', marginTop: 4 }}>
                      {isMuted ? 'Muted' : 'On'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <Pressable
          onPress={handleEnd}
          style={[styles.endButton, { backgroundColor: c.bg2, borderColor: c.bd2 }]}>
          <Text style={{ color: c.tx1, fontWeight: '700' }}>End Session</Text>
        </Pressable>
      </ScrollView>
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
  persistSave(state);
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
  sevLabel: { fontSize: 18, fontWeight: '700' },
  axisRow: { flexDirection: 'row', gap: 16, marginTop: 24, width: '80%' },
  axisItem: { flex: 1, alignItems: 'center' },
  axisTrack: { width: '100%', height: 6, borderRadius: 3, overflow: 'hidden' },
  axisFill: { height: '100%' },
  sparkCard: { width: '90%', marginTop: 24, padding: 12, borderRadius: radii.lg, borderWidth: 1 },
  muteCard: { width: '90%', marginTop: 20, padding: 14, borderRadius: radii.lg, borderWidth: 1 },
  muteRow: { flexDirection: 'row', gap: 10 },
  muteButton: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 72,
    justifyContent: 'center',
  },
  muteDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 6 },
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
