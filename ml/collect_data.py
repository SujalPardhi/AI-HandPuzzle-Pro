"""
AI HandPuzzle Pro - Gesture Data Collector
==========================================
Collects hand landmark features from webcam for training the Random Forest classifier.

Usage:
    python ml/collect_data.py

Controls:
    Press 1-6 to select gesture class, SPACE to capture sample, Q to quit.

Gesture Classes:
    1 = PINCH
    2 = OPEN_PALM
    3 = FIST
    4 = THUMBS_UP
    5 = ONE_FINGER
    6 = TWO_FINGERS
"""

import cv2
import mediapipe as mp
import numpy as np
import pandas as pd
import os
import time

# ── MediaPipe setup ──────────────────────────────────────────────────────────
mp_hands = mp.solutions.hands
mp_drawing = mp.solutions.drawing_utils

GESTURE_LABELS = {
    '1': 'PINCH',
    '2': 'OPEN_PALM',
    '3': 'FIST',
    '4': 'THUMBS_UP',
    '5': 'ONE_FINGER',
    '6': 'TWO_FINGERS',
}

DATASET_PATH = os.path.join(os.path.dirname(__file__), 'dataset', 'gesture_data.csv')
SAMPLES_PER_GESTURE = 300


def extract_features(hand_landmarks) -> list[float]:
    """
    Extract normalised hand landmark features.
    Returns 63-element vector: (x, y, z) * 21 landmarks, relative to wrist.
    Also appends 15 inter-finger distance features.
    Total: 63 + 15 = 78 features.
    """
    lm = hand_landmarks.landmark
    wrist = lm[0]

    # Normalise relative to wrist, scale by hand bounding-box diagonal
    xs = [l.x for l in lm]
    ys = [l.y for l in lm]
    bbox_diag = max(
        ((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2) ** 0.5,
        1e-6
    )

    coords = []
    for l in lm:
        coords.extend([
            (l.x - wrist.x) / bbox_diag,
            (l.y - wrist.y) / bbox_diag,
            l.z / bbox_diag,
        ])

    # Key fingertip indices: thumb=4, index=8, middle=12, ring=16, pinky=20
    tips = [4, 8, 12, 16, 20]
    dist_features = []
    for i in range(len(tips)):
        for j in range(i + 1, len(tips)):
            a = lm[tips[i]]
            b = lm[tips[j]]
            d = ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2) ** 0.5
            dist_features.append(d / bbox_diag)

    return coords + dist_features  # 78 features


def main():
    os.makedirs(os.path.dirname(DATASET_PATH), exist_ok=True)

    # Load existing data if present
    if os.path.exists(DATASET_PATH):
        df_existing = pd.read_csv(DATASET_PATH)
        print(f"Loaded {len(df_existing)} existing samples.")
    else:
        df_existing = pd.DataFrame()

    records = []
    current_gesture = None
    last_capture_time = 0
    capture_interval = 0.15  # seconds between auto-captures when held

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        raise RuntimeError("Cannot open webcam. Check camera permissions.")

    with mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=1,
        min_detection_confidence=0.7,
        min_tracking_confidence=0.5,
    ) as hands:
        print("\n=== AI HandPuzzle Pro — Data Collector ===")
        print("Press 1-6 to select gesture, SPACE to capture, Q to quit")
        for k, v in GESTURE_LABELS.items():
            print(f"  {k} → {v}")

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = hands.process(rgb)

            overlay = frame.copy()
            h, w = frame.shape[:2]

            # Draw landmarks
            if results.multi_hand_landmarks:
                for hand_lm in results.multi_hand_landmarks:
                    mp_drawing.draw_landmarks(
                        overlay, hand_lm, mp_hands.HAND_CONNECTIONS,
                        mp_drawing.DrawingSpec(color=(0, 255, 180), thickness=2, circle_radius=3),
                        mp_drawing.DrawingSpec(color=(0, 180, 255), thickness=2),
                    )

            # Status panel
            cv2.rectangle(overlay, (0, 0), (w, 80), (10, 10, 30), -1)
            gesture_text = current_gesture if current_gesture else "None selected"
            cv2.putText(overlay, f"Gesture: {gesture_text}", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 180), 2)
            count_this = sum(1 for r in records if r['label'] == current_gesture)
            cv2.putText(overlay, f"Captured this session: {count_this}  |  Press 1-6 to select, SPACE to capture, Q to quit",
                        (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (180, 180, 180), 1)

            cv2.imshow("AI HandPuzzle Pro — Data Collector", overlay)

            key = cv2.waitKey(1) & 0xFF

            if key == ord('q'):
                break
            elif chr(key) in GESTURE_LABELS if key != 255 else False:
                current_gesture = GESTURE_LABELS[chr(key)]
                print(f"\nSelected: {current_gesture}")
            elif key == ord(' '):
                if current_gesture and results.multi_hand_landmarks:
                    now = time.time()
                    if now - last_capture_time >= capture_interval:
                        features = extract_features(results.multi_hand_landmarks[0])
                        record = {f'f{i}': v for i, v in enumerate(features)}
                        record['label'] = current_gesture
                        records.append(record)
                        last_capture_time = now
                        count_this = sum(1 for r in records if r['label'] == current_gesture)
                        print(f"  ✓ {current_gesture} sample #{count_this} captured ({len(features)} features)")
                elif not current_gesture:
                    print("Select a gesture first (press 1-6)")
                else:
                    print("No hand detected — show your hand to the camera")

    cap.release()
    cv2.destroyAllWindows()

    if records:
        df_new = pd.DataFrame(records)
        df_all = pd.concat([df_existing, df_new], ignore_index=True) if not df_existing.empty else df_new
        df_all.to_csv(DATASET_PATH, index=False)
        print(f"\n✅ Saved {len(records)} new samples → {DATASET_PATH}")
        print(f"   Total dataset size: {len(df_all)} samples")
        print("\nClass distribution:")
        print(df_all['label'].value_counts().to_string())
    else:
        print("\nNo samples captured. Dataset unchanged.")


if __name__ == '__main__':
    main()
