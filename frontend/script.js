'use strict';

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS & CONFIG
// ═══════════════════════════════════════════════════════════════
const BACKEND_URL  = 'https://ai-handpuzzle-api.onrender.com';
const WS_URL       = 'wss://ai-handpuzzle-api.onrender.com/ws';
const GESTURE_NAMES = ['PINCH','OPEN_PALM','FIST','THUMBS_UP','ONE_FINGER','TWO_FINGERS'];

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],          // Thumb
  [0,5],[5,6],[6,7],[7,8],          // Index
  [0,9],[9,10],[10,11],[11,12],     // Middle
  [0,13],[13,14],[14,15],[15,16],   // Ring
  [0,17],[17,18],[18,19],[19,20],   // Pinky
  [5,9],[9,13],[13,17],             // Palm
];

const SNAP_THRESHOLD = 0.06; // fraction of puzzle size

// ═══════════════════════════════════════════════════════════════
//  DOM REFS
// ═══════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const DOM = {
  video:            $('video-feed'),
  landmarkCanvas:   $('landmark-canvas'),
  puzzleCanvas:     $('puzzle-canvas'),
  puzzleArea:       $('puzzle-area'),
  cursor:           $('gesture-cursor'),
  cursor2:          $('gesture-cursor-2'),
  twohandIndicator: $('twohand-indicator'),
  gestureNameEl:    $('gesture-name'),
  confidenceVal:    $('confidence-val'),
  confidenceFill:   $('confidence-fill'),
  probGrid:         $('prob-grid'),
  lmInfo:           $('landmark-info'),
  fpsBadge:         $('fps-badge'),
  handStatus:       $('hand-status'),
  backendStatus:    $('backend-status'),
  timerEl:          $('timer-val'),
  movesEl:          $('moves-val'),
  mistakesEl:       $('mistakes-val'),
  scoreEl:          $('score-val'),
  pauseOverlay:     $('pause-overlay'),
  successOverlay:   $('success-overlay'),
  confettiCanvas:   $('confetti-canvas'),
  toastContainer:   $('toast-container'),
  appSection:       $('app'),
  heroSection:      $('hero'),
  aiModelSection:   $('ai-model-section'),
  howtoSection:     $('howto-section'),
  useBackendToggle: $('use-backend'),
  // Image source panel
  imgSrcTabs:       $('img-src-tabs'),
  // Tab 1 – Gesture Capture
  gcPreviewCanvas:  $('gc-preview-canvas'),
  gcOverlay:        $('gc-overlay'),
  gcFrame:          $('gc-frame'),
  gcStatus:         $('gc-status'),
  gcCaptureBtn:     $('btn-gc-capture'),
  gcClearBtn:       $('btn-gc-clear'),
  gcActiveLabel:    $('gc-active-label'),
  // Tab 2 – Upload
  uploadInput:      $('puzzle-upload'),
  uploadTrigger:    $('upload-trigger'),
  uploadZone:       $('upload-zone'),
  uploadPreview:    $('upload-preview'),
  uploadThumb:      $('upload-thumb'),
  uploadRemove:     $('upload-remove'),
  // Tab 3 – Gallery
  galleryGrid:      $('gallery-grid'),
  galleryLabel:     $('gallery-active-label'),
  // Performance
  perfGrid:         $('perf-grid'),
  perfTime:         $('perf-time'),
  perfMoves:        $('perf-moves'),
  perfMistakes:     $('perf-mistakes'),
  perfAccuracy:     $('perf-accuracy'),
  perfScore:        $('perf-score-label'),
  perfRec:          $('perf-rec'),
};

// ═══════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════
const state = {
  // MediaPipe
  handLandmarks:   null,   // first hand
  handLandmarks2:  null,   // second hand
  lastLandmarks:   null,

  // Gesture
  currentGesture:      'NONE',
  gestureConfidence:   0,
  gestureHistory:      [],   // smoothing buffer
  gestureAccHistory:   [],   // for accuracy calc

  // Webcam
  fps: 0, lastFrameTime: 0, frameCount: 0, fpsInterval: null,

  // Puzzle
  mode:          '3x3',
  gridSize:      3,
  pieces:        [],        // {id, col, row, x, y, targetX, targetY, placed, img}
  sourceImage:   null,
  // Image source (3 tabs — whichever is set last wins)
  uploadedImage:    null,   // Tab 2: user file upload
  galleryImage:     null,   // Tab 3: gallery canvas
  capturedImage:    null,   // Tab 1: gesture-framed webcam capture
  activeImageTab:   'gesture', // 'gesture' | 'upload' | 'gallery'
  pieceSize:     0,
  canvasSize:    0,

  // Drag
  dragPiece:     null,
  dragOffX:      0,
  dragOffY:      0,
  pinchActive:   false,
  pinchPoint:    null,        // {x, y} normalised [0,1]
  pinchFrames:   0,           // consecutive frames pinch has been ON  (debounce)
  releaseFrames: 0,           // consecutive frames pinch has been OFF (debounce)

  // Two-hand pinch-spread (grid resize)
  twoHandActive:       false,
  twoHandSpreadStart:  null,  // baseline normalised distance when gesture began
  twoHandGridStart:    3,     // gridSize when gesture began

  // Score & timing
  timer:         0,
  timerInterval: null,
  running:       false,
  paused:        false,
  moves:         0,
  mistakes:      0,
  score:         0,
  startTime:     null,
  endTime:       null,

  // Performance history
  perfHistory: [],   // [{time, moves, mistakes, gestureAcc, mode}]
  gestureFrames: 0,
  gestureCorrect: 0,

  // Backend / WebSocket
  useBackend: false,
  ws:         null,
  wsConnected: false,
  wsQueue:    [],
  lastWsResult: null,
};

// ═══════════════════════════════════════════════════════════════
//  SECTION NAVIGATION
// ═══════════════════════════════════════════════════════════════
function showSection(name) {
  DOM.heroSection.classList.remove('hidden');
  DOM.appSection.classList.remove('visible');
  DOM.aiModelSection.classList.remove('visible');
  DOM.howtoSection.classList.remove('visible');

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  if (name === 'game') {
    DOM.heroSection.classList.add('hidden');
    DOM.appSection.classList.add('visible');
    document.querySelector('[data-nav="game"]')?.classList.add('active');
    initGame();
  } else if (name === 'howto') {
    DOM.heroSection.classList.add('hidden');
    DOM.howtoSection.classList.add('visible');
    document.querySelector('[data-nav="howto"]')?.classList.add('active');
  }
  // 'aimodel' route intentionally removed — section kept in DOM for CSS safety
}

// ═══════════════════════════════════════════════════════════════
//  MEDIAPIPE SETUP
// ═══════════════════════════════════════════════════════════════
let mpHands = null;
let camera  = null;

async function initMediaPipe() {
  toast('Loading MediaPipe…', 'info');
  try {
    // Load MediaPipe Hands from CDN
    mpHands = new Hands({
      locateFile: file =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    mpHands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });

    mpHands.onResults(onHandResults);

    // Camera
    camera = new Camera(DOM.video, {
      onFrame: async () => {
        await mpHands.send({ image: DOM.video });
        updateFPS();
      },
      width: 640,
      height: 480,
    });

    await camera.start();
    setStatusDot('hand-status', 'active');
    toast('MediaPipe loaded ✓', 'success');
    updateBackendStatus();
  } catch (err) {
    console.error('[MediaPipe]', err);
    toast('MediaPipe failed — check CDN access. Retrying…', 'error');
    // retry after 2s in case of CDN delay
    setTimeout(initMediaPipe, 2000);
  }
}

function updateFPS() {
  const now = performance.now();
  state.frameCount++;
  if (now - state.lastFrameTime >= 1000) {
    state.fps = state.frameCount;
    state.frameCount = 0;
    state.lastFrameTime = now;
    DOM.fpsBadge.textContent = `${state.fps} FPS`;
  }
}

// ═══════════════════════════════════════════════════════════════
//  HAND LANDMARK PROCESSING
// ═══════════════════════════════════════════════════════════════
function onHandResults(results) {
  drawLandmarks(results);

  const detected = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

  if (detected) {
    const lm  = results.multiHandLandmarks[0];
    const lm2 = results.multiHandLandmarks.length > 1 ? results.multiHandLandmarks[1] : null;
    state.handLandmarks  = lm;
    state.handLandmarks2 = lm2;

    setStatusDot('hand-status', 'active');
    DOM.handStatus.textContent = lm2 ? 'TWO HANDS' : 'HAND DETECTED';

    const features = extractFeatures(lm);
    classifyGesture(features, lm);
    updatePinchPoint(lm, lm2);
  } else {
    state.handLandmarks  = null;
    state.handLandmarks2 = null;
    setStatusDot('hand-status', 'warning');
    DOM.handStatus.textContent = 'NO HAND';
    updateGestureDisplay('NONE', 0, {});
    hideCursor();
    hideCursor2();
    endTwoHandGesture();
  }
}

