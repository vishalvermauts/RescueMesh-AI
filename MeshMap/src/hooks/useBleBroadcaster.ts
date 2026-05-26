import { useEffect } from 'react';

// Using a compressed 16-bit compatible UUID for our MeshMap application
export const MESHMAP_SERVICE_UUID = '0000fef0-0000-1000-8000-00805f9b34fb'; 

export let BlePeripheral: any = null;
try {
  const peripheralManager = require('react-native-ble-peripheral-manager');
  BlePeripheral = peripheralManager.default || peripheralManager;
} catch (e) {
  console.warn('react-native-ble-peripheral-manager is not available. Broadcasting disabled.');
}

export function useBleBroadcaster(
  permissionsGranted: boolean,
  deviceName: string,
  batteryLevel?: number,
  coordinates?: [number, number] | null,
  longRange?: boolean
) {
  const coordString = coordinates ? coordinates.join(',') : '';

  useEffect(() => {
    if (!permissionsGranted || !BlePeripheral) return;

    let isAdvertising = false;

    async function startBroadcasting() {
      try {
        // Stop any existing advertisement first to resolve race conditions on Android native bridge
        try {
          await BlePeripheral.stopAdvertising();
        } catch (e) {
          // Ignore if not currently advertising
        }

        let namePayload = deviceName;
        if (namePayload && !namePayload.startsWith('M:')) {
          const batteryPart = batteryLevel !== undefined ? `:${batteryLevel}` : '';
          const coordsPart = (coordinates && coordinates.length === 2)
            ? `:${coordinates[1].toFixed(4)},${coordinates[0].toFixed(4)}`
            : '';
          namePayload = `${deviceName}${batteryPart}${coordsPart}`;
        }

        if (typeof BlePeripheral.setName === 'function' && namePayload && namePayload.trim() !== '') {
          await BlePeripheral.setName(namePayload);
        }

        try {
          await BlePeripheral.addService(MESHMAP_SERVICE_UUID, true);
        } catch (e) {
          // Ignore if service is already added on native side
        }
        
        await BlePeripheral.startAdvertising({
          uuids: [MESHMAP_SERVICE_UUID],
          longRange: !!longRange,
        });
        
        isAdvertising = true;
        console.log(`[BROADCASTER] Successfully broadcasting as ${namePayload}`);
      } catch (e: any) {
        if (e && e.message && e.message.includes('Already advertising')) {
          isAdvertising = true;
          console.log(`[BROADCASTER] Hot-reload caught: Already broadcasting.`);
        } else {
          console.error('[BROADCASTER ERROR]', e);
        }
      }
    }

    startBroadcasting();

    return () => {
      if (isAdvertising && BlePeripheral) {
        try {
          const res = BlePeripheral.stopAdvertising();
          if (res && typeof res.catch === 'function') {
            res.catch(console.error);
          }
        } catch (err) {
          console.error('[BROADCASTER ERROR on stop]', err);
        }
      }
    };
  }, [permissionsGranted, deviceName, batteryLevel, coordString, longRange]);
}
