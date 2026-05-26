import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions, ScrollView } from 'react-native';
import Svg, { Path, Circle, Rect, G, Text as SvgText, Polyline } from 'react-native-svg';
import { useMobileMesh } from '../../src/hooks/useMobileMesh';
import trailData from '../../src/data/trail.json';

const { width, height } = Dimensions.get('window');
const MAP_CENTER = { lat: 37.7749, lng: -122.4194 };
const ZOOM_FACTOR = 100000;

export default function MapScreen() {
  const { nodes, myLocation, username } = useMobileMesh();

  // If we have a real GPS location, use it! Otherwise default to SF for the mock
  const MAP_CENTER = myLocation ? { lng: myLocation[0], lat: myLocation[1] } : { lat: 37.7749, lng: -122.4194 };

  // Draw a stylish grid overlay
  const gridLines = useMemo(() => {
    const lines = [];
    const gridSize = 40;
    for (let i = 0; i < width * 2; i += gridSize) {
      lines.push(`M${i},0 L${i},${height * 2}`);
    }
    for (let j = 0; j < height * 2; j += gridSize) {
      lines.push(`M0,${j} L${width * 2},${j}`);
    }
    return lines.join(' ');
  }, []);

  // Parse GeoJSON and project to SVG coordinates
  const trailPoints = useMemo(() => {
    const coordinates = trailData.features[0].geometry.coordinates;
    const originLng = coordinates[0][0];
    const originLat = coordinates[0][1];
    
    // Dynamically offset the GeoJSON mock trail to always start exactly where the user is physically standing!
    const offsetLng = myLocation ? myLocation[0] - originLng : 0;
    const offsetLat = myLocation ? myLocation[1] - originLat : 0;

    return coordinates.map(coord => {
      const shiftedLng = coord[0] + offsetLng;
      const shiftedLat = coord[1] + offsetLat;
      const dx = (shiftedLng - MAP_CENTER.lng) * ZOOM_FACTOR;
      const dy = (MAP_CENTER.lat - shiftedLat) * ZOOM_FACTOR;
      return `${width + dx},${height + dy}`; // 'width' and 'height' is the exact center of our 2x canvas
    }).join(' ');
  }, [myLocation, MAP_CENTER]);

  return (
    <View style={styles.container}>
      <ScrollView horizontal={true} bounces={false}>
        <ScrollView bounces={false}>
          {/* We increase the SVG size to allow panning around the center */}
          <Svg width={width * 2} height={height * 2}>
            {/* Dark Map Background */}
            <Rect x="0" y="0" width="100%" height="100%" fill="#0F172A" />

            {/* Topographic / Grid Lines */}
            <Path d={gridLines} stroke="#1E293B" strokeWidth="1" />

            {/* Real GeoJSON Hiking Trail */}
            <Polyline 
              points={trailPoints} 
              fill="none" 
              stroke="#10B981" 
              strokeWidth="4" 
              strokeOpacity="0.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            <G>
              {/* Main user node (centered exactly in the middle of the 2x view) */}
              <Circle cx={width} cy={height} r="12" fill="#38BDF8" opacity="0.4" />
              <Circle cx={width} cy={height} r="6" fill="#38BDF8" />
              <SvgText x={width + 15} y={height + 5} fill="#94A3B8" fontSize="12" fontWeight="bold">
                You ({username})
              </SvgText>

              {/* Draw team nodes relative to the center */}
              {nodes.map(node => {
                const dx = (node.coordinates[0] - MAP_CENTER.lng) * ZOOM_FACTOR;
                const dy = (MAP_CENTER.lat - node.coordinates[1]) * ZOOM_FACTOR; // Invert Y
                const cx = width + dx;
                const cy = height + dy;
                
                // Trail path to the node
                const trailPath = `M${width},${height} L${cx},${cy}`;

                return (
                  <React.Fragment key={`frag-${node.id}`}>
                    {/* Connection line */}
                    <Path 
                      d={trailPath} 
                      stroke={node.rssi > -80 ? "#818CF8" : "#EF4444"} 
                      strokeWidth="2" 
                      strokeDasharray="5, 5" 
                      opacity="0.6"
                    />
                    
                    {/* Node marker */}
                    <Circle cx={cx} cy={cy} r="18" fill="#1E293B" stroke={node.rssi > -80 ? "#818CF8" : "#EF4444"} strokeWidth="2" />
                    <SvgText x={cx} y={cy + 4} fill="#F8FAFC" fontSize="9" fontWeight="bold" textAnchor="middle">
                      {node.name.substring(0, 4)}
                    </SvgText>
                    <SvgText x={cx + 24} y={cy + 5} fill="#94A3B8" fontSize="10">
                      {node.name}
                    </SvgText>
                  </React.Fragment>
                );
              })}
            </G>
          </Svg>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
});
