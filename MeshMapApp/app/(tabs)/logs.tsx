import React, { useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSharedMesh } from '../../src/context/MeshContext';
import { BlurView } from 'expo-blur';

export default function LogsScreen() {
  const { logs, unknownDevices, authorizeDevice } = useSharedMesh();
  const scrollViewRef = useRef<ScrollView>(null);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Pairing & Logs</Text>
        <Text style={styles.subtitle}>Configure mesh nodes and inspect traffic</Text>
      </View>
      
      {unknownDevices.length > 0 && (
        <View style={styles.pairingSection}>
          <Text style={styles.sectionTitle}>Discovered Devices (Tap to Pair)</Text>
          {(() => {
            // Deduplicate unknown devices by name so we don't spam rotating MACs
            const uniqueDevicesMap = new Map();
            unknownDevices.forEach(d => {
              const name = d.name || 'Unknown Device';
              // Keep the one with the strongest signal (highest RSSI)
              if (!uniqueDevicesMap.has(name) || (d.rssi && d.rssi > uniqueDevicesMap.get(name).rssi)) {
                uniqueDevicesMap.set(name, d);
              }
            });
            const uniqueDevices = Array.from(uniqueDevicesMap.values());
            return uniqueDevices.map(device => (
              <BlurView intensity={10} tint="dark" style={styles.pairingCard} key={device.name}>
                <View style={styles.pairingCardLeft}>
                  <Text style={styles.deviceName}>{device.name}</Text>
                  <Text style={styles.deviceId}>RSSI: {device.rssi !== undefined ? `${device.rssi} dBm` : 'N/A'}</Text>
                </View>
                <View style={styles.pairingCardRight}>
                  <TouchableOpacity
                    style={styles.pairButton}
                    onPress={() => authorizeDevice(device.id, device.name)}
                  >
                    <Text style={styles.pairButtonText}>Pair</Text>
                  </TouchableOpacity>
                </View>
              </BlurView>
            ));
          })()}
        </View>
      )}

      <Text style={styles.consoleTitle}>Live Traffic Terminal</Text>
      <View style={styles.consoleContainer}>
        <ScrollView 
          ref={scrollViewRef}
          contentContainerStyle={styles.consoleContent}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        >
          {logs.map((log, index) => (
            <Text 
              key={index} 
              style={[
                styles.logText, 
                log.includes('RSSI: -') && parseInt(log.split('RSSI: ')[1]) < -85 ? styles.logTextWarning : null
              ]}
            >
              {log}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    padding: 20,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#94A3B8',
  },
  consoleContainer: {
    flex: 1,
    backgroundColor: '#020617',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    overflow: 'hidden',
  },
  consoleContent: {
    padding: 16,
  },
  logText: {
    fontFamily: 'monospace',
    color: '#38BDF8',
    fontSize: 12,
    marginBottom: 8,
    lineHeight: 16,
  },
  logTextWarning: {
    color: '#EF4444',
  },
  pairingSection: {
    marginTop: 10,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#38BDF8',
    marginBottom: 12,
  },
  consoleTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#38BDF8',
    marginBottom: 12,
  },
  pairingCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(30, 41, 59, 0.3)',
    overflow: 'hidden',
  },
  pairingCardLeft: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  deviceId: {
    fontSize: 12,
    color: '#64748B',
    fontFamily: 'monospace',
  },
  pairingCardRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pairButton: {
    backgroundColor: '#38BDF8',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  pairButtonText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
