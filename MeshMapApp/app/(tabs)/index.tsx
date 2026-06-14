import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Switch } from 'react-native';
import { useSharedMesh } from '../../src/context/MeshContext';
import { Battery, Activity, Navigation2, Network } from 'lucide-react-native';
import { BlurView } from 'expo-blur';

// Signal strength → color
function signalColor(rssi: number | undefined) {
  if (rssi === undefined) return '#818CF8';
  if (rssi > -75) return '#10B981'; // strong: green
  if (rssi > -88) return '#F59E0B'; // medium: amber
  return '#EF4444';                 // weak: red
}

export default function DashboardScreen() {
  const { 
    nodes, 
    permissionsGranted, 
    permissionError, 
    messages,
    sendMessage,
    username,
    setUsername,
    longRange,
    setLongRange,
    myLocation
  } = useSharedMesh();

  const [msgInput, setMsgInput] = React.useState('');
  const chatScrollRef = React.useRef<ScrollView>(null);

  // Debug: verify nodes are reaching the UI from shared context
  React.useEffect(() => {
    console.warn(`[DASHBOARD] nodes.length=${nodes.length} permissionsGranted=${permissionsGranted}`);
  }, [nodes.length, permissionsGranted]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Mesh Network</Text>
          <Text style={styles.subtitle}>{nodes.length} Active Hiker{nodes.length !== 1 ? 's' : ''}</Text>
        </View>

        <BlurView intensity={20} tint="dark" style={styles.usernameCard}>
          <View style={styles.usernameHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.usernameLabel}>My Mesh Username</Text>
              <TextInput
                style={styles.usernameInput}
                value={username}
                onChangeText={(val) => setUsername(val.substring(0, 12).replace(/\s/g, '_'))}
                placeholder="Change name..."
                placeholderTextColor="#64748B"
                maxLength={12}
              />
            </View>
            {myLocation && (
              <View style={styles.myCoordsCol}>
                <Text style={styles.myCoordsLabel}>My GPS Coords</Text>
                <Text style={styles.myCoordsVal}>
                  {myLocation[1].toFixed(5)}°, {myLocation[0].toFixed(5)}°
                </Text>
              </View>
            )}
          </View>
        </BlurView>

        <BlurView intensity={20} tint="dark" style={styles.settingsCard}>
          <View style={styles.settingsHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingsTitle}>Long Range Bluetooth</Text>
              <Text style={styles.settingsDesc}>Uses Coded PHY (LE Coded) to boost connection range (requires hardware support).</Text>
            </View>
            <Switch
              value={longRange}
              onValueChange={setLongRange}
              trackColor={{ false: '#1E293B', true: '#0369A1' }}
              thumbColor={longRange ? '#38BDF8' : '#64748B'}
            />
          </View>
        </BlurView>

        {!permissionsGranted && (
          <View style={styles.warningBanner}>
            <Text style={styles.warningText}>
              {permissionError || 'Permissions required for hardware BLE tracking. Using simulated data.'}
            </Text>
          </View>
        )}

        {nodes.length === 0 && permissionsGranted && (
          <View style={styles.emptyState}>
            <Activity size={40} color="#38BDF8" style={{ marginBottom: 12, opacity: 0.5 }} />
            <Text style={styles.emptyStateTitle}>Scanning...</Text>
            <Text style={styles.emptyStateDesc}>Waiting for nearby MeshMap hikers.</Text>
          </View>
        )}

        {nodes.map(node => (
          <BlurView intensity={20} tint="dark" style={styles.card} key={node.id}>
            <View style={styles.cardHeader}>
              <View style={styles.nodeIdentity}>
                <View style={styles.nodeAvatar}>
                  <Text style={styles.nodeAvatarText}>{node.name.substring(0, 2).toUpperCase()}</Text>
                </View>
                <Text style={styles.nodeName}>{node.name}</Text>
              </View>
              <View style={styles.batteryContainer}>
                <Battery size={20} color={node.battery > 20 ? '#10B981' : '#EF4444'} />
                <Text style={styles.batteryText}>{node.battery}%</Text>
              </View>
            </View>

            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Activity size={20} color={signalColor(node.rssi)} style={styles.statIcon} />
                <Text style={styles.statLabel}>Signal (RSSI)</Text>
                <Text style={[styles.statValue, { color: signalColor(node.rssi) }]}>{node.rssi} dBm</Text>
              </View>
              
              <View style={styles.statBox}>
                <Navigation2 size={20} color="#818CF8" style={styles.statIcon} />
                <Text style={styles.statLabel}>Distance</Text>
                <Text style={styles.statValue}>{node.distance} m</Text>
              </View>

              <View style={styles.statBox}>
                <Network size={20} color="#F59E0B" style={styles.statIcon} />
                <Text style={styles.statLabel}>Routing Hops</Text>
                <Text style={styles.statValue}>{node.hops}</Text>
              </View>
            </View>

            <View style={styles.coordsContainer}>
              <Text style={styles.coordsLabel}>Hiker Location</Text>
              <Text style={styles.coordsValue}>
                {node.coordinates ? `${node.coordinates[1].toFixed(5)}°, ${node.coordinates[0].toFixed(5)}°` : 'Resolving GPS...'}
              </Text>
            </View>
          </BlurView>
        ))}

        <View style={styles.chatSection}>
          <Text style={styles.sectionTitle}>Offline Mesh Chat</Text>
          <BlurView intensity={20} tint="dark" style={styles.chatCard}>
            <ScrollView 
              ref={chatScrollRef}
              style={styles.chatLogs} 
              nestedScrollEnabled={true}
              contentContainerStyle={styles.chatLogsContent}
              onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
            >
              {messages.length === 0 ? (
                <Text style={styles.noMessagesText}>No messages broadcasted yet.</Text>
              ) : (
                messages.map(msg => {
                  const isMe = msg.sender === 'You';
                  return (
                    <View key={msg.id} style={[styles.bubbleContainer, isMe ? styles.bubbleRight : styles.bubbleLeft]}>
                      <Text style={styles.bubbleSender}>{msg.sender}</Text>
                      <View style={[styles.bubble, isMe ? styles.myBubble : styles.peerBubble]}>
                        <Text style={styles.bubbleText}>{msg.text}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>

            <View style={styles.quickTemplatesRow}>
              {['Safe ✅', 'SOS 🚨', 'Delayed ⏳', 'Camp set ⛺'].map(tmpl => (
                <TouchableOpacity 
                  key={tmpl}
                  style={styles.templateBtn}
                  onPress={() => sendMessage(tmpl)}
                >
                  <Text style={styles.templateBtnText}>{tmpl}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                value={msgInput}
                onChangeText={setMsgInput}
                placeholder="Type message (max 12 chars)..."
                placeholderTextColor="#64748B"
                maxLength={12}
              />
              <TouchableOpacity 
                style={styles.sendBtn}
                onPress={() => {
                  if (msgInput.trim()) {
                    sendMessage(msgInput.trim());
                    setMsgInput('');
                  }
                }}
              >
                <Text style={styles.sendBtnText}>Send</Text>
              </TouchableOpacity>
            </View>
          </BlurView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 16,
    color: '#aaa',
    marginTop: 4,
  },
  warningBanner: {
    backgroundColor: 'rgba(255, 165, 0, 0.2)',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 165, 0, 0.5)',
  },
  warningText: {
    color: '#ffa500',
    fontSize: 14,
    textAlign: 'center',
  },
  card: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
    backgroundColor: 'rgba(30, 41, 59, 0.4)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  nodeIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nodeAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#38BDF8',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  nodeAvatarText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 18,
  },
  nodeName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  batteryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  batteryText: {
    color: '#F8FAFC',
    marginLeft: 6,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    padding: 12,
    borderRadius: 16,
    flex: 1,
    marginHorizontal: 4,
  },
  statIcon: {
    marginBottom: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    marginTop: 20,
    backgroundColor: 'rgba(30, 41, 59, 0.4)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  emptyStateTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  emptyStateDesc: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
  },
  logsContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    height: 150,
  },
  logsTitle: {
    color: '#38BDF8',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  logsScroll: {
    flex: 1,
  },
  logText: {
    color: '#10B981',
    fontFamily: 'monospace',
    fontSize: 11,
    marginBottom: 4,
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
  rssiText: {
    fontSize: 12,
    color: '#94A3B8',
    marginRight: 12,
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
  usernameCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(30, 41, 59, 0.2)',
    overflow: 'hidden',
  },
  usernameLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  usernameInput: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 8,
    padding: 10,
    color: '#F8FAFC',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  chatSection: {
    marginBottom: 20,
  },
  chatCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(30, 41, 59, 0.3)',
    overflow: 'hidden',
    padding: 16,
  },
  chatLogs: {
    height: 180,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  chatLogsContent: {
    paddingBottom: 10,
  },
  noMessagesText: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 70,
    fontStyle: 'italic',
  },
  bubbleContainer: {
    marginBottom: 10,
    maxWidth: '80%',
  },
  bubbleLeft: {
    alignSelf: 'flex-start',
  },
  bubbleRight: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  bubbleSender: {
    fontSize: 10,
    color: '#94A3B8',
    marginBottom: 2,
    marginLeft: 4,
    marginRight: 4,
    fontWeight: '600',
  },
  bubble: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  myBubble: {
    backgroundColor: '#38BDF8',
  },
  peerBubble: {
    backgroundColor: '#334155',
  },
  bubbleText: {
    fontSize: 14,
    color: '#F8FAFC',
  },
  quickTemplatesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  templateBtn: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 6,
  },
  templateBtnText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chatInput: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 10,
    padding: 10,
    color: '#F8FAFC',
    marginRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  sendBtn: {
    backgroundColor: '#38BDF8',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnText: {
    color: '#0F172A',
    fontWeight: 'bold',
    fontSize: 14,
  },
  usernameHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  myCoordsCol: {
    marginLeft: 16,
    alignItems: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  myCoordsLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  myCoordsVal: {
    color: '#38BDF8',
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: 'bold',
  },
  coordsContainer: {
    marginTop: 15,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  coordsLabel: {
    color: '#94A3B8',
    fontSize: 12,
  },
  coordsValue: {
    color: '#10B981',
    fontSize: 13,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  settingsCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    backgroundColor: 'rgba(30, 41, 59, 0.2)',
    overflow: 'hidden',
  },
  settingsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingsTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  settingsDesc: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 16,
    paddingRight: 16,
  },
});
