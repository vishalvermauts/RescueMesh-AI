import { useState, useEffect } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';

export function usePermissions() {
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function requestPermissions() {
      try {
        // 1. Location Permissions (Expo)
        const { status: locationStatus } = await Location.requestForegroundPermissionsAsync();
        if (locationStatus !== 'granted') {
          setError('Location permission denied.');
          setPermissionsGranted(false);
          return;
        }

        // 2. Bluetooth Permissions (Android Native)
        if (Platform.OS === 'android') {
          // Android 12+ requires explicit BLUETOOTH_SCAN and BLUETOOTH_CONNECT
          if (Platform.Version >= 31) {
            const btScan = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
              {
                title: 'Bluetooth Scan Permission',
                message: 'MeshMap needs to scan for nearby hiker nodes.',
                buttonNeutral: 'Ask Me Later',
                buttonNegative: 'Cancel',
                buttonPositive: 'OK',
              }
            );

            const btConnect = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
              {
                title: 'Bluetooth Connect Permission',
                message: 'MeshMap needs to connect to nearby hiker nodes.',
                buttonNeutral: 'Ask Me Later',
                buttonNegative: 'Cancel',
                buttonPositive: 'OK',
              }
            );

            const btAdvertise = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
              {
                title: 'Bluetooth Advertise Permission',
                message: 'MeshMap needs to broadcast its presence to nearby hiker nodes.',
                buttonNeutral: 'Ask Me Later',
                buttonNegative: 'Cancel',
                buttonPositive: 'OK',
              }
            );

            if (
              btScan !== PermissionsAndroid.RESULTS.GRANTED ||
              btConnect !== PermissionsAndroid.RESULTS.GRANTED ||
              btAdvertise !== PermissionsAndroid.RESULTS.GRANTED
            ) {
              setError('Bluetooth permissions denied.');
              setPermissionsGranted(false);
              return;
            }
          } else {
            // Android 11 and lower just need Location for BLE scanning (already requested above)
            // But we also requested ACCESS_FINE_LOCATION natively just to be safe
            const fineLocation = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
              {
                title: 'Fine Location Permission',
                message: 'MeshMap needs fine location to discover BLE devices.',
                buttonNeutral: 'Ask Me Later',
                buttonNegative: 'Cancel',
                buttonPositive: 'OK',
              }
            );

            if (fineLocation !== PermissionsAndroid.RESULTS.GRANTED) {
              setError('Fine location permission denied for BLE.');
              setPermissionsGranted(false);
              return;
            }
          }
        }

        setPermissionsGranted(true);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'An error occurred requesting permissions.');
        setPermissionsGranted(false);
      }
    }

    requestPermissions();
  }, []);

  return { permissionsGranted, error };
}
