import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from 'react-native';
import { useClerk } from '@clerk/expo';
import { useCompanion } from '../../lib/auth-context';
import { CONFIG } from '../../lib/config';

export default function AccountScreen() {
  const { signOut } = useClerk();
  const { user, isSignedIn } = useCompanion();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Account & Settings</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.profileCard}>
          <Text style={styles.avatarText}>
            {user?.firstName ? user.firstName[0].toUpperCase() : '👤'}
          </Text>
          <Text style={styles.userName}>
            {user?.fullName || user?.primaryEmailAddress?.emailAddress || 'LiTT User'}
          </Text>
          <Text style={styles.userEmail}>
            {user?.primaryEmailAddress?.emailAddress || 'Signed in via Clerk'}
          </Text>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoLabel}>API Endpoint:</Text>
          <Text style={styles.infoValue}>{CONFIG.apiUrl}</Text>
          <Text style={styles.infoLabel}>App Version:</Text>
          <Text style={styles.infoValue}>{CONFIG.appVersion}</Text>
        </View>

        {isSignedIn && (
          <TouchableOpacity style={styles.signOutButton} onPress={() => signOut()}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07070e',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2b',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  content: {
    padding: 16,
  },
  profileCard: {
    backgroundColor: '#121224',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1e1e34',
  },
  avatarText: {
    fontSize: 36,
    marginBottom: 8,
  },
  userName: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  userEmail: {
    color: '#8a8a9e',
    fontSize: 13,
    marginTop: 2,
  },
  infoCard: {
    backgroundColor: '#121224',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#1e1e34',
  },
  infoLabel: {
    color: '#8a8a9e',
    fontSize: 12,
    marginTop: 8,
  },
  infoValue: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  signOutButton: {
    backgroundColor: 'rgba(255, 77, 77, 0.15)',
    borderWidth: 1,
    borderColor: '#ff4d4d',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  signOutText: {
    color: '#ff6b6b',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
