import base64, re

# Simulate what the Windows BLE publisher sends as ManufacturerData
payload = b'M:Base:SOS! All Halt!'

# react-native-ble-plx device.manufacturerData = base64([company_id_le] + [payload])
md_bytes = bytes([0xFF, 0xFF]) + payload
b64_md = base64.b64encode(md_bytes).decode()
print(f"manufacturerData base64: {b64_md}")

# Simulate the JS manual base64 decoder from useMobileMesh.ts
chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
b64_clean = re.sub(r'[^A-Za-z0-9+/]', '', b64_md)
ascii_out = ''
idx = 0
while idx < len(b64_clean):
    c1 = b64_clean[idx] if idx < len(b64_clean) else ''
    idx += 1
    c2 = b64_clean[idx] if idx < len(b64_clean) else ''
    idx += 1
    c3 = b64_clean[idx] if idx < len(b64_clean) else ''
    idx += 1
    c4 = b64_clean[idx] if idx < len(b64_clean) else ''
    idx += 1
    e1 = chars.find(c1)
    e2 = chars.find(c2)
    e3 = chars.find(c3)
    e4 = chars.find(c4)
    if e1 >= 0 and e2 >= 0:
        ascii_out += chr((e1 << 2) | (e2 >> 4))
    if e3 != -1:
        ascii_out += chr(((e2 & 15) << 4) | (e3 >> 2))
    if e4 != -1:
        ascii_out += chr(((e3 & 3) << 6) | e4)

print(f"Decoded ASCII repr: {repr(ascii_out)}")
m_idx = ascii_out.find('M:')
base_idx = ascii_out.find('Base:')
print(f"M: at index {m_idx}, Base: at index {base_idx}")
if m_idx >= 0:
    print(f"Extracted normalizedName: [{ascii_out[m_idx:]}]")

# Now also try parsing from rawScanRecord (fallback path)
# rawScanRecord = base64 of the full advertisement bytes
ad_len = 1 + 2 + len(payload)  # type(1) + company_id(2) + payload
ad_bytes = bytes([ad_len, 0xFF, 0xFF, 0xFF]) + payload
raw_b64 = base64.b64encode(ad_bytes).decode()
print(f"\nrawScanRecord base64: {raw_b64}")
raw_decoded = base64.b64decode(raw_b64)
print(f"rawScanRecord hex: {raw_decoded.hex()}")
# Check if 0xF0 0xFE (our UUID) appears - it shouldn't
for i in range(len(raw_decoded) - 1):
    if raw_decoded[i] == 0xF0 and raw_decoded[i+1] == 0xFE:
        print(f"Found FEF0 at offset {i}")
print("No FEF0 UUID found in raw scan record (expected)")

# Check the type byte
print(f"\nAD type at offset 1: 0x{raw_decoded[1]:02X} (0xFF = Manufacturer Specific)")
print(f"Company ID (LE): 0x{raw_decoded[3]:02X}{raw_decoded[2]:02X}")
