"""Optional texture-generation service (compose profile "ai"). DISABLED: no image-generation API key.

Every texture request answers 501 so the app keeps using the deterministic procedural texture (L1);
anything synthetic would have to be labelled as such in the UI (docs/DECISIONS.md ADR-003/ADR-014).
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="Lunar South Pole Site Explorer - texgen (disabled)", version="0.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"])
DISABLED = {"detail": "disabled — no image-generation key", "enabled": False}


@app.get("/health")
def health():
    return {"status": "ok", "enabled": False}


@app.api_route("/api/v1/{path:path}", methods=["GET", "POST"])
def disabled(path: str):
    return JSONResponse(DISABLED, status_code=501)
