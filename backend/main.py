"""
AI HandPuzzle Pro - FastAPI Backend
=====================================
Provides REST + WebSocket endpoints for Random Forest gesture inference.

Endpoints:
    GET  /               — health check
    GET  /model/info     — model metadata
    POST /predict        — predict gesture from feature vector
    POST /predict/batch  — batch prediction
    POST /model/reload   — reload model from disk
    WS   /ws             — WebSocket real-time prediction stream
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import traceback

from gesture_predictor import GesturePredictor

# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(
    title="AI HandPuzzle Pro — Gesture API",
    description="Random Forest gesture classifier for hand landmark features",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

predictor = GesturePredictor()


# ── Request / Response schemas ────────────────────────────────────────────────

class PredictRequest(BaseModel):
    features: list[float]          # 78-element feature vector

class PredictBatchRequest(BaseModel):
    frames: list[list[float]]      # List of feature vectors

class PredictResponse(BaseModel):
    gesture:    str
    confidence: float
    all_probs:  dict
    success:    bool

class ModelInfoResponse(BaseModel):
    loaded:         bool
    model_path:     str
    gesture_labels: list[str]
    n_features:     int
    accuracy:       float


# ── HTTP Endpoints ────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "service": "AI HandPuzzle Pro — Gesture API",
        "status":  "running",
        "model":   "loaded" if predictor.loaded else "not_loaded",
    }


@app.get("/model/info", response_model=ModelInfoResponse)
async def model_info():
    return predictor.get_info()


@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    if not predictor.loaded:
        raise HTTPException(status_code=503, detail="Model not loaded. Run: python ml/train_model.py")
    result = predictor.predict(req.features)
    return result


@app.post("/predict/batch")
async def predict_batch(req: PredictBatchRequest):
    results = [predictor.predict(f) for f in req.frames]
    return {"predictions": results, "count": len(results)}


@app.post("/model/reload")
async def reload_model():
    predictor.reload()
    return {"success": predictor.loaded, "message": "Model reloaded" if predictor.loaded else "Reload failed"}


# ── WebSocket Endpoint ────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Real-time gesture prediction over WebSocket.

    Client sends:  {"features": [f0, f1, ..., f77]}
    Server sends:  {"gesture": "PINCH", "confidence": 0.96, "all_probs": {...}, "success": true}
    """
    await websocket.accept()
    print("[WS] Client connected")
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
                features = data.get("features", [])
                if not features:
                    await websocket.send_json({"error": "No features provided"})
                    continue
                result = predictor.predict(features)
                await websocket.send_json(result)
            except json.JSONDecodeError:
                await websocket.send_json({"error": "Invalid JSON"})
            except Exception as e:
                await websocket.send_json({"error": str(e), "trace": traceback.format_exc()})
    except WebSocketDisconnect:
        print("[WS] Client disconnected")


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
