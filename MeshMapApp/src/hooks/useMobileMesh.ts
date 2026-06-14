import { useState, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { usePermissions } from './usePermissions';
import { useBleBroadcaster, MESHMAP_SERVICE_UUID, BlePeripheral } from './useBleBroadcaster';

let BleManager: any = null;
try {
  const blePlx = require('react-native-ble-plx');
  BleManager = blePlx.BleManager;
} catch (e) {
  console.warn('react-native-ble-plx is not available in this environment. Falling back to mock engine.');
}

let AsyncStorage: any = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
} catch (e) {
  console.warn('AsyncStorage is not available. Username persistence falls back to memory.');
}

let pendingLogs: string[] = [];

let isAsyncStorageWorking = true;
const safeGetItem = async (key: string): Promise<string | null> => {
  if (!AsyncStorage) {
    if (pendingLogs.indexOf('[STORAGE] AsyncStorage package not found. Using memory fallback.') === -1) {
      pendingLogs.push('[STORAGE] AsyncStorage package not found. Using memory fallback.');
    }
    return null;
  }
  if (!isAsyncStorageWorking) return null;
  try {
    return await AsyncStorage.getItem(key);
  } catch (e: any) {
    const errorMsg = e?.message || String(e);
    const logMsg = `[STORAGE WARNING] Failed to load name: ${errorMsg.substring(0, 40)}. Using memory fallback.`;
    console.warn(logMsg, e);
    pendingLogs.push(logMsg);
    isAsyncStorageWorking = false;
    return null;
  }
};

const safeSetItem = async (key: string, value: string): Promise<void> => {
  if (!AsyncStorage) return;
  if (!isAsyncStorageWorking) {
    pendingLogs.push('[STORAGE] Cannot save: persistent storage is disabled.');
    return;
  }
  try {
    await AsyncStorage.setItem(key, value);
    pendingLogs.push(`[STORAGE] Saved username '${value}' successfully.`);
  } catch (e: any) {
    const errorMsg = e?.message || String(e);
    const logMsg = `[STORAGE ERROR] Save failed: ${errorMsg.substring(0, 40)}. Name will not persist.`;
    console.warn(logMsg, e);
    pendingLogs.push(logMsg);
    isAsyncStorageWorking = false;
  }
};

