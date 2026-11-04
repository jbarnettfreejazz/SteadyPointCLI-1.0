import React from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// ══════════════════════════════════════════════════════
// ModalSafeArea — the root of a <Modal>'s content (FIFTY-SIXTH follow-up)
//
// Android, since the Fifty-fourth follow-up turned on edge-to-edge: React
// Native's Modal then always draws under the status and navigation bars,
// and a SafeAreaView inside it wasn't keeping content clear of the
// navigation bar. The Edit Calibration dialog's Cancel / Save buttons sat
// behind it, and the ScrollView couldn't scroll to them because it believed
// everything already fit (it only became scrollable once the keyboard
// opened). On Android this pads the content explicitly with the screen's
// insets from the app's root SafeAreaProvider (App.js), which are the same
// bars the modal draws under.
//
// iOS: unchanged — SafeAreaView, as before (a pageSheet modal isn't under
// the status bar, so the root insets would add a gap at the top).
// ══════════════════════════════════════════════════════

export default function ModalSafeArea({ style, children }) {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'android') {
    return <SafeAreaView style={style}>{children}</SafeAreaView>;
  }
  return (
    <View
      style={[
        style,
        { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
      ]}>
      {children}
    </View>
  );
}