/**
 * Extract 78-element feature vector — mirrors ml/collect_data.py
 */
function extractFeatures(landmarks) {
  const wrist = landmarks[0];
  const xs = landmarks.map(l => l.x);
  const ys = landmarks.map(l => l.y);
  const bboxDiag = Math.max(
    Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
    1e-6
  );

  const coords = [];
  for (const l of landmarks) {
    coords.push((l.x - wrist.x) / bboxDiag);
    coords.push((l.y - wrist.y) / bboxDiag);
    coords.push(l.z / bboxDiag);
  }

  const tips = [4, 8, 12, 16, 20];
  const dists = [];
  for (let i = 0; i < tips.length; i++) {
    for (let j = i + 1; j < tips.length; j++) {
      const a = landmarks[tips[i]], b = landmarks[tips[j]];
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / bboxDiag;
      dists.push(d);
    }
  }
  return [...coords, ...dists];  // 63 coords + 10 inter-tip dists = 73 features
}

/**
 * Classify gesture — uses backend WS if available, else rule-based fallback.
 */
function classifyGesture(features, landmarks) {
  state.gestureFrames++;

  if (state.useBackend && state.wsConnected && state.ws) {
    // Send features to backend; response comes via onWsMessage
    try {
      state.ws.send(JSON.stringify({ features }));
    } catch (e) {
      fallbackClassify(landmarks);
    }
  } else {
    fallbackClassify(landmarks);
  }
}

/**
 * Rule-based gesture recogniser — matches what the RF model learns.
 * Uses normalised landmark geometry.
 */
function fallbackClassify(landmarks) {
  const lm = landmarks;

  // Fingertip / PIP / MCP indices per finger
  // Thumb: 4,3,2,1 — others: tip,dip,pip,mcp
  const fingerExtended = finger => {
    const tips = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
    const pips = { thumb: 2, index: 6, middle: 10, ring: 14, pinky: 18 };
    const mcps = { thumb: 1, index: 5, middle: 9,  ring: 13, pinky: 17 };
    if (finger === 'thumb') {
      // Thumb extended = tip far from index MCP
      return dist2d(lm[4], lm[5]) > dist2d(lm[3], lm[5]);
    }
    return lm[tips[finger]].y < lm[pips[finger]].y;
  };

  const thumb   = fingerExtended('thumb');
  const index   = fingerExtended('index');
  const middle  = fingerExtended('middle');
  const ring    = fingerExtended('ring');
  const pinky   = fingerExtended('pinky');

  const thumbTip = lm[4], indexTip = lm[8];
  const pinchDist = dist2d(thumbTip, indexTip);

  let gesture, confidence;

  if (pinchDist < 0.08 && !middle && !ring && !pinky) {
    gesture    = 'PINCH';
    confidence = Math.min(0.99, 0.85 + (0.08 - pinchDist) * 2);
  } else if (thumb && index && middle && ring && pinky) {
    gesture    = 'OPEN_PALM';
    confidence = 0.88 + Math.random() * 0.06;
  } else if (!thumb && !index && !middle && !ring && !pinky) {
    gesture    = 'FIST';
    confidence = 0.87 + Math.random() * 0.07;
  } else if (thumb && !index && !middle && !ring && !pinky) {
    gesture    = 'THUMBS_UP';
    confidence = 0.88 + Math.random() * 0.06;
  } else if (!thumb && index && !middle && !ring && !pinky) {
    gesture    = 'ONE_FINGER';
    confidence = 0.86 + Math.random() * 0.08;
  } else if (!thumb && index && middle && !ring && !pinky) {
    gesture    = 'TWO_FINGERS';
    confidence = 0.84 + Math.random() * 0.08;
  } else {
    gesture    = 'NONE';
    confidence = 0.0;
  }

  const probs = {};
  GESTURE_NAMES.forEach(g => { probs[g] = gesture === g ? confidence : (1 - confidence) / (GESTURE_NAMES.length - 1); });

  applyGestureResult({ gesture, confidence, all_probs: probs, success: true });
}

function dist2d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// WS response handler
function onWsMessage(evt) {
  try {
    const data = JSON.parse(evt.data);
    if (data.success) {
      applyGestureResult(data);
    } else {
      // Backend returned error — fall back
      if (state.handLandmarks) fallbackClassify(state.handLandmarks);
    }
  } catch (e) {
    console.warn('[WS parse]', e);
  }
}

/**
 * Smooth gesture via short history buffer, then apply to game.
 */
function applyGestureResult(result) {
  state.gestureHistory.push(result.gesture);
  if (state.gestureHistory.length > 5) state.gestureHistory.shift();

  // Vote on most common in buffer
  const votes = {};
  for (const g of state.gestureHistory) votes[g] = (votes[g] || 0) + 1;
  const smoothed = Object.entries(votes).sort((a,b) => b[1]-a[1])[0][0];

  // Track accuracy (comparing smoothed vs raw — proxy metric)
  if (result.gesture !== 'NONE') {
    state.gestureCorrect += (smoothed === result.gesture ? 1 : 0);
  }

  state.currentGesture   = smoothed;
  state.gestureConfidence = result.confidence;

  updateGestureDisplay(smoothed, result.confidence, result.all_probs || {});

  if (state.running && !state.paused) {
    handleGestureAction(smoothed, result.confidence);
  }

  // Gesture-triggered game controls (always active)
  if (smoothed === 'THUMBS_UP' && result.confidence > 0.7 && state.running && state.paused) {
    resumeGame();
  }
}

// ═══════════════════════════════════════════════════════════════
//  PINCH TRACKING → PUZZLE DRAG
// ═══════════════════════════════════════════════════════════════

/**
 * Returns true when thumb (lm[4]) and index finger (lm[8]) are pinching.
 * Used for both single-hand drag and two-hand spread detection.
 */
function isPinchingLM(lm) {
  return dist2d(lm[4], lm[8]) < 0.08;
}

function updatePinchPoint(lm, lm2) {
  // ── Feed gesture-capture tab (runs every frame regardless of game state) ──
  updateGestureCapture(lm, lm2);

  // ── Hand 1 cursor ──
  const tipX = 1 - lm[8].x;   // mirror
  const tipY = lm[8].y;
  const canvasRect = DOM.puzzleArea.getBoundingClientRect();
  showCursor(tipX * canvasRect.width, tipY * canvasRect.height);
  state.pinchPoint = { x: tipX, y: tipY };

  // ── Hand 2 cursor + two-hand spread (skip when in gesture-capture mode) ──
  if (lm2) {
    const tip2X = 1 - lm2[8].x;
    const tip2Y = lm2[8].y;
    showCursor2(tip2X * canvasRect.width, tip2Y * canvasRect.height);

    const hand1Pinching = isPinchingLM(lm);
    const hand2Pinching = isPinchingLM(lm2);

    // Grid selection is available only before the puzzle starts.
    if (!state.running && state.activeImageTab !== 'gesture' && hand1Pinching && hand2Pinching) {
      // Compute the spread distance between both index finger tips (mirrored)
      const spreadDist = Math.hypot(tipX - tip2X, tipY - tip2Y);

      if (!state.twoHandActive) {
        // Begin gesture — record baseline
        state.twoHandActive      = true;
        state.twoHandSpreadStart = spreadDist;
        state.twoHandGridStart   = state.gridSize;
      } else {
        // Compute new grid size from relative change
        const ratio  = spreadDist / (state.twoHandSpreadStart || 0.01);
        let newGrid;
        if (ratio > 1.35)       newGrid = 5;
        else if (ratio > 1.05)  newGrid = 4;
        else if (ratio < 0.70)  newGrid = 3;
        else                    newGrid = state.twoHandGridStart;

        newGrid = Math.max(3, Math.min(5, newGrid));

        if (newGrid !== state.gridSize) {
          setGridSize(newGrid);
        }

        // Show spread indicator
        const ind = DOM.twohandIndicator;
        if (ind) {
          ind.style.display = 'block';
          ind.textContent   = `✋✋ GRID RESIZE → ${state.gridSize}×${state.gridSize}`;
        }
      }
    } else if (state.activeImageTab === 'gesture') {
      // In capture tab, two-hand pinch is handled by updateGestureCapture — no grid resize
      endTwoHandGesture();
    } else {
      endTwoHandGesture();
    }
  } else {
    hideCursor2();
    endTwoHandGesture();
  }

  // ── Single-hand drag (only when not in two-hand mode) ──
  if (!state.running || state.paused || state.twoHandActive) return;

  // Convert normalised hand coords → puzzle canvas pixel coords.
  // tipX/tipY are [0,1] over the full webcam frame; the canvas sits at a
  // specific position on screen, so we must account for its offset.
  const puzzleRect  = DOM.puzzleCanvas.getBoundingClientRect();
  const areaRect    = DOM.puzzleArea.getBoundingClientRect();
  // Map normalised → viewport px, then subtract canvas top-left
  const canvasPxX   = tipX * areaRect.width  + (areaRect.left - puzzleRect.left);
  const canvasPxY   = tipY * areaRect.height + (areaRect.top  - puzzleRect.top);
  // Finally normalise to [0,1] within the canvas itself
  const cnX = canvasPxX / puzzleRect.width;
  const cnY = canvasPxY / puzzleRect.height;

  // Use raw landmark distance for pinch while dragging (immune to classifier noise)
  const rawPinching = isPinchingLM(lm);
  // Also accept smoothed gesture classification for the initial grab
  const gestPinching = state.currentGesture === 'PINCH' && state.gestureConfidence > 0.6;
  const pinchNow = state.pinchActive ? rawPinching : (rawPinching || gestPinching);

  // Debounce: count consecutive ON/OFF frames
  if (pinchNow) {
    state.pinchFrames++;
    state.releaseFrames = 0;
  } else {
    state.releaseFrames++;
    state.pinchFrames = 0;
  }

  const GRAB_FRAMES    = 2;   // frames of pinch required to start drag
  const RELEASE_FRAMES = 3;   // frames of release required to drop

  if (!state.pinchActive && state.pinchFrames >= GRAB_FRAMES) {
    // Start drag
    state.pinchActive = true;
    tryPickPiece(cnX, cnY);
  } else if (state.pinchActive && state.releaseFrames >= RELEASE_FRAMES) {
    // End drag
    state.pinchActive  = false;
    state.pinchFrames  = 0;
    state.releaseFrames = 0;
    dropPiece();
  } else if (state.pinchActive && state.dragPiece !== null) {
    // Continue drag — keep piece locked
    moveDragPiece(cnX, cnY);
  }
}

