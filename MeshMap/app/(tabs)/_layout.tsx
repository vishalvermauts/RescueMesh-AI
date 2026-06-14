import { Tabs } from 'expo-router';
import { Activity, Map, List, Compass } from 'lucide-react-native';
import { MeshProvider } from '../../src/context/MeshContext';

export default function TabLayout() {
  return (
    <MeshProvider>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: '#38BDF8',
          tabBarInactiveTintColor: '#94A3B8',
          headerStyle: {
            backgroundColor: '#0F172A',
          },
          headerTintColor: '#fff',
          tabBarStyle: {
            backgroundColor: '#0F172A',
            borderTopColor: '#1E293B',
          },
          headerShown: true,
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Dashboard',
            tabBarIcon: ({ color }) => <Activity size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Map',
            tabBarIcon: ({ color }) => <Map size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="compass"
          options={{
            title: 'Radar',
            tabBarIcon: ({ color }) => <Compass size={24} color={color} />,
          }}
        />
        <Tabs.Screen
          name="logs"
          options={{
            title: 'Pairing & Logs',
            tabBarIcon: ({ color }) => <List size={24} color={color} />,
          }}
        />
      </Tabs>
    </MeshProvider>
  );
}
