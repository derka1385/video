"""Synthesise every line of dialogue with Kokoro (82M, runs on CPU).

Model files (not in the repo) are expected in build/models/:
  kokoro-v1.0.onnx, voices-v1.0.bin
from https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
"""
import hashlib
import json
import os
import sys

import numpy as np
import soundfile as sf

from script import CAST, LINES

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.environ.get("KOKORO_DIR", os.path.join(ROOT, "build", "models"))
OUT = os.path.join(ROOT, "build", "voice")

_kokoro = None


def kokoro():
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro
        _kokoro = Kokoro(os.path.join(MODELS, "kokoro-v1.0.onnx"),
                         os.path.join(MODELS, "voices-v1.0.bin"))
    return _kokoro


def synth(key, voice, lang, text, speed, phonemes=None):
    """Cached synthesis -> (float32 mono @24k, path).

    `phonemes` overrides espeak's reading where it mispronounces a word
    (a name inside Portuguese, a stressed "Sir").
    """
    os.makedirs(OUT, exist_ok=True)
    h = hashlib.sha1(json.dumps([voice, lang, text, speed, phonemes]).encode()).hexdigest()[:10]
    path = os.path.join(OUT, f"{key}_{h}.wav")
    if not os.path.exists(path):
        src = phonemes if phonemes else text
        audio, sr = kokoro().create(src, voice=voice, speed=speed, lang=lang,
                                    is_phonemes=bool(phonemes))
        sf.write(path, audio, sr)
    audio, sr = sf.read(path, dtype="float32")
    return audio, sr, path


def all_lines():
    out = {}
    for lid, who, lang, text, speed, _gap, extra in LINES:
        voice = CAST[who][0]
        a, sr, p = synth(lid, voice, lang, text, speed, extra.get("ph"))
        out[lid] = (a, sr)
        if "hit" in extra:
            w, _, _ = synth(lid + "_hit", voice, lang, extra["hit"], speed,
                            extra.get("hit_ph"))
            out[lid + "_hit"] = (w, sr)
    return out


if __name__ == "__main__":
    res = all_lines()
    total = 0
    for k, (a, sr) in res.items():
        print(f"{k:10s} {len(a)/sr:6.2f}s")
        total += len(a) / sr
    print("total", round(total, 1))
