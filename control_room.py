import asyncio
import sys
import time
import datetime
import threading
import csv
import os
import customtkinter as ctk
import tkintermapview
import geocoder
from bleak import BleakScanner, BLEDevice, AdvertisementData
from foundry_iq_client import query_foundry_iq

try:
    from winrt.windows.devices.bluetooth.advertisement import (
        BluetoothLEAdvertisementPublisher,
        BluetoothLEAdvertisement,
        BluetoothLEAdvertisementDataSection,
        BluetoothLEManufacturerData
    )
    from winrt.windows.storage.streams import DataWriter
    WINSDK_AVAILABLE = True
except ImportError:
    WINSDK_AVAILABLE = False

MESHMAP_SERVICE_UUID = "0000fef0-0000-1000-8000-00805f9b34fb"
EXPIRY_TIME_SECONDS = 300  # Increased for geofencing rules

# Shared State
nodes = {}
messages = []
base_lat = "37.7749"
base_lng = "-122.4194"
pending_message = None
active_publisher = None

# Init Telemetry CSV
CSV_FILENAME = "meshmap_telemetry.csv"
if not os.path.exists(CSV_FILENAME):
    with open(CSV_FILENAME, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Timestamp", "MAC", "Name", "Battery", "RSSI", "Lat", "Lng", "AlertState"])

def log_telemetry(mac, name, battery, rssi, lat, lng, alert_state="OK"):
    try:
        with open(CSV_FILENAME, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow([datetime.datetime.now().isoformat(), mac, name, battery, rssi, lat, lng, alert_state])
    except:
        pass

BLOCKS = [" ", " ", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
def get_sparkline(history):
    out = ""
    for r in history:
        idx = int((r + 100) / (60 / 8))
        idx = max(0, min(8, idx))
        out += BLOCKS[idx]
    return out

def decode_coord(val36, offset):
    try:
        return (int(val36, 36) / 10000.0) - offset
    except:
        return None

def update_publisher_payload(payload):
    if not WINSDK_AVAILABLE: return
    
    global active_publisher
    if active_publisher:
        active_publisher.stop()
        active_publisher = None

    adv = BluetoothLEAdvertisement()
    
    # Absolute max payload size is 25 bytes to fit inside ManufacturerData without extra headers
    if len(payload.encode('utf-8')) > 25:
        payload = payload[:25]
        
    writer = DataWriter()
    writer.write_bytes(payload.encode('utf-8'))
    md = BluetoothLEManufacturerData(0xFFFF, writer.detach_buffer())
    adv.manufacturer_data.append(md)
    
    active_publisher = BluetoothLEAdvertisementPublisher(adv)
    active_publisher.start()

async def revert_to_gps(delay):
    await asyncio.sleep(delay)
    update_publisher_payload(get_base_station_payload())

def to_base36(num):
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    if num == 0:
        return "0"
    res = ""
    while num > 0:
        num, rem = divmod(num, 36)
        res = chars[rem] + res
    return res

def get_base_station_payload():
    try:
        lat = float(base_lat)
        lng = float(base_lng)
        lat_b36 = to_base36(int((lat + 90) * 10000))
        lng_b36 = to_base36(int((lng + 180) * 10000))
        return f"Base:99:{lat_b36},{lng_b36}"
    except:
        return "Base:99:0,0"

def parse_meshmap_data(device: BLEDevice, adv_data: AdvertisementData):
    global nodes, messages
    mac = device.address
    rssi = adv_data.rssi
    local_name = adv_data.local_name or device.name or ""
    
    # Also try to decode ManufacturerData (company 0xFFFF) as a fallback name source
    md_name = ""
    if adv_data.manufacturer_data and 0xFFFF in adv_data.manufacturer_data:
        try:
            md_bytes = adv_data.manufacturer_data[0xFFFF]
            md_name = bytes(md_bytes).decode('utf-8', errors='ignore')
        except:
            pass
    
    # Use ManufacturerData-decoded name if local_name is empty
    effective_name = local_name or md_name
    
    is_meshmap = False
    uuids = adv_data.service_uuids
    if uuids and MESHMAP_SERVICE_UUID in [u.lower() for u in uuids]:
        is_meshmap = True
    elif effective_name == "MM" or effective_name.startswith("M:") or (effective_name.startswith("h") and len(effective_name) >= 3 and effective_name[1:3].isdigit()):
        is_meshmap = True
    elif ":" in effective_name and len(effective_name.split(":")) >= 2 and effective_name.split(":")[1].isdigit():
        is_meshmap = True
    # Detect other Base Stations broadcasting GPS beacons via ManufacturerData
    elif effective_name.startswith("Base:"):
        is_meshmap = True

    if not is_meshmap: return
    
    # Use effective_name (which includes MD fallback) for all further processing
    local_name = effective_name

    display_name = local_name
    battery = "100"
    lat = None
    lng = None
    
    if local_name.startswith("M:"):
        parts = local_name.split(":")
        if len(parts) >= 3:
            sender = parts[1]
            msg_text = ":".join(parts[2:])
            display_name = sender
            msg_id = f"{sender}_{msg_text}"
            
            # Repeater Mode Interception!
            if sender != "Base" and not any(m['id'] == msg_id for m in messages):
                messages.append({"id": msg_id, "sender": sender, "text": msg_text, "time": datetime.datetime.now().strftime("%H:%M:%S")})
                if len(messages) > 30:
                    messages.pop(0)
                
                # Check for Foundry IQ trigger
                if msg_text.strip().upper().startswith("@IQ"):
                    # Start async task to query AI
                    async def fetch_iq():
                        try:
                            # Log that AI is thinking
                            messages.append({"id": f"IQ_think_{time.time()}", "sender": "Foundry IQ", "text": "Thinking...", "time": datetime.datetime.now().strftime("%H:%M:%S")})
                            # Strip the @IQ trigger so the AI only sees the actual question
                            # e.g., "@IQ canyon" -> "canyon"
                            clean_query = msg_text.strip()[3:].strip()
                            
                            # Secretly append 'weather forecast' so the AI knows to check the Vector Store
                            # This allows the hiker to type a tiny BLE message but still get the right data!
                            augmented_query = f"{clean_query} weather forecast alerts"
                            
                            iq_response = await query_foundry_iq(augmented_query)
                            iq_response = iq_response.replace("[Foundry IQ] ", "").strip()
                            
                            # Log full response in Base Station UI
                            messages.append({"id": f"IQ_res_{time.time()}", "sender": "Foundry IQ", "text": iq_response, "time": datetime.datetime.now().strftime("%H:%M:%S")})
                            
                            # BLE Manufacturer Data is strictly limited to ~25 bytes total.
                            # "M:IQ:" is 5 bytes. Leaves 20 bytes for text.
                            chunks = [iq_response[i:i+20] for i in range(0, len(iq_response), 20)]
                            
                            for chunk in chunks:
                                update_publisher_payload(f"M:IQ:{chunk}")
                                await asyncio.sleep(4) # Broadcast each chunk for 4 seconds so phones catch it
                            
                            update_publisher_payload(get_base_station_payload()) # Return to GPS
                            
                        except Exception as e:
                            print("IQ Error:", e)
                    asyncio.create_task(fetch_iq())
                else:
                    # Repeater Logic: Instantly repeat standard messages so others hear it
                    global pending_message
                    pending_message = f"M:{sender}:{msg_text}"
                
    else:
        parts = local_name.split(":")
        if len(parts) >= 2:
            display_name = parts[0]
            if parts[1].isdigit():
                battery = parts[1]
            if len(parts) >= 3 and "," in parts[2]:
                # Decode GPS Base36
                coords = parts[2].split(",")
                lat = decode_coord(coords[0], 90)
                lng = decode_coord(coords[1], 180)

    node_name = display_name or f"Unknown {mac[-5:]}"
    
    alert_state = "OK"
    if int(battery) < 15:
        alert_state = "LOW BATTERY"

    if mac not in nodes:
        nodes[mac] = {"name": node_name, "battery": battery, "rssi": rssi, "lat": lat, "lng": lng, "last_seen": time.time(), "history": [rssi]}
    else:
        nodes[mac]["name"] = node_name
        nodes[mac]["battery"] = battery
        nodes[mac]["rssi"] = rssi
        nodes[mac]["last_seen"] = time.time()
        
        # Update coordinates if provided
        if lat is not None and lng is not None:
            # Stationary Geofence check
            old_lat = nodes[mac].get("lat")
            old_lng = nodes[mac].get("lng")
            if old_lat and old_lng and abs(old_lat - lat) < 0.0001 and abs(old_lng - lng) < 0.0001:
                # Same position, don't clear stationary timer if we had one
                pass
            nodes[mac]["lat"] = lat
            nodes[mac]["lng"] = lng

        nodes[mac]["history"].append(rssi)
        if len(nodes[mac]["history"]) > 10:
            nodes[mac]["history"].pop(0)

    log_telemetry(mac, node_name, battery, rssi, lat, lng, alert_state)

async def bt_main():
    if WINSDK_AVAILABLE:
        update_publisher_payload(get_base_station_payload())

    scanner = BleakScanner(parse_meshmap_data)
    await scanner.start()
    
    try:
        while True:
            global pending_message
            if pending_message:
                msg = pending_message
                pending_message = None
                
                if msg.startswith("M:"):
                    # Repeater Mode relaying exact message
                    update_publisher_payload(msg)
                else:
                    update_publisher_payload(f"M:Base:{msg}")
                    messages.append({"id": f"Base_{msg}", "sender": "Base", "text": msg, "time": datetime.datetime.now().strftime("%H:%M:%S")})
                    
                asyncio.create_task(revert_to_gps(10)) # Repeat/Broadcast for 10 seconds
            await asyncio.sleep(0.1)
    except asyncio.CancelledError:
        pass
    finally:
        await scanner.stop()
        if active_publisher:
            active_publisher.stop()

def run_bluetooth_engine():
    asyncio.run(bt_main())

# ----------------- GUI -----------------

ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")

class SetupModal(ctk.CTkToplevel):
    def __init__(self, parent):
        super().__init__(parent)
        self.title("Base Station Configuration")
        self.geometry("350x250")
        self.resizable(False, False)
        
        self.update_idletasks()
        x = parent.winfo_x() + (parent.winfo_width() // 2) - (350 // 2)
        y = parent.winfo_y() + (parent.winfo_height() // 2) - (250 // 2)
        self.geometry(f"+{x}+{y}")
        self.grab_set()

        ctk.CTkLabel(self, text="Set Base Station Coordinates", font=ctk.CTkFont(size=18, weight="bold")).pack(pady=(20,10))
        
        # Auto-fetch laptop coordinates
        try:
            g = geocoder.ip('me')
            default_lat = str(g.latlng[0]) if g.latlng else "37.7749"
            default_lng = str(g.latlng[1]) if g.latlng else "-122.4194"
        except:
            default_lat = "37.7749"
            default_lng = "-122.4194"

        self.lat_entry = ctk.CTkEntry(self, width=200, placeholder_text="Latitude")
        self.lat_entry.insert(0, default_lat)
        self.lat_entry.pack(pady=5)
        self.lng_entry = ctk.CTkEntry(self, width=200, placeholder_text="Longitude")
        self.lng_entry.insert(0, default_lng)
        self.lng_entry.pack(pady=5)
        ctk.CTkButton(self, text="Start Broadcasting", command=self.save_and_close).pack(pady=20)

    def save_and_close(self):
        global base_lat, base_lng
        base_lat = self.lat_entry.get()
        base_lng = self.lng_entry.get()
        self.master.init_map(float(base_lat), float(base_lng))
        threading.Thread(target=run_bluetooth_engine, daemon=True).start()
        self.destroy()

class MeshMapApp(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("MeshMap Base Station Command Center")
        self.geometry("1400x800")
        
        self.grid_columnconfigure(0, weight=1) # Dashboard
        self.grid_columnconfigure(1, weight=3) # Map
        self.grid_columnconfigure(2, weight=1) # Chat & Emergency
        self.grid_rowconfigure(0, weight=1)

        # Left Panel - Dashboard
        self.dash_frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self.dash_frame.grid(row=0, column=0, sticky="nsew", padx=10, pady=10)
        ctk.CTkLabel(self.dash_frame, text="Active Hikers", font=ctk.CTkFont(size=24, weight="bold")).pack(anchor="w", pady=(0,10))
        self.nodes_container = ctk.CTkFrame(self.dash_frame, fg_color="transparent")
        self.nodes_container.pack(fill="x")
        self.node_widgets = {}

        # Center Panel - Map
        self.map_frame = ctk.CTkFrame(self, corner_radius=15)
        self.map_frame.grid(row=0, column=1, sticky="nsew", padx=10, pady=10)
        self.map_widget = tkintermapview.TkinterMapView(self.map_frame, corner_radius=15)
        self.map_widget.set_tile_server("https://mt0.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}&s=Ga", max_zoom=22)
        self.map_widget.pack(fill="both", expand=True)
        self.map_markers = {}

        # Right Panel - Chat & SOS
        self.right_frame = ctk.CTkFrame(self, corner_radius=15, fg_color="transparent")
        self.right_frame.grid(row=0, column=2, sticky="nsew", padx=10, pady=10)
        
        self.chat_frame = ctk.CTkFrame(self.right_frame, corner_radius=15)
        self.chat_frame.pack(fill="both", expand=True, pady=(0, 10))
        
        ctk.CTkLabel(self.chat_frame, text="Offline Mesh Chat", font=ctk.CTkFont(size=18, weight="bold")).pack(pady=(15,10))
        self.chat_textbox = ctk.CTkTextbox(self.chat_frame, state="disabled", wrap="word", fg_color="transparent")
        self.chat_textbox.pack(fill="both", expand=True, padx=10, pady=10)

        self.input_frame = ctk.CTkFrame(self.chat_frame, fg_color="transparent")
        self.input_frame.pack(fill="x", padx=10, pady=15)
        self.chat_input = ctk.CTkEntry(self.input_frame, placeholder_text="Type a message...")
        self.chat_input.pack(side="left", fill="x", expand=True, padx=(0,10))
        self.chat_input.bind("<Return>", lambda e: self.send_message())
        ctk.CTkButton(self.input_frame, text="Send", width=60, command=self.send_message).pack(side="right")

        # Emergency Buttons
        self.sos_frame = ctk.CTkFrame(self.right_frame, corner_radius=15)
        self.sos_frame.pack(fill="x")
        ctk.CTkButton(self.sos_frame, text="🚨 SOS TO ALL 🚨", fg_color="#DC2626", hover_color="#991B1B", font=ctk.CTkFont(weight="bold"), command=self.send_sos).pack(fill="x", padx=10, pady=10)
        ctk.CTkButton(self.sos_frame, text="RETURN TO BASE", fg_color="#D97706", hover_color="#B45309", font=ctk.CTkFont(weight="bold"), command=self.send_return).pack(fill="x", padx=10, pady=(0,10))

        self.after(200, self.open_setup)
        self.update_ui()

    def open_setup(self):
        SetupModal(self)

    def init_map(self, lat, lng):
        self.map_widget.set_position(lat, lng)
        self.map_widget.set_zoom(15)
        self.map_widget.set_marker(lat, lng, text="BASE STATION", marker_color_circle="#3B82F6", marker_color_outside="#1D4ED8")

    def send_message(self, text=None):
        global pending_message
        msg = text if text else self.chat_input.get().strip()
        if msg:
            pending_message = msg
            self.chat_input.delete(0, 'end')

    def send_sos(self):
        self.send_message("SOS! All Halt!")

    def send_return(self):
        self.send_message("Return to Base!")

    def update_ui(self):
        now = time.time()
        
        # Render Nodes and Geofence Logic
        for mac, data in list(nodes.items()):
            time_since = now - data['last_seen']
            
            # Remove stale nodes from map if older than expiry
            if time_since > EXPIRY_TIME_SECONDS:
                del nodes[mac]
                if mac in self.node_widgets:
                    self.node_widgets[mac]["frame"].destroy()
                    del self.node_widgets[mac]
                if mac in self.map_markers:
                    self.map_markers[mac].delete()
                    del self.map_markers[mac]
                continue

            # Geofencing / Alert Colors
            border_color = "#334155" # Default
            alert_text = f"{int(time_since)}s ago"
            text_color = "#94A3B8"
            
            if time_since > 60:
                border_color = "#B45309" # Warning Orange
                text_color = "#D97706"
                alert_text = "SIGNAL LOST?"
            if int(data['battery']) < 15:
                border_color = "#991B1B" # Red
                text_color = "#DC2626"
                alert_text = "LOW BATT"

            if mac not in self.node_widgets:
                card = ctk.CTkFrame(self.nodes_container, corner_radius=10, border_width=2, border_color=border_color)
                card.pack(fill="x", pady=5)
                
                header = ctk.CTkFrame(card, fg_color="transparent")
                header.pack(fill="x", padx=15, pady=10)
                name_lbl = ctk.CTkLabel(header, text=data['name'], font=ctk.CTkFont(size=16, weight="bold"))
                name_lbl.pack(side="left")
                batt_lbl = ctk.CTkLabel(header, text=f"{data['battery']}%", text_color="#10B981")
                batt_lbl.pack(side="right")

                stats = ctk.CTkFrame(card, fg_color="transparent")
                stats.pack(fill="x", padx=15, pady=(0,10))
                rssi_lbl = ctk.CTkLabel(stats, text=f"{data['rssi']} dBm")
                rssi_lbl.pack(side="left")
                graph_lbl = ctk.CTkLabel(stats, text="", font=ctk.CTkFont(family="Consolas", size=14))
                graph_lbl.pack(side="left", padx=10)
                ago_lbl = ctk.CTkLabel(stats, text=alert_text, text_color=text_color, font=ctk.CTkFont(weight="bold"))
                ago_lbl.pack(side="right")

                self.node_widgets[mac] = {
                    "frame": card, "name": name_lbl, "batt": batt_lbl,
                    "rssi": rssi_lbl, "graph": graph_lbl, "ago": ago_lbl
                }

            w = self.node_widgets[mac]
            w["frame"].configure(border_color=border_color)
            w["name"].configure(text=data['name'])
            w["batt"].configure(text=f"{data['battery']}%", text_color="#EF4444" if int(data['battery'])<15 else "#10B981")
            w["rssi"].configure(text=f"{data['rssi']} dBm")
            w["graph"].configure(text=get_sparkline(data["history"]))
            w["ago"].configure(text=alert_text, text_color=text_color)
            
            # Map Update
            if data['lat'] is not None and data['lng'] is not None:
                if mac not in self.map_markers:
                    marker = self.map_widget.set_marker(data['lat'], data['lng'], text=data['name'])
                    self.map_markers[mac] = marker
                else:
                    self.map_markers[mac].set_position(data['lat'], data['lng'])
                    self.map_markers[mac].set_text(data['name'])

        # Render Chat
        self.chat_textbox.configure(state="normal")
        current_text = self.chat_textbox.get("1.0", "end-1c")
        desired_text = ""
        for m in messages:
            desired_text += f"[{m['time']}] {m['sender']}:\n{m['text']}\n\n"
        if desired_text.strip() != current_text.strip():
            self.chat_textbox.delete("1.0", "end")
            self.chat_textbox.insert("end", desired_text)
            self.chat_textbox.see("end")
        self.chat_textbox.configure(state="disabled")

        self.after(500, self.update_ui)

if __name__ == "__main__":
    app = MeshMapApp()
    app.mainloop()