/** Called when two-hand pinch gesture ends. */
function endTwoHandGesture() {
  if (!state.twoHandActive) return;
  state.twoHandActive      = false;
  state.twoHandSpreadStart = null;
  if (DOM.twohandIndicator) DOM.twohandIndicator.style.display = 'none';
}

/**
 * Update the active grid size + mode selectors without restarting the game.
 * If a game is in progress, reinitialise the puzzle with the current image.
 */
function setGridSize(n) {
  if (state.running) return;

  state.gridSize = n;
  state.mode     = `${n}x${n}`;

  // Update mode button UI
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === state.mode);
  });
  const badge = $('mode-badge');
  if (badge) badge.textContent = `${n}×${n}`;

  toast(`Grid resized to ${n}×${n}`, 'info', 1500);

}

function setGridSelectorDisabled(disabled) {
  document.querySelectorAll('.mode-btn').forEach(button => {
    button.disabled = disabled;
  });
}

// ═══════════════════════════════════════════════════════════════
//  GESTURE → GAME ACTIONS
// ═══════════════════════════════════════════════════════════════
function handleGestureAction(gesture, conf) {
  if (conf < 0.55) return;

  switch (gesture) {
    case 'TWO_FINGERS':
      // Mode cycle on stable detection
      break;
    case 'ONE_FINGER':
      // Selection highlight
      break;
  }
}

// ═══════════════════════════════════════════════════════════════
//  LANDMARK DRAWING
// ═══════════════════════════════════════════════════════════════
function drawLandmarks(results) {
  const canvas = DOM.landmarkCanvas;
  const ctx    = canvas.getContext('2d');
  canvas.width  = DOM.video.videoWidth  || 640;
  canvas.height = DOM.video.videoHeight || 480;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) return;

  const lm = results.multiHandLandmarks[0];
  const W = canvas.width, H = canvas.height;

  // Draw connections
  ctx.strokeStyle = 'rgba(59,130,246,0.65)';
  ctx.lineWidth = 2;
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * W, lm[a].y * H);
    ctx.lineTo(lm[b].x * W, lm[b].y * H);
    ctx.stroke();
  }

  // Draw landmarks
  for (let i = 0; i < lm.length; i++) {
    const x = lm[i].x * W, y = lm[i].y * H;
    const isTip = [4,8,12,16,20].includes(i);
    const r     = isTip ? 6 : 4;
    const color = isTip ? '#06d6a0' : '#3b82f6';

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Landmark index label
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '9px monospace';
    ctx.fillText(i, x + 6, y - 6);
  }

  // Landmark info panel
  const t4 = lm[4], t8 = lm[8];
  DOM.lmInfo.textContent =
    `Wrist:(${lm[0].x.toFixed(2)},${lm[0].y.toFixed(2)}) ` +
    `ThumbTip:(${t4.x.toFixed(2)},${t4.y.toFixed(2)}) ` +
    `IndexTip:(${t8.x.toFixed(2)},${t8.y.toFixed(2)}) ` +
    `Pinch:${dist2d(t4,t8).toFixed(3)}`;
}

// ═══════════════════════════════════════════════════════════════
//  UI UPDATES
// ═══════════════════════════════════════════════════════════════
function updateGestureDisplay(gesture, confidence, allProbs) {
  DOM.gestureNameEl.textContent = gesture === 'NONE' ? '—' : gesture;
  const pct = Math.round(confidence * 100);
  DOM.confidenceVal.textContent  = `${pct}%`;
  DOM.confidenceFill.style.width = `${pct}%`;

  // Colour by confidence
  const color = confidence > 0.8 ? '#06d6a0' : confidence > 0.6 ? '#3b82f6' : '#f59e0b';
  DOM.confidenceFill.style.background = `linear-gradient(90deg, ${color}, ${color}aa)`;
  DOM.gestureNameEl.style.color = color;

  // Probability bars
  if (Object.keys(allProbs).length > 0) {
    DOM.probGrid.innerHTML = GESTURE_NAMES.map(g => {
      const p    = allProbs[g] || 0;
      const pct  = Math.round(p * 100);
      const top  = g === gesture ? 'top' : '';
      return `<div class="prob-item ${top}">
        <div class="prob-item-name">${g.replace('_',' ')}</div>
        <div class="prob-item-bar"><div class="prob-item-fill" style="width:${pct}%"></div></div>
        <div class="prob-item-val">${pct}%</div>
      </div>`;
    }).join('');
  }
}

function showCursor(x, y) {
  if (!DOM.cursor) return;
  DOM.cursor.style.display = 'block';
  DOM.cursor.style.left = x + 'px';
  DOM.cursor.style.top  = y + 'px';
}
function hideCursor() {
  if (DOM.cursor) DOM.cursor.style.display = 'none';
}
function showCursor2(x, y) {
  if (!DOM.cursor2) return;
  DOM.cursor2.style.display = 'block';
  DOM.cursor2.style.left = x + 'px';
  DOM.cursor2.style.top  = y + 'px';
}
function hideCursor2() {
  if (DOM.cursor2) DOM.cursor2.style.display = 'none';
}

function setStatusDot(id, type) {
  const dot = document.querySelector(`#${id} .status-dot`);
  if (dot) { dot.className = `status-dot ${type}`; }
}

function updateBackendStatus() {
  const el = DOM.backendStatus;
  if (el) el.textContent = state.wsConnected ? 'BACKEND CONNECTED' : 'LOCAL MODE';
}

// ═══════════════════════════════════════════════════════════════
//  WEBSOCKET (BACKEND)
// ═══════════════════════════════════════════════════════════════
function connectWebSocket() {
  if (state.ws) { state.ws.close(); state.ws = null; }
  toast('Connecting to backend…', 'info');
  try {
    state.ws = new WebSocket(WS_URL);
    state.ws.onopen    = () => {
      state.wsConnected = true;
      toast('Backend RF model connected ✓', 'success');
      setStatusDot('backend-status', 'active');
      updateBackendStatus();
    };
    state.ws.onmessage = onWsMessage;
    state.ws.onerror   = () => {
      toast('Backend WS error — using local classifier', 'error');
      state.wsConnected = false;
      updateBackendStatus();
    };
    state.ws.onclose   = () => {
      state.wsConnected = false;
      updateBackendStatus();
    };
  } catch (e) {
    state.wsConnected = false;
    toast('Cannot reach backend. Using local classifier.', 'error');
  }
}

function disconnectWebSocket() {
  if (state.ws) { state.ws.close(); state.ws = null; }
  state.wsConnected = false;
  updateBackendStatus();
  toast('Switched to local classifier', 'info');
}

