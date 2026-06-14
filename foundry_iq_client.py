import os
import asyncio
import csv
import traceback

def load_env():
    if os.path.exists(".env"):
        with open(".env", "r") as f:
            for line in f:
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.strip().split("=", 1)
                    os.environ[k.strip()] = v.strip().strip("\"").strip("'")

async def query_foundry_iq(query: str) -> str:
    """
    Queries Microsoft Azure AI Foundry Agent (NextGen).
    Routes through the `responses.create` endpoint specifically designed for AI agents!
    """
    load_env()
    endpoint = os.environ.get("AZURE_FOUNDRY_ENDPOINT")
    agent_name = os.environ.get("AZURE_FOUNDRY_AGENT_NAME")
    agent_version = os.environ.get("AZURE_FOUNDRY_AGENT_VERSION", "2")
    
    if endpoint and agent_name:
        # --- REAL AZURE FOUNDRY IQ IMPLEMENTATION ---
        try:
            from azure.identity import DefaultAzureCredential
            from azure.ai.projects import AIProjectClient
            
            project_client = AIProjectClient(
                endpoint=endpoint,
                credential=DefaultAzureCredential(),
                allow_preview=True
            )
            
            openai_client = project_client.get_openai_client()
            concise_query = f"{query} (Reply extremely concisely, max 12 words, no markdown)"
            
            # Use the new Microsoft "Responses" extension to query the agent!
            # The agent automatically retrieves data from your vector store (the .md file you uploaded)
            response = openai_client.responses.create(
                input=[{"role": "user", "content": concise_query}],
                extra_body={
                    "agent_reference": {
                        "name": agent_name, 
                        "version": agent_version, 
                        "type": "agent_reference"
                    }
                },
            )
            
            text_content = response.output_text
            return f"[Foundry IQ] {text_content}"
            
        except Exception as e:
            err = traceback.format_exc()
            return f"[IQ ERROR] {str(e)}"
    
    else:
        # --- MOCK MODE FOR HACKATHON DEMO ---
        # Simulates the LLM reasoning over the terrain_weather_data.csv knowledge base
        await asyncio.sleep(2)  # Simulate network latency
        query_lower = query.lower()
        
        try:
            with open("terrain_weather_data.csv", "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                data = list(reader)
        except Exception:
            return "[Foundry IQ] Knowledge base unavailable."

        if "canyon" in query_lower or "flood" in query_lower:
            loc_data = [d for d in data if "Canyon" in d["Location"]][0]
            return f"[Foundry IQ] {loc_data['Location']} forecast: {loc_data['Forecast']}. {loc_data['Alerts']}."
            
        elif "summit" in query_lower or "peak" in query_lower or "snow" in query_lower:
            loc_data = [d for d in data if "Summit" in d["Location"]][1]
            return f"[Foundry IQ] {loc_data['Location']}: {loc_data['Forecast']}. {loc_data['Alerts']}!"
            
        elif "ridge" in query_lower or "wind" in query_lower:
            loc_data = [d for d in data if "Ridge" in d["Location"]][2]
            return f"[Foundry IQ] {loc_data['Location']} forecast: {loc_data['Forecast']}. {loc_data['Alerts']}."
            
        elif "weather" in query_lower or "forecast" in query_lower:
            base = [d for d in data if "Base" in d["Location"]][0]
            return f"[Foundry IQ] Base Camp is {base['Forecast']} ({base['Temperature_F']}F)."
            
        else:
            return "[Foundry IQ] Try asking about the ridge, canyon, or summit!"

if __name__ == "__main__":
    # Test
    print(asyncio.run(query_foundry_iq("What is the weather at the summit?")))
