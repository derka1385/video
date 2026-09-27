"""Laughter, synthesised from a glottal source through vocal-tract formants.

A laugh bout is a train of short "ha" calls (~4-5 per second): an aspirated
onset, a voiced vowel whose pitch arcs and falls across the bout, decaying
intensity, and often an inhale at the end. Each character has their own pitch,
vocal-tract length and breathiness so the group sounds like people, not a patch.
"""
import numpy as np
from scipy import signal

from dsp import SR, hp, lp, seconds

# f0 (Hz), formant scale, breathiness, call rate (Hz)
PEOPLE = {
    "LU":   dict(f0=255, fs=1.16, br=0.32, rate=4.7),
    "BIA":  dict(f0=285, fs=1.19, br=0.28, rate=5.2),
    "RAFA": dict(f0=138, fs=1.00, br=0.22, rate=4.2),
    "SAM":  dict(f0=225, fs=1.14, br=0.55, rate=4.4),
    "NOOR": dict(f0=165, fs=1.04, br=0.50, rate=3.8),
}

# male-reference formants (F1..F4) for the vowels a laugh wanders between
VOWELS = {
    "a": (760, 1150, 2450, 3400),
    "ʌ": (640, 1190, 2390, 3350),
    "ɛ": (560, 1750, 2500, 3500),
    "ə": (520, 1450, 2480, 3450),
    "m": (280, 1050, 2300, 3300),   # closed-mouth chuckle
}
BW = (80, 110, 150, 220)
GAINS = (1.0, 0.55, 0.32, 0.14)


def _glottal(f0_track, oq=0.62, rng=None):
    """Rosenberg glottal flow derivative for a per-sample f0 track."""
    ph = np.cumsum(f0_track / SR)
    frac = ph - np.floor(ph)
    tp = oq * 0.66
    tn = oq * 0.34
    g = np.where(frac < tp, 0.5 * (1 - np.cos(np.pi * frac / tp)),
                 np.where(frac < tp + tn, np.cos(np.pi * (frac - tp) / (2 * tn)), 0.0))
    dg = np.diff(g, prepend=0.0)
    open_phase = (frac < tp + tn).astype(np.float32)
    return dg.astype(np.float32), open_phase


def _formants(x, vowel, scale, bw_mult=1.0):
    out = np.zeros_like(x)
    for f, bw, g in zip(VOWELS[vowel], BW, GAINS):
        f = f * scale
        r = np.exp(-np.pi * bw * bw_mult / SR)
        th = 2 * np.pi * f / SR
        a = [1, -2 * r * np.cos(th), r * r]
        b = [1 - r]
        out += g * signal.lfilter(b, a, x)
    return out.astype(np.float32)


def laugh(who, dur, intensity=1.0, seed=0, style="ha"):
    """Return a mono laugh bout for `who` of roughly `dur` seconds."""
    p = PEOPLE[who]
    rng = np.random.default_rng(seed)
    n = seconds(dur + 0.6)
    t = np.arange(n) / SR
    f0 = np.full(n, p["f0"], np.float64)
    amp = np.zeros(n, np.float32)
    asp_env = np.zeros(n, np.float32)
    rate = p["rate"] * rng.uniform(0.92, 1.08)
    ncalls = max(2, int(dur * rate * (0.95 if style == "ha" else 0.7)))
    vowel = rng.choice(["a", "a", "ʌ", "ɛ", "ə"]) if style == "ha" else "m"

    for i in range(ncalls):
        prog = i / max(1, ncalls - 1)
        t0 = i / rate + rng.normal(0, 0.012)
        clen = (0.62 + rng.uniform(-0.08, 0.1)) / rate
        a0, a1 = seconds(max(0, t0)), seconds(max(0, t0) + clen)
        if a1 >= n:
            break
        seg = np.arange(a1 - a0) / (a1 - a0)
        onset = 0.28 if style == "ha" else 0.12
        # call pitch: arc inside the call, bout-level decline, occasional peak
        base = p["f0"] * (1.28 - 0.4 * prog) * rng.uniform(0.94, 1.07)
        if i == 1 and rng.random() < 0.6:
            base *= 1.12
        f0[a0:a1] = base * (1 + 0.1 * np.sin(np.pi * np.clip((seg - onset) / (1 - onset), 0, 1)) - 0.06 * seg)
        # intensity decays across the bout, with a little irregularity
        lvl = intensity * (1.0 - 0.62 * prog ** 0.8) * rng.uniform(0.8, 1.1)
        v = np.clip((seg - onset) / 0.05, 0, 1) * np.exp(-4.6 * np.clip(seg - onset, 0, 1))
        amp[a0:a1] = np.maximum(amp[a0:a1], lvl * v)
        h = np.exp(-((seg - onset * 0.55) / (onset * 0.55 + 1e-3)) ** 2)
        asp_env[a0:a1] = np.maximum(asp_env[a0:a1], lvl * (0.8 * h + 0.35 * v))

    # jitter and shimmer so no two cycles are identical
    wob = lp(rng.standard_normal(n).astype(np.float32), 30)
    f0 *= 1 + 0.035 * wob / (np.std(wob) + 1e-9) * 0.5
    src, open_phase = _glottal(f0)
    src = src / (np.max(np.abs(src)) + 1e-9)
    voiced = src * amp
    noise = hp(rng.standard_normal(n).astype(np.float32), 350) * 0.22
    asp = noise * (asp_env + (p["br"] + 0.15) * amp * (0.4 + 0.6 * open_phase))
    out = _formants(voiced * 1.0 + asp * 0.9, vowel, p["fs"], 1.0 + p["br"])

    # inhale to close a real laugh
    end = seconds(min(dur, ncalls / rate) + 0.08)
    if style == "ha" and dur > 1.6 and intensity > 0.6:
        il = seconds(rng.uniform(0.35, 0.5))
        if end + il < n:
            e = np.sin(np.linspace(0, np.pi, il)) ** 1.5
            inh = hp(rng.standard_normal(il).astype(np.float32), 1200) * e * 0.02 * intensity
            out[end:end + il] += _formants(inh, "ɛ", p["fs"] * 1.1, 2.0)[:il] * 1.8
    out = hp(out, 90)
    pk = np.max(np.abs(out)) + 1e-9
    return (out / pk * 0.5 * intensity).astype(np.float32)


