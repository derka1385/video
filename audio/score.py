"""The internal score: drones, bowed glass, low pulses, and the conversation
itself stretched into a choir.

Harmony lives around D: a D minor 9 world while Sam is inside her head, a
D major 9 bloom when the room comes back. Everything is additive synthesis or
filtered noise; no samples.
"""
import numpy as np

from dsp import (SR, bp, brown, comb_tune, hp, lp, paulstretch, pink, seconds,
                 smooth_noise, smoothstep)

NOTE = {
    "G1": 49.00, "A1": 55.00, "Bb1": 58.27, "C2": 65.41, "D2": 73.42, "E2": 82.41, "F2": 87.31,
    "G2": 98.00, "A2": 110.0, "Bb2": 116.54, "C3": 130.81, "D3": 146.83, "E3": 164.81,
    "F3": 174.61, "F#3": 185.00, "G3": 196.0, "A3": 220.0, "Bb3": 233.08, "C4": 261.63,
    "D4": 293.66, "E4": 329.63, "F4": 349.23, "F#4": 369.99, "G4": 392.0, "A4": 440.0,
    "Bb4": 466.16, "C5": 523.25, "D5": 587.33, "E5": 659.26, "F5": 698.46, "F#5": 739.99,
    "G5": 783.99, "A5": 880.0, "Bb5": 932.33, "C6": 1046.5, "D6": 1174.66, "E6": 1318.5,
}

CHORDS = {
    "Dm9":     ["D2", "A2", "F3", "A3", "C4", "E4"],
    "Bbmaj7":  ["Bb1", "F2", "D3", "A3", "E4"],
    "Gm9":     ["G1", "D2", "Bb2", "F3", "A3"],
    "Fmaj7":   ["C2", "F2", "A2", "E3", "C4"],
    "Dsus":    ["D2", "A2", "E3", "A3", "D4"],
    "Dmaj9":   ["D2", "A2", "F#3", "A3", "E4", "F#4"],
}


def freqs(chord):
    return [NOTE[n] for n in CHORDS[chord]]


def pad_note(f, n, seed, bright=0.5, width=1.0):
    """One sustained additive tone with drifting partials; stereo."""
    r = np.random.default_rng(seed)
    out = np.zeros((n, 2), np.float32)
    hmax = int(min(10, 5200 / f))
    for h in range(1, hmax + 1):
        amp = 1.0 / h ** (2.2 - bright)
        if amp < 0.004:
            continue
        for ch in range(2):
            drift = 1 + 0.0018 * smooth_noise(n, 0.08, r.integers(1 << 30)) * width
            ph = 2 * np.pi * np.cumsum(f * h * drift) / SR + r.uniform(0, 6.283)
            shimmer = 0.75 + 0.25 * smooth_noise(n, 0.2 + 0.05 * h, r.integers(1 << 30))
            out[:, ch] += (amp * shimmer * np.sin(ph)).astype(np.float32)
    return out


def pad(sections, total, seed=0, bright=0.45, xfade=5.0):
    """sections: list of (t0, t1, chord). Overlapping crossfades between them."""
    n = seconds(total)
    out = np.zeros((n, 2), np.float32)
    for k, (t0, t1, chord) in enumerate(sections):
        a0 = seconds(max(0, t0 - xfade / 2))
        a1 = min(n, seconds(t1 + xfade / 2))
        L = a1 - a0
        if L <= 0:
            continue
        tt = np.arange(L) / SR
        env = smoothstep(0, xfade, tt) * smoothstep(0, xfade, (L / SR) - tt)
        seg = np.zeros((L, 2), np.float32)
        for i, f in enumerate(freqs(chord)):
            lvl = 1.0 if f < 150 else (0.55 if f < 300 else 0.3)
            seg += pad_note(f, L, seed * 97 + k * 13 + i, bright) * lvl
        # breath of air resonating on the same pitches
        air = comb_tune(pink(L, seed + k), [f * 2 for f in freqs(chord)[1:4]], fb=0.996)
        air = hp(bp(air, 900, 0.4), 250)
        seg[:, 0] += air * 0.18
        seg[:, 1] += np.roll(air, 331) * 0.18
        out[a0:a1] += seg * env[:, None]
    return out / (np.max(np.abs(out)) + 1e-9) * 0.5


