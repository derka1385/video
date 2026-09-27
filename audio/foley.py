"""Room tone, table foley and the body: heartbeat and breath."""
import numpy as np

from dsp import SR, bp, brown, hp, lp, pink, seconds, smooth_noise, white


def room_tone(dur, seed=11):
    """A flat at night: low building hum, faint city through glass, air."""
    n = seconds(dur)
    t = np.arange(n) / SR
    hum = lp(brown(n, seed), 180) * 0.5
    # fridge / building mains, barely there
    mains = (np.sin(2 * np.pi * 100 * t) * 0.3 + np.sin(2 * np.pi * 200 * t) * 0.1) * 0.01
    mains *= 0.6 + 0.4 * smooth_noise(n, 0.05, seed + 1)
    # distant traffic: band noise with slow swells as cars pass below
    city = bp(pink(n, seed + 2), 320, 0.6) * (0.5 + 0.5 * smooth_noise(n, 0.12, seed + 3) ** 2)
    air = hp(pink(n, seed + 4), 3000) * 0.05
    L = hum * 0.6 + mains + city * 0.35 + air
    R = lp(brown(n, seed + 5), 180) * 0.3 + mains + bp(pink(n, seed + 6), 300, 0.6) * 0.35 * (
        0.5 + 0.5 * smooth_noise(n, 0.1, seed + 7) ** 2) + hp(pink(n, seed + 8), 3000) * 0.05
    return np.stack([L, R], 1).astype(np.float32) * 0.05


def glass_clink(seed=0, level=1.0, pitch=1.0):
    """Two wine glasses touching: an inharmonic ring with beating partials."""
    r = np.random.default_rng(seed)
    n = seconds(1.6)
    t = np.arange(n) / SR
    f0 = r.uniform(1350, 1650) * pitch
    out = np.zeros(n)
    for k, (ratio, amp, dec) in enumerate([(1.0, 1.0, 1.6), (2.32, 0.45, 2.6), (4.25, 0.22, 4.5),
                                           (6.63, 0.1, 7.0), (9.4, 0.05, 11.0)]):
        f = f0 * ratio
        beat = r.uniform(0.6, 3.0)
        out += amp * np.sin(2 * np.pi * f * t + r.uniform(0, 6.28)) * np.exp(-dec * t) * (
            0.8 + 0.2 * np.cos(2 * np.pi * beat * t))
        # second glass, slightly detuned
        out += 0.6 * amp * np.sin(2 * np.pi * f * 1.037 * t) * np.exp(-dec * 1.2 * t)
    tick = hp(white(seconds(0.006), seed), 3000) * np.hanning(seconds(0.006))
    out[:len(tick)] += tick * 0.8
    out *= np.minimum(1, t / 0.0015)
    return (out / np.max(np.abs(out)) * 0.25 * level).astype(np.float32)


def cutlery(seed=0, level=1.0):
    """Fork on a plate: a ceramic tink with a short scrape."""
    r = np.random.default_rng(seed)
    n = seconds(0.4)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for ratio, amp, dec in [(1.0, 1.0, 38), (1.7, 0.5, 45), (2.9, 0.35, 60), (4.1, 0.2, 80)]:
        out += amp * np.sin(2 * np.pi * r.uniform(2600, 3300) * ratio * t) * np.exp(-dec * t)
    scrape = bp(white(n, seed + 1), 4200, 1.2) * np.exp(-((t - 0.09) / 0.05) ** 2) * 0.25
    out = out + scrape
    return (out / np.max(np.abs(out)) * 0.12 * level).astype(np.float32)


def rustle(dur=0.5, seed=0, level=1.0):
    """Clothing against a chair as someone leans."""
    n = seconds(dur)
    x = bp(pink(n, seed), 2400, 0.5)
    env = np.clip(smooth_noise(n, 12, seed) * 0.5 + 0.5, 0, 1) * np.sin(np.linspace(0, np.pi, n)) ** 1.5
    return (x * env / (np.max(np.abs(x)) + 1e-9) * 0.05 * level).astype(np.float32)


def heartbeat(times, level=1.0):
    """Returns a function-length buffer builder: list of beat times -> mono."""
    end = max(times) + 1.0
    n = seconds(end)
    out = np.zeros(n, np.float32)
    for i, bt in enumerate(times):
        for k, (dt, amp) in enumerate([(0.0, 1.0), (0.29, 0.62)]):   # lub, dub
            a0 = seconds(bt + dt)
            L = seconds(0.16)
            if a0 + L > n:
                continue
            tt = np.arange(L) / SR
            f = 58 - 22 * tt / 0.16 if k == 0 else 66 - 24 * tt / 0.16
            ph = 2 * np.pi * np.cumsum(f) / SR
            env = (1 - np.exp(-tt / 0.004)) * np.exp(-tt / 0.045)
            thump = np.sin(ph) * env + 0.25 * np.sin(2 * ph) * env * np.exp(-tt / 0.02)
            out[a0:a0 + L] += (thump * amp).astype(np.float32)
    out = lp(out, 140)
    return out / (np.max(np.abs(out)) + 1e-9) * 0.5 * level


def breath(inhale, exhale, seed=0, level=1.0):
    """One close breath: inhale then exhale, through the nose."""
    ni, ne = seconds(inhale), seconds(exhale)
    x = pink(ni + ne, seed)
    env = np.concatenate([np.sin(np.linspace(0, np.pi / 2, ni)) ** 2 * np.linspace(0.6, 1, ni),
                          np.cos(np.linspace(0, np.pi / 2, ne)) ** 1.6])
    inh = bp(x[:ni], 1700, 0.7) * env[:ni]
    exh = bp(x[ni:], 900, 0.6) * env[ni:] * 0.8
    y = np.concatenate([inh, exh])
    return (y / (np.max(np.abs(y)) + 1e-9) * 0.08 * level).astype(np.float32)


def sharp_inhale(seed=0, level=1.0):
    """The small breath someone takes right before they speak."""
    n = seconds(0.42)
    x = bp(pink(n, seed), 2100, 0.9)
    env = np.sin(np.linspace(0, np.pi, n)) ** 0.8 * np.linspace(0.4, 1, n)
    env[-seconds(0.05):] *= np.linspace(1, 0, seconds(0.05))
    return (x * env / (np.max(np.abs(x * env)) + 1e-9) * 0.09 * level).astype(np.float32)
