# MeshMap Codebase Review & Recommendations

I've reviewed the core files of the MeshMap codebase (`useMobileMesh.ts`, `useBleBroadcaster.ts`, `index.tsx`, `map.tsx`, and `logs.tsx`). Below is a summary of architectural improvements, potential bugs, and performance optimization opportunities.

## 1. Architectural Improvements

### The `useMobileMesh.ts` Monolith
At nearly 800 lines, `useMobileMesh.ts` is doing too much. It handles BLE scanning, mock data generation, GPS tracking, battery monitoring, and complex data parsing.

**Recommendations:**
- **Extract BLE Scanning**: Move the `BleManager` initialization and `startDeviceScan` logic into a dedicated `useBleScanner` hook.
- **Extract GPS Tracking**: Move the `Location.watchPositionAsync` logic into a `useLocationTracking` hook.
- **Extract Parsers**: The floating standalone functions like `parseLocalNameFromAdData`, `decodeUtf8`, and `isMeshMapName` should be moved to a pure utility file (e.g., `src/utils/bleParser.ts`). This makes them testable without rendering a React component.
- **Extract Mock Engine**: Move the fallback timer logic into `useMockMeshEngine.ts`.

### Component Modularity in `app/(tabs)/index.tsx`
The Dashboard screen (`index.tsx`) is over 600 lines long and contains multiple distinct UI sections.

**Recommendations:**
- Extract the Chat section into a `<ChatSection />` component.
- Extract the Node list mapping into a `<NodeCard />` component.
- Extract the Settings card into a `<SettingsCard />` component.
- Move these to the `components/` directory to improve the readability of the main dashboard screen.

### Handling Missing Native Modules
The codebase handles missing native modules (like `react-native-ble-plx`) using `try/catch` around `require()` calls. While this works well for running inside Expo Go, a more standard approach in Expo is to check `Constants.executionEnvironment === 'storeClient'` or `Constants.appOwnership === 'expo'` to explicitly gate native module usage.

## 2. Potential Bugs & Logical Flaws

### Coordinate Parsing Logic (`useMobileMesh.ts`)
When parsing coordinates from the broadcast name:
```typescript
const isBase36 = /[a-z]/i.test(part0) || /[a-z]/i.test(part1) || (!part0.includes('.') && !part1.includes('.'));
```
If a standard decimal coordinate happens to be a whole number (e.g., `37` instead of `37.0`), it lacks a decimal point and will incorrectly be evaluated as Base36. This could lead to wild coordinates if someone's GPS naturally rounds to an integer.

### Global State for `pendingLogs`
In `useMobileMesh.ts`, there is a global `let pendingLogs: string[] = []` variable that is modified by side-effects in `safeGetItem` and `safeSetItem`, then flushed to React state via a `setInterval`.
While this works, using module-level variables for state accumulation can lead to subtle bugs in React, especially during hot reloading or if the hook is ever unmounted and remounted. It would be safer to handle logging through a React Context or an explicit logger class.

### Device Deduplication Logic (`app/(tabs)/logs.tsx`)
```typescript
if (!uniqueDevicesMap.has(name) || (d.rssi && d.rssi > uniqueDevicesMap.get(name).rssi))
```
If `d.rssi` is defined, but the previously stored `uniqueDevicesMap.get(name).rssi` is `undefined`, the numeric comparison might behave unpredictably in JS. It is safer to use:
```typescript
const existingRssi = uniqueDevicesMap.get(name).rssi ?? -Infinity;
if (!uniqueDevicesMap.has(name) || (d.rssi !== undefined && d.rssi > existingRssi))
```

## 3. Performance Enhancements

### BLE Scan State Throttling
Inside `managerRef.current.startDeviceScan`, `setMeshState` is called frequently.
While there is an attempt to throttle raw discovery logging using `lastRawLogRef.current`, the actual node addition:
```typescript
setMeshState(prevState => { ... return { ...prevState, nodes: existingNodes ... } })
```
happens for *every* relevant broadcast packet received. In dense environments, BLE scanners can pick up dozens of packets per second. Updating React state for every single packet can severely impact the JS thread and drop UI frames.

**Recommendation:** Accumulate discovered/updated nodes in a `useRef<Map<string, NodeData>>` and run a `setInterval` (e.g., every 1000ms) to flush the Map values into `setMeshState(nodes)`. This caps React re-renders to 1 FPS for data updates, keeping the UI smooth regardless of BLE packet density.

### Map Rendering (`app/(tabs)/map.tsx`)
The `MapScreen` mounts and immediately tries to build `allPoints` dynamically on every render pass. Using `useMemo` for the `allPoints` array would prevent unnecessary array allocations on every minor state update (e.g., when a user types in chat and `nodes` haven't really changed coordinates).