// ═══════════════════════════════════════════════════════════════
//  PUZZLE ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Draw the user-uploaded image (state.uploadedImage) onto a square canvas
 * of the given size, centred/cropped, and return it.
 */
function renderUploadedImage(size) {
  const off = document.createElement('canvas');
  off.width = off.height = size;
  const ctx = off.getContext('2d');
  const img = state.uploadedImage;
  // Cover-fit: maintain aspect ratio, crop to centre
  const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth  * scale;
  const h = img.naturalHeight * scale;
  const ox = (size - w) / 2;
  const oy = (size - h) / 2;
  ctx.drawImage(img, ox, oy, w, h);
  return off;
}

/**
 * Load a built-in colourful image as the puzzle source.
 * Generates a procedural image since we cannot load external URLs.
 */
function generateSourceImage(size) {
  const offscreen = document.createElement('canvas');
  offscreen.width = offscreen.height = size;
  const ctx = offscreen.getContext('2d');

  // Colourful gradient background
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0,   '#1e3a8a');
  grad.addColorStop(0.3, '#7c3aed');
  grad.addColorStop(0.6, '#0891b2');
  grad.addColorStop(1,   '#059669');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Grid pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  const step = size / 8;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
  }

  // Decorative circles
  const circles = [
    { x: 0.2, y: 0.3, r: 0.15, color: 'rgba(99,102,241,0.6)' },
    { x: 0.7, y: 0.2, r: 0.12, color: 'rgba(6,214,160,0.5)'  },
    { x: 0.5, y: 0.6, r: 0.18, color: 'rgba(245,158,11,0.4)' },
    { x: 0.8, y: 0.75,r: 0.1,  color: 'rgba(239,68,68,0.5)'  },
    { x: 0.15,y: 0.7, r: 0.13, color: 'rgba(59,130,246,0.5)' },
  ];
  for (const c of circles) {
    ctx.beginPath();
    ctx.arc(c.x * size, c.y * size, c.r * size, 0, Math.PI * 2);
    ctx.fillStyle = c.color;
    ctx.fill();
  }

  // Central logo text
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `bold ${size * 0.08}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('AI HANDPUZZLE', size / 2, size / 2 - size * 0.06);
  ctx.fillStyle = 'rgba(6,214,160,0.9)';
  ctx.font = `bold ${size * 0.055}px "Segoe UI", sans-serif`;
  ctx.fillText('PRO', size / 2, size / 2 + size * 0.04);

  // Corner markers
  const markerSize = size * 0.05;
  const positions = [[0,0],[size-markerSize,0],[0,size-markerSize],[size-markerSize,size-markerSize]];
  for (const [px,py] of positions) {
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(px, py, markerSize, markerSize);
  }

  return offscreen;
}

function initPuzzle(gridSize, imageCanvas) {
  state.gridSize   = gridSize;
  state.sourceImage= imageCanvas;
  state.pieces     = [];
  state.dragPiece  = null;

  const canvas = DOM.puzzleCanvas;
  const size   = canvas.parentElement.clientWidth;
  canvas.width = canvas.height = size;
  state.canvasSize = size;

  const pieceSize  = Math.floor(size / gridSize);
  state.pieceSize  = pieceSize;

  // Create pieces
  const pieces = [];
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const id = row * gridSize + col;
      pieces.push({
        id,
        srcCol: col,
        srcRow: row,
        targetX: col * pieceSize,
        targetY: row * pieceSize,
        x: 0,
        y: 0,
        placed: false,
      });
    }
  }

  // Shuffle positions
  const shuffled = shufflePositions(pieces.length, pieceSize, size);
  pieces.forEach((p, i) => {
    p.x = shuffled[i].x;
    p.y = shuffled[i].y;
  });

  state.pieces = pieces;

  // ── Tile entrance animation ──────────────────────────────────
  // Each piece stores an animProgress (0→1) that drives scale+alpha.
  // A short rAF loop advances them with a stagger so pieces pop in
  // sequentially. After all finish (≈600 ms total) it stops and
  // normal renderPuzzle() takes over unmodified.
  const ANIM_DURATION = 220;   // ms per piece fade-in
  const STAGGER       = 40;    // ms delay between consecutive pieces
  const startTs       = performance.now();

  pieces.forEach((p, i) => { p._animStart = startTs + i * STAGGER; });

  function animFrame(now) {
    const canvas = DOM.puzzleCanvas;
    const ctx    = canvas.getContext('2d');
    const size   = canvas.width;
    const G      = state.gridSize;
    const PS     = state.pieceSize;

    ctx.clearRect(0, 0, size, size);

    // Ghost grid
    ctx.strokeStyle = 'rgba(59,130,246,0.12)';
    ctx.lineWidth   = 1;
    for (let r = 0; r < G; r++)
      for (let c = 0; c < G; c++)
        ctx.strokeRect(c * PS, r * PS, PS, PS);

    let allDone = true;
    for (const p of pieces) {
      const elapsed = now - p._animStart;
      const t = Math.min(1, Math.max(0, elapsed / ANIM_DURATION));
      // ease-out cubic
      const ease = 1 - Math.pow(1 - t, 3);

      if (t < 1) allDone = false;
      if (t === 0) continue; // not yet started

      const cx = p.x + PS / 2;
      const cy = p.y + PS / 2;
      const scale = 0.55 + 0.45 * ease;

      ctx.save();
      ctx.globalAlpha = ease;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
      drawPiece(ctx, p, PS, false);
      ctx.restore();
    }

    if (!allDone) {
      requestAnimationFrame(animFrame);
    } else {
      // Clean up anim markers and hand off to normal render
      pieces.forEach(p => delete p._animStart);
      renderPuzzle();
    }
  }
  requestAnimationFrame(animFrame);
}

function shufflePositions(count, pieceSize, canvasSize) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    let x, y, tries = 0;
    do {
      x = Math.random() * (canvasSize - pieceSize);
      y = Math.random() * (canvasSize - pieceSize);
      tries++;
    } while (tries < 50 && positions.some(p =>
      Math.abs(p.x - x) < pieceSize * 0.5 && Math.abs(p.y - y) < pieceSize * 0.5
    ));
    positions.push({ x, y });
  }
  return positions;
}

function renderPuzzle() {
  const canvas = DOM.puzzleCanvas;
  const ctx    = canvas.getContext('2d');
  const size   = canvas.width;
  const G      = state.gridSize;
  const PS     = state.pieceSize;

  ctx.clearRect(0, 0, size, size);

  // Draw ghost grid
  ctx.strokeStyle = 'rgba(59,130,246,0.12)';
  ctx.lineWidth   = 1;
  for (let r = 0; r < G; r++) {
    for (let c = 0; c < G; c++) {
      ctx.strokeRect(c * PS, r * PS, PS, PS);
    }
  }

  // Draw placed pieces (below)
  for (const p of state.pieces) {
    if (!p.placed || p === state.dragPiece) continue;
    drawPiece(ctx, p, PS);
  }

  // Draw unplaced, non-dragged pieces
  for (const p of state.pieces) {
    if (p.placed || p === state.dragPiece) continue;
    drawPiece(ctx, p, PS);
  }

  // Draw drag piece on top
  if (state.dragPiece) {
    drawPiece(ctx, state.dragPiece, PS, true);
  }

  // Draw target outlines for unplaced positions
  ctx.strokeStyle = 'rgba(59,130,246,0.2)';
  ctx.setLineDash([4, 4]);
  for (const p of state.pieces) {
    if (!p.placed) {
      ctx.strokeRect(p.targetX + 1, p.targetY + 1, PS - 2, PS - 2);
    }
  }
  ctx.setLineDash([]);
}

function drawPiece(ctx, p, PS, isDragging = false) {
  const imgSize = state.sourceImage.width;
  const srcX = p.srcCol * (imgSize / state.gridSize);
  const srcY = p.srcRow * (imgSize / state.gridSize);
  const srcW = imgSize / state.gridSize;

  ctx.save();
  if (isDragging) {
    ctx.shadowColor  = 'rgba(59,130,246,0.8)';
    ctx.shadowBlur   = 20;
    ctx.globalAlpha  = 0.95;
  }

  // Clip to piece shape
  ctx.beginPath();
  ctx.rect(p.x, p.y, PS, PS);
  ctx.clip();

  // Draw image slice
  ctx.drawImage(
    state.sourceImage,
    srcX, srcY, srcW, srcW,
    p.x, p.y, PS, PS
  );

  // Border
  ctx.strokeStyle = p.placed
    ? 'rgba(6,214,160,0.7)'
    : isDragging
    ? 'rgba(59,130,246,0.9)'
    : 'rgba(255,255,255,0.25)';
  ctx.lineWidth = p.placed ? 2 : 1.5;
  ctx.strokeRect(p.x + 1, p.y + 1, PS - 2, PS - 2);

  if (p.placed) {
    // Green checkmark overlay
    ctx.fillStyle = 'rgba(6,214,160,0.15)';
    ctx.fillRect(p.x, p.y, PS, PS);
  }

  ctx.restore();
}

// ── Drag & Drop ───────────────────────────────────────────────
function tryPickPiece(normX, normY) {
  const canvasX = normX * state.canvasSize;
  const canvasY = normY * state.canvasSize;
  const PS      = state.pieceSize;

  // Find topmost (last-rendered) unplaced piece under cursor
  let picked = null;
  for (let i = state.pieces.length - 1; i >= 0; i--) {
    const p = state.pieces[i];
    if (!p.placed &&
        canvasX >= p.x && canvasX <= p.x + PS &&
        canvasY >= p.y && canvasY <= p.y + PS) {
      picked = p;
      break;
    }
  }

  if (picked) {
    state.dragPiece = picked;
    state.dragOffX  = canvasX - picked.x;
    state.dragOffY  = canvasY - picked.y;
    // Bring to front
    state.pieces.splice(state.pieces.indexOf(picked), 1);
    state.pieces.push(picked);
  }
}

function moveDragPiece(normX, normY) {
  if (!state.dragPiece) return;
  const canvasX = normX * state.canvasSize;
  const canvasY = normY * state.canvasSize;
  state.dragPiece.x = canvasX - state.dragOffX;
  state.dragPiece.y = canvasY - state.dragOffY;
  renderPuzzle();
}

function dropPiece() {
  const p = state.dragPiece;
  if (!p) return;
  state.dragPiece = null;
  state.moves++;
  updateScoreDisplay();

  const PS     = state.pieceSize;
  const snapTh = PS * SNAP_THRESHOLD * 5;

  const dx = Math.abs(p.x - p.targetX);
  const dy = Math.abs(p.y - p.targetY);

  if (dx < snapTh && dy < snapTh) {
    // Snap!
    p.x = p.targetX;
    p.y = p.targetY;
    p.placed = true;
    state.score += 10 + Math.max(0, 50 - state.timer);
    updateScoreDisplay();
    checkCompletion();
  } else {
    // Check if overlapping another placed piece = mistake
    const overlaps = state.pieces.some(other =>
      other !== p && other.placed &&
      Math.abs(p.x - other.x) < PS * 0.5 &&
      Math.abs(p.y - other.y) < PS * 0.5
    );
    if (overlaps) {
      state.mistakes++;
      updateScoreDisplay();
    }
  }
  renderPuzzle();
}

function checkCompletion() {
  const allPlaced = state.pieces.every(p => p.placed);
  if (allPlaced) {
    gameComplete();
  }
}

// ═══════════════════════════════════════════════════════════════
//  GAME LIFECYCLE
// ═══════════════════════════════════════════════════════════════
function initGame() {
  if (!state.handLandmarks) {
    // MediaPipe may still be loading — that's fine
  }
  renderSplashInPuzzle();
}

function renderSplashInPuzzle() {
  const canvas = DOM.puzzleCanvas;
  const size   = canvas.parentElement.clientWidth;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(5,10,20,0.9)';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(59,130,246,0.5)';
  ctx.font = `bold ${size * 0.065}px "Segoe UI",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Press START GAME', size/2, size/2 - 20);
  ctx.fillStyle = 'rgba(180,200,230,0.4)';
  ctx.font = `${size * 0.04}px "Segoe UI",sans-serif`;
  ctx.fillText('Show hand to camera first', size/2, size/2 + 24);
}

