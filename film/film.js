// "Still Here" — the director. Turns the cue sheet (window.CUES) into camera,
// performances, light and words, and draws each frame with shaders.js.
(function () {
  'use strict';
  const CUES = window.CUES;
  const A = CUES.anchors;
  const W = 1920, H = 1080, PIC_H = 804;        // 2.39:1 inside 16:9
  const LINE = {};
  CUES.lines.forEach(l => { LINE[l.id] = l; });

  // ------------------------------------------------------------ math bits
  const v3 = (x, y, z) => [x, y, z];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => mul(a, 1 / (len(a) || 1));
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const ease = t => t * t * (3 - 2 * t);
  const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const rotY = (v, a) => [v[0] * Math.cos(a) - v[2] * Math.sin(a), v[1], v[0] * Math.sin(a) + v[2] * Math.cos(a)];
  function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function noise1(t, seed) {
    const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
    return lerp(hash(i + seed * 57.3), hash(i + 1 + seed * 57.3), u) * 2 - 1;
  }

  // envelopes from the soundtrack, 60 per second
  function env(name, t) {
    const a = CUES.env[name];
    if (!a) return 0;
    const x = t * CUES.fps_env;
    const i = Math.floor(x);
    if (i < 0) return a[0];
    if (i >= a.length - 1) return a[a.length - 1];
    return lerp(a[i], a[i + 1], x - i);
  }
  function curve(points, t) {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 0; i < points.length - 1; i++) {
      const [t0, v0] = points[i], [t1, v1] = points[i + 1];
      if (t <= t1) return lerp(v0, v1, ease((t - t0) / Math.max(1e-6, t1 - t0)));
    }
    return points[points.length - 1][1];
  }

  // ------------------------------------------------------------- the table
  const NAMES = ['SAM', 'LU', 'BIA', 'RAFA', 'NOOR'];
  const NP = 24;
  const IDX = { SAM: 0, LU: 1, BIA: 2, RAFA: 3, NOOR: 4 };
  const CH = [
    { name: 'SAM', seat: v3(-0.80, 1.20, 0.80), face: norm(v3(1, 0, -0.45)), hair: 'sam',
      skin: [0.56, 0.36, 0.27], hairC: [0.12, 0.05, 0.03], cloth: [0.05, 0.085, 0.07], scale: 0.97 },
    { name: 'LU', seat: v3(0.80, 1.22, 0.42), face: norm(v3(-1, 0, -0.3)), hair: 'curls',
      skin: [0.44, 0.27, 0.18], hairC: [0.035, 0.025, 0.02], cloth: [0.33, 0.2, 0.065], scale: 1.0 },
    { name: 'BIA', seat: v3(-0.80, 1.21, -0.58), face: norm(v3(1, 0, 0.22)), hair: 'bun',
      skin: [0.52, 0.34, 0.25], hairC: [0.07, 0.04, 0.028], cloth: [0.2, 0.045, 0.06], scale: 0.98 },
    { name: 'RAFA', seat: v3(0.82, 1.26, -0.78), face: norm(v3(-1, 0, 0.18)), hair: 'short',
      skin: [0.32, 0.19, 0.13], hairC: [0.025, 0.02, 0.018], cloth: [0.045, 0.06, 0.11], scale: 1.06 },
    { name: 'NOOR', seat: v3(0.05, 1.23, -2.25), face: norm(v3(0, 0, 1)), hair: 'short2',
      skin: [0.28, 0.17, 0.115], hairC: [0.02, 0.018, 0.016], cloth: [0.08, 0.08, 0.09], scale: 1.02 },
  ];
  const CANDLE = [v3(0.0, 0.76 + 0.13 + 0.045, 0.22), v3(0.02, 0.76 + 0.09 + 0.045, -1.02)];
  const GLASS = [v3(-0.36, 0.76, 0.62), v3(0.37, 0.76, 0.2), v3(-0.36, 0.76, -0.4), v3(0.38, 0.76, -0.55), v3(0.12, 0.76, -1.75)];

  // who each line is said to
  const ADDR = {
    L01: 'BIA', L02: 'LU', L03: 'SAM', L04: 'LU', L05: 'RAFA', L06: 'SAM', L07: 'RAFA', L08: 'BIA',
    P01: 'RAFA', P02: 'LU', P03: 'RAFA', P04: 'BIA', P05: 'BIA', P06: 'LU', P07: 'LU', P08: 'BIA',
    P09: 'SAM', P10: 'SAM', P11: 'RAFA', P12: 'RAFA', P13: 'LU', P14: 'RAFA', P15: 'BIA', P16: 'LU',
    P17: 'LU', P18: 'BIA', P19: 'BIA', P20: 'LU',
    R01: 'SAM', R02: 'SAM', R03: 'SAM', R04: 'SAM', R05: 'BIA', R06: 'SAM', R07: 'LU', R08: 'RAFA', R09: 'LU',
  };

  function speakingAt(t) {
    let cur = null;
    for (const l of CUES.lines) if (t >= l.start - 0.15 && t <= l.end + 0.25) cur = l;
    return cur;
  }
  function lastSpeakerAt(t) {
    let cur = null;
    for (const l of CUES.lines) if (l.start - 0.15 <= t) cur = l;
    return cur;
  }

  // ------------------------------------------------------------ interpretations
  const INTERP = A.interp;
  const IKIND = { tulip: 0, circle: 1, door: 2, self: 3 };

  // ----------------------------------------------------------- mind geometry
  const FAR = [null, v3(2.6, 1.25, -9.5), v3(-3.8, 1.25, -12.5), v3(5.2, 1.3, -17.0), v3(0.35, 1.2, -26.0)];
  const ORB_HOME = v3(-0.33, 1.13, 0.52);

  // ------------------------------------------------------------ gaze simulation
  const sim = { t: -1, yaw: [0, 0, 0, 0, 0], yawV: [0, 0, 0, 0, 0], pitch: [0, 0, 0, 0, 0], pitchV: [0, 0, 0, 0, 0] };

  function gazeTarget(i, t) {
    // returns [world point to look at, extra pitch]
    const me = CH[i];
    const sp = speakingAt(t);
    const last = lastSpeakerAt(t);
    const head = n => CH[IDX[n]].seat;
    const mind = env('mind', t);
    if (i === 4) {
      // Noor mostly looks at the glass in front of them; lifts their eyes at the very end
      if (t > A.cut - 0.7) return [CH[0].seat, 0];
      if (sp && sp.lang === 'en' && t < A.switch && (t % 7) > 4.5) return [head(sp.who), 0];
      return [GLASS[4], -0.1];
    }
    if (i === 0) {
      if (t > A.noor) return [CH[4].seat, -0.02];
      if (mind > 0.35 && t < A.r3 + 1.0) return [ORB_HOME, 0];
      if (t > A.sam + 3.5 && t < A.mind) return [add(GLASS[0], v3(0.1, 0, -0.1)), -0.05];
      if (sp && sp.who !== 'SAM') {
        // a lag, like someone following a conversation
        const lag = t > A.switch ? 0.5 : 0.3;
        const sp2 = speakingAt(t - lag) || sp;
        if (sp2.who !== 'SAM') return [head(sp2.who), 0];
      }
      if (sp && sp.who === 'SAM') return [head(ADDR[sp.id] || 'RAFA'), 0];
      if (last && last.who !== 'SAM') return [head(last.who), 0];
      return [head('LU'), 0];
    }
    // the friends
    if (sp) {
      if (sp.who === me.name) {
        const to = ADDR[sp.id] || 'SAM';
        return [head(to), 0];
      }
      // listeners watch the speaker; in the other language nobody checks on Sam
      return [head(sp.who), 0];
    }
    if (last) {
      if (last.who === me.name) return [head(ADDR[last.id] || 'SAM'), 0];
      return [head(last.who), 0];
    }
    return [head('SAM'), 0];
  }

  function simulateTo(t) {
    const dt = 1 / 120;
    if (t < sim.t || sim.t < 0) {
      sim.t = 0;
      for (let i = 0; i < 5; i++) {
        sim.yaw[i] = 0; sim.yawV[i] = 0; sim.pitch[i] = 0; sim.pitchV[i] = 0;
      }
    }
    while (sim.t < t) {
      const s = sim.t;
      for (let i = 0; i < 5; i++) {
        const [pt, pextra] = gazeTarget(i, s);
        const me = CH[i];
        const d = sub(pt, me.seat);
        const bodyAng = Math.atan2(me.face[2], me.face[0]);
        let ang = Math.atan2(d[2], d[0]) - bodyAng;
        while (ang > Math.PI) ang -= 2 * Math.PI;
        while (ang < -Math.PI) ang += 2 * Math.PI;
        ang = clamp(ang, -1.25, 1.25);
        const horiz = Math.hypot(d[0], d[2]);
        const pit = clamp(Math.atan2(d[1], horiz), -0.5, 0.35) + pextra;
        const w = i === 4 ? 3.2 : (i === 0 ? 5.5 : 6.5);
        // critically damped spring
        const a = w * w * (ang - sim.yaw[i]) - 2 * w * sim.yawV[i];
        sim.yawV[i] += a * dt; sim.yaw[i] += sim.yawV[i] * dt;
        const ap = w * w * (pit - sim.pitch[i]) - 2 * w * sim.pitchV[i];
        sim.pitchV[i] += ap * dt; sim.pitch[i] += sim.pitchV[i] * dt;
      }
      sim.t += dt;
    }
  }

  // ------------------------------------------------------------ bodies
  // capsule list in character space: [f, s, y] relative to head centre
  const HEAD = [
    // [a, b, r, group]  group: 0 skin, 1 hair, 2 cloth
    [[-0.012, 0, 0.012], [-0.012, 0, 0.012], 0.086, 0],     // cranium
    [[0.024, 0, -0.024], [0.03, 0, -0.045], 0.066, 0],      // face
    [[0.03, 0, -0.07], [0.052, 0, -0.088], 0.036, 0],       // jaw and chin
    [[0.072, 0, 0.004], [0.092, 0, -0.028], 0.0115, 0],     // nose
    [[-0.006, 0.074, -0.012], [-0.006, 0.074, -0.012], 0.02, 0],
    [[-0.006, -0.074, -0.012], [-0.006, -0.074, -0.012], 0.02, 0],
  ];
  const HAIR = {
    sam: [[[-0.022, 0, 0.026], [-0.022, 0, 0.026], 0.091, 1], [[-0.05, 0, 0.0], [-0.07, 0, -0.14], 0.08, 1],
      [[-0.03, 0.05, -0.02], [-0.05, 0.075, -0.15], 0.045, 1], [[-0.03, -0.05, -0.02], [-0.05, -0.075, -0.15], 0.045, 1]],
    curls: [[[-0.035, 0, 0.03], [-0.035, 0, 0.03], 0.118, 1], [[-0.09, 0.07, -0.03], [-0.09, 0.07, -0.03], 0.07, 1],
      [[-0.09, -0.07, -0.03], [-0.09, -0.07, -0.03], 0.07, 1], [[-0.06, 0, 0.09], [-0.06, 0, 0.09], 0.06, 1]],
    bun: [[[-0.02, 0, 0.026], [-0.02, 0, 0.026], 0.09, 1], [[-0.1, 0, 0.075], [-0.1, 0, 0.075], 0.045, 1]],
    short: [[[-0.018, 0, 0.03], [-0.018, 0, 0.03], 0.089, 1], [[0.028, 0, -0.068], [0.052, 0, -0.092], 0.042, 1]],
    short2: [[[-0.02, 0, 0.034], [-0.02, 0, 0.034], 0.088, 1]],
  };

  // pose -> world capsules for character i
  function buildBody(i, t, P) {
    const c = CH[i];
    const sc = c.scale;
    const Fb = c.face, Sb = [-Fb[2], 0, Fb[0]], Y = [0, 1, 0];
    const breathe = Math.sin(t * 2 * Math.PI / 4.2 + i) * 0.004;
    const laugh = P.laugh;
    const shake = laugh * Math.sin(t * 2 * Math.PI * 4.6 + i) * 0.007;
    const base = add(c.seat, v3(0, shake + breathe * 0.5 + P.lift, 0));
    // lean moves the head forward/back along the body facing
    const head = add(base, mul(Fb, P.lean));
    const bodyP = (f, s, y) => add(add(add(c.seat, mul(Fb, f * sc + P.lean * 0.4)), mul(Sb, s * sc)), v3(0, y * sc + shake * 0.6 + breathe, 0));
    // head frame: yaw relative to body, pitch about the neck
    const yaw = P.yaw, pit = P.pitch, roll = P.roll;
    const Fh0 = rotY(Fb, yaw);
    const Sh0 = [-Fh0[2], 0, Fh0[0]];
    const cp = Math.cos(pit), sp = Math.sin(pit);
    const Fh = add(mul(Fh0, cp), mul(Y, sp));
    const Yh0 = add(mul(Y, cp), mul(Fh0, -sp));
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const Yh = add(mul(Yh0, cr), mul(Sh0, sr));
    const Sh = add(mul(Sh0, cr), mul(Yh0, -sr));
    const pivot = add(head, v3(0, -0.085 * sc, 0));
    const headP = (f, s, y) => add(pivot, add(add(mul(Fh, f * sc), mul(Sh, s * sc)), mul(Yh, (y + 0.085) * sc)));
    const out = [];
    for (const [a, b, r, g] of HEAD) out.push([headP(...a), headP(...b), r * sc, g]);
    for (const [a, b, r, g] of HAIR[c.hair]) out.push([headP(...a), headP(...b), r * sc, g]);
    const HOLLOWS = [[[0.074, 0.031, -0.004], [0.074, 0.031, -0.004], 0.017, 3], [[0.074, -0.031, -0.004], [0.074, -0.031, -0.004], 0.017, 3],
      [[0.083, 0.0, -0.054], [0.083, 0.0, -0.054], 0.011, 3]];
    // neck and body
    out.push([headP(-0.008, 0, -0.07), bodyP(-0.025, 0, -0.2), 0.047 * sc, 0]);
    out.push([bodyP(-0.03, -0.165, -0.235), bodyP(-0.03, 0.165, -0.235), 0.07 * sc, 2]);
    out.push([bodyP(-0.015, 0, -0.29), bodyP(-0.03, 0, -0.52), 0.155 * sc, 2]);
    // arms: upper arms hang, forearms rest on the table unless a hand is raised
    for (const side of [-1, 1]) {
      const raise = side > 0 ? P.handR : P.handL;
      const sh = bodyP(-0.04, 0.195 * side, -0.27);
      const el = bodyP(-0.01 + 0.06 * raise, 0.225 * side, -0.5 + 0.12 * raise);
      const hand = bodyP(0.22 - 0.02 * raise + P.handFwd, (0.13 - 0.02 * raise) * side, -0.49 + 0.3 * raise + 0.04 * Math.sin(t * 5.3 + side) * raise);
      out.push([sh, el, 0.052 * sc, 2]);
      out.push([el, hand, 0.043 * sc, 2]);
      out.push([hand, add(hand, mul(Fb, 0.035)), 0.028 * sc, 0]);
    }
    for (const [a, b, r, g] of HOLLOWS) out.push([headP(...a), headP(...b), r * sc, g]);
    return { prims: out, head };
  }

  // -------------------------------------------------------------- camera
  function camera(t) {
    const L = LINE;
    const I = INTERP;
    const sam = CH[0].seat;
    const shots = [
      ['open', 0, L.L03.start + 2.4],
      ['lu', L.L03.start + 2.4, L.L05.start - 0.35],
      ['samC', L.L05.start - 0.35, L.L06.start + 0.25],
      ['group', L.L06.start + 0.25, L.P01.start + 0.3],
      ['samLong', L.P01.start + 0.3, L.P07.start - 0.25],
      ['pov', L.P07.start - 0.25, L.P10.end + 0.35],
      ['samTele', L.P10.end + 0.35, A.mind - 2.2],
      ['dolly', A.mind - 2.2, A.mind + 5.6],
      ['mind1', A.mind + 5.6, I[1].form - 0.6],
      ['mind2', I[1].form - 0.6, I[3].form - 0.4],
      ['mind3', I[3].form - 0.4, A.desc],
      ['desc', A.desc, A.dark],
      ['dark', A.dark, A.r2 + 0.6],
      ['ret', A.r2 + 0.6, L.R04.start - 0.15],
      ['pov2', L.R04.start - 0.15, L.R05.start - 0.3],
      ['samEnd', L.R05.start - 0.3, A.noor + 1.1],
      ['noor', A.noor + 1.1, A.cut],
      ['black', A.cut, 1e9],
    ];
    let s = shots[0];
    for (const sh of shots) if (t >= sh[1] && t < sh[2]) s = sh;
    const [name, t0, t1] = s;
    const u = clamp((t - t0) / (t1 - t0), 0, 1);
    let pos, tgt, fov, focusP, ap, sway = 0.004;
    const mindAp = 0.0;
    switch (name) {
      case 'open':
        pos = lerp3(v3(0.12, 1.62, 3.55), v3(0.02, 1.5, 3.0), easeIO(u));
        tgt = v3(-0.05, 1.02, -0.7);
        fov = 30; focusP = lerp3(CANDLE[0], CH[1].seat, sstep(0.35, 0.9, u)); ap = 0.035; break;
      case 'lu':
        pos = lerp3(v3(-1.28, 1.36, 1.62), v3(-1.22, 1.35, 1.52), u);
        tgt = v3(0.55, 1.12, -0.2);
        fov = 21; focusP = CH[1].seat; ap = 0.05; break;
      case 'samC':
        pos = lerp3(v3(0.62, 1.31, 1.62), v3(0.55, 1.3, 1.56), u);
        tgt = add(sam, v3(0.12, -0.04, -0.02));
        fov = 19; focusP = sam; ap = 0.05; break;
      case 'group':
        pos = lerp3(v3(0.42, 1.48, 2.7), v3(0.36, 1.45, 2.55), u);
        tgt = v3(-0.05, 1.08, -0.85);
        fov = 26; focusP = lerp3(CH[3].seat, CH[2].seat, 0.5); ap = 0.03; break;
      case 'samLong': {
        // the long take: the switch happens here, and we stay with her face
        const e = easeIO(u);
        pos = lerp3(v3(0.95, 1.36, 1.95), v3(0.45, 1.31, 1.5), e);
        tgt = lerp3(add(sam, v3(0.32, -0.25, -0.05)), add(sam, v3(0.2, -0.15, -0.02)), e);
        fov = lerp(27, 21, e); focusP = sam;
        ap = lerp(0.045, 0.085, sstep(0.2, 1.0, u)); sway = 0.003; break;
      }
      case 'pov': {
        // her eyes: the three of them, a closed circle, a wide lens
        const a = lerp(-0.93, -0.9, u);
        pos = add(sam, v3(0.06, 0.02, -0.02));
        tgt = add(pos, v3(Math.cos(a), -0.06, Math.sin(a)));
        fov = 39; focusP = CH[3].seat; ap = lerp(0.07, 0.12, u); sway = 0.008; break;
      }
      case 'samTele':
        pos = lerp3(v3(1.72, 1.29, 1.72), v3(1.66, 1.29, 1.68), u);
        tgt = add(sam, v3(0.03, -0.02, 0));
        fov = 9.5; focusP = sam; ap = 0.1; break;
      case 'dolly': {
        // behind her shoulder: move in while the lens widens, so she stays and
        // everything she is looking at falls away
        const e = easeIO(u);
        const d0 = 2.5, d1 = 0.7;
        const dist = lerp(d0, d1, e);
        const k = Math.tan(10 * Math.PI / 360) * d0;
        fov = 2 * Math.atan(k / dist) * 180 / Math.PI;
        const look = norm(v3(0.72, 0, -0.69));
        const side = [-look[2], 0, look[0]];
        const anchor = add(sam, mul(side, 0.16));
        pos = add(add(anchor, mul(look, -dist)), v3(0, 0.1 + 0.05 * e, 0));
        tgt = add(anchor, mul(look, 1.0));
        focusP = lerp3(sam, add(sam, mul(look, 1.5)), 0.0); ap = lerp(0.05, 0.035, e); sway = 0.002; break;
      }
      case 'mind1': {
        // behind her shoulder: the orb, and far away the others as lights
        const e = easeIO(u);
        pos = lerp3(v3(-1.35, 1.36, 1.55), v3(-1.3, 1.32, 1.35), e);
        tgt = lerp3(v3(0.2, 1.12, -1.2), v3(0.3, 1.15, -1.4), e);
        fov = 34; focusP = ORB_HOME; ap = 0.035; sway = 0.002; break;
      }
      case 'mind2': {
        const e = easeIO(u);
        const ang = lerp(-0.25, 0.25, e);
        const c = add(ORB_HOME, v3(-0.1, 0, 0.05));
        pos = add(c, v3(Math.sin(ang) * 1.5 - 0.4, 0.14, Math.cos(ang) * 1.5 + 0.3));
        tgt = add(c, v3(0.05, 0.02, -0.1));
        fov = 30; focusP = ORB_HOME; ap = 0.045; sway = 0.002; break;
      }
      case 'mind3': {
        const e = easeIO(u);
        pos = lerp3(v3(0.2, 1.24, 2.0), v3(0.1, 1.22, 1.8), e);
        tgt = lerp3(add(ORB_HOME, v3(-0.15, 0.08, 0)), add(ORB_HOME, v3(-0.2, 0.08, 0)), e);
        fov = 28; focusP = ORB_HOME; ap = 0.045; sway = 0.002; break;
      }
      case 'desc': {
        // pulling away: she becomes small in a very large dark
        const e = easeIO(u);
        pos = lerp3(v3(-0.4, 1.4, 2.6), v3(0.9, 2.3, 7.8), e);
        tgt = lerp3(v3(-0.5, 1.1, 0.4), v3(-0.35, 1.05, -1.0), e);
        fov = lerp(30, 34, e); focusP = sam; ap = lerp(0.03, 0.01, e); sway = 0.0; break;
      }
      case 'dark': {
        const e = easeIO(u);
        pos = lerp3(v3(0.7, 2.1, 7.0), v3(-0.35, 1.3, 2.3), e);
        tgt = lerp3(v3(-0.4, 1.05, -0.6), add(ORB_HOME, v3(-0.1, 0.0, 0)), e);
        fov = lerp(34, 22, e); focusP = lerp3(sam, ORB_HOME, e); ap = 0.04; sway = 0.0; break;
      }
      case 'ret': {
        // the light pulls back and is a candle again; the room assembles around it
        const e = easeIO(u);
        pos = lerp3(v3(-0.4, 1.28, 1.95), v3(-0.72, 1.3, 1.25), e);
        tgt = lerp3(add(ORB_HOME, v3(0.05, 0.0, 0.0)), v3(0.3, 1.1, -0.6), e);
        fov = lerp(22, 34, e); focusP = lerp3(ORB_HOME, CH[1].seat, sstep(0.3, 0.9, u)); ap = lerp(0.07, 0.035, e); break;
      }
      case 'pov2': {
        const a = -0.9;
        pos = add(sam, v3(0.05, 0.03, -0.02));
        tgt = add(pos, v3(Math.cos(a), -0.06, Math.sin(a)));
        fov = 39; focusP = CH[2].seat; ap = 0.04; sway = 0.005; break;
      }
      case 'samEnd': {
        pos = lerp3(v3(0.66, 1.3, 1.68), v3(0.42, 1.28, 1.46), easeIO(u));
        tgt = add(sam, v3(0.12, -0.05, -0.04));
        fov = 18; focusP = sam; ap = 0.055; break;
      }
      case 'noor': {
        // over her shoulder, down the length of the table to the one who has been quiet
        pos = lerp3(v3(-0.56, 1.35, 1.52), v3(-0.54, 1.34, 1.44), u);
        tgt = v3(0.0, 1.14, -1.9);
        fov = lerp(17, 15.5, u);
        focusP = lerp3(sam, CH[4].seat, sstep(0.05, 0.45, u)); ap = 0.06; break;
      }
      default:
        pos = v3(0, 1.3, 3); tgt = v3(0, 1.1, 0); fov = 30; focusP = tgt; ap = 0.03;
    }
    // breath of a handheld operator
    const sw = [noise1(t * 0.35, 1) * sway, noise1(t * 0.3, 2) * sway * 0.7, 0];
    tgt = add(tgt, sw);
    return { pos, tgt, fov, focusP, ap, shot: name };
  }

  // --------------------------------------------------------- per-frame state
  function frameState(t) {
    simulateTo(t);
    const cam = camera(t);
    const fwd = norm(sub(cam.tgt, cam.pos));
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const tanHalf = Math.tan(cam.fov * Math.PI / 360);
    const focus = Math.max(0.2, dot(sub(cam.focusP, cam.pos), fwd));

    const clarity = env('clarity', t);
    const mind = env('mind', t);
    const dark = env('dark', t);
    const orbE = env('orb', t);
    const voices = env('voices', t);
    const heart = env('heart', t) * env('heart', t) * 0 + env('heart', t);

    // how far the others have gone
    const away = sstep(0.25, 1.0, mind);
    const figs = [];
    const primsA = new Float32Array(5 * NP * 4);
    const primsB = new Float32Array(5 * NP * 4).fill(-1);
    const chC = [], chLook = [];
    for (let i = 0; i < 5; i++) {
      const c = CH[i];
      const talk = env('talk_' + c.name, t);
      const laugh = Math.min(1, env('laugh_' + c.name, t) * 1.1);
      const P = {
        yaw: sim.yaw[i] + noise1(t * 0.4, i + 10) * 0.05,
        pitch: sim.pitch[i] + laugh * 0.16 + talk * 0.035 * Math.sin(t * 6.1 + i) + noise1(t * 0.5, i + 20) * 0.025,
        roll: noise1(t * 0.23, i + 30) * 0.04 + laugh * 0.05 * Math.sin(t * 2.0 + i),
        lean: -laugh * 0.035 + talk * 0.012 + (i === 0 ? -0.01 : 0),
        lift: 0, laugh: laugh * 0.9,
        handR: 0, handL: 0, handFwd: 0,
      };
      // Lu tells the story with her hands
      if (i === 1) P.handR = clamp(talk * 1.6, 0, 1) * (t < A.switch ? 0.75 : 0.45);
      if (i === 3 && LINE.L08 && t > LINE.L08.start - 0.2 && t < LINE.L08.end + 0.3) { P.handR = 0.9; P.handL = 0.7; }
      if (i === 3 && t > LINE.L04.start && t < LINE.L04.end + 0.3) P.handR = 0.6;
      // Sam: the automatic smile, a small nod
      if (i === 0) {
        const sm = sstep(A.sharp - 0.2, A.sharp + 0.5, t) * (1 - sstep(A.sharp + 2.5, A.sharp + 4.0, t));
        P.pitch += sm * 0.04 + 0.03 * Math.sin((t - A.sharp) * 5) * sm;
        // she sinks a little into herself as the room goes
        P.pitch -= 0.08 * sstep(A.sam, A.mind, t) * (1 - sstep(A.r3, A.r4, t));
        P.lean -= 0.012 * sstep(A.sam, A.mind, t) * (1 - sstep(A.r3, A.r4, t));
        if (t > A.cut - 0.6) P.lean += 0.02 * sstep(A.cut - 0.6, A.cut, t);
      }
      if (i === 4) {
        // Noor turns their glass slowly, hands together on the table
        P.handR = 0.25; P.handL = 0.25; P.handFwd = -0.06;
        P.pitch += 0.02 * Math.sin(t * 0.7);
      }
      const b = buildBody(i, t, P);
      let C = c.seat;
      let dissolve = 0, glow = 0, alpha = 1, light = 1;
      if (i > 0) {
        // the others recede and come apart into light
        const off = sub(FAR[i], c.seat);
        const push = easeIO(clamp(away * 1.05, 0, 1));
        const shift = mul(off, push);
        for (const p of b.prims) { p[0] = add(p[0], shift); p[1] = add(p[1], shift); }
        C = add(c.seat, shift);
        dissolve = sstep(0.1, 0.85, mind);
        glow = 1.0;
        alpha = 1 - sstep(0.75, 1.0, mind);
        // faces lose their light before they lose their shape
        light = lerp(1.0, 0.5, clamp((1 - clarity) * 1.3, 0, 1));
        if (i === 4) light *= 0.9 + 2.4 * sstep(A.noor + 0.8, A.cut - 0.8, t);
      } else {
        light = 1.0 + 0.1 * (1 - clarity) * (1 - mind);
      }
      // project into the billboard frame
      let ext = 0;
      for (let k = 0; k < b.prims.length && k < NP; k++) {
        const [pa, pb, r, g] = b.prims[k];
        const oa = sub(pa, C), ob = sub(pb, C);
        const j = (i * NP + k) * 4;
        primsA[j] = dot(oa, right); primsA[j + 1] = dot(oa, up); primsA[j + 2] = -dot(oa, fwd); primsA[j + 3] = r;
        primsB[j] = dot(ob, right); primsB[j + 1] = dot(ob, up); primsB[j + 2] = -dot(ob, fwd); primsB[j + 3] = g;
        ext = Math.max(ext, Math.hypot(primsA[j], primsA[j + 1]) + r, Math.hypot(primsB[j], primsB[j + 1]) + r);
      }
      chC.push(C[0], C[1], C[2], ext);
      chLook.push(dissolve, glow, alpha, light);
    }

    // the near candle is also the first form of the orb
    const hitGlow = (() => {
      let g = 0;
      for (const l of CUES.lines) if (l.hit) {
        g += 0.45 * sstep(l.hit[0] - 0.05, l.hit[0] + 0.15, t) * (1 - sstep(l.hit[1] + 0.3, l.hit[1] + 1.6, t));
      }
      return g;
    })();
    const flick = [0, 1].map(k => 1 + 0.07 * Math.sin(t * 11.3 + k * 2) + 0.05 * Math.sin(t * 23.7 + k) + 0.08 * noise1(t * 3.1, 40 + k));
    flick[0] += hitGlow;
    const orbGrow = sstep(0.0, 1.0, orbE);
    const orbBase = lerp3(CANDLE[0], ORB_HOME, easeIO(sstep(0.05, 0.85, clamp(mind * 1.1, 0, 1))));
    const retShrink = sstep(A.r3, A.r3 + 1.8, t);
    const orbPos = add(orbBase, v3(Math.sin(t * 0.31) * 0.01, Math.sin(t * 0.47) * 0.012, 0));
    let orbSize = (lerp(0.008, 0.05, orbGrow) * (1 - 0.6 * dark) + 0.004) * (1 - 0.8 * retShrink);
    // interpretations: the orb brightens as it reaches for a meaning, dims as it breaks
    let ik = 0, iform = 0, ibrk = 0, pulse = voices * 0.35 * mind;
    for (const it of INTERP) {
      const f = sstep(it.form - 0.6, it.form + 2.4, t);
      const br = sstep(it.brk, it.brk + 2.4, t);
      if (t > it.form - 0.8 && t < it.brk + 2.6) {
        ik = IKIND[it.kind]; iform = f; ibrk = br;
        pulse += 0.45 * f * (1 - br) + 0.9 * Math.exp(-Math.max(0, t - it.brk) * 3) * (t > it.brk ? 1 : 0);
        orbSize *= 1 - 0.25 * br * (1 - sstep(it.brk + 1.2, it.brk + 2.6, t));
      }
    }
    // the ember in the dark, answering the voice that calls her back
    const callE = env('talk_LU', t) * sstep(A.r1 - 0.2, A.r1, t) * (1 - sstep(A.r3, A.r3 + 2, t));
    pulse += callE * 1.2;
    const orbGlow = orbE * (1 - 0.75 * dark) + (0.22 + callE * 0.6) * dark * (1 - retShrink);
    const candleOn = 1 - sstep(0.15, 0.55, mind);

    // distant lights
    const far = [];
    for (let i = 1; i < 5; i++) {
      const nm = CH[i].name;
      const tk = env('talk_' + nm, t), lg = env('laugh_' + nm, t);
      const vis = sstep(0.45, 0.95, mind) * (1 - 0.7 * dark);
      const base = i === 4 ? 0.12 : 0.35;
      far.push(FAR[i][0], FAR[i][1], FAR[i][2], vis * (base + 0.6 * tk + 0.9 * lg));
    }

    // thoughts
    const slots = [null, null];
    CUES.thoughts.forEach((th, k) => {
      const t0 = th.start, t1 = th.start + th.dur;
      if (t < t0 - 0.1 || t > t1 + 0.1) return;
      const u = (t - t0) / th.dur;
      const reveal = sstep(0.0, th.style === 'last' ? 0.6 : 0.32, u);
      const brk = sstep(th.style === 'last' ? 0.75 : 0.6, 1.0, u);
      slots[k % 2] = { k, th, reveal, brk, alpha: 1 - sstep(0.94, 1.0, u) };
    });
    const tparams = slots.map(s => s ? thoughtParams(s, t, { pos: cam.pos, fwd, right, up, tanHalf }, orbPos) : null);

    const room = (1 - mind) * (1 - 0.35 * (1 - clarity)) * (1 - dark);
    const fadeIn = sstep(5.0, 8.5, t) * (t < A.cut ? 1 : 0);
    const trace = sstep(A.r2, A.r2 + 1.5, t) * (1 - sstep(A.r3 + 1.0, A.r3 + 2.6, t));

    return {
      cam, fwd, right, up, tanHalf, focus,
      clarity, mind, dark, orbE, voices, heart, room, fadeIn, trace,
      primsA, primsB, chC, chLook, flick, candleOn,
      orbPos, orbSize, orbGlow, pulse, ik, iform, ibrk, far, slots, tparams,
      noorGlint: sstep(A.noor + 1.5, A.cut - 0.5, t),
    };
  }

  function project(p, cam) {
    const d = sub(p, cam.pos);
    const z = dot(d, cam.fwd);
    return [dot(d, cam.right) / z / cam.tanHalf, dot(d, cam.up) / z / cam.tanHalf, z];
  }

  const STYLE = { reflect: 1, glass: 2, dark: 3, near: 4, orb: 5, floor: 6, last: 7 };
  function thoughtParams(s, t, cam, orbPos) {
    const st = s.th.style;
    const id = STYLE[st];
    let p = [0, 0, 0.1, 0];
    const drift = (t - s.th.start) * 0.01;
    const faceAngle = Math.atan2(cam.right[2], cam.right[0]);
    if (st === 'reflect') {
      p = [-0.2, 0.6, 0.62, faceAngle];          // lying on the table beside her glass
    } else if (st === 'floor') {
      p = [-0.05, 0.25, 0.9, faceAngle];
    } else if (st === 'glass') {
      const q = project(add(GLASS[0], v3(0, 0.1, 0)), cam);
      p = [q[0] + 0.1, q[1] + 0.2 + drift, 0.13, 0.0];
    } else if (st === 'dark') {
      p = s.th.text.startsWith('Wait') ? [-1.45, 0.42 + drift, 0.17, 0.6] : [1.35, -0.4 + drift, 0.16, 0.6];
    } else if (st === 'near') {
      p = [0.72, 0.2 + drift * 2, 0.19, 0.2];
    } else if (st === 'orb') {
      const q = project(orbPos, cam);
      p = [q[0] + 0.1, q[1] - 0.3 + drift, 0.15, 0.0];
    } else if (st === 'last') {
      p = [0.0, -0.42, 0.16, 0.35];
    }
    return { id, p, reveal: s.reveal, brk: s.brk, alpha: s.alpha, k: s.k };
  }

  // ------------------------------------------------------------------ GL
  let gl, progs = {}, quad, fbScene, bloomChain = [], textTex = [null, null], textKey = [-1, -1], titleTex, titleCanvas, titleCtx, titleKey = '';
  let textCanvas, textCtx;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n').slice(0, 20000));
    return s;
  }
  function program(fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, SHADERS.vert));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }
  function makeFB(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h };
  }
  function texFromCanvas(tex, canvas) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  let SW = W, SH = PIC_H, scale = 1;
  function init(canvas, opts) {
    scale = (opts && opts.scale) || 1;
    SW = Math.round(W * scale); SH = Math.round(PIC_H * scale);
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error('WebGL2 not available');
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    progs.scene = program(SHADERS.scene);
    progs.down = program(SHADERS.down);
    progs.up = program(SHADERS.up);
    progs.final = program(SHADERS.final);
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    fbScene = makeFB(SW, SH);
    let w = SW, h = SH;
    for (let i = 0; i < 6; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      bloomChain.push({ down: makeFB(w, h), up: makeFB(w, h) });
    }
    textCanvas = document.createElement('canvas');
    textCanvas.width = 2048; textCanvas.height = 256;
    textCtx = textCanvas.getContext('2d');
    textTex = [gl.createTexture(), gl.createTexture()];
    titleCanvas = document.createElement('canvas');
    titleCanvas.width = SW; titleCanvas.height = SH;
    titleCtx = titleCanvas.getContext('2d');
    titleTex = gl.createTexture();
    drawTitle(0);
  }

  function drawThoughtTexture(slot, k) {
    if (textKey[slot] === k) return;
    textKey[slot] = k;
    const th = CUES.thoughts[k];
    const c = textCtx;
    c.fillStyle = '#000'; c.fillRect(0, 0, 2048, 256);
    c.fillStyle = '#fff';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = "italic 300 150px 'Cormorant Garamond'";
    c.fillText(th.text, 1024, 132);
    texFromCanvas(textTex[slot], textCanvas);
  }

  function drawTitle(t) {
    const a1 = t > A.text1 ? sstep(A.text1, A.text1 + 1.4, t) * (1 - sstep(A.text2 - 0.9, A.text2 - 0.1, t)) : 0;
    const a2 = t > A.text2 ? sstep(A.text2, A.text2 + 1.4, t) * (1 - sstep(A.title - 1.0, A.title - 0.2, t)) : 0;
    const a3 = t > A.title ? sstep(A.title + 0.3, A.title + 2.4, t) * (1 - sstep(A.end - 2.2, A.end - 0.3, t)) : 0;
    const key = [a1, a2, a3].map(x => x.toFixed(3)).join('|');
    if (key === titleKey) return;
    titleKey = key;
    const c = titleCtx, w = SW, h = SH;
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const g = v => { const x = Math.round(v * 255); return `rgb(${x},${x},${x})`; };
    if (a1 > 0) { c.fillStyle = g(a1 * 0.82); c.font = `300 ${Math.round(46 * scale)}px 'Cormorant Garamond'`; c.fillText(CUES.ending[0], w / 2, h / 2); }
    if (a2 > 0) { c.fillStyle = g(a2 * 0.82); c.font = `300 ${Math.round(46 * scale)}px 'Cormorant Garamond'`; c.fillText(CUES.ending[1], w / 2, h / 2); }
    if (a3 > 0) {
      c.fillStyle = g(a3 * 0.9);
      c.font = `200 ${Math.round(40 * scale)}px 'Jost'`;
      const txt = CUES.title.toUpperCase().split('').join(String.fromCharCode(8202, 8202, 8202));
      c.fillText(txt, w / 2, h / 2);
    }
    texFromCanvas(titleTex, titleCanvas);
  }

  function setU(prog, name, fn, ...args) { const l = prog.u[name]; if (l !== undefined && l !== null) gl[fn](l, ...args); }

  function render(t) {
    const S = frameState(t);
    // ---- scene
    const P = progs.scene;
    gl.useProgram(P.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbScene.fb);
    gl.viewport(0, 0, SW, SH);
    setU(P, 'uRes', 'uniform2f', SW, SH);
    setU(P, 'uTime', 'uniform1f', t);
    setU(P, 'uCamPos', 'uniform3fv', S.cam.pos);
    setU(P, 'uCamFwd', 'uniform3fv', S.fwd);
    setU(P, 'uCamRight', 'uniform3fv', S.right);
    setU(P, 'uCamUp', 'uniform3fv', S.up);
    setU(P, 'uTanHalf', 'uniform1f', S.tanHalf);
    setU(P, 'uFocus', 'uniform1f', S.focus);
    setU(P, 'uAperture', 'uniform1f', S.cam.ap);
    setU(P, 'uMind', 'uniform1f', S.mind);
    setU(P, 'uDark', 'uniform1f', S.dark);
    setU(P, 'uOrb', 'uniform1f', S.orbE);
    setU(P, 'uRoom', 'uniform1f', S.room);
    setU(P, 'uClarity', 'uniform1f', S.clarity);
    setU(P, 'uHeart', 'uniform1f', S.heart);
    setU(P, 'uVoices', 'uniform1f', S.voices);
    setU(P, 'uTrace', 'uniform1f', S.trace);
    setU(P, 'uFade', 'uniform1f', S.fadeIn);
    setU(P, 'uChC', 'uniform4fv', new Float32Array(S.chC));
    setU(P, 'uChLook', 'uniform4fv', new Float32Array(S.chLook));
    setU(P, 'uChSkin', 'uniform3fv', new Float32Array(CH.flatMap(c => c.skin)));
    setU(P, 'uChHair', 'uniform3fv', new Float32Array(CH.flatMap(c => c.hairC)));
    setU(P, 'uChCloth', 'uniform3fv', new Float32Array(CH.flatMap(c => c.cloth)));
    setU(P, 'uPrimA', 'uniform4fv', S.primsA);
    setU(P, 'uPrimB', 'uniform4fv', S.primsB);
    setU(P, 'uCandle', 'uniform3fv', new Float32Array([...CANDLE[0], ...CANDLE[1]]));
    setU(P, 'uFlick', 'uniform1fv', new Float32Array(S.flick));
    setU(P, 'uCandleOn', 'uniform1f', S.candleOn);
    const gls = [];
    for (let k = 0; k < 5; k++) gls.push(...GLASS[k], (k === 4 ? 1 + 1.5 * S.noorGlint : 1) * S.room);
    setU(P, 'uGlass', 'uniform4fv', new Float32Array(gls));
    setU(P, 'uOrbP', 'uniform4f', S.orbPos[0], S.orbPos[1], S.orbPos[2], S.orbSize);
    setU(P, 'uOrbGlow', 'uniform1f', S.orbGlow);
    setU(P, 'uOrbPulse', 'uniform1f', S.pulse);
    setU(P, 'uFar', 'uniform4fv', new Float32Array(S.far));
    setU(P, 'uIKind', 'uniform1f', S.ik);
    setU(P, 'uIForm', 'uniform1f', S.iform);
    setU(P, 'uIBreak', 'uniform1f', S.ibrk);
    const isc = [1.7, 1.0, 1.0, 1.15][S.ik] || 1.0;
    setU(P, 'uIPos', 'uniform4f', S.orbPos[0] + 0.02, S.orbPos[1] + 0.2 * isc, S.orbPos[2] - 0.05, isc);
    setU(P, 'uNoorGlint', 'uniform1f', S.noorGlint);
    { const q = project(S.orbPos, { pos: S.cam.pos, fwd: S.fwd, right: S.right, up: S.up, tanHalf: S.tanHalf });
      setU(P, 'uOrbScr', 'uniform2f', q[2] > 0 ? q[0] : 0, q[2] > 0 ? q[1] : 0); }
    for (let s = 0; s < 2; s++) {
      const tp = S.tparams[s];
      const sl = S.slots[s];
      if (tp && sl) drawThoughtTexture(s, sl.k);
      gl.activeTexture(gl.TEXTURE0 + s);
      gl.bindTexture(gl.TEXTURE_2D, textTex[s]);
      setU(P, s === 0 ? 'uTxt0' : 'uTxt1', 'uniform1i', s);
      setU(P, s === 0 ? 'uT0' : 'uT1', 'uniform4f', tp ? tp.id : 0, tp ? tp.reveal : 0, tp ? tp.brk : 0, tp ? tp.alpha : 0);
      setU(P, s === 0 ? 'uT0p' : 'uT1p', 'uniform4f', ...(tp ? tp.p : [0, 0, 0, 0]));
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- bloom
    let src = fbScene;
    for (let i = 0; i < bloomChain.length; i++) {
      const d = bloomChain[i].down;
      gl.useProgram(progs.down.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb);
      gl.viewport(0, 0, d.w, d.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
      setU(progs.down, 'uTex', 'uniform1i', 0);
      setU(progs.down, 'uTexel', 'uniform2f', 1 / src.w, 1 / src.h);
      setU(progs.down, 'uThresh', 'uniform1f', i === 0 ? 0.55 : 0.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = d;
    }
    let prev = bloomChain[bloomChain.length - 1].down;
    for (let i = bloomChain.length - 2; i >= 0; i--) {
      const u = bloomChain[i].up;
      gl.useProgram(progs.up.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, u.fb);
      gl.viewport(0, 0, u.w, u.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, prev.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomChain[i].down.tex);
      setU(progs.up, 'uTex', 'uniform1i', 0);
      setU(progs.up, 'uPrev', 'uniform1i', 1);
      setU(progs.up, 'uTexel', 'uniform2f', 1 / prev.w, 1 / prev.h);
      setU(progs.up, 'uMix', 'uniform1f', 0.9);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      prev = u;
    }

    // ---- finish
    drawTitle(t);
    const F = progs.final;
    gl.useProgram(F.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const cw = gl.canvas.width, chh = gl.canvas.height;
    gl.viewport(0, 0, cw, chh);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbScene.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, titleTex);
    setU(F, 'uScene', 'uniform1i', 0);
    setU(F, 'uBloom', 'uniform1i', 1);
    setU(F, 'uTitle', 'uniform1i', 2);
    setU(F, 'uRes', 'uniform2f', cw, chh);
    setU(F, 'uBox', 'uniform4f', 0, (chh - SH) / 2, SW, SH);
    setU(F, 'uTime', 'uniform1f', t);
    setU(F, 'uGrain', 'uniform1f', 1.0);
    setU(F, 'uBloomAmt', 'uniform1f', 0.16 + 0.04 * S.mind);
    setU(F, 'uWarm', 'uniform1f', 1.0);
    setU(F, 'uHeart', 'uniform1f', S.heart * S.mind);
    setU(F, 'uTitleA', 'uniform1f', 1.0);
    setU(F, 'uVignette', 'uniform1f', 0.55 + 0.35 * S.mind);
    setU(F, 'uExposure', 'uniform1f', 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return S;
  }

  window.FILM = { init, render, duration: CUES.duration, cues: CUES, frameState };
})();
