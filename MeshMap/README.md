# MeshMap

MeshMap is an off-grid, connectionless BLE advertising platform built for mobile and bare-metal environments. It enables decentralized, infrastructure-free communication and geolocation sharing over Bluetooth Low Energy (BLE) without requiring pairing, internet, or cellular networks.

## How it Works

MeshMap operates using **Connectionless BLE Advertising (Broadcast Mode)**:
1. **No Pairing Required**: Devices broadcast encrypted payloads in the open BLE advertising spectrum. 
2. **Stateless Propagation**: There are no persistent connections or handshakes. Devices continuously scan for and parse incoming broadcast packets.
3. **Relay Mode**: Any device running MeshMap can act as a passive relay, instantly re-broadcasting received payloads to extend the network's physical range deeper into denied environments.

## Tech Stack
- **Framework**: React Native (Expo)
- **Native Bluetooth**: `react-native-ble-plx` (Scanning) and `react-native-ble-peripheral-manager` (Advertising)
- **Mapping**: `react-native-maps` for localized geospatial visualization
- **State Management**: React Hooks & Context API

## Real-World Applications

MeshMap's dual deployment modes—**With Mobile Phones** (leveraging existing consumer hardware) and **Without Mobile Phones** (flashing the protocol directly onto bare-metal microcontrollers/embedded chips)—make it highly versatile across multiple industries.

### 1. Search & Rescue (SAR)
* **With Phones**: Search parties can map tracking vectors, share hand-drawn canvas path overlays, and drop localized hazard markers across deep, infrastructure-denied terrain.
* **Without Phones**: Integrates low-cost, passive transponders directly into consumer outdoor gear (hiking boot heels, life vests, or safety helmets) that activate automatically upon impact or water immersion, broadcasting long-range survival signals through dense foliage or snow.

### 2. Maritime & Fishing
* **With Phones**: Enables ship-to-ship communication and location tracking at sea where VHF radios are unavailable or impractical.
* **Without Phones**: Deployable on autonomous buoys to relay data back to shore or alert nearby vessels of hazards.

### 3. Industrial & Mining
* **With Phones**: Workers deep underground can maintain contact and share location vectors with surface operators through a daisy-chain of phones acting as relays.
* **Without Phones**: Bare-metal beacons placed along tunnels act as static relay points, creating an unbroken chain of telemetry without expensive Wi-Fi infrastructure.

## Usage & Installation

### Local Development
To run the app locally on a development device:
```bash
npm install
npx expo start
```

### Standalone Production App
Due to the intense native Android requirements for BLE advertising and scanning, MeshMap is configured to be built via **GitHub Actions** in a pristine Linux environment.

1. Navigate to the **Actions** tab on this GitHub repository.
2. Click on the **Build Android APK** workflow.
3. Once the build finishes, download the `MeshMap-Release-APK` artifact.
4. Transfer the `.apk` file to your Android device and install it (ensure "Install from Unknown Sources" is enabled).

*Note: The app requires Location and Bluetooth permissions to function in the real world.*
