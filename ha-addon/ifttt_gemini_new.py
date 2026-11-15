from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import httpx
import json
import os
import subprocess

app = FastAPI()

CONFIG_PATH = os.path.expanduser("~/.jarvis/config.json")

def load_config():
    try:
        with open(CONFIG_PATH) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

@app.post("/webhook")
async def handle_ifttt(request: Request):
    try:
        body = await request.json()
        prompt = body.get("SceneName", body.get("prompt", ""))
        config = load_config()
        api_key = config.get("google_secret", "")
        device = config.get("friendly_name", "Google Home Mini")
        ip = config.get("google_home_ip", "")
        reply = ""
        if api_key and api_key.startswith("AIza"):
            async with httpx.AsyncClient() as client:
                for model in ['gemini-2.5-flash', 'gemini-1.5-flash']:
                    resp = await client.post(
                        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                        params={"key": api_key},
                        json={"contents": [{"parts": [{"text": prompt}]}]},
                        timeout=30.0,
                    )
                    if resp.status_code == 200:
                        try:
                            reply = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                            break
                        except (KeyError, IndexError):
                            continue
        if not reply:
            reply = prompt
        cmd = ["python3", "/home/litbit/jarvis-cast-tool.py", "speak", device, reply[:280]]
        if ip:
            cmd.extend(["--ip", ip])
        subprocess.run(cmd, capture_output=True, text=True)
        return {"response": reply, "prompt": prompt, "spoken": True}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/health")
async def health():
    return {"status": "ok"}