/**
 * Resolve the puzzle source image from whichever tab is active.
 * Priority: captured → uploaded → gallery → generated fallback.
 */
function resolvePuzzleSource(size) {
  if (state.activeImageTab === 'gesture' && state.capturedImage) {
    return renderOffscreenImage(state.capturedImage, size);
  }
  if (state.activeImageTab === 'upload' && state.uploadedImage) {
    return renderUploadedImage(size);
  }
  if (state.activeImageTab === 'gallery' && state.galleryImage) {
    return renderOffscreenImage(state.galleryImage, size);
  }
  return generateSourceImage(size);
}

/** Render any HTMLImageElement or OffscreenCanvas onto a square canvas. */
function renderOffscreenImage(imgOrCanvas, size) {
  const off = document.createElement('canvas');
  off.width = off.height = size;
  const ctx = off.getContext('2d');
  const srcW = imgOrCanvas.width  || imgOrCanvas.naturalWidth;
  const srcH = imgOrCanvas.height || imgOrCanvas.naturalHeight;
  const scale = Math.max(size / srcW, size / srcH);
  const w = srcW * scale, h = srcH * scale;
  ctx.drawImage(imgOrCanvas, (size - w) / 2, (size - h) / 2, w, h);
  return off;
}

function startGame() {
  const gridSize = parseInt(state.mode.split('x')[0]);
  const srcCanvas = resolvePuzzleSource(600);

  state.moves    = 0;
  state.mistakes = 0;
  state.score    = 0;
  state.timer    = 0;
  state.running  = true;
  state.paused   = false;
  state.startTime = Date.now();
  state.gestureFrames  = 0;
  state.gestureCorrect = 0;
  // Reset drag state so no stale pinch carries over from previous game
  state.dragPiece    = null;
  state.pinchActive  = false;
  state.pinchFrames  = 0;
  state.releaseFrames = 0;
  setGridSelectorDisabled(true);

  initPuzzle(gridSize, srcCanvas);
  startTimer();
  updateScoreDisplay();

  toast(`Game started! ${state.mode} puzzle`, 'success');
}

function pauseGame() {
  if (!state.running) return;
  if (state.paused) {
    state.paused = false;
    DOM.pauseOverlay.classList.remove('show');
    startTimer();
    toast('Resumed', 'info');
  } else {
    state.paused = true;
    DOM.pauseOverlay.classList.add('show');
    stopTimer();
    toast('Paused — 👍 THUMBS UP to resume', 'info');
  }
}

function resumeGame() {
  if (state.paused) pauseGame();
}

function restartGame() {
  stopTimer();
  DOM.pauseOverlay.classList.remove('show');
  state.paused = false;
  state.running = false;
  setGridSelectorDisabled(false);
  startGame();
}

function gameComplete() {
  state.running = false;
  setGridSelectorDisabled(false);
  state.endTime = Date.now();
  stopTimer();

  const elapsed = Math.round((state.endTime - state.startTime) / 1000);
  const gestureAcc = state.gestureFrames > 0
    ? Math.round((state.gestureCorrect / state.gestureFrames) * 100)
    : 92;

  // Record performance
  const perfEntry = {
    time:       elapsed,
    moves:      state.moves,
    mistakes:   state.mistakes,
    gestureAcc: gestureAcc,
    mode:       state.mode,
  };
  state.perfHistory.push(perfEntry);
  if (state.perfHistory.length > 10) state.perfHistory.shift();

  updatePerformancePanel(perfEntry);

  // Show success overlay
  $('suc-time').textContent    = formatTime(elapsed);
  $('suc-moves').textContent   = state.moves;
  $('suc-mistakes').textContent= state.mistakes;
  $('suc-score').textContent   = state.score;
  DOM.successOverlay.classList.add('show');

  startConfetti();
}