def glass(f, dur, level=1.0, seed=0, attack=0.45, release=None):
    """Bowed glass: almost a sine, slow bloom, a slow beat, the faintest octave."""
    r = np.random.default_rng(seed)
    release = release if release is not None else dur * 0.6
    n = seconds(dur)
    t = np.arange(n) / SR
    vib = 1 + 0.0016 * np.sin(2 * np.pi * r.uniform(4.2, 5.2) * t) * smoothstep(0.3, 1.2, t)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    ph2 = 2 * np.pi * np.cumsum(f * 1.0021 * vib) / SR
    x = np.sin(ph) + 0.55 * np.sin(ph2) + 0.07 * np.sin(2 * ph) + 0.025 * np.sin(3.01 * ph)
    env = smoothstep(0, attack, t) * smoothstep(0, release, dur - t)
    x = x * env
    return (x / (np.max(np.abs(x)) + 1e-9) * 0.2 * level).astype(np.float32)


def shatter(seed=0, dur=2.2, level=1.0, low=1800, high=7200):
    """An interpretation breaking: a spray of tiny glass grains, falling."""
    r = np.random.default_rng(seed)
    n = seconds(dur)
    out = np.zeros((n, 2), np.float32)
    count = 90
    for i in range(count):
        tt = (r.random() ** 1.8) * dur * 0.8
        f = np.exp(r.uniform(np.log(low), np.log(high))) * (1 - 0.35 * tt / dur)
        L = seconds(r.uniform(0.03, 0.18))
        a0 = seconds(tt)
        if a0 + L >= n:
            continue
        e = np.exp(-np.arange(L) / (L / 4)) * (1 - np.exp(-np.arange(L) / 30))
        g = np.sin(2 * np.pi * f * np.arange(L) / SR) * e * (1 - tt / dur) ** 1.5 * r.uniform(0.3, 1)
        p = r.uniform(0, 1)
        out[a0:a0 + L, 0] += g * np.sqrt(1 - p)
        out[a0:a0 + L, 1] += g * np.sqrt(p)
    return out / (np.max(np.abs(out)) + 1e-9) * 0.16 * level


def reverse_swell(src, length, rt_ir):
    """Reverb tail of `src`, reversed, so it breathes in toward an event."""
    from dsp import convolve
    wet = convolve(src, rt_ir)[: seconds(length)]
    wet = wet[::-1].copy()
    t = np.arange(len(wet)) / SR
    wet *= smoothstep(0, length * 0.9, t)[:, None]
    return wet / (np.max(np.abs(wet)) + 1e-9)


def sub_rumble(total, seed=0):
    n = seconds(total)
    x = lp(brown(n, seed), 55)
    x2 = lp(brown(n, seed + 1), 55)
    return np.stack([x, x2], 1) / (np.max(np.abs(x)) + 1e-9) * 0.6


def sub_pulse(times, level=1.0, f=41.0):
    end = max(times) + 2
    n = seconds(end)
    out = np.zeros(n, np.float32)
    for tt in times:
        a0 = seconds(tt)
        L = seconds(1.3)
        if a0 + L > n:
            continue
        s = np.arange(L) / SR
        e = (1 - np.exp(-s / 0.06)) * np.exp(-s / 0.35)
        out[a0:a0 + L] += np.sin(2 * np.pi * f * s) * e
    return out * 0.5 * level


def voice_choir(clips, chord_sections, total, stretch=10.0, seed=0):
    """The conversation stretched until it stops being words and becomes a
    chord. clips: list of (t, mono). chord_sections: [(t0,t1,chord)]."""
    n = seconds(total)
    out = np.zeros((n, 2), np.float32)
    for k, (t0, x) in enumerate(clips):
        y = paulstretch(x, stretch, win_s=0.32, seed=seed + k)
        # pick the chord sounding at this moment
        chord = "Dm9"
        for a, b, c in chord_sections:
            if a <= t0 + 1.0 <= b:
                chord = c
        fr = [f for f in freqs(chord) if f > 100]
        y = comb_tune(bp(y, 700, 0.35), fr[:4], fb=0.992, mix=0.85)
        y = hp(lp(y, 3200), 140)
        L = len(y)
        env = np.sin(np.linspace(0, np.pi, L)) ** 1.2
        y = y * env
        a0 = seconds(max(0.0, t0))
        a1 = min(n, a0 + L)
        pan = (k % 3 - 1) * 0.6
        out[a0:a1, 0] += y[: a1 - a0] * np.sqrt((1 - pan) / 2) * 1.4
        out[a0:a1, 1] += np.roll(y, 480)[: a1 - a0] * np.sqrt((1 + pan) / 2) * 1.4
    return out / (np.max(np.abs(out)) + 1e-9) * 0.5
