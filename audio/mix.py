"""Assemble the soundtrack and the cue sheet that drives the picture.

    python3 audio/mix.py            -> build/soundtrack.wav, film/cues.json

Everything that happens in the film is timed here: dialogue is laid out from
the screenplay, the psychological state is a handful of automation curves
(clarity, room, heart...), and the same curves are exported so the picture
breathes with the sound.
"""
import json
import os

import numpy as np
import soundfile as sf
from scipy import signal

import foley
import laughter
import score
from dsp import (SR, adsr, bp, convolve, curve_at, hp, limiter, lp, make_ir,
                 pan, resample, seconds, smoothstep, soft_clip, stft, istft)
from script import CAST, LINES, THOUGHTS, TRANSLATION
from tts import all_lines

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
FPS_ENV = 60
START = 4.2           # first word, over black

# ------------------------------------------------------------------ alignment


def _logmel(x, sr):
    f, t, Z = signal.stft(x, sr, nperseg=512, noverlap=512 - int(sr * 0.01))
    S = np.abs(Z) ** 2
    mel = lambda h: 2595 * np.log10(1 + h / 700)
    edges = np.linspace(mel(80), mel(sr / 2 * 0.9), 42)
    hz = 700 * (10 ** (edges / 2595) - 1)
    fb = np.zeros((40, len(f)))
    for i in range(40):
        lo, c, hi = hz[i], hz[i + 1], hz[i + 2]
        fb[i] = np.clip(np.minimum((f - lo) / (c - lo), (hi - f) / (hi - c)), 0, None)
    M = np.log(fb @ S + 1e-8)
    M -= M.mean(0, keepdims=True)
    return M / (np.linalg.norm(M, axis=0, keepdims=True) + 1e-9)


def locate_word(line, word, sr):
    """Subsequence DTW of an isolated word inside a line -> (t0, t1) seconds."""
    A, B = _logmel(word, sr), _logmel(line, sr)
    C = 1 - A.T @ B
    n, m = C.shape
    D = np.full((n, m), np.inf)
    D[0] = C[0]
    for i in range(1, n):
        D[i, 0] = D[i - 1, 0] + C[i, 0]
        for j in range(1, m):
            D[i, j] = C[i, j] + min(D[i - 1, j - 1], D[i - 1, j], D[i, j - 1])
    j = int(np.argmin(D[-1]))
    end = j
    i = n - 1
    while i > 0:
        opts = [(D[i - 1, j - 1] if j > 0 else np.inf, i - 1, j - 1), (D[i - 1, j], i - 1, j),
                (D[i, j - 1] if j > 0 else np.inf, i, j - 1)]
        _, i, j = min(opts)
    hop = 0.01
    return j * hop, (end + 1) * hop


# --------------------------------------------------------------------- layout


def layout():
    voices = all_lines()
    events, lines = [], {}
    prev_end, t = None, START
    for lid, who, lang, text, speed, gap, extra in LINES:
        a, sr = voices[lid]
        s = t if prev_end is None else prev_end + gap
        x = resample(a, sr)
        e = s + len(x) / SR
        ev = dict(id=lid, kind="line", who=who, start=s, end=e, lang=lang, text=text,
                  audio=x, look=bool(extra.get("look")), soft=bool(extra.get("soft")))
        if "hit" in extra:
            w, _ = voices[lid + "_hit"]
            h0, h1 = locate_word(a, w, sr)
            ev["hit"] = (s + h0, s + h1, extra["hit"])
        events.append(ev)
        lines[lid] = ev
        end_all = e
        if "laugh" in extra:
            kind, dur, inten = extra["laugh"]
            l0 = e + 0.05
            for k, (who2, off, lx) in enumerate(laughter.group_laugh(kind, dur, inten, seed=len(events))):
                events.append(dict(id=f"{lid}_laugh_{who2}", kind="laugh", who=who2, group=kind,
                                   start=l0 + off, end=l0 + off + len(lx) / SR, audio=lx))
            end_all = e + 0.05 + dur
        if extra.get("sam_laugh"):
            hx = laughter.breath_laugh("SAM", seed=5, pulses=2, level=0.5)
            events.append(dict(id=f"{lid}_samheh", kind="laugh", who="SAM", group="heh",
                               start=e + 0.45, end=e + 0.45 + len(hx) / SR, audio=hx))
        prev_end = end_all
    return events, lines


