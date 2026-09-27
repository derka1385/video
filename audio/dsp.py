"""Small DSP toolkit: filters, reverbs, spectral processing, stretching."""
import numpy as np
from scipy import signal

SR = 48000
rng = np.random.default_rng(7)


def seconds(n):
    return int(round(n * SR))


def db(x):
    return 20 * np.log10(np.maximum(np.abs(x), 1e-12))


def undb(d):
    return 10 ** (d / 20.0)


def resample(x, sr_in, sr_out=SR):
    if sr_in == sr_out:
        return x.astype(np.float32)
    g = np.gcd(int(sr_in), int(sr_out))
    return signal.resample_poly(x, sr_out // g, sr_in // g).astype(np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------- filters
def _biquad(kind, f0, q=0.707, gain_db=0.0):
    f0 = min(max(f0, 10.0), SR * 0.49)
    w0 = 2 * np.pi * f0 / SR
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2 * q)
    A = 10 ** (gain_db / 40)
    if kind == "lp":
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "hp":
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "bp":
        b = [alpha, 0, -alpha]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == "peak":
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == "lowshelf":
        sa = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * cw + sa), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sa)]
        a = [(A + 1) + (A - 1) * cw + sa, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sa]
    elif kind == "highshelf":
        sa = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + sa), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sa)]
        a = [(A + 1) - (A - 1) * cw + sa, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sa]
    else:
        raise ValueError(kind)
    b, a = np.array(b) / a[0], np.array(a) / a[0]
    return np.concatenate([b, a])[None, :]


def filt(x, kind, f0, q=0.707, gain_db=0.0):
    sos = _biquad(kind, f0, q, gain_db)
    return signal.sosfilt(sos, x, axis=0).astype(np.float32)


def lp(x, f, q=0.707):
    return filt(x, "lp", f, q)


def hp(x, f, q=0.707):
    return filt(x, "hp", f, q)


def bp(x, f, q=1.0):
    return filt(x, "bp", f, q)


def onepole(x, coef):
    return signal.lfilter([1 - coef], [1, -coef], x, axis=0).astype(np.float32)


# ------------------------------------------------------------------ noise etc
def white(n, seed=None):
    r = np.random.default_rng(seed) if seed is not None else rng
    return r.standard_normal(n).astype(np.float32)


def pink(n, seed=None):
    w = white(n, seed)
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    return (signal.lfilter(b, a, w) * 3.5).astype(np.float32)


def brown(n, seed=None):
    w = white(n, seed)
    y = signal.lfilter([1], [1, -0.995], w)
    return (y / (np.std(y) + 1e-9) * 0.5).astype(np.float32)


def smooth_noise(n, rate_hz, seed=None):
    """Band-limited random control signal in roughly [-1, 1]."""
    r = np.random.default_rng(seed)
    k = max(4, int(n / SR * rate_hz) + 4)
    pts = r.uniform(-1, 1, k)
    xs = np.linspace(0, k - 1, n)
    i = np.floor(xs).astype(int)
    f = xs - i
    i1 = np.minimum(i + 1, k - 1)
    f = f * f * (3 - 2 * f)
    return (pts[i] * (1 - f) + pts[i1] * f).astype(np.float32)


# ------------------------------------------------------------------- envelopes
def adsr(n, a, r, curve=2.0):
    env = np.ones(n, np.float32)
    na, nr = min(seconds(a), n), min(seconds(r), n)
    if na > 0:
        env[:na] = np.linspace(0, 1, na) ** curve
    if nr > 0:
        env[n - nr:] *= np.linspace(1, 0, nr) ** curve
    return env


def curve_at(points, t):
    """Piecewise-smooth curve through (time, value) pairs, evaluated at t."""
    pts = sorted(points)
    ts = np.array([p[0] for p in pts])
    vs = np.array([p[1] for p in pts])
    t = np.asarray(t, dtype=np.float64)
    idx = np.clip(np.searchsorted(ts, t) - 1, 0, len(ts) - 2)
    t0, t1 = ts[idx], ts[idx + 1]
    f = np.clip((t - t0) / np.maximum(t1 - t0, 1e-9), 0, 1)
    f = f * f * (3 - 2 * f)
    out = vs[idx] * (1 - f) + vs[idx + 1] * f
    out = np.where(t <= ts[0], vs[0], out)
    out = np.where(t >= ts[-1], vs[-1], out)
    return out


# --------------------------------------------------------------------- space
def pan(x, p, width_ms=0.35):
    """Constant-power pan with a small interaural delay. p in [-1, 1]
    (scalar or per-sample array). Returns (n, 2)."""
    p = np.clip(p, -1, 1)
    ang = (p + 1) * np.pi / 4
    l = x * np.cos(ang)
    r = x * np.sin(ang)
    if np.isscalar(p):
        d = int(abs(p) * width_ms * 1e-3 * SR)
        if d > 0:
            if p > 0:
                l = np.concatenate([np.zeros(d, np.float32), l[:-d]])
            else:
                r = np.concatenate([np.zeros(d, np.float32), r[:-d]])
    return np.stack([l, r], axis=1).astype(np.float32)


