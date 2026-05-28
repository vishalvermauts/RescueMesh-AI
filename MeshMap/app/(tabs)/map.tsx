import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSharedMesh } from '../../src/context/MeshContext';
import trailData from '../../src/data/trail.json';


// Parse trail GeoJSON coordinates into LatLng array
const TRAIL_COORDS = (trailData.features[0].geometry.coordinates as number[][]).map(
  ([lng, lat]) => ({ latitude: lat, longitude: lng })
);

// Compute bounding box for the trail
function getBBox(coords: { latitude: number; longitude: number }[]) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const { latitude, longitude } of coords) {
    if (latitude < minLat) minLat = latitude;
    if (latitude > maxLat) maxLat = latitude;
    if (longitude < minLng) minLng = longitude;
    if (longitude > maxLng) maxLng = longitude;
  }
  return { minLat, maxLat, minLng, maxLng };
}

const TRAIL_BBOX = getBBox(TRAIL_COORDS);
const TRAIL_CENTER = {
  latitude: (TRAIL_BBOX.minLat + TRAIL_BBOX.maxLat) / 2,
  longitude: (TRAIL_BBOX.minLng + TRAIL_BBOX.maxLng) / 2,
};
const TRAIL_DELTA = {
  latitudeDelta: Math.max((TRAIL_BBOX.maxLat - TRAIL_BBOX.minLat) * 2.5, 0.01),
  longitudeDelta: Math.max((TRAIL_BBOX.maxLng - TRAIL_BBOX.minLng) * 2.5, 0.015),
};

// Signal strength → color
function signalColor(rssi: number | undefined) {
  if (rssi === undefined) return '#818CF8';
  if (rssi > -60) return '#10B981'; // strong: green
  if (rssi > -80) return '#F59E0B'; // medium: amber
  return '#EF4444';                 // weak: red
}