# ---------------------------------------------------------------- automation


def anchors(lines):
    L = lines
    A = {
        "switch": L["P01"]["start"],
        "tulipas": L["P03"]["hit"][0],
        "carol": L["P05"]["hit"][0],
        "sam": L["P09"]["hit"][0],
        "sharp": L["P10"]["end"],
        "mind": L["P12"]["start"] - 1.6,
        "desc": L["P19"]["start"],
        "dark": L["P20"]["end"] + 2.7,
        "r1": L["R01"]["start"],
        "r2": L["R02"]["start"],
        "r3": L["R03"]["start"],
        "r4": L["R04"]["start"],
        "yeah": L["R05"]["start"],
        "noor": L["R09"]["start"] + 0.6,
    }
    A["cut"] = L["R09"]["end"] + 2.9
    A["text1"] = A["cut"] + 1.8
    A["text2"] = A["text1"] + 4.6
    A["title"] = A["text2"] + 5.4
    A["end"] = A["title"] + 7.5
    # interpretations: the orb tries a meaning, then the meaning breaks
    A["interp"] = [
        dict(kind="tulip",  form=L["P12"]["start"] + 0.8, brk=L["P14"]["end"] + 0.25),
        dict(kind="circle", form=L["P14"]["end"] + 2.2, brk=L["P16"]["start"] + 0.6),
        dict(kind="door",   form=L["P16"]["start"] + 1.8, brk=L["P18"]["start"] + 0.2),
        dict(kind="self",   form=L["P18"]["start"] + 0.5, brk=L["P18"]["end"] + 0.35),
    ]
    return A


def curves(A):
    """The protagonist's inner state, as (time, value) breakpoints."""
    s, sam, mind, desc, dark = A["switch"], A["sam"], A["mind"], A["desc"], A["dark"]
    r1, r2, r3, r4, cut = A["r1"], A["r2"], A["r3"], A["r4"], A["cut"]
    return {
        # how much of the others' speech reaches her
        "clarity": [(0, 1), (s + 2, 1), (s + 8, 0.93), (s + 14, 0.82), (s + 21, 0.68),
                    (sam - 1.5, 0.52), (sam + 4, 0.38), (mind, 0.2), (mind + 9, 0.1),
                    (desc, 0.05), (dark, 0.0), (r1 - 0.25, 0.0), (r1 + 0.05, 0.34), (r2 - 0.2, 0.38),
                    (r2 + 1.0, 0.56), (r3, 0.72), (r3 + 1.5, 0.93), (r4, 1.0), (A["end"], 1.0)],
        # the room itself: tone, foley, light
        "room": [(0, 0), (1.2, 1), (s + 16, 1), (sam + 2, 0.6), (mind, 0.25), (mind + 8, 0.04),
                 (desc, 0.0), (r2, 0.0), (r3 - 0.2, 0.15), (r3 + 1.6, 0.85), (r4, 1.0),
                 (cut - 0.01, 1.0), (cut, 0.0), (A["end"], 0.0)],
        "heart": [(0, 0), (sam - 3, 0), (sam + 1, 0.3), (mind, 0.45), (desc, 0.7),
                  (dark, 0.9), (r1, 0.75), (r3, 0.3), (r3 + 2.5, 0.0), (A["end"], 0.0)],
        "breath": [(0, 0), (sam, 0), (sam + 3, 0.5), (mind, 0.55), (desc, 0.8), (dark, 1.0),
                   (r2, 0.6), (r4, 0.0), (A["end"], 0)],
        "drone": [(0, 0), (sam - 5, 0.0), (sam + 1, 0.16), (mind, 0.55), (mind + 12, 0.9),
                  (desc, 0.7), (dark - 2, 0.18), (dark + 1.5, 0.0), (r2 - 0.5, 0.0), (r2 + 1.5, 0.5),
                  (r3 + 1.5, 0.45), (r4 + 1.5, 0.0), (A["title"] - 0.5, 0), (A["title"] + 1.5, 0.6),
                  (A["end"] - 2.5, 0.35), (A["end"], 0)],
        "choir": [(0, 0), (mind - 2, 0), (mind + 7, 0.7), (desc, 1.0), (dark - 3, 0.3),
                  (dark, 0.0), (A["end"], 0)],
        "rumble": [(0, 0), (sam, 0.0), (sam + 3, 0.25), (mind, 0.45), (desc, 0.85), (dark, 0.7),
                   (r1, 0.4), (r3, 0.0), (A["end"], 0)],
        # the visuals only
        # picture follows the sound back: the room rebuilds only after she can hear again
        "mind": [(0, 0), (sam, 0.0), (sam + 5, 0.12), (mind - 2, 0.45), (mind + 4, 1.0),
                 (r3 - 0.4, 1.0), (r3 + 1.2, 0.62), (r4 + 0.4, 0.0), (A["end"], 0)],
        "dark": [(0, 0), (desc, 0.0), (dark - 2.5, 0.75), (dark + 2, 1.0), (r1, 1.0),
                 (r2, 0.85), (r3 - 0.3, 0.6), (r4, 0.0), (A["end"], 0)],
        "orb": [(0, 0), (sam + 1, 0.0), (mind - 1.5, 0.35), (mind + 3, 1.0), (desc, 0.85),
                (dark, 0.22), (A["r1"] - 3, 0.12), (r1 + 0.3, 0.35), (r2 + 0.5, 0.6), (r3 + 1.2, 1.0),
                (r3 + 2.6, 0.0), (A["end"], 0)],
    }


