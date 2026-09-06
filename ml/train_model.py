"""
AI HandPuzzle Pro - Random Forest Gesture Classifier Trainer
=============================================================
Trains a Random Forest classifier on collected hand-landmark feature data.

If no real dataset exists, generates a realistic synthetic dataset so the
application can run out-of-the-box.  Run collect_data.py first for better
accuracy on your own hand.

Usage:
    python ml/train_model.py

Output:
    ml/gesture_model.pkl   -- trained model + scaler bundle
"""

import os
import sys
import numpy as np
import pandas as pd
import pickle
import warnings
warnings.filterwarnings('ignore')

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, cross_val_score, StratifiedKFold
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    classification_report, confusion_matrix, accuracy_score
)
from sklearn.pipeline import Pipeline

# Paths
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DATASET    = os.path.join(BASE_DIR, 'dataset', 'gesture_data.csv')
MODEL_OUT  = os.path.join(BASE_DIR, 'gesture_model.pkl')

GESTURE_LABELS = ['PINCH', 'OPEN_PALM', 'FIST', 'THUMBS_UP', 'ONE_FINGER', 'TWO_FINGERS']
N_FEATURES     = 73   # 63 coords (21*3) + 10 inter-tip distances C(5,2)


# --- Synthetic data generator -------------------------------------------

def _make_landmark_array(lm_3d):
    """
    Convert (21, 3) landmark array -> 78-feature vector matching collect_data.py.
    lm_3d: shape (21, 3) in normalised coords relative to wrist.
    """
    bbox_diag = max(
        ((lm_3d[:, 0].max() - lm_3d[:, 0].min()) ** 2 +
         (lm_3d[:, 1].max() - lm_3d[:, 1].min()) ** 2) ** 0.5,
        1e-6
    )
    wrist = lm_3d[0]
    coords = []
    for pt in lm_3d:
        coords.extend([
            (pt[0] - wrist[0]) / bbox_diag,
            (pt[1] - wrist[1]) / bbox_diag,
            pt[2] / bbox_diag,
        ])
    tips = [4, 8, 12, 16, 20]
    dist_feats = []
    for i in range(len(tips)):
        for j in range(i + 1, len(tips)):
            d = np.linalg.norm(lm_3d[tips[i]] - lm_3d[tips[j]]) / bbox_diag
            dist_feats.append(float(d))
    return np.array(coords + dist_feats, dtype=np.float32)


def _random_hand_base(rng):
    """Generate a plausible 21-landmark hand skeleton (21x3)."""
    lm = np.zeros((21, 3), dtype=np.float32)
    lm[0] = [0, 0, 0]
    palm_mcp = np.array([
        [0.05, -0.09, 0], [0.10, -0.10, 0],
        [0.14, -0.10, 0], [0.18, -0.09, 0],
    ])
    for i, mcp in enumerate(palm_mcp):
        base = 5 + i * 4
        lm[base] = mcp + rng.normal(0, 0.005, 3)
        for j in range(1, 4):
            lm[base + j] = lm[base] + np.array([0, -0.04 * j, 0]) + rng.normal(0, 0.004, 3)
    lm[1] = [0.03, -0.04, 0] + rng.normal(0, 0.005, 3)
    lm[2] = [0.06, -0.06, 0] + rng.normal(0, 0.005, 3)
    lm[3] = [0.08, -0.08, 0] + rng.normal(0, 0.005, 3)
    lm[4] = [0.09, -0.10, 0] + rng.normal(0, 0.005, 3)
    return lm


def _apply_gesture(lm_base, gesture, rng):
    """Deform the base hand skeleton to approximate a gesture."""
    lm = lm_base.copy()
    if gesture == 'PINCH':
        mid = (lm[4] + lm[8]) / 2 + rng.normal(0, 0.008, 3)
        lm[4] = mid + rng.normal(0, 0.005, 3)
        lm[8] = mid + rng.normal(0, 0.005, 3)
        for tip in [12, 16, 20]:
            lm[tip] = lm[tip] + np.array([0, 0.06, 0]) + rng.normal(0, 0.008, 3)
    elif gesture == 'OPEN_PALM':
        offsets = [-0.02, 0.0, 0.0, 0.0, 0.02]
        tips = [4, 8, 12, 16, 20]
        for k, tip in enumerate(tips):
            lm[tip] = lm[tip] + np.array([offsets[k], -0.06, 0]) + rng.normal(0, 0.008, 3)
    elif gesture == 'FIST':
        tips = [4, 8, 12, 16, 20]
        for tip in tips:
            lm[tip] = lm[0] + rng.normal(0, 0.015, 3) + np.array([0.05, -0.03, 0])
    elif gesture == 'THUMBS_UP':
        lm[4] = lm[4] + np.array([0.0, -0.08, 0]) + rng.normal(0, 0.008, 3)
        for tip in [8, 12, 16, 20]:
            lm[tip] = lm[0] + rng.normal(0, 0.015, 3) + np.array([0.05, -0.02, 0])
    elif gesture == 'ONE_FINGER':
        lm[8] = lm[8] + np.array([0.0, -0.06, 0]) + rng.normal(0, 0.008, 3)
        for tip in [4, 12, 16, 20]:
            lm[tip] = lm[0] + rng.normal(0, 0.012, 3) + np.array([0.04, -0.02, 0])
    elif gesture == 'TWO_FINGERS':
        lm[8]  = lm[8]  + np.array([-0.01, -0.07, 0]) + rng.normal(0, 0.008, 3)
        lm[12] = lm[12] + np.array([ 0.01, -0.07, 0]) + rng.normal(0, 0.008, 3)
        for tip in [4, 16, 20]:
            lm[tip] = lm[0] + rng.normal(0, 0.012, 3) + np.array([0.04, -0.02, 0])
    return lm


