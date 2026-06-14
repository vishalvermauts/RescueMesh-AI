# 🏕️ RescueMesh AI: Offline-First Hybrid Edge Intelligence

## 🚀 The Pitch (Track: Creative Apps with GitHub Copilot)

**The Problem:** 
During natural disasters (hurricanes, floods, wildfires) or deep wilderness search-and-rescue (SAR) operations, cellular infrastructure is the first thing to fail. When first responders and victims are completely disconnected, they lose access to life-saving communication and real-time intelligence.

**The Solution:** 
RescueMesh AI is an offline-first disaster response and SAR platform. We built a custom **Bluetooth Low Energy (BLE) Mesh Network** that allows disconnected Android devices to bounce messages across a disaster zone. At the edge of the connectivity zone sits our Python Base Station, acting as a secure bridge. 

Using the **Microsoft Azure AI Projects SDK**, the Base Station intercepts offline SOS or status queries, securely queries our custom **Foundry IQ Agent** (grounded on hyper-local disaster intelligence, terrain, and weather vector data), and chunks the AI's response to be beamed back across the offline Bluetooth mesh. 

*(Note: We built and tested the initial prototype specifically for hikers in dead zones, but the architecture scales perfectly to any offline disaster scenario!)*

**Why it’s Creative:** 
We took an enterprise cloud LLM (Azure OpenAI) and brought it completely off the grid. We bypassed traditional internet requirements by using an Edge RAG orchestrator to proxy inferences over micro-bandwidth BLE packets.

---

## 💬 Demo Questions to Ask
*Since BLE packets are extremely small, keep your queries ultra-short!*

**1. The Flash Flood Warning**
* **You type:** `@IQ canyon?`
* **Foundry IQ:** *Expects: Rain, 55F, muddy and slick, flash flood watch.*

**2. The Extreme Weather Warning**
* **You type:** `@IQ summit?`
* **Foundry IQ:** *Expects: Blizzard, 15F, Whiteout conditions. DO NOT SUMMIT - Severe Weather!*

**3. The General Safety Check**
* **You type:** `@IQ ridge?`
* **Foundry IQ:** *Expects: High Winds, 60F, Loose rocks. High wind advisory - Gusts up to 45mph.*

---

## 🎥 Demo Video Recording Script

### **Scene 1: The Setup (0:00 - 0:15)**
* **Visual:** Split screen. On the left, the laptop running `control_room.py` (The Base Station). On the right, screen record your Android phone (The offline Hiker).
* **Voiceover:** *"Welcome to RescueMesh AI. We built a completely offline Bluetooth mesh network for disaster response. On the left is our Edge Base Station. On the right is an Android phone with airplane mode turned on, relying entirely on Bluetooth."*

### **Scene 2: The Agent in the Cloud (0:15 - 0:30)**
* **Visual:** Briefly show the Azure AI Foundry portal with the `Meshmap` agent and the `.md` Vector Store attached.
* **Voiceover:** *"To give offline victims and first responders intelligence, we built a Foundry IQ Agent in Azure, grounded on dynamic disaster and weather data using Retrieval-Augmented Generation."*

### **Scene 3: The Live Demo (0:30 - 1:15)**
* **Visual:** Show the Android app. Type `@IQ canyon?` and hit send. 
* **Visual:** Point to the laptop terminal. Show the message arriving over Bluetooth, and log output saying `"Thinking..."`.
* **Voiceover:** *"When a disconnected user asks a question, the Bluetooth mesh relays it to the Base Station. The Base Station uses the Microsoft Azure AI Projects SDK to query our Foundry Agent in the cloud."*

### **Scene 4: The BLE Payload Chunking (1:15 - 1:45)**
* **Visual:** Show the AI's response slowly appearing on the Android phone's chat screen, chunk by chunk.
* **Voiceover:** *"Because Bluetooth Low Energy has a strict 31-byte limit, our Base Station breaks the AI's response into tiny 20-byte chunks and dynamically broadcasts them back across the offline mesh. The user receives life-saving flash flood warnings entirely off the grid."*

### **Scene 5: Conclusion (1:45 - 2:00)**
* **Visual:** Show the GitHub Copilot logo or VS Code.
* **Voiceover:** *"Built entirely using GitHub Copilot, RescueMesh AI proves that with Azure AI, cloud intelligence doesn't have to stop where the cell towers end. Thank you!"*