def make_ir(rt60, length=None, predelay=0.0, damp=0.5, early=0, seed=1,
            lo_cut=80.0, bright=6000.0):
    """Stereo, frequency-dependent exponentially decaying noise IR.

    damp: how much faster the highs decay (0 = flat).
    early: number of discrete early reflections."""
    length = length or rt60 * 1.3
    n = seconds(length)
    r = np.random.default_rng(seed)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2), np.float32)
    for ch in range(2):
        nz = r.standard_normal(n).astype(np.float32)
        # split in three bands decaying at different rates
        lo = lp(nz, 500)
        mid = bp(nz, 1800, 0.5)
        hi = hp(nz, 4000)
        k = 6.91 / rt60
        env_lo = np.exp(-k * t * (1 - 0.1 * damp))
        env_mid = np.exp(-k * t * (1 + 0.6 * damp))
        env_hi = np.exp(-k * t * (1 + 2.5 * damp))
        ir[:, ch] = lo * env_lo + mid * env_mid + 0.7 * hi * env_hi
    ir = lp(hp(ir, lo_cut), bright)
    # soft onset so the tail blooms rather than clicks
    ir *= smoothstep(0, 0.012 + rt60 * 0.01, t)[:, None]
    if early:
        for _ in range(early):
            dt = r.uniform(0.004, 0.045)
            g = r.uniform(0.2, 0.55) * np.exp(-dt * 30)
            i = seconds(dt)
            ir[i, 0] += g * r.choice([-1, 1])
            ir[min(n - 1, i + r.integers(1, 40)), 1] += g * r.choice([-1, 1])
    pd = seconds(predelay)
    if pd:
        ir = np.concatenate([np.zeros((pd, 2), np.float32), ir])
    ir /= np.sqrt(np.sum(ir ** 2) / 2) + 1e-9
    return ir.astype(np.float32)


def convolve(x, ir):
    """x mono (n,) or stereo (n,2); ir stereo. Returns stereo, len n + len(ir)."""
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    out = np.stack([signal.fftconvolve(x[:, c], ir[:, c]) for c in range(2)], 1)
    return out.astype(np.float32)


# ------------------------------------------------------------ spectral tools
NFFT = 2048
HOP = 256


def stft(x):
    f, t, Z = signal.stft(x, SR, nperseg=NFFT, noverlap=NFFT - HOP, boundary="zeros", padded=True)
    return f, t, Z


def istft(Z, n):
    _, y = signal.istft(Z, SR, nperseg=NFFT, noverlap=NFFT - HOP, boundary=True)
    y = y[:n]
    if len(y) < n:
        y = np.pad(y, (0, n - len(y)))
    return y.astype(np.float32)


def paulstretch(x, stretch, win_s=0.25, seed=3):
    """Extreme time-stretch with randomised phases (Paul Nasca's method)."""
    r = np.random.default_rng(seed)
    win = int(win_s * SR) // 2 * 2
    half = win // 2
    w = np.power(1 - np.power(np.linspace(-1, 1, win), 2), 1.25)
    x = np.concatenate([np.zeros(half), x, np.zeros(win)])
    out_len = int(len(x) * stretch) + win
    out = np.zeros(out_len)
    step_in = half / stretch
    pos, opos = 0.0, 0
    while int(pos) + win < len(x) and opos + win < out_len:
        seg = x[int(pos):int(pos) + win] * w
        spec = np.abs(np.fft.rfft(seg))
        ph = r.uniform(0, 2 * np.pi, len(spec))
        seg = np.fft.irfft(spec * np.exp(1j * ph)) * w
        out[opos:opos + win] += seg
        pos += step_in
        opos += half
    return (out / (np.max(np.abs(out)) + 1e-9)).astype(np.float32)


def comb(x, delay, fb):
    """y[n] = (1-fb) x[n] + fb y[n-D], run block-wise so numpy does the work."""
    D = max(1, int(round(delay)))
    n = len(x)
    xin = x.astype(np.float64) * (1 - fb)
    y = np.zeros(n, np.float64)
    y[:D] = xin[:D]
    for k in range(D, n, D):
        m = min(D, n - k)
        y[k:k + m] = xin[k:k + m] + fb * y[k - D:k - D + m]
    return y.astype(np.float32)


def comb_tune(x, freqs, fb=0.985, mix=1.0):
    """Resonate x at the given pitches (feedback combs in parallel)."""
    out = np.zeros(len(x), np.float32)
    for f in freqs:
        out += comb(x, SR / f, fb)
    out /= len(freqs)
    return (x * (1 - mix) + out * mix * 3.0).astype(np.float32)


def soft_clip(x, drive=1.0):
    return (np.tanh(x * drive) / np.tanh(drive)).astype(np.float32)


def limiter(x, ceiling_db=-1.0, release=0.08, look=0.004):
    """Look-ahead peak limiter on a stereo buffer."""
    ceiling = undb(ceiling_db)
    peak = np.max(np.abs(x), axis=1)
    la = seconds(look)
    # running max over the look-ahead window
    from scipy.ndimage import maximum_filter1d
    pk = maximum_filter1d(peak, size=2 * la + 1)
    gain = np.minimum(1.0, ceiling / np.maximum(pk, 1e-9))
    # smooth: instant attack (already look-ahead), exponential release
    coef = np.exp(-1.0 / (release * SR))
    g = signal.lfilter([1 - coef], [1, -coef], gain)
    g = np.minimum(g, gain)
    return (x * g[:, None]).astype(np.float32)
