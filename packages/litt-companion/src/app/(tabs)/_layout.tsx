import React from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';

export default function TabsLayout() {
  const TabsComp = Tabs as any;

  return (
    <TabsComp
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#818cf8',
        tabBarInactiveTintColor: '#64748b',
        tabBarStyle: {
          backgroundColor: '#07070e',
          borderTopColor: '#1e293b',
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'LiTT',
          tabBarIcon: ({ color }: { color: any }) => (
            <Text style={{ color: color as string, fontSize: 18, fontWeight: 'bold' }}>💬</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="studio"
        options={{
          title: 'Studio',
          tabBarIcon: ({ color }: { color: any }) => (
            <Text style={{ color: color as string, fontSize: 18, fontWeight: 'bold' }}>🛠</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="voice"
        options={{
          title: 'Voice',
          tabBarIcon: ({ color }: { color: any }) => (
            <Text style={{ color: color as string, fontSize: 20, fontWeight: 'bold' }}>🎙️</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: ({ color }: { color: any }) => (
            <Text style={{ color: color as string, fontSize: 18, fontWeight: 'bold' }}>🔔</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'You',
          tabBarIcon: ({ color }: { color: any }) => (
            <Text style={{ color: color as string, fontSize: 18, fontWeight: 'bold' }}>👤</Text>
          ),
        }}
      />
    </TabsComp>
  );
}
