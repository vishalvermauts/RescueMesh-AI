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

function parseLocalNameFromAdData(base64AdData: string): string | null {
  if (!base64AdData) return null;
  try {
    const atobFunc = typeof atob === 'function' ? atob : (str: string) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
      let output = '';
      str = str.replace(/=+$/, '');
      for (let bc = 0, bs = 0, buffer, idx = 0; buffer = str.charAt(idx++);
        ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer,
          bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0
      ) {
        buffer = chars.indexOf(buffer);
      }
      return output;
    };

    const binaryString = atobFunc(base64AdData);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    let index = 0;
    while (index < bytes.length) {
      const length = bytes[index];
      if (length === 0) break;
      if (index + length + 1 > bytes.length) break;

      const type = bytes[index + 1];
      if (type === 0x08 || type === 0x09) {
        const nameBytes = bytes.subarray(index + 2, index + length + 1);
        return String.fromCharCode.apply(null, Array.from(nameBytes));
      }
      index += length + 1;
    }
  } catch (e) {
    console.warn('Failed to parse BLE advertisingData:', e);
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

  const [username, setUsername] = useState(globalUsername);
  const [broadcastName, setBroadcastName] = useState(globalUsername);
  const [localBattery, setLocalBattery] = useState<number>(() => Math.floor(75 + Math.random() * 20));
  const [broadcastCoords, setBroadcastCoords] = useState<[number, number] | null>(null);
  const [longRange, setLongRange] = useState(false);

  useBleBroadcaster(permissionsGranted, broadcastName, localBattery, broadcastCoords, longRange);

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
    
    // ~0.0001 degrees is ~10 meters. Update if moved > 10m or every 30 seconds
    const threshold = 0.0001; 
    const timeThreshold = 30000; 

    if (distSq > threshold * threshold || (now - lastCoordsUpdateRef.current > timeThreshold)) {
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

  const [meshState, setMeshState] = useState<MeshState>({
    nodes: [],
    logs: ['[SYSTEM] MeshMap initialized.'],
    authorizedIds: [],
    authorizedNames: [],
    unknownDevices: [],
    messages: []
  });

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

      const subscription = managerRef.current.onStateChange((state: any) => {
        if (state === 'PoweredOn') {
          console.log('[SCANNER] Bluetooth PoweredOn, starting wide scan...');
          
          // Android hardware filtering for 128-bit UUIDs is notoriously buggy.
          // We will scan for ALL devices (null) and manually filter them in JavaScript
          // by looking for our broadcast signature: `Hiker_`
          managerRef.current.startDeviceScan(null, { allowDuplicates: true }, (error: any, device: any) => {
            if (error) {
              console.error('[SCANNER ERROR]', error);
              return;
            }

            if (!device) return;

            const adName = parseLocalNameFromAdData(device.advertisingData);
            
            // Log everything we see to the terminal so we know the scanner works!
            const nameStr = adName || device.localName || device.name || 'Unknown';
            const uuidStr = device.serviceUUIDs ? device.serviceUUIDs.join(',') : 'none';
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

            // 1. Check if it explicitly broadcasts our UUID (including 16-bit FEF0 representation)
            const hasOurUUID = device.serviceUUIDs && (
              device.serviceUUIDs.includes(MESHMAP_SERVICE_UUID.toLowerCase()) ||
              device.serviceUUIDs.includes(MESHMAP_SERVICE_UUID.toUpperCase()) ||
              device.serviceUUIDs.includes('fef0') ||
              device.serviceUUIDs.includes('FEF0')
            );
            
            // 2. Check if it broadcasts our tiny "MM" name
            const isOurName = device.name === 'MM' || adName === 'MM';
            const isOurLocalName = device.localName === 'MM';

            const normalizedName = adName || device.localName || device.name || '';
            
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
                    const lat = parseFloat(coordParts[0]);
                    const lng = parseFloat(coordParts[1]);
                    if (!isNaN(lat) && !isNaN(lng)) {
                      parsedCoords = [lng, lat]; // [longitude, latitude] for mapping
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

            if (hasOurUUID || isOurName || isOurLocalName || isAuthorizedName || isAuthorizedId) {
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
        }
      }, true);

      // Node Expiry Engine: Remove nodes we haven't seen in 15 seconds
      const expiryInterval = setInterval(() => {
        setMeshState(prevState => {
          const now = Date.now();
          const activeNodes = prevState.nodes.filter(n => {
            if (!n.lastSeen) return true; // Mock nodes don't expire
            return now - n.lastSeen < 15000;
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