def eval_curves(C, t):
    return {k: curve_at(v, t) for k, v in C.items()}


# ------------------------------------------------------------ voice processing


def process_voice(x, T, clarity, punch=None, floor=0.0, sharp=False):
    """Time-varying 'hearing' of someone else's voice.

    As clarity falls the voice loses its consonants (steep low-pass), gains a
    muffled low-mid body, and is handed to the far reverb. `punch` windows
    let single syllables snap back unnaturally clear."""
    f, tt, Z = stft(x)
    times = T + tt
    c = clarity(times)
    if punch is not None:
        c = np.maximum(c, punch(times))
    c = np.maximum(c, floor)
    fc = np.exp(np.log(380) + (np.log(17000) - np.log(380)) * np.clip(c, 0, 1) ** 1.25)
    ff = f[:, None]
    G = 1.0 / np.sqrt(1.0 + (ff / fc[None, :]) ** 6)
    body = 1 + 0.9 * (1 - c[None, :]) * np.exp(-((np.log(ff + 1) - np.log(320)) / 0.6) ** 2)
    if sharp:
        # laughter keeps an edge: a narrow presence band survives the muffling
        G = np.maximum(G, 0.55 * np.exp(-((np.log(ff + 1) - np.log(2600)) / 0.35) ** 2) * (1 - c[None, :]))
    Z = Z * G * body
    y = istft(Z, len(x))
    cs = np.interp(T + np.arange(len(x)) / SR, times, c)
    return y, cs


def make_punch(windows):
    def punch(t):
        out = np.zeros_like(t)
        for a, b, strength in windows:
            out = np.maximum(out, strength * smoothstep(a - 0.06, a + 0.02, t) * (1 - smoothstep(b - 0.02, b + 0.1, t)))
        return out
    return punch


# ------------------------------------------------------------------ the mix


