import React from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../utils/theme';
import { useStore } from '../state/StoreContext';
import { applyCalibrationDuringSession } from '../services/sessionLogic';
import CalibrationEditor from '../components/CalibrationEditor';

// ══════════════════════════════════════════════════════
// Edit Calibration Settings during a continuous session (FIFTY-SEVENTH
// follow-up: a stack screen instead of a <Modal> on the Recording screen).
//
// Android, old architecture, RN 0.81: the Modal's content was laid out as
// tall as everything in it rather than the window, so the ScrollView had
// nothing to scroll and Cancel / Save sat below the screen until the
// keyboard opened (which resized the dialog window and corrected the
// layout). The same editor on a normal screen (Settings > Calibration) was
// fine, so the session editor is now a normal screen too, pushed over
// Recording — which stays mounted underneath, exactly as under Summary, so
// the session (recording, sound, keep-awake, the session service) carries
// on while you edit. RootNavigator presents it with presentation: 'modal':
// a page sheet on iOS (as before), a full screen on Android. Back /
// swipe-down / Cancel return to the session.
//
// Save: same as the Thirty-sixth follow-up's dialog — saved as the app's
// calibration (calibrationSource 'manual') and applied to the running
// session right away.
// ══════════════════════════════════════════════════════

export default function SessionCalibrationScreen() {
  const c = useTheme();
  const navigation = useNavigation();
  const { state, actions } = useStore();

  const close = () => {
    if (navigation.canGoBack?.()) navigation.goBack();
  };

  const handleSave = (patch) => {
    actions.updateSettings({ ...patch, calibrationSource: 'manual', calibrationSetAt: new Date().toISOString() });
    applyCalibrationDuringSession(patch);
    close();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <Text style={{ fontSize: 20, fontWeight: '600', color: c.tx1, marginBottom: 4 }}>Calibration</Text>
        <Text style={{ fontSize: 13, color: c.tx2, lineHeight: 19, marginBottom: 8 }}>
          Changes apply to this session right away and are saved as your calibration settings. The session keeps
          recording while you edit.
        </Text>
        <CalibrationEditor
          settings={state.settings}
          onSave={handleSave}
          onCancel={close}
          c={c}
          context="session"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 40 },
});