// ═══════════════════════════════════════════════════════════════
//  TIMER
// ═══════════════════════════════════════════════════════════════
function startTimer() {
  stopTimer();
  const startMs = Date.now() - state.timer * 1000;
  state.timerInterval = setInterval(() => {
    state.timer = Math.round((Date.now() - startMs) / 1000);
    DOM.timerEl.textContent = formatTime(state.timer);
  }, 500);
}
function stopTimer() {
  if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
}
function formatTime(s) {
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

function updateScoreDisplay() {
  DOM.movesEl.textContent    = state.moves;
  DOM.mistakesEl.textContent = state.mistakes;
  DOM.scoreEl.textContent    = state.score;
}

// ═══════════════════════════════════════════════════════════════
//  AI PERFORMANCE ANALYSIS
// ═══════════════════════════════════════════════════════════════
function updatePerformancePanel(entry) {
  // null entry means reset (no game completed yet)
  if (!entry) {
    if (DOM.perfGrid)     DOM.perfGrid.textContent     = '—';
    if (DOM.perfTime)     DOM.perfTime.textContent     = '—';
    if (DOM.perfMoves)    DOM.perfMoves.textContent    = '—';
    if (DOM.perfMistakes) DOM.perfMistakes.textContent = '—';
    if (DOM.perfAccuracy) DOM.perfAccuracy.textContent = '—';
    if (DOM.perfScore)    DOM.perfScore.textContent    = '—';
    if (DOM.perfRec)      DOM.perfRec.innerHTML        = 'COMPLETE A GAME TO SEE ANALYSIS<strong></strong>';
    return;
  }

  const { time, moves, mistakes, gestureAcc, mode } = entry;

  // Puzzle size e.g. "3x3" → "3×3"
  const gridLabel = mode ? mode.replace('x', '×') : '—';

  // Score formula (0–100) — only meaningful for completed games
  // Time score: penalises slow solves; 0 s → 100, 200 s → 0
  const timeScore    = Math.max(0, 100 - time * 0.5);
  // Move score: penalises excess moves; optimal ≈ gridSize² → 0 pts at 125 moves
  const moveScore    = Math.max(0, 100 - moves * 0.8);
  // Mistake score: each wrong drop costs 5 points
  const mistakeScore = Math.max(0, 100 - mistakes * 5);
  // Gesture accuracy direct percentage
  const accScore     = gestureAcc;
  const perfScore    = Math.round((timeScore + moveScore + mistakeScore + accScore) / 4);

  let perfLabel, perfClass, recMode;
  if (perfScore >= 80)      { perfLabel = 'EXCELLENT'; perfClass = 'perf-excellent'; recMode = '5×5'; }
  else if (perfScore >= 60) { perfLabel = 'GOOD';      perfClass = 'perf-good';      recMode = '4×4'; }
  else if (perfScore >= 40) { perfLabel = 'AVERAGE';   perfClass = 'perf-average';   recMode = '4×4'; }
  else                      { perfLabel = 'POOR';      perfClass = 'perf-poor';      recMode = '3×3'; }

  if (DOM.perfGrid)     DOM.perfGrid.textContent     = gridLabel;
  if (DOM.perfTime)     DOM.perfTime.textContent     = formatTime(time);
  if (DOM.perfMoves)    DOM.perfMoves.textContent    = moves;
  if (DOM.perfMistakes) DOM.perfMistakes.textContent = mistakes;
  if (DOM.perfAccuracy) DOM.perfAccuracy.textContent = `${gestureAcc}%`;
  if (DOM.perfScore)    DOM.perfScore.innerHTML      = `<span class="perf-badge ${perfClass}">${perfLabel}</span>`;
  if (DOM.perfRec)      DOM.perfRec.innerHTML        = `RECOMMENDED DIFFICULTY<strong>${recMode}</strong>`;
}

// ═══════════════════════════════════════════════════════════════
//  CONFETTI
// ═══════════════════════════════════════════════════════════════
let confettiParticles = [];
let confettiRaf = null;

function startConfetti() {
  const canvas = DOM.confettiCanvas;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.classList.add('show');

  confettiParticles = Array.from({ length: 160 }, () => ({
    x:    Math.random() * canvas.width,
    y:    -10 - Math.random() * 100,
    vx:   (Math.random() - 0.5) * 3,
    vy:   2 + Math.random() * 4,
    size: 4 + Math.random() * 8,
    color: ['#3b82f6','#06d6a0','#f59e0b','#ef4444','#8b5cf6','#fff'][Math.floor(Math.random()*6)],
    rot:  Math.random() * Math.PI * 2,
    rotV: (Math.random() - 0.5) * 0.2,
  }));

  function frame() {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    confettiParticles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.rot += p.rotV;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
      ctx.restore();
    });
    confettiParticles = confettiParticles.filter(p => p.y < canvas.height + 20);
    if (confettiParticles.length) confettiRaf = requestAnimationFrame(frame);
    else stopConfetti();
  }
  confettiRaf = requestAnimationFrame(frame);
  setTimeout(stopConfetti, 5000);
}

function stopConfetti() {
  if (confettiRaf) { cancelAnimationFrame(confettiRaf); confettiRaf = null; }
  DOM.confettiCanvas.classList.remove('show');
}

// ═══════════════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════
function toast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  DOM.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ═══════════════════════════════════════════════════════════════
//  IMAGE SOURCE PANEL  (Tab 1: Gesture Capture · Tab 2: Upload · Tab 3: Gallery)
// ═══════════════════════════════════════════════════════════════

// ── Tab switching ──────────────────────────────────────────────
function initImgSourceTabs() {
  document.querySelectorAll('.img-src-tab').forEach(btn => {
    btn.addEventListener('click', () => switchImgTab(btn.dataset.tab));
  });
}

function switchImgTab(tab) {
  state.activeImageTab = tab;
  document.querySelectorAll('.img-src-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  document.querySelectorAll('.img-src-body').forEach(b =>
    b.classList.toggle('active', b.id === `tab-${tab}`)
  );
}

// ── Tab 1: Gesture Capture ─────────────────────────────────────

/**
 * gcState tracks gesture-capture mode independently.
 * Updated every frame from updatePinchPoint() when gc is active.
 */
const gcState = {
  hand1: null,   // {x, y} normalised — mirrored — index tip of hand 1
  hand2: null,   // same for hand 2
  holdTimer: null,
  captured: false,
};

/**
 * Called from updatePinchPoint() every MediaPipe frame with live two-hand data.
 * Only runs when the Gesture Capture tab is visible and no capture done yet.
 */
function updateGestureCapture(lm, lm2) {
  if (state.activeImageTab !== 'gesture') return;
  if (gcState.captured) return;

  const cvs    = DOM.gcPreviewCanvas;
  const frame  = DOM.gcFrame;
  const status = DOM.gcStatus;
  if (!cvs) return;

  // Mirror the live webcam feed onto the gc preview canvas
  const ctx = cvs.getContext('2d');
  cvs.width  = DOM.video.videoWidth  || 640;
  cvs.height = DOM.video.videoHeight || 480;
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(DOM.video, -cvs.width, 0, cvs.width, cvs.height);
  ctx.restore();

  if (!lm2) {
    // Only one hand — hide frame, reset hold
    if (frame) frame.classList.remove('visible');
    if (status) { status.textContent = 'Show both pinch gestures…'; status.className = 'gc-status'; }
    clearGcHold();
    gcState.hand1 = null; gcState.hand2 = null;
    if (DOM.gcCaptureBtn) DOM.gcCaptureBtn.disabled = true;
    return;
  }

  const h1Pinching = isPinchingLM(lm);
  const h2Pinching = isPinchingLM(lm2);

  if (!h1Pinching || !h2Pinching) {
    if (frame) frame.classList.remove('visible');
    if (status) { status.textContent = 'Pinch both thumbs + index fingers…'; status.className = 'gc-status'; }
    clearGcHold();
    if (DOM.gcCaptureBtn) DOM.gcCaptureBtn.disabled = true;
    return;
  }

  // Both pinching — compute bounding box on the preview canvas
  const pw = cvs.offsetWidth  || cvs.width;
  const ph = cvs.offsetHeight || cvs.height;

  // Hand positions in mirrored normalised space
  const x1n = 1 - lm[8].x,  y1n = lm[8].y;
  const x2n = 1 - lm2[8].x, y2n = lm2[8].y;

  const minX = Math.min(x1n, x2n), maxX = Math.max(x1n, x2n);
  const minY = Math.min(y1n, y2n), maxY = Math.max(y1n, y2n);

  // Draw frame overlay on preview wrap
  if (frame) {
    const wrapRect = DOM.gcPreviewCanvas.parentElement.getBoundingClientRect();
    frame.style.left   = `${minX * 100}%`;
    frame.style.top    = `${minY * 100}%`;
    frame.style.width  = `${(maxX - minX) * 100}%`;
    frame.style.height = `${(maxY - minY) * 100}%`;
    frame.classList.add('visible');
  }

  gcState.hand1 = { x: x1n, y: y1n };
  gcState.hand2 = { x: x2n, y: y2n };
  if (DOM.gcCaptureBtn) DOM.gcCaptureBtn.disabled = false;

  // Auto-hold timer: capture automatically after 3 s of stable hold
  if (!gcState.holdTimer) {
    if (status) { status.textContent = 'Hold still 3 s to auto-capture…'; status.className = 'gc-status'; }
    gcState.holdTimer = setTimeout(() => {
      if (gcState.hand1 && gcState.hand2) captureGestureFrame();
    }, 3000);
  } else {
    if (status) { status.textContent = '📸 Ready — hold still…'; status.className = 'gc-status ready'; }
  }
}

function clearGcHold() {
  if (gcState.holdTimer) { clearTimeout(gcState.holdTimer); gcState.holdTimer = null; }
}

