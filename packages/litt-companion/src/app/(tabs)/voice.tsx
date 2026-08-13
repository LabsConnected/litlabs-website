import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';
import { triggerHaptic } from '../../lib/haptics';

export default function VoiceScreen() {
  const handleVoicePress = async () => {
    await triggerHaptic.heavy();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Hands-Free LiTT Voice</Text>
        <Text style={styles.subtitle}>
          Phase 2 live audio streaming gateway will connect directly here.
        </Text>

        <TouchableOpacity style={styles.voiceButton} onPress={handleVoicePress}>
          <Text style={styles.voiceIcon}>🎙️</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>Tap to test haptics</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07070e',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    color: '#8a8a9e',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 40,
  },
  voiceButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#ff00a0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ff00a0',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  voiceIcon: {
    fontSize: 48,
  },
  hint: {
    color: '#6e6e82',
    fontSize: 12,
    marginTop: 16,
  },
});