def build():
    events, lines = layout()
    A = anchors(lines)
    C = curves(A)
    total = A["end"]
    n = seconds(total)
    tsec = np.arange(n) / SR
    clarity = lambda t: curve_at(C["clarity"], t)

    dry = np.zeros((n, 2), np.float32)
    room_send = np.zeros((n, 2), np.float32)
    void_send = np.zeros((n, 2), np.float32)
    self_bus = np.zeros((n, 2), np.float32)
    env_raw = {k: np.zeros(n, np.float32) for k in CAST}
    laugh_raw = {k: np.zeros(n, np.float32) for k in CAST}

    # a few syllables that snap back into focus while she is still trying
    rng = np.random.default_rng(4)
    windows = []
    for ev in events:
        if ev["kind"] == "line" and "hit" in ev:
            a, b, _ = ev["hit"]
            windows.append((a, b, 1.0))
    for lid in ("P06", "P07", "P10", "P13", "P16"):
        ev = lines[lid]
        for _ in range(2 if lid < "P12" else 1):
            a = rng.uniform(ev["start"] + 0.2, ev["end"] - 0.4)
            windows.append((a, a + rng.uniform(0.12, 0.2), 0.85))
    punch = make_punch(windows)

    def place(buf, x, t0, gain=1.0):
        a0 = seconds(t0)
        a1 = min(len(buf), a0 + len(x))
        if a1 > a0:
            buf[a0:a1] += x[: a1 - a0] * gain

    for ev in events:
        who, T, x = ev["who"], ev["start"], ev["audio"]
        a0 = seconds(T)
        L = min(len(x), n - a0)
        if L <= 0:
            continue
        x = x[:L]
        (env_raw if ev["kind"] == "line" else laugh_raw)[who][a0:a0 + L] += x ** 2
        base_pan, dist = CAST[who][1], CAST[who][2]
        if who == "SAM":
            # her own voice is never filtered: it is the one thing that stays hers
            g = 0.95 if ev["kind"] == "line" else 0.8
            st = pan(x * g, base_pan)
            place(self_bus, st, T)
            place(room_send, st * 0.16, T)
            continue
        sharp = ev["kind"] == "laugh" and ev.get("group") == "sharp"
        y, cs = process_voice(x, T, clarity, punch if ev["kind"] == "line" else None,
                              floor=0.0, sharp=sharp)
        tt = T + np.arange(L) / SR
        spread = 1 + 1.4 * (1 - cs)
        wob = 0.35 * (1 - cs) * np.sin(2 * np.pi * (0.05 + 0.02 * dist) * tt + sum(map(ord, who)) % 7)
        p = np.clip(base_pan * spread + wob, -0.95, 0.95)
        # distance: the further she drifts, the quieter they are
        lvl = (1.0 - 0.18 * dist) * (0.55 + 0.45 * cs)
        if ev["kind"] == "laugh":
            lvl *= 0.62
        if ev.get("soft"):
            lvl *= 0.72
        g_dry = lvl * (0.18 + 0.82 * cs ** 0.9)
        if sharp:
            g_dry = g_dry * (0.55 + 0.45 * cs)
        st = pan(y, p)
        place(dry, st * g_dry[:, None], T)
        place(room_send, st * (lvl * (0.12 + 0.1 * dist) * cs)[:, None], T)
        void_amt = lvl * 0.55 * (1 - cs) ** 0.8
        if sharp:
            void_amt = void_amt * 1.0
        place(void_send, st * void_amt[:, None], T)
        if sharp and cs.mean() < 0.7:
            # the laugh bends: a slowed, slightly grainy double far behind it
            dbl = soft_clip(resample(y, SR, int(SR * 1.07)), 2.5)
            place(void_send, pan(dbl, -base_pan) * 0.28, T + 0.03)

    # ---- fragments that repeat inside her head
    frag = []
    p03, p09, p10 = lines["P03"], lines["P09"], lines["P10"]

    def cut(ev, a, b):
        i0, i1 = seconds(a - ev["start"]), seconds(b - ev["start"])
        return ev["audio"][max(0, i0):i1] * adsr(i1 - max(0, i0), 0.02, 0.08)

    sam_word = cut(p09, p09["hit"][0] - 0.12, p09["hit"][1] + 0.05)
    tul_word = cut(p03, p03["hit"][0] - 0.02, p03["hit"][1] + 0.05)
    coitada = cut(p10, p10["end"] - 0.78, p10["end"])
    sharp_mix = np.zeros(seconds(3.5), np.float32)
    for ev in events:
        if ev["kind"] == "laugh" and ev["id"].startswith("P10_laugh"):
            o = seconds(ev["start"] - lines["P10"]["end"])
            sharp_mix[o:o + len(ev["audio"])] += ev["audio"][: len(sharp_mix) - o]
    m = A["mind"]
    I = A["interp"]
    for t0, x, pn, g, rate in [
        (m + 4.0, tul_word, -0.7, 0.7, 1.0),
        (I[1]["form"] + 0.9, sam_word, 0.75, 0.75, 1.0),
        (I[1]["form"] + 2.6, coitada, -0.6, 0.55, 0.97),
        (I[1]["form"] + 3.2, sharp_mix, 0.5, 0.45, 0.95),
        (A["desc"] + 1.5, sam_word, -0.85, 0.5, 0.94),
        (A["desc"] + 4.6, sharp_mix, 0.85, 0.35, 0.9),
        (A["dark"] + 1.0, sam_word, 0.1, 0.22, 0.88),
        (A["dark"] + 4.2, sharp_mix, -0.3, 0.16, 0.86),
    ]:
        xx = resample(x, SR, int(SR / rate)) if rate != 1.0 else x
        y, _ = process_voice(xx, t0, lambda t: np.full_like(t, 0.3), None, sharp=True)
        place(dry, pan(y, pn) * g * 0.25, t0)
        place(void_send, pan(y, pn) * g * 0.6, t0)
        frag.append(dict(t=t0, dur=len(xx) / SR, pan=pn))

    # ---- room: tone, clinks, cutlery, movement
    room_gain = curve_at(C["room"], tsec).astype(np.float32)
    amb = foley.room_tone(total)
    amb_l = lp(amb, 20000)
    ambience = amb_l * room_gain[:, None]
    fx = np.zeros((n, 2), np.float32)
    for k, (tt_, kind, pn, lvl) in enumerate([
            (2.1, "clink", 0.1, 0.7), (5.2, "fork", -0.4, 0.8), (11.5, "fork", 0.3, 0.6),
            (lines["L07"]["end"] + 2.6, "clink", 0.25, 0.9), (lines["L08"]["end"] + 0.4, "fork", -0.2, 0.6),
            (lines["P02"]["start"] + 0.5, "fork", 0.35, 0.5), (lines["P06"]["start"] + 1.0, "fork", 0.15, 0.45),
            (lines["R04"]["start"] - 0.5, "fork", -0.3, 0.5), (lines["R07"]["end"] + 1.3, "clink", 0.2, 0.8),
            (lines["R09"]["start"] + 1.1, "fork", 0.35, 0.45)]):
        snd = foley.glass_clink(k, lvl) if kind == "clink" else foley.cutlery(k, lvl)
        g = float(curve_at(C["room"], tt_))
        place(fx, pan(snd, pn) * g, tt_)
        place(room_send, pan(snd, pn) * 0.25 * g, tt_)
    for ev in events:
        if ev["kind"] == "line" and ev["look"]:
            g = float(curve_at(C["room"], ev["start"]))
            place(fx, pan(foley.rustle(0.6, seed=seconds(ev["start"]) % 97), CAST[ev["who"]][1]) * g,
                  ev["start"] - 0.2)
    # one clink echoing into the dark: the last sound of the room
    ghost = foley.glass_clink(21, 0.9, pitch=0.5)
    place(void_send, pan(ghost, 0.2) * 0.8, A["mind"] + 1.0)

    # ---- body
    heart_t = []
    t = A["sam"] - 3
    while t < A["r3"] + 2.5:
        lvl = float(curve_at(C["heart"], t))
        bpm = float(curve_at([(A["sam"] - 3, 70), (A["sam"] + 4, 80), (A["mind"] + 5, 72),
                              (A["dark"], 60), (A["r3"], 66)], t))
        if lvl > 0.02:
            heart_t.append(t)
        t += 60.0 / bpm
    heart = foley.heartbeat(heart_t)
    hb = np.zeros(n, np.float32)
    hb[: min(n, len(heart))] = heart[:n]
    hb *= curve_at(C["heart"], tsec).astype(np.float32)
    body = pan(hb, 0.0) * 0.42

    breath_times = []
    t = A["sam"] + 5
    while t < A["r2"]:
        breath_times.append(t)
        t += float(np.random.default_rng(int(t * 10)).uniform(4.6, 6.2))
    for k, bt in enumerate(breath_times):
        lvl = float(curve_at(C["breath"], bt))
        b = lp(foley.breath(1.3, 2.1, seed=k, level=lvl), 2600)
        place(body, pan(b, -0.05) * 0.4, bt)
    # relief: the exhale she didn't know she was holding
    place(body, pan(lp(foley.breath(0.9, 2.6, seed=77, level=1.3), 3000), -0.05) * 0.6, A["r3"] + 0.9)
    # and the breath before she speaks to Noor
    place(self_bus, pan(foley.sharp_inhale(3, 1.4), -0.05), A["cut"] - 0.46)

    # ---- score
    sections = [
        (A["sam"] - 5, A["mind"], "Dsus"),
        (A["mind"], A["mind"] + 13, "Dm9"),
        (A["mind"] + 13, A["mind"] + 25, "Bbmaj7"),
        (A["mind"] + 25, A["desc"] + 3, "Gm9"),
        (A["desc"] + 3, A["dark"] + 2, "Dm9"),
        (A["r2"] - 1.0, A["r4"] + 3, "Dmaj9"),
        (A["title"] - 1.0, A["end"], "Dsus"),
    ]
    drone = score.pad(sections, total, seed=3)
    drone *= curve_at(C["drone"], tsec)[:, None].astype(np.float32)
    # the drone loses its top as she sinks, then gets it back
    hc = curve_at([(0, 5000), (A["mind"], 3200), (A["desc"], 1400), (A["dark"], 500),
                   (A["r2"], 900), (A["r3"] + 1, 4000), (A["end"], 4000)], tsec)
    drone_lo = lp(drone, 600)
    mixc = np.clip((hc - 500) / 4500, 0, 1)[:, None]
    drone = drone_lo * (1 - mixc) + drone * mixc

    # the conversation stretched into a choir
    clips = [(lines[k]["start"], lines[k]["audio"]) for k in
             ("P11", "P12", "P13", "P14", "P15", "P16", "P17", "P18", "P19", "P20")]
    choir = score.voice_choir(clips, sections, total, stretch=9.0)
    choir *= curve_at(C["choir"], tsec)[:, None].astype(np.float32)

    rumble = score.sub_rumble(total) * curve_at(C["rumble"], tsec)[:, None].astype(np.float32)

    glass = np.zeros((n, 2), np.float32)
    N = score.NOTE
    hall = make_ir(5.5, predelay=0.03, damp=0.7, seed=5)
    motifs = {
        "tulip":  (["D5", "F5", "A5"], ["A5", "Bb4"]),
        "circle": (["F5", "E5", "C5"], ["C5", "D6"]),
        "door":   (["A4", "C5", "E5"], ["E5", "F5"]),
        "self":   (["D6", "A5"], ["A5", "Bb5"]),
    }
    for k, it in enumerate(A["interp"]):
        up, brk = motifs[it["kind"]]
        # a breath in toward the meaning
        sw = score.reverse_swell(score.glass(N[up[0]], 1.2, 1.0, seed=k), 2.4, hall)
        place(glass, sw * 0.07, it["form"] - 2.4 + 0.05)
        for j, note in enumerate(up):
            g = score.glass(N[note], 3.6, 0.9 - 0.15 * j, seed=k * 10 + j)
            place(glass, pan(g, (j - 1) * 0.4), it["form"] + j * 0.85)
        # and the meaning breaking apart
        for j, note in enumerate(brk):
            g = score.glass(N[note] * (1 - 0.008 * j), 2.2, 0.55, seed=k * 20 + j, attack=0.02, release=2.0)
            place(glass, pan(g, 0.5 - j), it["brk"] + 0.02 * j)
        place(glass, score.shatter(seed=k, level=0.35), it["brk"])
    # a single thread of sound under "I'm still here."
    still_t = lines["R01"]["start"] - 6.2
    place(glass, pan(score.glass(N["A4"], 6.0, 0.35, seed=91, attack=1.6), 0.0), still_t - 0.8)
    # relief: the room coming back in a major colour
    for j, note in enumerate(["F#5", "A5", "E6"]):
        place(glass, pan(score.glass(N[note], 5.0, 0.55 - 0.1 * j, seed=60 + j, attack=1.2), (j - 1) * 0.5),
              A["r2"] + 0.6 + j * 1.1)
    # the title
    for j, note in enumerate(["D5", "A5"]):
        place(glass, pan(score.glass(N[note], 6.0, 0.5, seed=70 + j, attack=1.5), (j - 0.5) * 0.6),
              A["title"] + 0.3 + j * 1.6)

    # ---- reverbs
    room_ir = make_ir(0.55, predelay=0.004, damp=0.6, early=10, seed=2, bright=9000)
    void_ir = make_ir(7.5, predelay=0.09, damp=1.0, seed=9, lo_cut=60, bright=4200)
    room_wet = convolve(room_send, room_ir)[:n]
    void_wet = convolve(void_send, void_ir)[:n]
    glass_wet = convolve(glass + fx * 0.3, hall)[:n]
    choir_wet = convolve(choir, void_ir)[:n]

    stems = {
        "dialogue": dry + room_wet * 0.55 + void_wet * 0.5 + self_bus,
        "room": ambience + fx,
        "body": body,
        "score": drone * 0.28 + choir * 0.14 + choir_wet * 0.2 + glass * 0.38 + glass_wet * 0.42 + rumble * 0.45,
    }
    # hard cut to silence with the picture; then only the title music
    cut_i = seconds(A["cut"])
    title_i = seconds(A["title"] - 1.0)
    for k in stems:
        stems[k][cut_i:title_i] = 0
        if k != "score":
            stems[k][cut_i:] = 0
    mixbus = sum(stems.values())
    mixbus = hp(mixbus, 24)
    # loudness: aim for a quiet, dynamic film (about -19 LUFS integrated)
    import pyloudnorm as pyln
    meter = pyln.Meter(SR)
    loud = meter.integrated_loudness(mixbus.astype(np.float64))
    g = 10 ** ((-19.0 - loud) / 20)
    mixbus = limiter(mixbus * g, -1.0)
    # 5 ms fades so nothing clicks at the cut or the very end
    f = seconds(0.005)
    mixbus[cut_i - f:cut_i] *= np.linspace(1, 0, f)[:, None]
    mixbus[-seconds(0.5):] *= np.linspace(1, 0, seconds(0.5))[:, None]

    os.makedirs(BUILD, exist_ok=True)
    sf.write(os.path.join(BUILD, "soundtrack.wav"), mixbus, SR, subtype="PCM_24")
    for k, v in stems.items():
        sf.write(os.path.join(BUILD, f"stem_{k}.wav"), (v * g).astype(np.float32), SR, subtype="FLOAT")
    print("integrated loudness before gain:", round(loud, 1), "gain dB:", round(20 * np.log10(g), 1))

    # ---------------------------------------------------------- cue sheet
    hop = SR // FPS_ENV
    frames = n // hop

    def envelope(x, smooth=0.12):
        e = np.sqrt(np.add.reduceat(x[: frames * hop], np.arange(0, frames * hop, hop)) / hop)
        e = signal.lfilter([1 - np.exp(-1 / (smooth * FPS_ENV))], [1, -np.exp(-1 / (smooth * FPS_ENV))], e)
        return e

    def norm(e):
        return e / (np.percentile(e[e > 1e-5], 98) + 1e-9) if np.any(e > 1e-5) else e

    envs = {}
    for k in CAST:
        envs["talk_" + k] = norm(envelope(env_raw[k], 0.06))
        envs["laugh_" + k] = norm(envelope(laugh_raw[k], 0.1))
    envs["heart"] = norm(envelope(hb ** 2, 0.03))
    envs["voices"] = norm(envelope(np.mean(stems["dialogue"] ** 2, 1), 0.08))
    envs["score"] = norm(envelope(np.mean(stems["score"] ** 2, 1), 0.3))
    tt = np.arange(frames) / FPS_ENV
    for k, v in C.items():
        envs[k] = curve_at(v, tt)
    q = {k: [round(float(min(max(x, 0), 4)), 3) for x in v] for k, v in envs.items()}

    cue_lines = []
    for ev in events:
        if ev["kind"] != "line":
            continue
        d = dict(id=ev["id"], who=ev["who"], start=round(ev["start"], 3), end=round(ev["end"], 3),
                 lang=ev["lang"][:2], text=ev["text"], look=ev["look"])
        if ev["id"] in TRANSLATION:
            d["en"] = TRANSLATION[ev["id"]]
        if "hit" in ev:
            d["hit"] = [round(ev["hit"][0], 3), round(ev["hit"][1], 3), ev["hit"][2]]
        cue_lines.append(d)
    laughs = []
    for ev in events:
        if ev["kind"] == "laugh":
            laughs.append(dict(who=ev["who"], group=ev["group"], start=round(ev["start"], 3),
                               end=round(ev["end"], 3)))
    thoughts = []
    for text, anc, off, dur, style in THOUGHTS:
        t0 = lines[anc]["start"] + off
        thoughts.append(dict(text=text, start=round(t0, 3), dur=dur, style=style))
    anchors_out = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in A.items()}
    cues = dict(duration=round(total, 3), fps_env=FPS_ENV, anchors=anchors_out, lines=cue_lines,
                laughs=laughs, thoughts=thoughts, fragments=frag, env=q,
                ending=["Sometimes exclusion isn't intentional.", "But it is still felt."],
                title="Still Here")
    with open(os.path.join(ROOT, "film", "cues.js"), "w") as fh:
        fh.write("// generated by audio/mix.py\nwindow.CUES = ")
        json.dump(cues, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")
    print("duration", round(total, 2), "s")
    for k in ("switch", "sam", "mind", "desc", "dark", "r1", "r3", "cut", "title", "end"):
        print(f"  {k:8s} {A[k]:7.2f}")


if __name__ == "__main__":
    build()
