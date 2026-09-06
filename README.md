# HandPuzzle Pro 🤖🧩

> A browser-based, gesture-controlled sliding puzzle that uses your webcam and hand landmarks to let you play without a mouse or touchscreen.

---

## What Is This?

Traditional puzzle games require a mouse or touchscreen. This project lets you control a sliding puzzle entirely with your hands in front of a webcam. The app tracks 21 points on your hand in real time and translates your natural gestures — pinch, open palm, fist — directly into puzzle actions.

---

## How It Works

```
Webcam → Hand Tracking → 21 Landmarks → Gesture Detection → Puzzle Action
```

Your hand is captured live via the webcam. The app identifies key points on your hand (fingertips, knuckles, wrist) and uses the positions and distances between those points to figure out what gesture you are making. The puzzle then responds to that gesture instantly.

---

## Features

| Category | Details |
|---|---|
| **Hand Tracking** | Real-time 21-point hand landmark detection |
| **Gestures** | PINCH · OPEN_PALM · FIST · THUMBS_UP · ONE_FINGER · TWO_FINGERS |
| **Puzzle Modes** | 3×3, 4×4, 5×5 sliding puzzle |
| **Interaction** | Pinch-to-drag, piece snapping, correct-position detection |
| **Image Sources** | Gesture capture from webcam · Upload your own image · Built-in gallery |
| **Scoring** | Timer · Moves · Mistakes · Score |
| **Performance Review** | Post-game analysis with difficulty recommendation |
| **UI** | Dark glassmorphism, real-time confidence bars, landmark overlay |
| **Backend** | FastAPI WebSocket server for server-side gesture processing |
| **Fallback** | In-browser rule-based gesture detection (works without backend) |

---

## Gestures

| Gesture | Action |
|---|---|
| **PINCH** (thumb + index touch) | Grab and drag a puzzle piece |
| **OPEN PALM** | Start the game |
| **FIST** | Pause the game |
| **TWO-HAND PINCH** | Resize the grid |
| **THUMBS UP** | Confirm / next |
| **ONE FINGER** | Point / select |

---

## Hand Landmarks

The app tracks 21 points on your hand per frame:

```
Wrist (0)
Thumb:  CMC(1)  MCP(2)  IP(3)   TIP(4)
Index:  MCP(5)  PIP(6)  DIP(7)  TIP(8)
Middle: MCP(9)  PIP(10) DIP(11) TIP(12)
Ring:   MCP(13) PIP(14) DIP(15) TIP(16)
Pinky:  MCP(17) PIP(18) DIP(19) TIP(20)
```

Runs at 30+ FPS.

---

## Image Source Options

### Gesture Capture
1. Show both hands in front of the webcam.
2. Form a **pinch** (thumb + index) on each hand.
3. Move hands to the top-left and bottom-right of the area you want to capture.
4. Hold still for **3 seconds** — that region becomes your puzzle image.

### File Upload
Drag and drop or click to upload any JPG / PNG / WebP image from your device.

### Gallery
Pick from 6 built-in puzzle images, all drawn directly in the browser.

---

## Scoring

After each game, your performance is reviewed:

```
Score ≥ 80  →  EXCELLENT  →  Try 5×5
Score ≥ 60  →  GOOD       →  Try 4×4
Score ≥ 40  →  AVERAGE    →  Stay on 4×4
Score  < 40  →  POOR      →  Try 3×3
```

Score is calculated from your solving time, number of moves, and mistakes.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Hand Detection | MediaPipe Hands (JavaScript CDN) |
| Backend API | FastAPI + Uvicorn |
| Real-time Comms | WebSocket |
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Canvas Rendering | HTML5 Canvas 2D API |
| Data Tools | NumPy, Pandas |

---

## Project Structure

