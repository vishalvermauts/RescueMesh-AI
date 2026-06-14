"""Quick test: Start a publisher with ManufacturerData then scan for it from the same machine"""
import asyncio
import winrt.windows.devices.bluetooth.advertisement as adv
from winrt.windows.storage.streams import DataWriter, DataReader

async def main():
    # Start publisher
    ad = adv.BluetoothLEAdvertisement()
    writer = DataWriter()
    payload = b'M:Base:TestMsg'
    writer.write_bytes(payload)
    md = adv.BluetoothLEManufacturerData(0xFFFF, writer.detach_buffer())
    ad.manufacturer_data.append(md)
    
    pub = adv.BluetoothLEAdvertisementPublisher(ad)
    pub.start()
    print(f"Publisher status: {pub.status}")
    print(f"Broadcasting ManufacturerData: {payload.decode()}")
    
    # Now scan to see if we can pick up our own advertisement (or any with 0xFFFF)
    watcher = adv.BluetoothLEAdvertisementWatcher()
    watcher.scanning_mode = adv.BluetoothLEScanningMode.ACTIVE
    
    found_self = False
    def on_received(sender, args):
        nonlocal found_self
        ad_data = args.advertisement
        if ad_data.manufacturer_data.size > 0:
            for i in range(ad_data.manufacturer_data.size):
                md_item = ad_data.manufacturer_data[i]
                if md_item.company_id == 0xFFFF:
                    reader = DataReader.from_buffer(md_item.data)
                    data_bytes = bytes(reader.read_bytes(md_item.data.length))
                    text = data_bytes.decode('utf-8', errors='ignore')
                    print(f"  FOUND 0xFFFF ManufacturerData from {args.bluetooth_address:012X}: [{text}]")
                    if 'Base' in text or 'M:' in text:
                        found_self = True
    
    token = watcher.add_received(on_received)
    watcher.start()
    print("Scanning for 5 seconds...")
    
    await asyncio.sleep(5)
    
    watcher.stop()
    pub.stop()
    
    if found_self:
        print("\nSUCCESS: Publisher advertisement was detected by scanner!")
    else:
        print("\nWARNING: Publisher advertisement was NOT detected. This may indicate BLE radio cannot receive its own ads.")
    
    # Also test if publisher and scanner can coexist
    print("\n--- Testing Publisher + Bleak Scanner coexistence ---")
    from bleak import BleakScanner
    
    # Restart publisher
    ad2 = adv.BluetoothLEAdvertisement()
    w2 = DataWriter()
    w2.write_bytes(b'M:Base:Hello')
    md2 = adv.BluetoothLEManufacturerData(0xFFFF, w2.detach_buffer())
    ad2.manufacturer_data.append(md2)
    pub2 = adv.BluetoothLEAdvertisementPublisher(ad2)
    pub2.start()
    print(f"Publisher started, status: {pub2.status}")
    
    # Run Bleak scanner
    devices_seen = 0
    def callback(device, adv_data):
        nonlocal devices_seen
        devices_seen += 1
    
    scanner = BleakScanner(callback)
    await scanner.start()
    print("Bleak scanner running alongside publisher for 5 seconds...")
    await asyncio.sleep(5)
    await scanner.stop()
    pub2.stop()
    
    print(f"Bleak scanner saw {devices_seen} device advertisements while publisher was active")
    if devices_seen > 0:
        print("SUCCESS: Scanner works alongside publisher!")
    else:
        print("FAILURE: Scanner saw NOTHING while publisher was active - they conflict!")

asyncio.run(main())
