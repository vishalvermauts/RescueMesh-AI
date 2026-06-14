import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { useSharedMesh } from '../../src/context/MeshContext';
import * as Location from 'expo-location';
import { BlurView } from 'expo-blur';
import { Navigation } from 'lucide-react-native';

const { width } = Dimensions.get('window');
const COMPASS_SIZE = width * 0.85;
const COMPASS_RADIUS = COMPASS_SIZE / 2;
const MAX_RADAR_DISTANCE = 500; // meters

// Haversine formula
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const dLon = toRad(lon2 - lon1);
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);

  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);

  let brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

function signalColor(rssi: number | undefined) {
  if (rssi === undefined) return '#818CF8';
  if (rssi > -75) return '#10B981'; // strong: green
  if (rssi > -88) return '#F59E0B'; // medium: amber
  return '#EF4444';                 // weak: red
}

function getHeadingString(heading: number) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(heading / 45) % 8;
  return `${Math.round(heading)}° ${dirs[index]}`;
}

export default function CompassScreen() {
  const { nodes, myLocation, permissionsGranted } = useSharedMesh();
  const [heading, setHeading] = useState<number>(0);
  const [hasHeadingSupport, setHasHeadingSupport] = useState<boolean>(true);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    
    if (permissionsGranted) {
      Location.watchHeadingAsync((data) => {
        const newHeading = (data.trueHeading !== -1 && data.trueHeading !== undefined) 
          ? data.trueHeading 
          : data.magHeading;
        setHeading(newHeading);
      }).then(sub => {
        subscription = sub;
      }).catch(err => {
        console.warn('Failed to start heading sensor:', err);
        setHasHeadingSupport(false);
      });
    }

    return () => {
      if (subscription) subscription.remove();
    };
  }, [permissionsGranted]);

  // Generate 12 ticks for the compass (every 30 degrees)
  const ticks = Array.from({ length: 12 }).map((_, i) => i * 30);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Compass</Text>
        <Text style={styles.headingText}>{hasHeadingSupport ? getHeadingString(heading) : '---°'}</Text>
      </View>

      <View style={styles.radarWrapper}>
        <BlurView intensity={20} tint="dark" style={styles.radarContainer}>
          {/* Compass Rose (Rotating) */}
          <View style={[styles.cardinalContainer, { transform: [{ rotate: `${-heading}deg` }] }]}>
            
            {/* Ticks */}
            {ticks.map(tick => (
              <View key={tick} style={[styles.tickMarker, { transform: [{ rotate: `${tick}deg` }] }]}>
                <View style={[styles.tickLine, tick % 90 === 0 ? styles.tickLineMajor : styles.tickLineMinor]} />
              </View>
            ))}

            <Text style={[styles.cardinalText, styles.northText]}>N</Text>
            <Text style={[styles.cardinalText, styles.eastText]}>E</Text>
            <Text style={[styles.cardinalText, styles.southText]}>S</Text>
            <Text style={[styles.cardinalText, styles.westText]}>W</Text>
          </View>

          {/* Radar Rings */}
          <View style={[styles.ring, { width: COMPASS_SIZE * 0.66, height: COMPASS_SIZE * 0.66 }]} />
          <View style={[styles.ring, { width: COMPASS_SIZE * 0.33, height: COMPASS_SIZE * 0.33 }]} />
          
          {/* Fixed Forward Marker */}
          <View style={styles.forwardMarker} />

          {/* Center (Me) */}
          <View style={styles.centerDot}>
            <Navigation size={16} color="#0F172A" fill="#38BDF8" style={{ transform: [{ rotate: '0deg' }] }} />
          </View>

          {/* Nodes */}
          {myLocation && nodes.map(node => {
            if (!node.coordinates) return null;
            
            const absoluteBearing = calculateBearing(
              myLocation[1], myLocation[0],
              node.coordinates[1], node.coordinates[0]
            );
            
            const relativeAngle = absoluteBearing - heading;
            const angleRad = (relativeAngle - 90) * (Math.PI / 180);
            
            const distanceRatio = Math.min(node.distance / MAX_RADAR_DISTANCE, 1);
            const plotRadius = distanceRatio * (COMPASS_RADIUS * 0.85); // 0.85 to keep inside ticks
            
            const x = COMPASS_RADIUS + plotRadius * Math.cos(angleRad);
            const y = COMPASS_RADIUS + plotRadius * Math.sin(angleRad);
            const color = signalColor(node.rssi);

            return (
              <View 
                key={node.id} 
                style={[
                  styles.nodeMarker, 
                  { 
                    left: x - 18,
                    top: y - 18,
                    borderColor: color,
                    backgroundColor: 'rgba(15, 23, 42, 0.9)'
                  }
                ]}
              >
                <Text style={styles.nodeText}>{node.name.substring(0, 3).toUpperCase()}</Text>
              </View>
            );
          })}
        </BlurView>

        {!hasHeadingSupport && (
          <Text style={styles.warningText}>Compass sensor unavailable on this device.</Text>
        )}
        {!myLocation && permissionsGranted && (
          <Text style={styles.warningText}>Waiting for GPS lock to calculate relative positions...</Text>
        )}
      </View>

      {/* Roster / Distance list */}
      <View style={styles.listContainer}>
        <Text style={styles.listTitle}>Tracking Targets</Text>
        {nodes.map(node => {
          let absoluteBearing = 0;
          if (myLocation && node.coordinates) {
             absoluteBearing = calculateBearing(myLocation[1], myLocation[0], node.coordinates[1], node.coordinates[0]);
          }
          return (
            <View key={node.id} style={styles.listItem}>
              <View style={[styles.listDot, { backgroundColor: signalColor(node.rssi) }]} />
              <Text style={styles.listName}>{node.name}</Text>
              <Text style={styles.listBearing}>{Math.round(absoluteBearing)}°</Text>
              <Text style={styles.listDistance}>{node.distance}m</Text>
            </View>
          );
        })}
        {nodes.length === 0 && (
          <Text style={styles.listEmpty}>No active hikers found.</Text>
        )}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline'
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  headingText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#38BDF8',
    fontFamily: 'monospace',
  },
  radarWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  radarContainer: {
    width: COMPASS_SIZE,
    height: COMPASS_SIZE,
    borderRadius: COMPASS_RADIUS,
    borderWidth: 3,
    borderColor: '#1E293B',
    backgroundColor: 'rgba(2, 6, 23, 0.7)',
    overflow: 'hidden',
    position: 'relative',
  },
  cardinalContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardinalText: {
    position: 'absolute',
    color: '#94A3B8',
    fontWeight: '900',
    fontSize: 18,
  },
  northText: { top: 12, color: '#EF4444' },
  southText: { bottom: 12 },
  eastText: { right: 12 },
  westText: { left: 12 },
  tickMarker: {
    position: 'absolute',
    width: 2,
    height: COMPASS_SIZE,
    alignItems: 'center',
  },
  tickLine: {
    width: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  tickLineMajor: {
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  tickLineMinor: {
    height: 6,
  },
  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: COMPASS_SIZE,
    top: '50%',
    left: '50%',
    transform: [{ translateX: '-50%' }, { translateY: '-50%' }],
  },
  forwardMarker: {
    position: 'absolute',
    top: 0,
    left: '50%',
    width: 4,
    height: 15,
    backgroundColor: '#38BDF8',
    transform: [{ translateX: '-2px' }],
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  centerDot: {
    position: 'absolute',
    top: COMPASS_RADIUS - 12,
    left: COMPASS_RADIUS - 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#38BDF8',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#38BDF8',
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 5,
  },
  nodeMarker: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  nodeText: {
    color: '#F8FAFC',
    fontSize: 10,
    fontWeight: 'bold',
  },
  warningText: {
    color: '#F59E0B',
    fontSize: 12,
    marginTop: 15,
    textAlign: 'center',
  },
  listContainer: {
    flex: 1,
    backgroundColor: 'rgba(30, 41, 59, 0.3)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  listTitle: {
    color: '#38BDF8',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  listDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  listName: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '600',
  },
  listBearing: {
    color: '#94A3B8',
    fontSize: 14,
    fontFamily: 'monospace',
    marginRight: 15,
  },
  listDistance: {
    color: '#10B981',
    fontSize: 14,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  listEmpty: {
    color: '#64748B',
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 20,
  }
});