```
HandPuzzle-Pro/
│
├── frontend/
│   ├── index.html          ← Main application page
│   ├── style.css           ← Dark glassmorphism stylesheet
│   ├── script.js           ← Game engine + hand tracking + gesture logic
│   └── assets/
│
├── backend/
│   ├── main.py             ← FastAPI server (REST + WebSocket)
│   ├── gesture_predictor.py← Gesture processing wrapper
│   └── requirements.txt
│
├── ml/
│   ├── collect_data.py     ← Webcam data collection tool
│   ├── train_model.py      ← Gesture model training
│   ├── gesture_model.pkl   ← Trained gesture bundle (generated)
│   └── dataset/
│       └── gesture_data.csv← Collected training data
│
├── README.md
└── .gitignore
```

---

## Installation

### Prerequisites

- Python 3.10+
- pip
- A modern browser (Chrome / Edge recommended)
- Webcam

### 1. Install Python Dependencies

```bash
cd HandPuzzle-Pro/backend
pip install -r requirements.txt
```

The `requirements.txt` includes:
```
fastapi, uvicorn, scikit-learn, numpy, pandas, mediapipe, opencv-python
```

---

## Data Collection

```bash
python ml/collect_data.py
```

Controls:
- Press `1` – PINCH
- Press `2` – OPEN_PALM
- Press `3` – FIST
- Press `4` – THUMBS_UP
- Press `5` – ONE_FINGER
- Press `6` – TWO_FINGERS
- `SPACE` – capture sample
- `Q` – quit

Aim for **300+ samples per class** for best accuracy.

> **Note:** If you skip data collection, the trainer automatically generates a realistic synthetic dataset so the app works out of the box.

---

## Training the Gesture Detector

```bash
python ml/train_model.py
```

Output:
```
✅ Test Accuracy: 97.xx%
📈 5-fold CV Accuracy: 96.xx% ± 0.xx%
📋 Classification Report: (per-class precision/recall/F1)
🔢 Confusion Matrix
🔍 Top-10 Most Important Features
💾 Model saved → ml/gesture_model.pkl
```

---

## Running the Application

### Option A — Frontend Only (No Backend Required)

```bash
# Serve the frontend (any static server)
cd HandPuzzle-Pro/frontend
python -m http.server 5500
# Open: http://localhost:5500
```

The in-browser gesture detection works without the backend.

### Option B — Full Backend

```bash
# Terminal 1: Start backend
cd HandPuzzle-Pro/backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2: Serve frontend
cd HandPuzzle-Pro/frontend
python -m http.server 5500
# Open: http://localhost:5500
# Toggle "RF Backend" switch in the status bar
```

---

## Testing Checklist

1. ✅ Open http://localhost:5500 in Chrome
2. ✅ Allow camera access
3. ✅ Verify green "HAND DETECTED" status
4. ✅ See 21 landmarks drawn on webcam
5. ✅ PINCH gesture → confidence > 80%
6. ✅ Click START GAME → puzzle pieces appear
7. ✅ Pinch a piece → drag it → release to drop
8. ✅ Piece snaps when near correct position
9. ✅ Test 3×3, 4×4, 5×5 modes
10. ✅ Complete puzzle → confetti + success screen
11. ✅ Check Performance Analysis panel after game
12. ✅ Enable RF Backend toggle → verify WebSocket connection

---

## Common Errors & Fixes

| Error | Fix |
|---|---|
| `Hand tracking not loading` | Check internet (CDN). Try Chrome. Disable VPN. |
| `Camera permission denied` | Allow camera in browser settings. Use HTTPS or localhost. |
| `Backend 503 — model not loaded` | Run `python ml/train_model.py` first |
| `WebSocket connection failed` | Start backend with `uvicorn main:app --port 8000` |
| `Gesture not detected` | Ensure good lighting. Keep hand within frame. |
| `Pinch not working` | Touch thumb and index fingertips firmly toward camera |

---

## Future Improvements

- [ ] Collect real user data for higher accuracy
- [ ] Support custom images as puzzle source
- [ ] Two-hand support (one hand = drag, other = zoom)
- [ ] Mobile overlay with WebXR
- [ ] Leaderboard with Firebase
- [ ] More gesture classes (swipe, rotate)
- [ ] Progressive puzzle generation from webcam snapshot

---

*HandPuzzle Pro — Gesture-Controlled Puzzle Game*
*MediaPipe · FastAPI · HTML5 Canvas*