def breath_laugh(who="SAM", seed=0, pulses=2, level=0.35):
    """A small nasal exhale-laugh: the polite 'heh' of someone smiling along."""
    p = PEOPLE[who]
    rng = np.random.default_rng(seed)
    n = seconds(0.2 * pulses + 0.5)
    env = np.zeros(n, np.float32)
    f0 = np.full(n, p["f0"] * 0.85)
    for i in range(pulses):
        a0 = seconds(0.03 + i * rng.uniform(0.16, 0.2))
        L = seconds(rng.uniform(0.09, 0.13))
        seg = np.linspace(0, 1, L)
        env[a0:a0 + L] = np.maximum(env[a0:a0 + L], (1 - 0.35 * i) * np.sin(np.pi * seg) ** 0.7 * np.exp(-1.5 * seg))
    src, _ = _glottal(f0)
    src /= np.max(np.abs(src)) + 1e-9
    noise = hp(rng.standard_normal(n).astype(np.float32), 500)
    x = _formants(src * env * 0.12 + noise * env * 0.8, "ə", p["fs"], 2.2)
    x = hp(x, 120)
    return (x / (np.max(np.abs(x)) + 1e-9) * level).astype(np.float32)


# Who laughs, when (offset s), how long and how hard, for each kind of moment.
GROUPS = {
    "group": [("LU", 0.00, 1.0, 1.0), ("BIA", 0.12, 0.95, 0.95), ("SAM", 0.20, 0.8, 0.8),
              ("NOOR", 0.45, 0.4, 0.35), ("RAFA", 0.30, 0.55, 0.6)],
    "big":   [("BIA", 0.00, 1.0, 1.0), ("LU", 0.08, 1.0, 1.0), ("SAM", 0.15, 0.9, 0.85),
              ("RAFA", 0.25, 0.8, 0.8), ("NOOR", 0.5, 0.45, 0.4)],
    "tail":  [("LU", 0.0, 0.9, 0.55), ("SAM", 0.1, 0.6, 0.45), ("BIA", 0.25, 0.7, 0.5)],
    "pt":    [("LU", 0.0, 1.0, 0.9), ("BIA", 0.1, 0.85, 0.85), ("RAFA", 0.2, 0.7, 0.75)],
    "sharp": [("BIA", 0.0, 1.0, 1.0), ("LU", 0.05, 0.95, 1.0), ("RAFA", 0.12, 0.8, 0.85)],
    "warm":  [("LU", 0.0, 1.0, 0.95), ("BIA", 0.07, 0.95, 0.9), ("SAM", 0.12, 0.95, 0.9),
              ("RAFA", 0.2, 0.7, 0.7), ("NOOR", 0.55, 0.35, 0.3)],
}


def group_laugh(kind, dur, intensity, seed=0):
    """List of (who, offset_s, mono) for a group laugh."""
    out = []
    for k, (who, off, dscale, lvl) in enumerate(GROUPS[kind]):
        style = "m" if who == "NOOR" else "ha"
        d = max(0.8, dur * dscale)
        if who == "SAM" and kind in ("group", "big", "tail"):
            x = laugh(who, d * 0.8, intensity * lvl, seed=seed * 31 + k)
        else:
            x = laugh(who, d, intensity * lvl, seed=seed * 31 + k, style=style)
        out.append((who, off, x))
    return out
