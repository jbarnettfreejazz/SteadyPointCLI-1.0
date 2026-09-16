import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { useBLE } from '../services/useBLE';

// Calibration Mode Screen 0 (Calibration_Mode_Design.pdf, Section 2) —
// shown only on first launch, before any measurement features are
// reachable. There is deliberately no "skip" option: the only action is
// "Calibrate Now", leading into CalibrationScreen.js. The wording is
// careful not to frame this as one-time setup — the app can recalibrate
// again later from Settings if tremors change.
//
// Connection UI added here after real testing surfaced a gap: a
// first-launch user has no other way to reach the device-connect button
// (it normally lives on Home, which this mandatory flow blocks access
// to) — so "Calibrate Now" would lead into a flow with no way to
// actually connect. Reuses the exact same useBLE()/state.isConnected
// pattern as HomeScreen's own connect row, for consistency.
export default function CalibrationWelcomeScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state } = useStore();
  const { connect, disconnect } = useBLE();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <View style={styles.content}>
        <View style={[styles.iconWrap, { backgroundColor: c.info }]}>
          <View style={styles.iconInner} />
        </View>

        <Text style={[styles.title, { color: c.tx1 }]}>Welcome to Steady Point</Text>
        <Text style={[styles.subtitle, { color: c.tx3 }]}>Steady Point measures your tremors and tracks them over time.</Text>

        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <Text style={[styles.cardTitle, { color: c.tx1 }]}>Connect your device</Text>
          <Text style={[styles.cardBody, { color: c.tx2, marginBottom: 14 }]}>
            Calibration needs a live connection to your M5Stick to measure your tremor.
          </Text>
          <View style={styles.connectRow}>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: state.isConnected ? c.success : c.tx3 }]} />
              <Text style={{ color: c.tx2, fontSize: 13 }}>
                {state.isConnected
                  ? `${state.connectedDeviceName || 'Device'} connected`
                  : state.bleConnecting
                  ? 'Connecting…'
                  : 'Not connected'}
              </Text>
            </View>
            <Pressable
              onPress={state.isConnected ? disconnect : connect}
              disabled={state.bleConnecting}
              style={[styles.connectButton, { borderColor: c.info }]}>
              <Text style={{ color: c.info, fontWeight: '600', fontSize: 13 }}>
                {state.isConnected ? 'Disconnect' : 'Connect'}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
          <Text style={[styles.cardTitle, { color: c.tx1 }]}>Let's calibrate to you first</Text>
          <Text style={[styles.cardBody, { color: c.tx2 }]}>
            Every reading Steady Point gives you is measured against your own personal scale — not a generic
            default. Before your first measurement, we need a quick calibration so your "level 100" and tremor
            frequency range are based on your tremors. You can recalibrate again at any point later from Settings
            if your tremors change.
          </Text>
        </View>

        <Text style={[styles.note, { color: c.info }]}>
          This takes less than a minute. You won't be able to start a measurement session until it's complete.
        </Text>
      </View>

      <View style={styles.footer}>
        <Pressable
          disabled={!state.isConnected}
          onPress={() => navigation.navigate('calibration', { fromWelcome: true })}
          style={[styles.button, { backgroundColor: state.isConnected ? c.info : c.bg3 }]}>
          <Text style={[styles.buttonText, { color: state.isConnected ? '#fff' : c.tx3 }]}>Calibrate Now</Text>
        </Pressable>
        <Text style={[styles.footerNote, { color: c.tx3 }]}>
          {state.isConnected ? 'Required before your first measurement' : 'Connect your device to continue'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between' },
  content: { padding: 24, alignItems: 'center', flexGrow: 1, justifyContent: 'center' },
  iconWrap: { width: 64, height: 64, borderRadius: radii.lg, marginBottom: 20, alignItems: 'center', justifyContent: 'center' },
  iconInner: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 6, textAlign: 'center' },
  subtitle: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
  card: { borderRadius: radii.lg, borderWidth: 1, padding: 18, width: '100%', marginBottom: 14 },
  cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  cardBody: { fontSize: 13, lineHeight: 20, textAlign: 'center' },
  connectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  connectButton: { borderWidth: 1.5, borderRadius: radii.lg, paddingHorizontal: 16, paddingVertical: 8 },
  note: { fontSize: 12, textAlign: 'center', marginTop: 6, paddingHorizontal: 12 },
  footer: { padding: 24 },
  button: { borderRadius: radii.lg, paddingVertical: 16, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  footerNote: { fontSize: 11, textAlign: 'center', marginTop: 10 },
});