function captureGestureFrame() {
  const cvs = DOM.gcPreviewCanvas;
  if (!cvs || !gcState.hand1 || !gcState.hand2) return;

  const W = cvs.width, H = cvs.height;
  const x1 = Math.min(gcState.hand1.x, gcState.hand2.x);
  const y1 = Math.min(gcState.hand1.y, gcState.hand2.y);
  const x2 = Math.max(gcState.hand1.x, gcState.hand2.x);
  const y2 = Math.max(gcState.hand1.y, gcState.hand2.y);

  // Add 5% padding, clamp to canvas bounds
  const pad = 0.05;
  const sx = Math.max(0, (x1 - pad) * W);
  const sy = Math.max(0, (y1 - pad) * H);
  const sw = Math.min(W - sx, (x2 - x1 + pad * 2) * W);
  const sh = Math.min(H - sy, (y2 - y1 + pad * 2) * H);

  // Crop from the live video (mirrored) into an offscreen canvas
  const off = document.createElement('canvas');
  off.width = Math.round(sw);
  off.height = Math.round(sh);
  const ctx = off.getContext('2d');
  ctx.save();
  // Draw mirrored video, then crop
  const tmpC = document.createElement('canvas');
  tmpC.width = W; tmpC.height = H;
  const tmpCtx = tmpC.getContext('2d');
  tmpCtx.save();
  tmpCtx.scale(-1, 1);
  tmpCtx.drawImage(DOM.video, -W, 0, W, H);
  tmpCtx.restore();
  ctx.drawImage(tmpC, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.restore();

  state.capturedImage = off;
  gcState.captured    = true;
  clearGcHold();

  // Update UI
  if (DOM.gcFrame)  DOM.gcFrame.classList.remove('visible');
  if (DOM.gcStatus) { DOM.gcStatus.textContent = '✅ Captured!'; DOM.gcStatus.className = 'gc-status ready'; }
  if (DOM.gcCaptureBtn) DOM.gcCaptureBtn.disabled = true;
  if (DOM.gcClearBtn)   DOM.gcClearBtn.style.display = 'block';
  if (DOM.gcActiveLabel) DOM.gcActiveLabel.style.display = 'block';

  // Show the cropped capture on the preview canvas
  const pvCtx = cvs.getContext('2d');
  cvs.width  = off.width;
  cvs.height = off.height;
  pvCtx.drawImage(off, 0, 0);

  toast('Frame captured — press START GAME to use it!', 'success');
}

function clearGestureCapture() {
  state.capturedImage = null;
  gcState.captured    = false;
  gcState.hand1 = null;
  gcState.hand2 = null;
  clearGcHold();

  if (DOM.gcClearBtn)    DOM.gcClearBtn.style.display = 'none';
  if (DOM.gcCaptureBtn)  DOM.gcCaptureBtn.disabled = true;
  if (DOM.gcActiveLabel) DOM.gcActiveLabel.style.display = 'none';
  if (DOM.gcFrame)       DOM.gcFrame.classList.remove('visible');
  if (DOM.gcStatus)      { DOM.gcStatus.textContent = 'Show both pinch gestures…'; DOM.gcStatus.className = 'gc-status'; }

  // Clear preview canvas
  const cvs = DOM.gcPreviewCanvas;
  if (cvs) {
    const ctx = cvs.getContext('2d');
    cvs.width = 320; cvs.height = 240;
    ctx.fillStyle = 'rgba(5,10,20,0.9)';
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.fillStyle = 'rgba(59,130,246,0.4)';
    ctx.font = '12px "Segoe UI",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Camera feed appears here', 160, 120);
  }
}

function initGestureCapture() {
  DOM.gcCaptureBtn?.addEventListener('click', captureGestureFrame);
  DOM.gcClearBtn?.addEventListener('click', clearGestureCapture);
  clearGestureCapture(); // initialise blank state
}

// ── Tab 2: File Upload ─────────────────────────────────────────
function initUpload() {
  const input   = DOM.uploadInput;
  const trigger = DOM.uploadTrigger;
  const zone    = DOM.uploadZone;
  if (!input || !trigger || !zone) return;

  trigger.addEventListener('click', () => input.click());

  input.addEventListener('change', () => {
    if (input.files && input.files[0]) loadUploadedFile(input.files[0]);
  });

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadUploadedFile(file);
  });

  DOM.uploadRemove?.addEventListener('click', e => { e.stopPropagation(); clearUpload(); });
}

function loadUploadedFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      state.uploadedImage = img;
      if (DOM.uploadThumb)   DOM.uploadThumb.src = ev.target.result;
      if (DOM.uploadPreview) DOM.uploadPreview.style.display = 'flex';
      if (DOM.uploadTrigger) DOM.uploadTrigger.style.display = 'none';
      toast('Image uploaded — start the game to use it', 'success');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function clearUpload() {
  state.uploadedImage = null;
  if (DOM.uploadInput)   DOM.uploadInput.value = '';
  if (DOM.uploadThumb)   DOM.uploadThumb.src = '';
  if (DOM.uploadPreview) DOM.uploadPreview.style.display = 'none';
  if (DOM.uploadTrigger) DOM.uploadTrigger.style.display = 'flex';
  toast('Custom image removed', 'info');
}

// ── Tab 3: Gallery ─────────────────────────────────────────────

/**
 * 6 built-in gallery images — each drawn entirely with Canvas 2D.
 * No external URLs, no images files needed.
 */
