import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../utils/theme';

export default function PlaceholderScreen({ title, note }) {
  const c = useTheme();
  const navigation = useNavigation();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg1 }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: c.tx1 }]}>{title}</Text>
        <Text style={[styles.note, { color: c.tx2 }]}>
          {note || 'This screen is coming in a later build phase.'}
        </Text>
        <Pressable
          onPress={() => navigation.navigate('home')}
          style={[styles.button, { backgroundColor: c.bg2, borderColor: c.bd2 }]}>
          <Text style={{ color: c.tx1, fontWeight: '600' }}>Back to Home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  note: { fontSize: 14, textAlign: 'center' },
  button: { marginTop: 16, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1 },
});