export default function MapScreen() {
  const { nodes, myLocation, username } = useSharedMesh();
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);

  // Build the initial region — prefer user GPS, fallback to trail center
  const initialRegion = useMemo(() => {
    if (myLocation) {
      return {
        latitude: myLocation[1],
        longitude: myLocation[0],
        latitudeDelta: 0.01,
        longitudeDelta: 0.015,
      };
    }
    return { ...TRAIL_CENTER, ...TRAIL_DELTA };
  }, []); // only compute once on mount

  // Once map is ready, fit to show trail + all peers
  useEffect(() => {
    if (!mapReady) return;
    const allPoints: { latitude: number; longitude: number }[] = [...TRAIL_COORDS];
    if (myLocation) allPoints.push({ latitude: myLocation[1], longitude: myLocation[0] });
    for (const node of nodes) {
      if (node.coordinates) {
        allPoints.push({ latitude: node.coordinates[1], longitude: node.coordinates[0] });
      }
    }
    if (allPoints.length > 0) {
      mapRef.current?.fitToCoordinates(allPoints, {
        edgePadding: { top: 80, right: 40, bottom: 160, left: 40 },
        animated: true,
      });
    }
  }, [mapReady, nodes.length]);

  const centerOnMe = () => {
    const lat = myLocation ? myLocation[1] : TRAIL_CENTER.latitude;
    const lng = myLocation ? myLocation[0] : TRAIL_CENTER.longitude;
    mapRef.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: 0.008, longitudeDelta: 0.012 },
      500
    );
  };

  const fitAll = () => {
    const allPoints: { latitude: number; longitude: number }[] = [...TRAIL_COORDS];
    if (myLocation) allPoints.push({ latitude: myLocation[1], longitude: myLocation[0] });
    for (const node of nodes) {
      if (node.coordinates) {
        allPoints.push({ latitude: node.coordinates[1], longitude: node.coordinates[0] });
      }
    }
    mapRef.current?.fitToCoordinates(allPoints, {
      edgePadding: { top: 80, right: 40, bottom: 160, left: 40 },
      animated: true,
    });
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={initialRegion}
        mapType="standard"
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={true}
        showsScale={true}
        onMapReady={() => setMapReady(true)}
      >
        {/* Hiking trail polyline */}
        <Polyline
          coordinates={TRAIL_COORDS}
          strokeColor="#10B981"
          strokeWidth={4}
          lineDashPattern={undefined}
          lineJoin="round"
          lineCap="round"
        />

        {/* "You are here" marker (if location known) */}
        {myLocation && (
          <Marker
            coordinate={{ latitude: myLocation[1], longitude: myLocation[0] }}
            title={`You (${username})`}
            description="Your current location"
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.myMarker}>
              <View style={styles.myMarkerPulse} />
              <View style={styles.myMarkerCore} />
            </View>
          </Marker>
        )}

        {/* Peer BLE node markers */}
        {nodes.map(node => {
          if (!node.coordinates) return null;
          const color = signalColor(node.rssi);
          return (
            <Marker
              key={node.id}
              coordinate={{ latitude: node.coordinates[1], longitude: node.coordinates[0] }}
              title={node.name}
              description={`RSSI: ${node.rssi ?? 'N/A'} dBm · Battery: ${node.battery ?? '?'}%`}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={[styles.peerMarker, { borderColor: color }]}>
                <Text style={styles.peerMarkerText}>{node.name.substring(0, 3).toUpperCase()}</Text>
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* Loading spinner until map tiles appear */}
      {!mapReady && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#10B981" />
          <Text style={styles.loadingText}>Loading map…</Text>
        </View>
      )}

      {/* Floating HUD */}
      <View style={styles.hudCard}>
        <Text style={styles.hudTitle}>MeshMap</Text>
        <Text style={styles.hudSubtitle}>Pacific Ridge Trail</Text>
        <View style={styles.hudSeparator} />

        <View style={styles.hudLegendItem}>
          <View style={[styles.hudDot, { backgroundColor: '#38BDF8' }]} />
          <Text style={styles.hudLegendText}>You ({username})</Text>
        </View>
        <View style={styles.hudLegendItem}>
          <View style={[styles.hudDot, { backgroundColor: '#10B981' }]} />
          <Text style={styles.hudLegendText}>Strong signal</Text>
        </View>
        <View style={styles.hudLegendItem}>
          <View style={[styles.hudDot, { backgroundColor: '#F59E0B' }]} />
          <Text style={styles.hudLegendText}>Medium signal</Text>
        </View>
        <View style={styles.hudLegendItem}>
          <View style={[styles.hudDot, { backgroundColor: '#EF4444' }]} />
          <Text style={styles.hudLegendText}>Weak signal</Text>
        </View>
        <View style={styles.hudLegendItem}>
          <View style={[styles.trailDash]} />
          <Text style={styles.hudLegendText}>Hiking trail</Text>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.btn} onPress={centerOnMe}>
            <Text style={styles.btnText}>📍 Me</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={fitAll}>
            <Text style={styles.btnText}>🗺 All</Text>
          </TouchableOpacity>
        </View>

        {nodes.length > 0 && (
          <Text style={styles.peerCount}>{nodes.length} peer{nodes.length !== 1 ? 's' : ''} online</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  map: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
  },

  // HUD Card
  hudCard: {
    position: 'absolute',
    top: 20,
    left: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.90)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    minWidth: 190,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  hudTitle: {
    color: '#F8FAFC',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.5,
  },
  hudSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 1,
    marginBottom: 8,
  },
  hudSeparator: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 8,
  },
  hudLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 5,
  },
  hudDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    marginRight: 8,
  },
  trailDash: {
    width: 20,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#10B981',
    marginRight: 8,
  },
  hudLegendText: {
    color: '#CBD5E1',
    fontSize: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  btn: {
    flex: 1,
    backgroundColor: '#38BDF8',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  btnSecondary: {
    backgroundColor: '#334155',
  },
  btnText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 12,
  },
  peerCount: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'center',
  },

  // Markers
  myMarker: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  myMarkerPulse: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(56, 189, 248, 0.3)',
  },
  myMarkerCore: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#38BDF8',
    borderWidth: 2,
    borderColor: '#fff',
  },
  peerMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1E293B',
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  peerMarkerText: {
    color: '#F8FAFC',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