def generate_synthetic_dataset(n_per_class=500):
    """Generate synthetic landmark features for all gesture classes."""
    rng = np.random.RandomState(42)
    records = []
    for gesture in GESTURE_LABELS:
        for _ in range(n_per_class):
            base = _random_hand_base(rng)
            lm   = _apply_gesture(base, gesture, rng)
            feat = _make_landmark_array(lm)
            row  = {f'f{i}': float(v) for i, v in enumerate(feat)}
            row['label'] = gesture
            records.append(row)
    return pd.DataFrame(records)


# --- Training -----------------------------------------------------------

def train():
    sep = "=" * 60
    print(sep)
    print(" AI HandPuzzle Pro -- Random Forest Trainer")
    print(sep)

    # Load or generate dataset
    if os.path.exists(DATASET):
        df = pd.read_csv(DATASET)
        print(f"\n[OK] Loaded real dataset: {len(df)} samples")
    else:
        print("\n[!] No real dataset found. Generating synthetic training data...")
        print("    (Run ml/collect_data.py to collect real data for better accuracy)")
        df = generate_synthetic_dataset(n_per_class=500)
        os.makedirs(os.path.dirname(DATASET), exist_ok=True)
        df.to_csv(DATASET, index=False)
        print(f"    Synthetic dataset saved -> {DATASET}")

    print(f"\n[Data] Class distribution:")
    counts = df['label'].value_counts()
    for label, count in counts.items():
        print(f"   {label:15s}: {count:4d} samples")

    feature_cols = [c for c in df.columns if c.startswith('f')]
    X = df[feature_cols].values.astype(np.float32)
    y = df['label'].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"\n[Split] Train: {len(X_train)} | Test: {len(X_test)}")

    # Pipeline: scaler + RF
    pipeline = Pipeline([
        ('scaler', StandardScaler()),
        ('rf', RandomForestClassifier(
            n_estimators=200,
            max_depth=None,
            min_samples_split=4,
            min_samples_leaf=2,
            max_features='sqrt',
            class_weight='balanced',
            random_state=42,
            n_jobs=-1,
        ))
    ])

    print("\n[Training] Random Forest (200 trees)...")
    pipeline.fit(X_train, y_train)

    # Evaluation
    y_pred = pipeline.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    print(f"\n[Result] Test Accuracy: {acc * 100:.2f}%")

    # Cross-validation
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv_scores = cross_val_score(pipeline, X, y, cv=cv, scoring='accuracy', n_jobs=-1)
    print(f"[CV]     5-fold CV Accuracy: {cv_scores.mean()*100:.2f}% +/- {cv_scores.std()*100:.2f}%")

    # Classification report
    print("\n[Report] Classification Report:")
    print(classification_report(y_test, y_pred, target_names=sorted(set(y))))

    # Confusion matrix
    labels_sorted = sorted(set(y))
    cm = confusion_matrix(y_test, y_pred, labels=labels_sorted)
    print("[Matrix] Confusion Matrix:")
    header = f"{'':15s}" + "".join(f"{l[:7]:>8s}" for l in labels_sorted)
    print(header)
    for i, row_label in enumerate(labels_sorted):
        row_str = f"{row_label:15s}" + "".join(f"{cm[i][j]:8d}" for j in range(len(labels_sorted)))
        print(row_str)

    # Feature importance
    rf_model = pipeline.named_steps['rf']
    importances = rf_model.feature_importances_
    top_idx = np.argsort(importances)[::-1][:10]
    print("\n[Features] Top-10 Most Important Features:")
    for rank, idx in enumerate(top_idx, 1):
        print(f"   {rank:2d}. f{idx:02d}: importance={importances[idx]:.4f}")

    # Save model bundle
    model_bundle = {
        'pipeline':       pipeline,
        'gesture_labels': GESTURE_LABELS,
        'n_features':     len(feature_cols),
        'accuracy':       float(acc),
        'cv_mean':        float(cv_scores.mean()),
        'cv_std':         float(cv_scores.std()),
    }
    with open(MODEL_OUT, 'wb') as f:
        pickle.dump(model_bundle, f)

    print(f"\n[Saved] Model -> {MODEL_OUT}")
    print(f"        Accuracy: {acc*100:.2f}%")
    print(sep)
    print(" Training complete!")
    print(sep)
    return pipeline, acc


if __name__ == '__main__':
    train()
