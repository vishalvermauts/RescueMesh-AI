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
  longRange?: boolean,
  onLog?: (msg: string) => void
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
          let coordsPart = '';
          if (coordinates && coordinates.length === 2) {
            // Encode coordinates using base36 to fit in the 31-byte BLE advertising packet limit
            const latVal = Math.round((coordinates[1] + 90) * 10000).toString(36);
            const lngVal = Math.round((coordinates[0] + 180) * 10000).toString(36);
            coordsPart = `:${latVal},${lngVal}`;
          }
          namePayload = `${deviceName}${batteryPart}${coordsPart}`;
        }

        onLog?.(`[BROADCASTER] Starting advertising as '${namePayload}' (Long Range: ${!!longRange})`);

        if (typeof BlePeripheral.setName === 'function' && namePayload && namePayload.trim() !== '') {
          await BlePeripheral.setName(namePayload);
        }

        try {
          await BlePeripheral.addService(MESHMAP_SERVICE_UUID, true);
        } catch (e) {
          // Ignore if service is already added on native side
        }
        
        const advertiseOpts: any = {
          uuids: [MESHMAP_SERVICE_UUID],
          serviceUUIDs: [MESHMAP_SERVICE_UUID],
          longRange: !!longRange,
        };

        try {
          await BlePeripheral.startAdvertising(advertiseOpts);
        } catch (err: any) {
          onLog?.(`[BROADCASTER] Advertising failed to start: ${err.message || err}`);
          throw err;
        }
        
        isAdvertising = true;
        onLog?.(`[BROADCASTER] Advertising started successfully (Long Range: ${!!longRange}).`);
        console.log(`[BROADCASTER] Successfully broadcasting as ${namePayload}`);
      } catch (e: any) {
        if (e && e.message && e.message.includes('Already advertising')) {
          isAdvertising = true;
          onLog?.('[BROADCASTER] Already advertising.');
          console.log(`[BROADCASTER] Hot-reload caught: Already broadcasting.`);
        } else {
          const errStr = e?.message || String(e);
          onLog?.(`[BROADCASTER ERROR] Failed to start advertising: ${errStr}`);
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
          onLog?.('[BROADCASTER] Stopped advertising.');
        } catch (err) {
          console.error('[BROADCASTER ERROR on stop]', err);
        }
      }
    };
  }, [permissionsGranted, deviceName, batteryLevel, coordString, longRange]);
}