let globalUsername = `h${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;

// Detect if a device name looks like a MeshMap broadcast
// Patterns: hXX, hXX:battery, hXX:battery:coords, M:sender:msg, or any custom saved name
function isMeshMapName(name: string, authorizedNames: string[]): boolean {
  if (!name || name === 'Unknown') return false;
  // Message payload pattern
  if (name.startsWith('M:') && name.split(':').length >= 3) return true;
  // Standard name:battery or name:battery:coords pattern — key signal is ":" with a numeric battery
  const parts = name.split(':');
  if (parts.length >= 2 && !isNaN(Number(parts[1])) && Number(parts[1]) >= 0 && Number(parts[1]) <= 100) return true;
  // h-prefix device names (auto-generated format: h00-h99)
  if (/^h\d{2}/.test(name)) return true;
  // Check authorized names list
  if (authorizedNames.some(auth =>
    auth.toLowerCase() === name.toLowerCase() ||
    name.toLowerCase().startsWith(auth.toLowerCase().split(':')[0])
  )) return true;
  return false;
}


function decodeUtf8(bytes: Uint8Array): string {
  try {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(bytes);
    }
  } catch (e) {}

  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 128) {
      out += String.fromCharCode(c);
    } else if (c > 191 && c < 224) {
      if (i >= bytes.length) break;
      out += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
    } else if (c > 223 && c < 240) {
      if (i + 1 >= bytes.length) break;
      out += String.fromCharCode(((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
    } else if (c > 239 && c < 245) {
      if (i + 2 >= bytes.length) break;
      let val = ((c & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      val -= 0x10000;
      out += String.fromCharCode((val >> 10) | 0xD800, (val & 0x3FF) | 0xDC00);
    }
  }
  return out;
}

function parseLocalNameFromAdData(base64AdData: string): string | null {
  if (!base64AdData) return null;
  try {
    // Decode base64 → binary
    let binaryString: string;
    if (typeof atob === 'function') {
      binaryString = atob(base64AdData);
    } else {
      // Node/Hermes fallback using Buffer
      try {
        binaryString = Buffer.from(base64AdData, 'base64').toString('binary');
      } catch (_) {
        return null;
      }
    }

    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i) & 0xFF;
    }

    // Walk the AD structure: [length][type][data...]
    let index = 0;
    while (index < bytes.length) {
      const adLength = bytes[index];
      if (adLength === 0) break;                            // end of records
      if (index + adLength >= bytes.length) break;         // malformed record

      const adType = bytes[index + 1];

      // 0x08 = Shortened Local Name, 0x09 = Complete Local Name
      if (adType === 0x08 || adType === 0x09) {
        const nameBytes = bytes.subarray(index + 2, index + 1 + adLength);
        const name = decodeUtf8(nameBytes);
        if (name && name.trim().length > 0) return name.trim();
      }

      index += 1 + adLength;
    }
  } catch (e) {
    // Silent fail — caller handles null return
  }
  return null;
}


export interface NodeData {
  id: string;
  name: string;
  battery: number;
  rssi: number;
  distance: number;
  coordinates: [number, number]; // longitude, latitude
  hops: number;
  lastSeen?: number; // Timestamp of the last received BLE packet
}

export interface MeshMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
}

export interface MeshState {
  nodes: NodeData[];
  logs: string[];
  myLocation?: [number, number];
  authorizedIds: string[];
  authorizedNames: string[];
  unknownDevices: any[];
  messages: MeshMessage[];
}

export function useMobileMesh() {
  const { permissionsGranted, error: permissionError } = usePermissions();
  const managerRef = useRef<any>(null);
  const authorizedIdsRef = useRef<string[]>([]);
  const authorizedNamesRef = useRef<string[]>([]);
  const lastRawLogRef = useRef<number>(0);

  const [meshState, setMeshState] = useState<MeshState>({
    nodes: [],
    logs: ['[SYSTEM] MeshMap initialized.'],
    authorizedIds: [],
    authorizedNames: [],
    unknownDevices: [],
    messages: []
  });

  const [username, setUsername] = useState(globalUsername);
  const [broadcastName, setBroadcastName] = useState(globalUsername);
  const [localBattery, setLocalBattery] = useState<number>(() => Math.floor(75 + Math.random() * 20));
  const [broadcastCoords, setBroadcastCoords] = useState<[number, number] | null>(null);
  const [longRange, setLongRange] = useState(false);

  useBleBroadcaster(
    permissionsGranted, 
    broadcastName, 
    localBattery, 
    broadcastCoords, 
    longRange, 
    (msg) => {
      setMeshState(prev => {
        const logs = [...prev.logs, msg];
        if (logs.length > 80) logs.shift();
        return { ...prev, logs };
      });
    }
  );

  const lastCoordsUpdateRef = useRef<number>(0);

  // Throttled coordinate updates for BLE advertising name payload
  useEffect(() => {
    if (!meshState.myLocation) return;
    const now = Date.now();
    const [lng, lat] = meshState.myLocation;
    
    if (!broadcastCoords) {
      setBroadcastCoords([lng, lat]);
      lastCoordsUpdateRef.current = now;
      return;
    }

    const [lastLng, lastLat] = broadcastCoords;
    const dx = lng - lastLng;
    const dy = lat - lastLat;
    const distSq = dx * dx + dy * dy;
    
    // ~0.0001 degrees is ~10 meters. Update ONLY if moved > 10m to avoid constant adapter restarts when stationary
    const threshold = 0.0001; 

    if (distSq > threshold * threshold) {
      setBroadcastCoords([lng, lat]);
      lastCoordsUpdateRef.current = now;
    }
  }, [meshState.myLocation, broadcastCoords]);

  // Slowly drain mock battery by 1% every 3 minutes in simulated/fallback mode
  useEffect(() => {
    const timer = setInterval(() => {
      setLocalBattery(prev => Math.max(1, prev - 1));
    }, 180000);
    return () => clearInterval(timer);
  }, []);

  // Listen for real Android native battery broadcasts to update localBattery dynamically
  useEffect(() => {
    if (!permissionsGranted || !BlePeripheral || Platform.OS !== 'android') return;

    let subscription: any = null;
    try {
      if (typeof BlePeripheral.registerBroadcastReceiver === 'function') {
        BlePeripheral.registerBroadcastReceiver(['android.intent.action.BATTERY_CHANGED']);
        
        if (typeof BlePeripheral.onDidReceiveBroadcastIntent === 'function') {
          subscription = BlePeripheral.onDidReceiveBroadcastIntent((event: any) => {
            if (event.action === 'android.intent.action.BATTERY_CHANGED' && event.extras) {
              const level = event.extras.level;
              const scale = event.extras.scale || 100;
              if (level !== undefined) {
                const pct = Math.round((level / scale) * 100);
                setLocalBattery(pct);
              }
            }
          });
        }
      }
    } catch (err) {
      console.warn('[BATTERY] Native broadcast receiver not supported, using simulation.', err);
    }

    return () => {
      if (subscription) subscription.remove();
      try {
        if (typeof BlePeripheral.unregisterBroadcastReceiver === 'function') {
          BlePeripheral.unregisterBroadcastReceiver();
        }
      } catch (err) {
        // Ignore
      }
    };
  }, [permissionsGranted]);

  useEffect(() => {
    async function loadUsername() {
      const saved = await safeGetItem('meshmap_username');
      if (saved) {
        globalUsername = saved;
        setUsername(saved);
        setBroadcastName(saved);
      }
    }
    async function loadLongRange() {
      const saved = await safeGetItem('meshmap_long_range');
      if (saved) {
        setLongRange(saved === 'true');
      }
    }
    loadUsername();
    loadLongRange();
  }, []);

  // Periodically drain persistent storage logs into the in-app System Terminal
  useEffect(() => {
    const timer = setInterval(() => {
      if (pendingLogs.length > 0) {
        setMeshState(prev => {
          const updatedLogs = [...prev.logs, ...pendingLogs];
          pendingLogs = [];
          if (updatedLogs.length > 80) {
            updatedLogs.splice(0, updatedLogs.length - 80);
          }
          return { ...prev, logs: updatedLogs };
        });
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const saveUsername = async (newName: string) => {
    const cleanName = newName.substring(0, 12).replace(/\s/g, '_').trim();
    const finalName = cleanName || `h${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
    globalUsername = finalName;
    setUsername(newName); // Allow the UI input to show empty text
    setBroadcastName(finalName); // Use the fallback for the BLE broadcaster name
    if (cleanName) {
      await safeSetItem('meshmap_username', cleanName);
    } else {
      setMeshState(prev => ({
        ...prev,
        logs: [...prev.logs, `[SYSTEM] Username cleared. Broadcasting fallback: '${finalName}'`]
      }));
    }
  };

  const authorizeDevice = (id: string, name: string) => {
    if (!authorizedIdsRef.current.includes(id)) {
      authorizedIdsRef.current.push(id);
    }
    if (name && !authorizedNamesRef.current.includes(name)) {
      authorizedNamesRef.current.push(name);
    }
    setMeshState(prev => {
      const authorizedIds = [...prev.authorizedIds, id];
      const authorizedNames = name ? [...prev.authorizedNames, name] : prev.authorizedNames;
      const unknownDevices = prev.unknownDevices.filter(d => d.id !== id && d.name !== name);
      const logs = [...prev.logs, `[SYSTEM] Authorized Mesh Node: ${name || id}`];
      return { ...prev, authorizedIds, authorizedNames, unknownDevices, logs };
    });
  };

  const sendMessage = (text: string) => {
    const cleanText = text.substring(0, 12);
    const msgPayload = `M:${username.substring(0, 8)}:${cleanText}`;
    setBroadcastName(msgPayload);

    setMeshState(prev => {
      const messages = [
        ...prev.messages,
        {
          id: Math.random().toString(),
          sender: 'You',
          text: cleanText,
          timestamp: Date.now()
        }
      ];
      return { ...prev, messages, logs: [...prev.logs, `[CHAT] You: ${cleanText}`] };
    });

    setTimeout(() => {
      setBroadcastName(globalUsername);
    }, 8000);
  };

  // 0. Fetch Real GPS Location
  useEffect(() => {
    let locationSubscription: any = null;
    if (permissionsGranted) {
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 5 },
        (loc) => {
          setMeshState(prev => ({
            ...prev,
            myLocation: [loc.coords.longitude, loc.coords.latitude]
          }));
        }
      ).then(sub => {
        locationSubscription = sub;
      });
    }
    return () => {
      if (locationSubscription) locationSubscription.remove();
    };
  }, [permissionsGranted]);

  // 1. Hardware Scanning Engine
  useEffect(() => {
    if (permissionsGranted && BleManager) {
      if (!managerRef.current) {
        managerRef.current = new BleManager();
      }

      setMeshState(prev => ({
        ...prev,
        nodes: [], // Clear any lingering mock nodes
        logs: [...prev.logs, '[SYSTEM] Hardware permissions granted. Initializing BLE...']
      }));

      let scanTimer: any = null;

      const runScanner = () => {
        if (!managerRef.current) return;
        try {
          managerRef.current.stopDeviceScan();
        } catch (e) {
          // Ignore
        }
        
        console.log('[SCANNER] Initiating BLE scan cycle...');
        setMeshState(prev => {
          const logs = [...prev.logs, '[SCANNER] Initiating BLE scan cycle...'];
          if (logs.length > 80) logs.shift();
          return { ...prev, logs };
        });

        managerRef.current.startDeviceScan(null, { allowDuplicates: true }, (error: any, device: any) => {
          if (error) {
            console.error('[SCANNER ERROR]', error);
            // Try to auto-restart scanner in 3 seconds on error
            setTimeout(runScanner, 3000);
            return;
          }

          if (!device) return;

          const adName = parseLocalNameFromAdData(device.rawScanRecord);
          const nameStr = adName || device.localName || device.name || 'Unknown';
          const uuidStr = device.serviceUUIDs ? device.serviceUUIDs.join(',') : 'none';
          console.log(`[SCANNER DISCOVERY] Saw ${nameStr} (${device.id}) UUIDs: ${uuidStr} RSSI: ${device.rssi} AD: ${device.rawScanRecord} MD: ${device.manufacturerData}`);
          // Throttle raw discovery logging — only update state at most once per second
          // to avoid drowning React's state update queue with hundreds of updates/sec
          const nowMs = Date.now();
          if (!lastRawLogRef.current || nowMs - lastRawLogRef.current > 1000) {
            lastRawLogRef.current = nowMs;
            setMeshState(prev => {
              const logs = [...prev.logs];
              const msg = `[RAW] Saw ${nameStr} (${device.id.substring(0,5)}) UUIDs: ${uuidStr}`;
              if (!logs.includes(msg)) {
                logs.push(msg);
                if (logs.length > 60) logs.shift();
                return { ...prev, logs };
              }
              return prev;
            });
          }

          // 1a. Check device.serviceUUIDs (populated when Android parses the ad)
          const hasOurUUID = device.serviceUUIDs && (
            device.serviceUUIDs.includes(MESHMAP_SERVICE_UUID.toLowerCase()) ||
            device.serviceUUIDs.includes(MESHMAP_SERVICE_UUID.toUpperCase()) ||
            device.serviceUUIDs.includes('fef0') ||
            device.serviceUUIDs.includes('FEF0') ||
            device.serviceUUIDs.some((u: string) => u.toLowerCase().includes('fef0'))
          );

          // 1b. Fallback: parse FEF0 directly from the raw scan record bytes
          // Some Android firmware (Motorola especially) doesn't populate serviceUUIDs from Coded PHY ads
          let hasOurUUIDRaw = false;
          if (!hasOurUUID && device.rawScanRecord) {
            try {
              const atobF = typeof atob === 'function' ? atob : (s: string) => Buffer.from(s, 'base64').toString('binary');
              const raw = atobF(device.rawScanRecord);
              // Look for 16-bit / 128-bit UUIDs or Service Data containing 0xF0 0xFE (little-endian FEF0)
              // Types: 0x02/0x03 (16-bit UUID list), 0x06/0x07 (128-bit UUID list), 0x16 (16-bit Service Data), 0x21 (128-bit Service Data)
              for (let ri = 0; ri < raw.length - 2; ri++) {
                const rtype = raw.charCodeAt(ri + 1);
                if (rtype === 0x02 || rtype === 0x03 || rtype === 0x06 || rtype === 0x07 || rtype === 0x16 || rtype === 0x21) {
                  const rlen = raw.charCodeAt(ri);
                  // Scan the data payload byte-by-byte for FEF0 in little-endian format
                  for (let rj = ri + 2; rj < ri + rlen + 1 && rj + 1 < raw.length; rj++) {
                    if (raw.charCodeAt(rj) === 0xF0 && raw.charCodeAt(rj + 1) === 0xFE) {
                      hasOurUUIDRaw = true;
                      break;
                    }
                  }
                }
                if (hasOurUUIDRaw) break;
              }
            } catch (_) {}
          }
          
          // 2. Check if it broadcasts our tiny "MM" name (legacy)
          const isOurName = device.name === 'MM' || adName === 'MM';
          const isOurLocalName = device.localName === 'MM';

          // 3. Check if the name matches a MeshMap broadcast pattern
          const isMeshPattern = isMeshMapName(nameStr, authorizedNamesRef.current);
          let normalizedName = adName || device.localName || device.name || '';
          
          // Decode ManufacturerData payload (Company ID 0xFFFF) from Base Station
          // Try both device.manufacturerData AND rawScanRecord as fallback
          const extractMeshPayload = (rawBytes: Uint8Array): string | null => {
            // Look for 'M:' or 'Base:' in the raw bytes after skipping leading non-ASCII
            let str = '';
            for (let i = 0; i < rawBytes.length; i++) {
              str += String.fromCharCode(rawBytes[i]);
            }
            const mIdx = str.indexOf('M:');
            const bIdx = str.indexOf('Base:');
            if (mIdx !== -1) return str.substring(mIdx).replace(/\x00/g, '');
            if (bIdx !== -1) return str.substring(bIdx).replace(/\x00/g, '');
            return null;
          };

          // Method 1: Parse from device.manufacturerData (base64 string including company ID)
          if (device.manufacturerData) {
            try {
              const b64 = device.manufacturerData.replace(/[^A-Za-z0-9\+\/]/g, '');
              const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
              const bytes: number[] = [];
              for (let i = 0; i < b64.length;) {
                const e1 = chars.indexOf(b64.charAt(i++));
                const e2 = chars.indexOf(b64.charAt(i++));
                const e3 = chars.indexOf(b64.charAt(i++));
                const e4 = chars.indexOf(b64.charAt(i++));
                bytes.push((e1 << 2) | (e2 >> 4));
                if (e3 !== -1) bytes.push(((e2 & 15) << 4) | (e3 >> 2));
                if (e4 !== -1) bytes.push(((e3 & 3) << 6) | e4);
              }
              const result = extractMeshPayload(new Uint8Array(bytes));
              if (result) normalizedName = result;
            } catch (e) {
              console.warn('[MD DECODE ERROR]', e);
            }
          }

          // Method 2: Also parse ManufacturerData AD type (0xFF) from rawScanRecord
          // Always try this as some Android stacks don't populate device.manufacturerData
          if (device.rawScanRecord) {
            try {
              const atobF = typeof atob === 'function' ? atob : (s: string) => Buffer.from(s, 'base64').toString('binary');
              const raw = atobF(device.rawScanRecord);
              let ri = 0;
              while (ri < raw.length - 1) {
                const adLen = raw.charCodeAt(ri);
                if (adLen === 0 || ri + adLen >= raw.length) break;
                const adType = raw.charCodeAt(ri + 1);
                // 0xFF = Manufacturer Specific Data
                if (adType === 0xFF && adLen >= 3) {
                  // Company ID is bytes [ri+2, ri+3] in little-endian
                  const companyLo = raw.charCodeAt(ri + 2);
                  const companyHi = raw.charCodeAt(ri + 3);
                  const companyId = (companyHi << 8) | companyLo;
                  if (companyId === 0xFFFF) {
                    // Extract payload bytes (after company ID)
                    const payloadBytes = new Uint8Array(adLen - 3);
                    for (let j = 0; j < adLen - 3; j++) {
                      payloadBytes[j] = raw.charCodeAt(ri + 4 + j);
                    }
                    const result = extractMeshPayload(payloadBytes);
                    if (result) {
                      normalizedName = result;
                      console.warn('[MD FROM RAW] Decoded from rawScanRecord:', result);
                    }
                  }
                }
                ri += 1 + adLen;
              }
            } catch (e) {
              console.warn('[RAW MD DECODE ERROR]', e);
            }
          }

          // Check if name is a message payload (e.g. M:Sender:Text)
          let parsedSender = '';
          let parsedMsg = '';
          if (normalizedName.startsWith('M:')) {
            const parts = normalizedName.split(':');
            if (parts.length >= 3) {
              parsedSender = parts[1];
              parsedMsg = parts.slice(2).join(':');
            }
          }

          // Extract battery level and coordinates if encoded in the name (e.g. Name:Battery:Lat,Lng or Name:Battery)
          let nameToCheck = parsedSender || normalizedName;
          let batteryValue = 100;
          let parsedCoords: [number, number] | null = null;
          
          if (!normalizedName.startsWith('M:')) {
            const nameParts = normalizedName.split(':');
            if (nameParts.length >= 2) {
              nameToCheck = nameParts[0];
              if (!isNaN(Number(nameParts[1]))) {
                batteryValue = parseInt(nameParts[1], 10);
              }
              if (nameParts.length >= 3) {
                const coordParts = nameParts[2].split(',');
                if (coordParts.length === 2) {
                  const part0 = coordParts[0];
                  const part1 = coordParts[1];
                  const isBase36 = /[a-z]/i.test(part0) || /[a-z]/i.test(part1) || (!part0.includes('.') && !part1.includes('.'));
                  
                  if (isBase36) {
                    const latRaw = parseInt(part0, 36);
                    const lngRaw = parseInt(part1, 36);
                    if (!isNaN(latRaw) && !isNaN(lngRaw)) {
                      const lat = (latRaw / 10000) - 90;
                      const lng = (lngRaw / 10000) - 180;
                      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                        parsedCoords = [lng, lat];
                      }
                    }
                  } else {
                    const lat = parseFloat(part0);
                    const lng = parseFloat(part1);
                    if (!isNaN(lat) && !isNaN(lng)) {
                      parsedCoords = [lng, lat]; // [longitude, latitude] for mapping
                    }
                  }
                }
              }
            }
          }

          const isAuthorizedName = nameToCheck && authorizedNamesRef.current.some(
            authName => authName.toLowerCase().startsWith(nameToCheck.toLowerCase()) || 
                        nameToCheck.toLowerCase().startsWith(authName.toLowerCase())
          );
          const isAuthorizedId = authorizedIdsRef.current.includes(device.id);
          const isBaseMsg = normalizedName.startsWith('M:');
          // Re-check mesh pattern against normalizedName (decoded from ManufacturerData)
          // This catches Base Station broadcasts that have no local_name/serviceUUIDs
          const isMeshPatternMD = isMeshMapName(normalizedName, authorizedNamesRef.current);
          // Detect Base Station GPS beacon: "Base:99:lat,lng"
          const isBaseGps = normalizedName.startsWith('Base:');

          if (hasOurUUID || hasOurUUIDRaw || isOurName || isOurLocalName || isMeshPattern || isMeshPatternMD || isAuthorizedName || isAuthorizedId || isBaseMsg || isBaseGps) {
            console.warn(`[MESH NODE DETECTED] ${nameStr} (${device.id}) hasUUID=${hasOurUUID} hasUUIDRaw=${hasOurUUIDRaw} isMeshPattern=${isMeshPattern} nameToCheck=${nameToCheck} isBaseMsg=${isBaseMsg}`);
            const rssi = device.rssi || -100;

            // Basic distance approximation based on RSSI free-space path loss
            const txPower = -59; 
            const ratio = rssi * 1.0 / txPower;
            const distance = ratio < 1.0 ? Math.pow(ratio, 10) : (0.89976) * Math.pow(ratio, 7.7095) + 0.111;

            // Process BLE message if present
            if (parsedSender && parsedMsg) {
              setMeshState(prev => {
                const isDuplicate = prev.messages.some(
                  m => m.sender === parsedSender && m.text === parsedMsg && Date.now() - m.timestamp < 12000
                );
                if (isDuplicate) return prev;

                const newMessage = {
                  id: Math.random().toString(),
                  sender: parsedSender,
                  text: parsedMsg,
                  timestamp: Date.now()
                };
                return {
                  ...prev,
                  messages: [...prev.messages, newMessage],
                  logs: [...prev.logs, `[CHAT] ${parsedSender}: ${parsedMsg}`]
                };
              });
            }

            setMeshState(prevState => {
              const existingNodes = [...prevState.nodes];
              const displayName = parsedSender || nameToCheck || `Hiker ${device.id.substring(0, 4)}`;
              // Match by ID OR Name to prevent duplicate entries from rotating MACs (RPA)
              const existingIndex = existingNodes.findIndex(
                n => n.id === device.id || (displayName && n.name === displayName)
              );
              const timestamp = new Date().toLocaleTimeString();
              let newLogs = [...prevState.logs];

              // Determine coordinates:
              // 1. If parsedCoords are present in the payload, use them.
              // 2. Otherwise, if it's a message payload (or coordinates are missing from name), preserve existing coordinates.
              // 3. Otherwise, fall back to myLocation + offset.
              const myLoc = prevState.myLocation;
              const existingCoords = existingIndex >= 0 ? existingNodes[existingIndex].coordinates : undefined;
              let coordsToUse: [number, number];
              
              if (parsedCoords) {
                coordsToUse = parsedCoords;
              } else if (existingCoords) {
                coordsToUse = existingCoords;
              } else {
                coordsToUse = [
                  myLoc ? myLoc[0] + (Math.random() - 0.5) * 0.001 : -122.4194 + (Math.random() - 0.5) * 0.01,
                  myLoc ? myLoc[1] + (Math.random() - 0.5) * 0.001 : 37.7749 + (Math.random() - 0.5) * 0.01
                ];
              }

              const existingBattery = existingIndex >= 0 ? existingNodes[existingIndex].battery : 100;
              const batteryToUse = (!normalizedName.startsWith('M:') && batteryValue !== 100)
                ? batteryValue
                : existingBattery;

              const node: NodeData = {
                id: device.id, // Update node ID to the current MAC address
                name: displayName,
                battery: batteryToUse,
                rssi: rssi,
                distance: parseFloat(distance.toFixed(1)),
                coordinates: coordsToUse,
                hops: 1,
                lastSeen: Date.now()
              };

              if (existingIndex >= 0) {
                existingNodes[existingIndex] = node;
              } else {
                if (existingNodes.length < 20) {
                  existingNodes.push(node);
                  console.warn(`[MESH NODE ADDED] ${node.name} (${node.id}) — total nodes: ${existingNodes.length}`);
                  newLogs.push(`[${timestamp}] Discovered MeshMap Node: ${node.name} (${node.id.substring(0, 4)})`);
                }
              }

              if (newLogs.length > 50) newLogs.splice(0, newLogs.length - 50);
              
              // Remove from unknown if it's now known
              const unknownDevices = prevState.unknownDevices.filter(d => d.id !== device.id && d.name !== displayName);

              return { ...prevState, nodes: existingNodes, logs: newLogs, unknownDevices };
            });
          } else {
            // Track as an unknown device for manual pairing!
            setMeshState(prevState => {
              const displayName = parsedSender || nameToCheck;
              if (!displayName) return prevState;
              const existingUnknown = [...prevState.unknownDevices];
              // Prevent spamming multiple rotating MACs for the same device name
              if (!existingUnknown.find(d => d.id === device.id || d.name === displayName)) {
                existingUnknown.push({ id: device.id, name: displayName, rssi: device.rssi });
              }
              return { ...prevState, unknownDevices: existingUnknown };
            });
          }
        });
      };

      const subscription = managerRef.current.onStateChange((state: any) => {
        if (state === 'PoweredOn') {
          console.log('[SCANNER] Bluetooth PoweredOn, starting wide scan...');
          runScanner();
          if (scanTimer) clearInterval(scanTimer);
          scanTimer = setInterval(runScanner, 25000);
        }
      }, true);

      // Node Expiry Engine: Remove nodes we haven't seen in 45 seconds (increased from 15s to handle brief packet drops / MAC rotation)
      const expiryInterval = setInterval(() => {
        setMeshState(prevState => {
          const now = Date.now();
          const activeNodes = prevState.nodes.filter(n => {
            if (!n.lastSeen) return true; // Mock nodes don't expire
            return now - n.lastSeen < 45000;
          });
          
          if (activeNodes.length !== prevState.nodes.length) {
            return {
              ...prevState,
              nodes: activeNodes,
              logs: [...prevState.logs, `[SYSTEM] A node went offline (timeout).`]
            };
          }
          return prevState;
        });
      }, 5000);

      return () => {
        if (scanTimer) clearInterval(scanTimer);
        managerRef.current.stopDeviceScan();
        subscription.remove();
        clearInterval(expiryInterval);
      };
    }
  }, [permissionsGranted]);

  // 2. Fallback Mock Engine (If hardware missing or permissions denied)
  useEffect(() => {
    if (!BleManager || (!permissionsGranted && permissionError)) {
      setMeshState(prev => ({
        ...prev,
        logs: [...prev.logs, '[SYSTEM] Proceeding with Mock Data Engine.'],
        nodes: prev.nodes.length === 0 ? [
          { id: 'B', name: 'Hiker B', battery: 85, rssi: -65, distance: 120, coordinates: [-122.4194, 37.7749], hops: 1 },
          { id: 'C', name: 'Hiker C', battery: 60, rssi: -82, distance: 340, coordinates: [-122.4180, 37.7755], hops: 2 },
        ] : prev.nodes
      }));

      const interval = setInterval(() => {
        setMeshState(prevState => {
          const timestamp = new Date().toLocaleTimeString();
          const newLogs = [...prevState.logs];
          
          const newNodes = prevState.nodes.map(node => {
            const dLat = (Math.random() - 0.5) * 0.0001;
            const dLng = (Math.random() - 0.5) * 0.0001;
            const dRssi = Math.floor((Math.random() - 0.5) * 10);
            const newRssi = Math.min(-30, Math.max(-100, node.rssi + dRssi));
            const newHops = newRssi < -85 ? 3 : (newRssi < -70 ? 2 : 1);
            const newDistance = Math.floor(Math.abs(newRssi) * 3.5);
            const newBattery = Math.max(0, node.battery - (Math.random() > 0.8 ? 1 : 0));

            if (Math.random() > 0.8) {
               newLogs.push(`[${timestamp}] Mock Packet | Node ${node.id} | RSSI: ${newRssi}dBm`);
            }

            return {
              ...node,
              battery: newBattery,
              rssi: newRssi,
              distance: newDistance,
              coordinates: [node.coordinates[0] + dLng, node.coordinates[1] + dLat] as [number, number],
              hops: newHops
            };
          });

          if (newLogs.length > 50) newLogs.splice(0, newLogs.length - 50);
          return { nodes: newNodes, logs: newLogs };
        });
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [permissionsGranted, permissionError]);

  const saveLongRange = async (val: boolean) => {
    setLongRange(val);
    await safeSetItem('meshmap_long_range', String(val));
    setMeshState(prev => ({
      ...prev,
      logs: [...prev.logs, `[SYSTEM] Long Range Mode set to: ${val}`]
    }));
  };

  return {
    nodes: meshState.nodes,
    logs: meshState.logs,
    myLocation: meshState.myLocation,
    unknownDevices: meshState.unknownDevices,
    messages: meshState.messages,
    sendMessage,
    username,
    setUsername: saveUsername,
    longRange,
    setLongRange: saveLongRange,
    authorizeDevice,
    permissionsGranted,
    permissionError
  };
}