const GALLERY_PRESETS = [
  {
    id: 'sunset',
    label: 'Sunset',
    draw(ctx, S) {
      // Sky gradient
      const sky = ctx.createLinearGradient(0, 0, 0, S);
      sky.addColorStop(0,   '#0f0c29');
      sky.addColorStop(0.4, '#302b63');
      sky.addColorStop(0.7, '#e96c3f');
      sky.addColorStop(1,   '#f9d423');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, S, S);
      // Sun
      const sg = ctx.createRadialGradient(S/2, S*0.55, 0, S/2, S*0.55, S*0.22);
      sg.addColorStop(0, '#fff7aa'); sg.addColorStop(1, 'rgba(249,212,35,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(S/2, S*0.55, S*0.22, 0, Math.PI*2); ctx.fill();
      // Horizon hills
      ctx.fillStyle = '#1a1040';
      ctx.beginPath(); ctx.moveTo(0,S*0.7);
      for(let x=0;x<=S;x+=S/20) ctx.lineTo(x, S*0.65 + Math.sin(x/S*Math.PI*3)*S*0.07);
      ctx.lineTo(S,S); ctx.lineTo(0,S); ctx.closePath(); ctx.fill();
      // Reflection
      ctx.globalAlpha=0.35;
      const ref=ctx.createLinearGradient(0,S*0.75,0,S);
      ref.addColorStop(0,'#e96c3f'); ref.addColorStop(1,'#f9d423');
      ctx.fillStyle=ref; ctx.fillRect(0,S*0.75,S,S*0.25); ctx.globalAlpha=1;
    }
  },
  {
    id: 'ocean',
    label: 'Ocean',
    draw(ctx, S) {
      const sky=ctx.createLinearGradient(0,0,0,S*0.5);
      sky.addColorStop(0,'#0369a1'); sky.addColorStop(1,'#7dd3fc');
      ctx.fillStyle=sky; ctx.fillRect(0,0,S,S*0.5);
      const sea=ctx.createLinearGradient(0,S*0.5,0,S);
      sea.addColorStop(0,'#0284c7'); sea.addColorStop(1,'#0c4a6e');
      ctx.fillStyle=sea; ctx.fillRect(0,S*0.5,S,S*0.5);
      // Waves
      ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=2;
      for(let i=0;i<6;i++){
        const y=S*0.55+i*S*0.07;
        ctx.beginPath(); ctx.moveTo(0,y);
        for(let x=0;x<=S;x+=10) ctx.lineTo(x,y+Math.sin((x/S)*Math.PI*4+i)*6);
        ctx.stroke();
      }
      // Clouds
      ctx.fillStyle='rgba(255,255,255,0.85)';
      [[S*0.15,S*0.12,S*0.12],[S*0.6,S*0.08,S*0.1],[S*0.8,S*0.18,S*0.08]].forEach(([cx,cy,r])=>{
        ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx+r*0.7,cy+r*0.2,r*0.7,0,Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx-r*0.7,cy+r*0.2,r*0.7,0,Math.PI*2); ctx.fill();
      });
    }
  },
  {
    id: 'forest',
    label: 'Forest',
    draw(ctx, S) {
      // Sky
      ctx.fillStyle='#86efac'; ctx.fillRect(0,0,S,S*0.35);
      // Ground
      ctx.fillStyle='#166534'; ctx.fillRect(0,S*0.7,S,S*0.3);
      // Trees
      const tree=(x,h,w)=>{
        ctx.fillStyle='#7c3f1e';
        ctx.fillRect(x-w*0.1,S*0.7-h*0.25,w*0.2,h*0.25);
        ctx.fillStyle='#15803d';
        ctx.beginPath();
        ctx.moveTo(x,S*0.7-h);
        ctx.lineTo(x-w/2,S*0.7-h*0.3);
        ctx.lineTo(x+w/2,S*0.7-h*0.3);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle='#16a34a';
        ctx.beginPath();
        ctx.moveTo(x,S*0.7-h*1.15);
        ctx.lineTo(x-w*0.4,S*0.7-h*0.55);
        ctx.lineTo(x+w*0.4,S*0.7-h*0.55);
        ctx.closePath(); ctx.fill();
      };
      [[S*0.1,S*0.55,S*0.22],[S*0.28,S*0.65,S*0.26],[S*0.5,S*0.7,S*0.28],
       [S*0.72,S*0.62,S*0.25],[S*0.9,S*0.5,S*0.2]].forEach(([x,h,w])=>tree(x,h,w));
    }
  },
  {
    id: 'mountain',
    label: 'Mountain',
    draw(ctx, S) {
      const bg=ctx.createLinearGradient(0,0,0,S);
      bg.addColorStop(0,'#1e3a5f'); bg.addColorStop(0.5,'#4a90d9'); bg.addColorStop(1,'#e8e8e8');
      ctx.fillStyle=bg; ctx.fillRect(0,0,S,S);
      // Back mountains
      ctx.fillStyle='#5c7a9e';
      ctx.beginPath(); ctx.moveTo(0,S*0.65);
      ctx.lineTo(S*0.25,S*0.25); ctx.lineTo(S*0.55,S*0.55);
      ctx.lineTo(S*0.75,S*0.2); ctx.lineTo(S,S*0.5);
      ctx.lineTo(S,S); ctx.lineTo(0,S); ctx.closePath(); ctx.fill();
      // Front mountains
      ctx.fillStyle='#374151';
      ctx.beginPath(); ctx.moveTo(0,S*0.8);
      ctx.lineTo(S*0.3,S*0.4); ctx.lineTo(S*0.6,S*0.75);
      ctx.lineTo(S*0.8,S*0.35); ctx.lineTo(S,S*0.6);
      ctx.lineTo(S,S); ctx.lineTo(0,S); ctx.closePath(); ctx.fill();
      // Snow caps
      ctx.fillStyle='rgba(255,255,255,0.9)';
      [[S*0.3,S*0.4,S*0.08],[S*0.8,S*0.35,S*0.07]].forEach(([px,py,r])=>{
        ctx.beginPath(); ctx.moveTo(px,py);
        ctx.lineTo(px-r,py+r*1.2); ctx.lineTo(px+r,py+r*1.2); ctx.closePath(); ctx.fill();
      });
    }
  },
  {
    id: 'city',
    label: 'City Night',
    draw(ctx, S) {
      ctx.fillStyle='#0a0a1a'; ctx.fillRect(0,0,S,S);
      // Stars
      for(let i=0;i<80;i++){
        ctx.fillStyle=`rgba(255,255,255,${0.3+Math.random()*0.7})`;
        ctx.beginPath(); ctx.arc(Math.random()*S,Math.random()*S*0.5,Math.random()*1.5,0,Math.PI*2); ctx.fill();
      }
      // Buildings
      const buildings=[];
      let bx=0;
      while(bx<S){
        const bw=S*0.05+Math.random()*S*0.1;
        const bh=S*0.2+Math.random()*S*0.45;
        buildings.push({x:bx,w:bw,h:bh});
        bx+=bw+S*0.01;
      }
      buildings.forEach(b=>{
        const g=ctx.createLinearGradient(0,S-b.h,0,S);
        g.addColorStop(0,'#1e293b'); g.addColorStop(1,'#0f172a');
        ctx.fillStyle=g; ctx.fillRect(b.x,S-b.h,b.w,b.h);
        // Windows
        for(let wy=S-b.h+4;wy<S-4;wy+=10){
          for(let wx=b.x+3;wx<b.x+b.w-3;wx+=8){
            if(Math.random()>0.35){
              ctx.fillStyle=Math.random()>0.7?'#fbbf24':'#60a5fa';
              ctx.fillRect(wx,wy,4,5);
            }
          }
        }
      });
    }
  },
  {
    id: 'abstract',
    label: 'Abstract',
    draw(ctx, S) {
      ctx.fillStyle='#0f0f23'; ctx.fillRect(0,0,S,S);
      const colors=['#3b82f6','#06d6a0','#f59e0b','#ef4444','#8b5cf6','#ec4899'];
      for(let i=0;i<18;i++){
        const c=colors[i%colors.length];
        const x=Math.random()*S, y=Math.random()*S, r=S*0.05+Math.random()*S*0.2;
        const g=ctx.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0,c+'cc'); g.addColorStop(1,c+'00');
        ctx.fillStyle=g;
        ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
      }
      // Geometric overlay
      ctx.globalAlpha=0.15;
      for(let i=0;i<6;i++){
        ctx.strokeStyle=colors[i];
        ctx.lineWidth=1.5;
        ctx.beginPath();
        ctx.rect(S*0.1+i*S*0.05, S*0.1+i*S*0.05, S*0.8-i*S*0.1, S*0.8-i*S*0.1);
        ctx.stroke();
      }
      ctx.globalAlpha=1;
    }
  },
];

function initGallery() {
  const grid = DOM.galleryGrid;
  if (!grid) return;
  grid.innerHTML = '';

  GALLERY_PRESETS.forEach((preset, idx) => {
    const item = document.createElement('div');
    item.className = 'gallery-item';
    item.dataset.idx = idx;

    // Draw thumbnail
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = thumbCanvas.height = 120;
    preset.draw(thumbCanvas.getContext('2d'), 120);
    item.appendChild(thumbCanvas);

    // Label
    const label = document.createElement('div');
    label.className = 'gallery-item-label';
    label.textContent = preset.label;
    item.appendChild(label);

    item.addEventListener('click', () => selectGalleryItem(idx));
    grid.appendChild(item);
  });
}

function selectGalleryItem(idx) {
  // Draw full-res version
  const preset = GALLERY_PRESETS[idx];
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = fullCanvas.height = 600;
  preset.draw(fullCanvas.getContext('2d'), 600);
  state.galleryImage = fullCanvas;

  // Update selection UI
  document.querySelectorAll('.gallery-item').forEach((el, i) =>
    el.classList.toggle('selected', i === idx)
  );
  if (DOM.galleryLabel) DOM.galleryLabel.style.display = 'block';

  toast(`Gallery: "${preset.label}" selected`, 'success', 2000);
}

// ═══════════════════════════════════════════════════════════════
//  EVENT WIRING
// ═══════════════════════════════════════════════════════════════
function wireEvents() {
  // Nav buttons
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => showSection(btn.dataset.nav));
  });

  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.running) return;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
      state.gridSize = parseInt(btn.dataset.mode.split('x')[0]);
    });
  });

  // Game control buttons
  $('btn-start')?.addEventListener('click', startGame);
  $('btn-pause')?.addEventListener('click', pauseGame);
  $('btn-restart')?.addEventListener('click', restartGame);
  $('btn-resume')?.addEventListener('click', resumeGame);

  // Pause overlay resume
  DOM.pauseOverlay?.addEventListener('click', resumeGame);

  // Success overlay
  $('suc-btn-restart')?.addEventListener('click', () => {
    DOM.successOverlay.classList.remove('show');
    stopConfetti();
    restartGame();
  });
  $('suc-btn-close')?.addEventListener('click', () => {
    DOM.successOverlay.classList.remove('show');
    stopConfetti();
  });

  // Backend toggle
  DOM.useBackendToggle?.addEventListener('change', e => {
    state.useBackend = e.target.checked;
    if (state.useBackend) {
      connectWebSocket();
    } else {
      disconnectWebSocket();
    }
  });

  // Hero START button
  $('hero-start-btn')?.addEventListener('click', () => showSection('game'));
  $('hero-howto-btn')?.addEventListener('click', () => showSection('howto'));

  // Back to home button
  $('btn-back-home')?.addEventListener('click', () => showSection('home'));

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.code === 'KeyP') pauseGame();
    if (e.code === 'KeyR') restartGame();
  });

  // Window resize
  window.addEventListener('resize', () => {
    if (state.running) {
      initPuzzle(state.gridSize, state.sourceImage);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
//  BOOTSTRAP
// ═══════════════════════════════════════════════════════════════
async function bootstrap() {
  wireEvents();
  initImgSourceTabs();
  initGestureCapture();
  initUpload();
  initGallery();
  await initMediaPipe();
  updatePerformancePanel(null); // show dashes until a game is completed
  toast('AI HandPuzzle Pro ready', 'success');
}

window.addEventListener('DOMContentLoaded', bootstrap);
