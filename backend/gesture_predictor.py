"""
AI HandPuzzle Pro - Gesture Predictor
======================================
Loads the trained Random Forest model and runs inference on incoming
hand-landmark feature vectors.
"""

import os
import pickle
import numpy as np
from typing import Optional

MODEL_PATH = os.path.join(os.path.dirname(__file__), '..', 'ml', 'gesture_model.pkl')


class GesturePredictor:
    """Wraps the trained sklearn Pipeline for gesture inference."""

    def __init__(self, model_path: str = MODEL_PATH):
        self.model_path    = os.path.abspath(model_path)
        self.pipeline      = None
        self.gesture_labels: list[str] = []
        self.n_features    = 73
        self.accuracy      = 0.0
        self.loaded        = False
        self._load()

    # ── Loading ───────────────────────────────────────────────────────────────

    def _load(self):
        if not os.path.exists(self.model_path):
            print(f"[GesturePredictor] Model not found at {self.model_path}")
            print("  Run: python ml/train_model.py")
            return
        try:
            with open(self.model_path, 'rb') as f:
                bundle = pickle.load(f)
            self.pipeline       = bundle['pipeline']
            self.gesture_labels = bundle['gesture_labels']
            self.n_features     = bundle.get('n_features', 78)
            self.accuracy       = bundle.get('accuracy', 0.0)
            self.loaded         = True
            print(f"[GesturePredictor] Model loaded. Accuracy={self.accuracy*100:.1f}%  "
                  f"Gestures={self.gesture_labels}")
        except Exception as e:
            print(f"[GesturePredictor] Failed to load model: {e}")

    def reload(self):
        """Reload model from disk (useful after retraining)."""
        self.loaded = False
        self._load()

    # ── Inference ─────────────────────────────────────────────────────────────

    def predict(self, features: list[float]) -> dict:
        """
        Run gesture prediction.

        Parameters
        ----------
        features : list[float]
            78-element feature vector produced by extract_features().

        Returns
        -------
        dict with keys:
            gesture    : str   — predicted gesture label
            confidence : float — probability in [0, 1]
            all_probs  : dict  — {gesture: probability} for all classes
            success    : bool  — False if model not loaded
        """
        if not self.loaded or self.pipeline is None:
            return {'gesture': 'UNKNOWN', 'confidence': 0.0,
                    'all_probs': {}, 'success': False}

        try:
            X = np.array(features, dtype=np.float32).reshape(1, -1)
            if X.shape[1] != self.n_features:
                raise ValueError(
                    f"Expected {self.n_features} features, got {X.shape[1]}"
                )
            proba = self.pipeline.predict_proba(X)[0]
            classes = self.pipeline.classes_
            best_idx = int(np.argmax(proba))
            return {
                'gesture':    str(classes[best_idx]),
                'confidence': float(proba[best_idx]),
                'all_probs':  {str(c): float(p) for c, p in zip(classes, proba)},
                'success':    True,
            }
        except Exception as e:
            return {'gesture': 'ERROR', 'confidence': 0.0,
                    'all_probs': {}, 'success': False, 'error': str(e)}

    # ── Metadata ──────────────────────────────────────────────────────────────

    def get_info(self) -> dict:
        return {
            'loaded':         self.loaded,
            'model_path':     self.model_path,
            'gesture_labels': self.gesture_labels,
            'n_features':     self.n_features,
            'accuracy':       self.accuracy,
        }
