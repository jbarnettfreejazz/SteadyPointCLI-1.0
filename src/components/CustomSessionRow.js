import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { radii } from '../utils/theme';
import { describeCustomSession } from '../utils/customSessions';
import { BrainIcon, BookIcon, WalkIcon } from './TabIcons';

// Activity icon and colours — the same pairings as Home's Quick Start rows
// (Meditating = brain/blue, Reading = book/green, Taking a Walk = walk/orange).
const ACTIVITY_ICONS = {
  meditative: { Icon: BrainIcon, iconBg: 'bgInfo', iconColor: 'info' },
  engaged: { Icon: BookIcon, iconBg: 'bgSuccess', iconColor: 'success' },
  active: { Icon: WalkIcon, iconBg: 'bgWarning', iconColor: 'warning' },
};

// One custom session: activity icon on the left (as on Quick Start), tap the
// body or the blue "Start →" to start it, ✎ to edit, ✕ to delete.
// Used by Home's "CUSTOM SESSIONS" section and the Custom Sessions screen,
// so both always look and behave the same.
//
// TWENTY-FIFTH follow-up: the card now uses Quick Start's neutral style
// (bg2 / bd3) instead of the light-blue fill — the Meditative icon's
// light-blue box was invisible against it. The blue session name and
// "Start →" still mark it as a custom session.
export default function CustomSessionRow({ session, c, onStart, onEdit, onDelete }) {
  const { Icon, iconBg, iconColor } = ACTIVITY_ICONS[session.activityType] || ACTIVITY_ICONS.meditative;
  return (
    <View style={[styles.row, { backgroundColor: c.bg2, borderColor: c.bd3 }]}>
      <Pressable style={styles.main} onPress={onStart} accessibilityRole="button" accessibilityLabel={`Start ${session.name}`}>
        <View style={[styles.iconBox, { backgroundColor: c[iconBg] }]}>
          <Icon color={c[iconColor]} size={20} />
        </View>
        <View style={styles.text}>
          <Text style={{ fontSize: 14, color: c.info, fontWeight: '600', marginBottom: 2 }} numberOfLines={1}>
            {session.name}
          </Text>
          <Text style={{ color: c.tx3, fontSize: 11 }}>{describeCustomSession(session)}</Text>
        </View>
      </Pressable>
      <Pressable onPress={onStart} hitSlop={6} style={styles.startLink} accessibilityRole="button" accessibilityLabel={`Start ${session.name}`}>
        <Text style={{ fontSize: 12, fontWeight: '500', color: c.info }}>Start →</Text>
      </Pressable>
      <View style={styles.actions}>
        <Pressable onPress={onEdit} hitSlop={8} style={styles.iconButton} accessibilityLabel={`Edit ${session.name}`}>
          <Text style={{ color: c.tx2, fontSize: 14 }}>✎</Text>
        </Pressable>
        <Pressable onPress={onDelete} hitSlop={8} style={styles.iconButton} accessibilityLabel={`Delete ${session.name}`}>
          <Text style={{ color: c.tx3, fontSize: 14 }}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Sizes match Home's Quick Start rows (quickRow / quickIconBox).
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 8 },
  iconBox: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0 },
  startLink: { paddingHorizontal: 4, paddingVertical: 6, marginRight: 4 },
  actions: { flexDirection: 'row' },
  iconButton: { padding: 6, marginLeft: 2 },
});
