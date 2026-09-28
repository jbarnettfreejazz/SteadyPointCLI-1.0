import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, radii } from '../utils/theme';

// Shown when RecordingScreen's connectivity guard detects the BLE
// connection to the M5Stick dropped mid-session (see the useEffect watching
// state.isConnected there, and the `disconnected: true` path through
// endSession() in sessionLogic.js). The session that was running has
// already been ended and persisted with endReason: 'disconnected' by the
// time this screen is reached, so there's nothing to recover here — this
// is purely informational, with a single way out.
export default function DisconnectedScreen() {
  const c = useTheme();
  const navigation = useNavigation();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: c.bgDanger }]}>
          <Text style={{ fontSize: 36 }}>⚠️</Text>
        </View>

        <Text style={[styles.headline, { color: c.tx1 }]}>Disconnected from device</Text>

        <Text style={[styles.body, { color: c.tx2 }]}>
          The app lost its Bluetooth connection to your M5Stick partway through the session. The session was ended
          and saved automatically — you can see what was recorded before the connection dropped in Session History.
        </Text>

        <Text style={[styles.hint, { color: c.tx3 }]}>
          Make sure the device is powered on and within range, then reconnect from the Home screen to start a new
          session.
        </Text>

        <Pressable
          onPress={() => navigation.navigate('home')}
          style={[styles.button, { backgroundColor: c.tx1 }]}>
          <Text style={{ color: c.bg1, fontWeight: '700' }}>Return to Home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  headline: { fontSize: 20, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 14 },
  hint: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginBottom: 30 },
  button: { width: '100%', paddingVertical: 15, borderRadius: radii.xl, alignItems: 'center' },
});
