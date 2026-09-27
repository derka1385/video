// GLSL for "Still Here". One scene pass, a bloom chain, and a finishing pass.
window.SHADERS = {};

SHADERS.vert = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`;

SHADERS.scene = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uCamPos, uCamFwd, uCamRight, uCamUp;
uniform float uTanHalf, uFocus, uAperture;

uniform float uMind, uDark, uOrb, uRoom, uClarity, uHeart, uVoices, uReturn, uTrace, uFade;

// characters: C = billboard centre (world), prims packed as pairs of vec4
#define NCH 5
#define NP 24
uniform vec4  uChC[NCH];        // xyz centre, w = extent radius
uniform vec4  uChLook[NCH];     // x = dissolve, y = glow, z = alpha, w = face light
uniform vec3  uChSkin[NCH], uChHair[NCH], uChCloth[NCH];
uniform vec4  uPrimA[NCH*NP];   // u, v, depth, radius
uniform vec4  uPrimB[NCH*NP];   // u, v, depth, group (-1 = unused)

uniform vec3  uCandle[2];
uniform float uFlick[2];
uniform float uCandleOn;
uniform vec4  uGlass[5];        // xyz, w = brightness
uniform vec4  uOrbP;            // xyz, w = size
uniform float uOrbGlow, uOrbPulse;
uniform vec4  uFar[4];          // distant lights: xyz, w = intensity

uniform float uIKind, uIForm, uIBreak;
uniform vec4  uIPos;            // xyz, w = scale

uniform sampler2D uTxt0, uTxt1;
uniform vec4  uT0, uT1;         // style, reveal, break, alpha
uniform vec4  uT0p, uT1p;       // x, y, height (screen) or world params
uniform vec2  uT0asp, uT1asp;   // texture aspect, unused
uniform float uNoorGlint;
uniform vec2 uOrbScr;

const float PI = 3.14159265;
const float TABLE_Y = 0.76;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float hash13(vec3 p3){ p3 = fract(p3*0.1031); p3 += dot(p3, p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
float fbm3(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<3;i++){ s+=a*vnoise(p); p=p*2.07+vec2(3.1,1.3); a*=0.5; } return s; }

float pixelSize(float depth){ return depth * 2.0 * uTanHalf / uRes.y; }
float coc(float depth){ return uAperture * abs(depth - uFocus) / max(uFocus, 0.05); }
float blurAt(float depth){ return max(pixelSize(depth)*0.9, coc(depth)); }

// ------------------------------------------------------------------ figures
float sdSeg(vec2 p, vec2 a, vec2 b, out float h){
  vec2 pa = p-a, ba = b-a; h = clamp(dot(pa,ba)/max(dot(ba,ba),1e-8), 0.0, 1.0);
  return length(pa - ba*h);
}

// Returns premultiplied colour + alpha of character i for ray (ro, rd).
vec4 figure(int i, vec3 ro, vec3 rd, vec3 fwd, vec3 right, vec3 up, out float fdepth){
  fdepth = 1e9;
  vec4 C = uChC[i];
  vec4 look = uChLook[i];
  if (look.z < 0.003) return vec4(0);
  float den = dot(rd, fwd);
  if (den < 1e-4) return vec4(0);
  float t = dot(C.xyz - ro, fwd) / den;
  if (t <= 0.0) return vec4(0);
  vec3 P = ro + rd*t;
  vec2 q = vec2(dot(P-C.xyz, right), dot(P-C.xyz, up));
  float depth = dot(C.xyz - ro, fwd);
  float blur = blurAt(depth) + look.x*look.x*0.12;
  if (length(q) > C.w + blur*1.5) return vec4(0);

  float dmin = 1e5, sm = 1e5;
  float shade = 1.0; float catchL = 0.0;
  float hSkin=-1e5, hHair=-1e5, hCloth=-1e5;
  vec3 nSkin=vec3(0), nHair=vec3(0), nCloth=vec3(0);
  const float KS = 0.018;
  for (int k=0; k<NP; k++){
    vec4 A = uPrimA[i*NP+k];
    vec4 B = uPrimB[i*NP+k];
    if (B.w < -0.5) break;
    float hh;
    float dist = sdSeg(q, A.xy, B.xy, hh);
    float r = A.w;
    if (B.w > 2.5){
      // a hollow: darkens the face where it faces us
      float zc0 = mix(A.z, B.z, hh);
      float vis = smoothstep(-0.004, 0.006, zc0 - hSkin + 0.02);
      shade *= 1.0 - 0.3 * (1.0 - smoothstep(r*0.3, r + blurAt(dot(C.xyz - ro, fwd))*0.6, dist)) * vis;
      if (r > 0.014){
        vec2 cq = q - (A.xy + vec2(0.002, 0.003));
        float bl = blurAt(dot(C.xyz - ro, fwd));
        catchL += vis * exp(-dot(cq, cq)/(0.0000035 + bl*bl)) * 0.0000035/(0.0000035 + bl*bl);
      }
      continue;
    }
    float d = dist - r;
    // smooth union keeps joints soft
    float kk = 0.018;
    float hs = clamp(0.5 + 0.5*(d - sm)/kk, 0.0, 1.0);
    sm = mix(d, sm, hs) - kk*hs*(1.0-hs);
    dmin = min(dmin, d);
    vec2 cp = mix(A.xy, B.xy, hh);
    float zc = mix(A.z, B.z, hh);
    float s2 = r*r - dist*dist;
    float z = zc + sqrt(max(s2, 0.0)) - max(dist - r, 0.0)*30.0;
    vec2 dd = q - cp;
    vec3 n = normalize(vec3(dd, sqrt(max(s2, r*r*0.0004))));
    // online soft-max per material: overlapping parts blend instead of creasing
    if (B.w < 0.5){
      if (z > hSkin){ float e = exp((hSkin - z)/KS); nSkin = nSkin*e + n; hSkin = z; } else nSkin += n*exp((z - hSkin)/KS);
    } else if (B.w < 1.5){
      if (z > hHair){ float e = exp((hHair - z)/KS); nHair = nHair*e + n; hHair = z; } else nHair += n*exp((z - hHair)/KS);
    } else {
      if (z > hCloth){ float e = exp((hCloth - z)/KS); nCloth = nCloth*e + n; hCloth = z; } else nCloth += n*exp((z - hCloth)/KS);
    }
  }
  nSkin = normalize(nSkin + vec3(0,0,1e-4)); nHair = normalize(nHair + vec3(0,0,1e-4)); nCloth = normalize(nCloth + vec3(0,0,1e-4));
  float d = sm;
  // flyaway hair: the outline breaks up a little where hair is outermost
  float hairEdge = exp((hHair - max(hSkin, hCloth))/0.01);
  d += (fbm3(q*vec2(90.0, 70.0) + float(i)*5.0) - 0.5) * 0.008 * clamp(hairEdge, 0.0, 1.0);
  float cov = 1.0 - smoothstep(-blur, blur, d);
  if (cov < 0.002) return vec4(0);
  fdepth = depth;

  // which material is front-most here (soft)
  float hm = max(hSkin, max(hHair, hCloth));
  float soft = 0.006 + blur*0.5;
  float wS = exp((hSkin-hm)/soft), wH = exp((hHair-hm)/soft), wC = exp((hCloth-hm)/soft);
  float ws = wS+wH+wC;
  wS/=ws; wH/=ws; wC/=ws;
  vec3 nl = normalize(nSkin*wS + nHair*wH + nCloth*wC);
  vec3 N = normalize(right*nl.x + up*nl.y - fwd*nl.z);
  vec3 wp = C.xyz + right*q.x + up*q.y - fwd*hm;

  vec3 albedo = uChSkin[i]*wS + uChHair[i]*wH + uChCloth[i]*wC;
  // a whisper of texture so cloth and hair aren't plastic
  float tex = fbm3(q*vec2(180.0, 60.0) + float(i)*7.0);
  albedo *= 0.85 + 0.3*tex*(wH + wC*0.6);

  vec3 col = vec3(0);
  float roomL = uRoom;
  // candles: warm, flickering, soft wrap lighting with real falloff
  for (int c=0; c<2; c++){
    vec3 L = uCandle[c] - wp;
    float dl = length(L); L/=dl;
    float wrap = clamp((dot(N,L)+0.25)/1.25, 0.0, 1.0);
    float att = 1.0/(0.03 + dl*dl*1.7);
    col += albedo * vec3(1.0, 0.52, 0.2) * wrap*wrap * att * uFlick[c] * 0.62 * uCandleOn;
  }
  // pendant lamp above the table: only the tops of heads and shoulders
  { vec3 L = normalize(vec3(0.0, 1.95, -0.35) - wp);
    float wrap = clamp(dot(N,L), 0.0, 1.0);
    col += albedo * vec3(1.0, 0.68, 0.38) * wrap*wrap*wrap * 0.07 * roomL; }
  // cool night from the window: a thin rim on the edges that face it
  { vec3 Lw = normalize(vec3(0.0, 1.5, -3.2) - wp);
    float rim = pow(clamp(1.0 - nl.z, 0.0, 1.0), 6.0) * clamp(dot(N, Lw), 0.0, 1.0);
    col += vec3(0.3, 0.4, 0.62) * rim * 0.12 * roomL;
    col += albedo * vec3(0.05, 0.065, 0.1) * 0.12 * roomL; }
  // eyes and mouth: soft hollows, only where the face is the visible surface
  col *= mix(1.0, shade, wS);
  col += vec3(1.0, 0.8, 0.55) * catchL * wS * 0.35 * (uCandleOn + uOrbGlow);
  // the orb, when it exists, lights her from in front
  if (uOrbGlow > 0.001){
    vec3 L = uOrbP.xyz - wp; float dl = length(L); L/=dl;
    float wrap = clamp((dot(N,L)+0.3)/1.3, 0.0, 1.0);
    float rim = pow(clamp(1.0 - nl.z, 0.0, 1.0), 3.0);
    vec3 oc = vec3(1.0, 0.78, 0.55);
    col += (albedo*wrap*wrap*0.8 + oc*rim*wrap*0.2) * oc * uOrbGlow / (0.2 + dl*dl*2.0);
  }
  // skin sheen
  col += wS * pow(clamp(nl.z,0.0,1.0), 6.0) * 0.012 * roomL;
  col *= look.w;

  // leaving: they soften, warm, and thin into light
  float dis = look.x;
  if (dis > 0.001){
    col = mix(col, vec3(0.9, 0.5, 0.25) * 0.04 * look.y, dis*0.6);
    cov *= 1.0 - dis*0.55;
  }
  col = mix(col, vec3(0.02, 0.018, 0.022)*roomL, 1.0 - exp(-depth*0.06));
  float a = cov * look.z;
  return vec4(col*a, a);
}

// ------------------------------------------------------------ light sources
vec3 glowAt(vec3 ro, vec3 rd, vec3 p, float radius, vec3 col, float power){
  vec3 op = p - ro;
  float tt = dot(op, rd);
  if (tt < 0.0) return vec3(0);
  float d = length(op - rd*tt);
  float depth = dot(op, uCamFwd);
  // a defocused point spreads its light, it doesn't gain any
  float rr = radius + coc(depth)*0.5;
  float k = (radius*radius)/(rr*rr);
  return col * power * (exp(-d*d/(rr*rr)) * (0.3 + 0.7*k) + 0.04*exp(-d/(rr*2.0)) * k);
}

vec3 candle(vec3 ro, vec3 rd, int c, float on){
  vec3 base = uCandle[c] - vec3(0.0, 0.045, 0.0);
  vec3 fwd = uCamFwd, right = uCamRight, up = uCamUp;
  float t = dot(base - ro, fwd) / dot(rd, fwd);
  if (t < 0.0) return vec3(0);
  vec3 P = ro + rd*t;
  vec2 q = vec2(dot(P-base, right), dot(P-base, up));
  float depth = dot(base-ro, fwd);
  float blur = blurAt(depth);
  // wax
  float h = c==0 ? 0.13 : 0.09;
  vec2 qb = q - vec2(0.0, -h*0.5 - 0.005);
  float dB = max(abs(qb.x) - 0.022, abs(qb.y) - h*0.5);
  float wax = 1.0 - smoothstep(-blur, blur, dB);
  vec3 col = vec3(0.55, 0.42, 0.3) * wax * (0.25 + 0.75*smoothstep(-h, 0.0, q.y)) * 0.35 * on;
  // flame: a small teardrop, breathing with the flicker
  float fl = uFlick[c];
  vec2 qf = q - vec2(sin(uTime*7.0+float(c))*0.0015*fl, 0.018);
  qf.x *= 1.0 + 0.4*smoothstep(-0.01, 0.02, qf.y);
  float df = length(qf*vec2(1.0, 0.55)) - 0.0075*fl;
  float flame = 1.0 - smoothstep(-blur*0.8, blur*0.8+0.002, df);
  col += vec3(1.0, 0.72, 0.36) * flame * 3.2 * on;
  col += vec3(1.0, 0.95, 0.8) * (1.0 - smoothstep(0.0, 0.004 + blur*0.5, length(qf - vec2(0.0,-0.004)))) * 2.5 * on;
  return col;
}

vec3 orb(vec3 ro, vec3 rd){
  if (uOrbGlow < 0.001) return vec3(0);
  vec3 p = uOrbP.xyz;
  vec3 op = p - ro;
  float tt = dot(op, rd);
  if (tt < 0.0) return vec3(0);
  vec3 cp = ro + rd*tt;
  vec3 dv = cp - p;
  float d = length(dv);
  float depth = dot(op, uCamFwd);
  float r = uOrbP.w;
  float blur = blurAt(depth);
  vec2 q = vec2(dot(dv, uCamRight), dot(dv, uCamUp)) / max(r, 1e-4);
  float ang = atan(q.y, q.x);
  // amorphous edge: the light is never quite a sphere
  float wob = fbm(vec2(ang*1.6, uTime*0.35)) - 0.5;
  float rr = r * (1.0 + 0.22*wob + 0.06*sin(ang*3.0 + uTime*0.7));
  float core = 1.0 - smoothstep(-blur - rr*0.25, blur + rr*0.25, d - rr);
  float swirl = fbm(q*1.8 + vec2(uTime*0.12, -uTime*0.08));
  vec3 inner = mix(vec3(1.0, 0.62, 0.32), vec3(1.0, 0.94, 0.84), smoothstep(0.35, 0.8, swirl + (1.0-length(q))*0.4));
  vec3 col = inner * core * (1.1 + 1.0*uOrbPulse);
  float halo = exp(-d*d/(rr*rr*5.0))*0.3 + exp(-d/(rr*2.5))*0.07 + exp(-d/(rr*9.0))*0.004;
  col += vec3(1.0, 0.62, 0.34) * halo * (0.7 + 0.8*uOrbPulse);
  return col * uOrbGlow;
}

// ------------------------------------------------------------ environment
vec3 cityBokeh(vec2 w, float amount, float bsize){
  vec3 acc = vec3(0);
  for (int layer=0; layer<2; layer++){
    float sc = layer==0 ? 9.0 : 16.0;
    vec2 g = w*sc + float(layer)*13.7;
    vec2 id = floor(g);
    for (int oy=-1; oy<=1; oy++) for (int ox=-1; ox<=1; ox++){
      vec2 cid = id + vec2(ox, oy);
      float rnd = hash12(cid);
      if (rnd > 0.34) continue;
      vec2 c = cid + hash22(cid);
      float d = length(g - c);
      float rad = bsize*sc*(0.45 + 0.9*hash12(cid+3.1));
      float disc = 1.0 - smoothstep(rad*0.82, rad, d);
      float ring = exp(-pow((d - rad*0.9)/(rad*0.08+0.02), 2.0))*0.35;
      float warm = hash12(cid+7.7);
      vec3 col = warm < 0.6 ? vec3(1.0, 0.62, 0.3) : (warm < 0.85 ? vec3(1.0, 0.85, 0.65) : vec3(0.55, 0.7, 1.0));
      float tw = 0.75 + 0.25*sin(uTime*(0.3+hash12(cid+1.3)) + rnd*20.0);
      acc += col * (disc + ring*0.6) * (0.025 + 0.12*pow(hash12(cid+5.2), 2.0)) * tw / (1.0 + rad*rad*0.6);
    }
  }
  return acc * amount;
}

vec3 room(vec3 ro, vec3 rd){
  // back wall with the window
  float tw = (-2.95 - ro.z) / rd.z;
  vec3 col = vec3(0.0);
  if (tw > 0.0){
    vec3 P = ro + rd*tw;
    float depth = dot(P - ro, uCamFwd);
    float b = blurAt(depth);
    vec2 w = P.xy - vec2(0.0, 1.55);
    float win = (1.0 - smoothstep(-b, b, abs(w.x) - 1.35)) * (1.0 - smoothstep(-b, b, abs(w.y) - 0.72));
    float mull = 1.0 - (1.0 - smoothstep(0.012, 0.012 + b, abs(w.x)))*0.9;
    mull *= 1.0 - (1.0 - smoothstep(0.012, 0.012 + b, abs(w.y + 0.1)))*0.9;
    vec3 sky = mix(vec3(0.012, 0.02, 0.045), vec3(0.03, 0.035, 0.07), smoothstep(-0.7, 0.8, w.y));
    // city glow near the bottom of the window
    sky += vec3(0.09, 0.045, 0.02) * smoothstep(0.2, -0.75, w.y) * 0.5;
    float bsz = clamp(uAperture*1.4 * (22.0 - uFocus)/max(uFocus,0.1) * 0.05, 0.02, 0.09);
    vec3 cityL = cityBokeh(w + uCamPos.xy*0.02, 1.0, bsz) * smoothstep(0.55, -0.3, w.y);
    // a string of warm bulbs across the top
    vec3 bulbs = vec3(0);
    if (abs(w.y - 0.55) < 0.25 + b*3.0) for (int k=0; k<11; k++){
      float x = -1.25 + float(k)*0.25;
      float y = 0.58 - 0.07*cos((x/1.25)*1.57);
      float d = length(w - vec2(x, y));
      float rr = 0.004 + b*0.9;
      bulbs += vec3(1.0, 0.6, 0.26) * (1.0 - smoothstep(rr*0.8, rr, d)) * (0.25 / (1.0 + rr*40.0)) * (0.9 + 0.1*sin(uTime*1.3 + float(k)));
      bulbs += vec3(1.0, 0.55, 0.25) * exp(-d*d/(0.03*0.03)) * 0.06;
    }
    vec3 wall = vec3(0.04, 0.03, 0.025);
    // candlelight falloff on the wall
    wall *= 0.25 + 0.9*exp(-dot(w - vec2(0.0, -0.6), w - vec2(0.0, -0.6))*0.5);
    col = mix(wall, (sky + cityL)*mull, win) + bulbs;
  }
  // side walls, barely there
  float ts = ((rd.x > 0.0 ? 1.9 : -1.9) - ro.x) / rd.x;
  if (ts > 0.0 && ts < tw){
    vec3 P = ro + rd*ts;
    col = vec3(0.028, 0.021, 0.017) * (0.3 + 0.7*exp(-pow(P.y - 1.1, 2.0)*1.5)) * exp(-max(0.0, P.z - 0.5)*0.4);
  }
  return col;
}

// the mind: a deep, dimensional dark
vec3 voidSpace(vec3 ro, vec3 rd, vec2 uv){
  float up = rd.y;
  vec3 col = mix(vec3(0.002, 0.003, 0.006), vec3(0.004, 0.005, 0.011), smoothstep(-0.2, 0.5, up));
  // slow nebulous volumes, very low contrast
  vec2 sp = vec2(atan(rd.x, -rd.z)*1.3, up*2.2);
  float n1 = fbm(sp*1.6 + vec2(uTime*0.012, 0.0));
  float n2 = fbm(sp*3.1 - vec2(0.0, uTime*0.02) + n1);
  col += vec3(0.03, 0.026, 0.045) * pow(n2, 2.6) * 0.8;
  col += vec3(0.05, 0.028, 0.015) * pow(n1, 3.0) * 0.6 * (1.0 - uDark);
  // light leaks drifting at the edges of vision
  float lk = exp(-pow((uv.x + 1.25 + 0.2*sin(uTime*0.05))/0.5, 2.0)) * (0.5 + 0.5*sin(uTime*0.11 + uv.y));
  float lk2 = exp(-pow((uv.x - 1.35 - 0.2*cos(uTime*0.04))/0.6, 2.0)) * (0.5 + 0.5*cos(uTime*0.09));
  col += vec3(0.07, 0.03, 0.012) * lk * 0.35 + vec3(0.015, 0.03, 0.05) * lk2 * 0.35;
  // the horizon: the faintest seam where the mirror meets the dark
  col += vec3(0.012, 0.01, 0.016) * exp(-pow((rd.y + 0.003)/0.012, 2.0)) * 0.5;
  col *= mix(1.0, 0.55, smoothstep(0.0, 0.5, up));
  return col * (1.0 - 0.8*uDark);
}

// dust in the air: particle planes at several depths, with depth of field
vec3 motes(vec3 ro, vec3 rd, float amount){
  if (amount < 0.001) return vec3(0);
  vec3 acc = vec3(0);
  for (int l=0; l<3; l++){
    float dz = 0.9 + float(l)*1.8;
    float t = dz / max(dot(rd, uCamFwd), 1e-3);
    vec3 P = ro + rd*t;
    vec2 q = vec2(dot(P, uCamRight), dot(P, uCamUp));
    q += vec2(sin(uTime*0.05 + float(l)), uTime*(0.012 + 0.006*float(l)));
    float cell = 0.16;
    vec2 g = q/cell;
    vec2 id = floor(g);
    float b = blurAt(dz)/cell;
    for (int oy=-1; oy<=1; oy++) for (int ox=-1; ox<=1; ox++){
      vec2 cid = id + vec2(ox, oy) + float(l)*17.0;
      if (hash12(cid) > 0.35) continue;
      vec2 c = cid - float(l)*17.0 + hash22(cid);
      c += 0.3*vec2(sin(uTime*0.3 + hash12(cid)*6.0), cos(uTime*0.23 + hash12(cid+2.0)*6.0));
      float d = length(g - c);
      float rr = 0.02 + b;
      acc += vec3(1.0, 0.8, 0.6) * exp(-d*d/(rr*rr)) * (0.02/(rr*rr*60.0+0.25)) * (0.4 + 0.6*hash12(cid+4.0));
    }
  }
  return acc * amount;
}

// --------------------------------------------------------- interpretations
float sdBox2(vec2 p, vec2 b){ vec2 d = abs(p)-b; return length(max(d,0.0)) + min(max(d.x,d.y),0.0); }
float sdCirc(vec2 p, float r){ return length(p)-r; }
float sdBust(vec2 p, float facing){
  // head, a hint of face, neck, and wide sloping shoulders
  float h = length((p - vec2(0.0, 0.105))/vec2(0.043, 0.052)) - 1.0; h *= 0.045;
  h = min(h, sdCirc(p - vec2(0.03*facing, 0.09), 0.028));
  float nk = sdBox2(p - vec2(0.0, 0.04), vec2(0.018, 0.03));
  float sh = length((p - vec2(0.0, -0.045))/vec2(0.13, 0.065)) - 1.0; sh *= 0.065;
  sh = max(sh, -(p.y + 0.07));
  return min(min(h, nk), sh);
}
float shapeSDF(vec2 p, float kind){
  if (kind < 0.5){
    // a tulip: cup of three petals on a curved stem
    float stem = abs(p.x - 0.02*sin(p.y*8.0)) - 0.004;
    stem = max(stem, abs(p.y + 0.12) - 0.13);
    float cup = length((p - vec2(0.0, 0.07))/vec2(0.075, 0.07)) - 1.0;
    cup = max(cup*0.07, -(p.y - 0.12 + 0.03*cos(p.x*60.0)));
    float leaf = length((p - vec2(0.045, -0.1))*mat2(0.8,-0.6,0.6,0.8)/vec2(0.065, 0.018)) - 1.0;
    return min(min(stem, cup), leaf*0.018);
  } else if (kind < 1.5){
    // three leaning together, one a little apart
    float d = sdBust(p - vec2(-0.12, 0.0), 1.0);
    d = min(d, sdBust(p - vec2(0.0, 0.02), 0.0));
    d = min(d, sdBust(p - vec2(0.12, 0.0), -1.0));
    d = min(d, sdBust((p - vec2(0.36, -0.03))*1.15, -1.0)/1.15);
    return d;
  } else if (kind < 2.5){
    // a lit doorway, three inside, one outside
    float door = abs(sdBox2(p - vec2(-0.05, 0.02), vec2(0.13, 0.22))) - 0.004;
    float d = min(door, sdBust((p - vec2(-0.1, -0.08))*1.8, 1.0)/1.8);
    d = min(d, sdBust((p - vec2(-0.03, -0.07))*1.8, 0.0)/1.8);
    d = min(d, sdBust((p - vec2(0.03, -0.08))*1.8, -1.0)/1.8);
    d = min(d, sdBust((p - vec2(0.3, -0.12))*1.4, -1.0)/1.4);
    return d;
  }
  // herself: a large profile
  return sdBust((p - vec2(0.05, -0.05))*0.75, 1.0)/0.75;
}

vec3 interpretation(vec3 ro, vec3 rd){
  if (uIForm < 0.001) return vec3(0);
  vec3 C = uIPos.xyz;
  float t = dot(C - ro, uCamFwd) / dot(rd, uCamFwd);
  if (t < 0.0) return vec3(0);
  vec3 P = ro + rd*t;
  vec2 q = vec2(dot(P - C, uCamRight), dot(P - C, uCamUp)) / uIPos.w;
  float depth = dot(C - ro, uCamFwd);
  // particles gather from a scattered cloud, then are blown apart. The field
  // is kept smooth (no folding) so the shape reads cleanly once formed.
  float br = uIBreak;
  float loose = (1.0 - uIForm)*(1.0 - uIForm);
  vec2 disp = (vec2(vnoise(q*1.4 + 1.3), vnoise(q*1.4 + 7.1)) - 0.5) * loose * 0.6;
  disp += q * br * br * 1.3 + vec2(0.0, -0.22*br*br);
  disp += (vec2(vnoise(q*2.2 + br*2.0), vnoise(q*2.2 + 5.0 - br*2.0)) - 0.5) * br * 0.25;
  vec2 home = q - disp;
  float cell = 0.0105;
  vec2 g = home / cell;
  vec2 id = floor(g);
  vec3 acc = vec3(0);
  float pxs = pixelSize(depth) / uIPos.w / cell;
  for (int oy=-1; oy<=1; oy++) for (int ox=-1; ox<=1; ox++){
    vec2 cid = id + vec2(ox, oy);
    vec2 hp = (cid + hash22(cid)) * cell;
    float sd = shapeSDF(hp, uIKind);
    float inside = 1.0 - smoothstep(-0.004, 0.006, sd);
    float edge = exp(-pow(sd/0.006, 2.0));
    float on = max(inside*0.45, edge) * step(hash12(cid + 2.0), 0.85);
    if (on < 0.01) continue;
    float d = length(g - (cid + hash22(cid)));
    float rr = 0.18 + pxs;
    float tw = 0.6 + 0.4*sin(uTime*2.0 + hash12(cid)*30.0);
    acc += vec3(1.0, 0.82, 0.62) * on * exp(-d*d/(rr*rr)) * tw / (1.0 + rr*rr*4.0) * 0.55;
  }
  float fade = uIForm * (1.0 - smoothstep(0.35, 1.0, br));
  float fill = (1.0 - smoothstep(-0.01, 0.03, shapeSDF(q - disp, uIKind))) * 0.025 * (1.0 - br);
  return (acc + vec3(1.0, 0.7, 0.45) * fill) * fade * (1.0 + 0.8*exp(-br*6.0)*step(0.001, br));
}

// ---------------------------------------------------------------- thoughts
float textSample(sampler2D tx, vec2 uv){
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return texture(tx, uv).r;
}

// screen-space placement with emergence and dissolution
vec3 thoughtScreen(sampler2D tx, vec4 T, vec4 Tp, vec2 uv, float asp){
  // Tp: x, y centre in [-asp..asp, -1..1], z = height, w = tint mix
  vec2 p = (uv - Tp.xy) / Tp.z;
  vec2 tuv = vec2(p.x / 8.0 + 0.5, 0.5 - p.y);
  float rev = T.y, brk = T.z;
  // letters drift apart and upward as the thought breaks
  vec2 n = vec2(fbm3(tuv*vec2(30.0, 6.0) + 3.0), fbm3(tuv*vec2(30.0, 6.0) + 9.0)) - 0.5;
  vec2 off = n * brk * vec2(0.08, 0.5) + vec2(0.0, -brk*brk*0.35) * (0.5 + hash12(floor(tuv*vec2(120.0, 8.0))));
  float blurx = (1.0 - rev) * 0.004 + brk*0.003;
  float a = 0.0;
  a += textSample(tx, tuv + off);
  a += textSample(tx, tuv + off + vec2(blurx, 0.0));
  a += textSample(tx, tuv + off - vec2(blurx, 0.0));
  a /= 3.0;
  // emerge from noise, crumble into noise
  float nz = vnoise(tuv*vec2(260.0, 40.0));
  float m = smoothstep(1.0 - rev*1.15, 1.0 - rev*1.15 + 0.15, nz) * (1.0 - smoothstep(1.0 - brk*1.1 - 0.1, 1.0 - brk*1.1, nz));
  vec3 tint = mix(vec3(1.0, 0.88, 0.74), vec3(0.88, 0.9, 0.98), Tp.w);
  return tint * a * m * T.w;
}

vec3 thought(int slot, vec2 uv, float asp){
  vec4 T = slot == 0 ? uT0 : uT1;
  if (T.w < 0.001) return vec3(0);
  vec4 Tp = slot == 0 ? uT0p : uT1p;
  if (slot == 0) return thoughtScreen(uTxt0, T, Tp, uv, asp);
  return thoughtScreen(uTxt1, T, Tp, uv, asp);
}

// text lying on the mirror: sampled in table-plane coordinates, flipped
float thoughtOnPlane(int slot, vec2 xz){
  vec4 T = slot == 0 ? uT0 : uT1;
  vec4 Tp = slot == 0 ? uT0p : uT1p;
  // Tp: x, z centre on the plane, width in metres, rotation
  vec2 p = xz - Tp.xy;
  float cs = cos(Tp.w), sn = sin(Tp.w);
  p = mat2(cs, -sn, sn, cs) * p;
  vec2 tuv = vec2(p.x / Tp.z + 0.5, 0.5 + p.y / (Tp.z/(T.x < 1.5 ? 5.0 : 8.0)) * 0.5);
  float a = slot == 0 ? textSample(uTxt0, tuv) : textSample(uTxt1, tuv);
  float nz = vnoise(tuv*vec2(200.0, 30.0));
  float m = smoothstep(1.0 - T.y*1.15, 1.0 - T.y*1.15 + 0.15, nz) * (1.0 - smoothstep(1.0 - T.z*1.1 - 0.1, 1.0 - T.z*1.1, nz));
  return a * m * T.w;
}

// ------------------------------------------------------------------- table
vec3 tableSurface(vec3 ro, vec3 rd, out float tdepth, out float tcov, out vec3 reflDir, out vec3 tP){
  tdepth = 1e9; tcov = 0.0; reflDir = vec3(0); tP = vec3(0);
  if (rd.y >= -1e-4) return vec3(0);
  float t = (TABLE_Y - ro.y) / rd.y;
  if (t < 0.0) return vec3(0);
  vec3 P = ro + rd*t;
  tP = P;
  float depth = dot(P - ro, uCamFwd);
  float b = blurAt(depth);
  // the table grows into an endless mirror as the room lets go
  float grow = smoothstep(0.5, 1.0, uMind);
  vec2 half_ = mix(vec2(0.5, 1.6), vec2(80.0, 120.0), grow*grow);
  vec2 ctr = vec2(0.0, -0.3);
  float dT = sdBox2(P.xz - ctr, half_);
  float cov = 1.0 - smoothstep(-b, b, dT);
  if (cov < 0.001) return vec3(0);
  tdepth = depth; tcov = cov;

  // ripples: sound disturbs the surface
  vec2 rp = P.xz - uOrbP.xz;
  float rdist = length(rp);
  float wave = sin(rdist*38.0 - uTime*2.2) * exp(-rdist*1.2) * (0.004 + 0.02*uVoices) * uMind;
  vec2 grain = vec2(vnoise(P.xz*vec2(3.0, 40.0)), vnoise(P.xz*vec2(3.0, 40.0)+5.0)) - 0.5;
  vec3 N = normalize(vec3(grain.x*0.03*(1.0-uMind) + rp.x/max(rdist,1e-3)*wave, 1.0, grain.y*0.012*(1.0-uMind) + rp.y/max(rdist,1e-3)*wave));
  vec3 R = reflect(rd, N);
  reflDir = R;
  float fres = 0.04 + 0.96*pow(1.0 - clamp(-rd.y, 0.0, 1.0), 5.0);

  // walnut in candlelight
  float wood = fbm3(P.xz*vec2(1.5, 26.0));
  vec3 albedo = mix(vec3(0.06, 0.03, 0.017), vec3(0.11, 0.06, 0.03), wood) * (1.0 - uMind);
  vec3 col = vec3(0);
  for (int c=0; c<2; c++){
    vec3 L = uCandle[c] - P; float dl = length(L);
    col += albedo * vec3(1.0, 0.56, 0.24) * (L.y/dl) / (0.05 + dl*dl*1.6) * uFlick[c] * 0.5 * uCandleOn;
  }
  col += albedo * vec3(1.0, 0.7, 0.42) * 0.12 * uRoom;
  // reflections of the flames, stretched along the grain
  vec3 refl = vec3(0);
  for (int c=0; c<2; c++){
    vec3 op = uCandle[c] + vec3(0.0, 0.018, 0.0) - P;
    vec3 od = normalize(op);
    float cosA = dot(R, od);
    float ang = acos(clamp(cosA, -1.0, 1.0));
    float rough = mix(0.035, 0.006, uMind);
    refl += vec3(1.0, 0.62, 0.3) * exp(-ang*ang/(rough*rough)) * 0.9 * uFlick[c] * uCandleOn;
  }
  // mirror: the orb and the distant lights
  if (uOrbGlow > 0.001) refl += orb(P + N*0.001, R) * mix(0.25, 0.8, uMind);
  for (int k=0; k<4; k++){
    if (uFar[k].w < 0.001) continue;
    vec3 op = uFar[k].xyz - P;
    vec3 od = normalize(op);
    vec3 dd = R - od;
    // stretched vertically, like lights on water
    float s = exp(-(dd.x*dd.x + dd.z*dd.z)/(0.0004) - dd.y*dd.y/(0.01));
    refl += vec3(1.0, 0.64, 0.34) * s * uFar[k].w * 0.9;
  }
  vec3 mirrorCol = mix(vec3(0.004, 0.005, 0.009), vec3(0.0), uDark);
  col += mirrorCol * uMind;
  col += refl * fres * mix(0.45, 1.0, uMind);
  // the near edge of the table catches a line of light
  float edge = exp(-pow((P.z - 1.3)/0.004, 2.0)) * (1.0 - uMind);
  col += vec3(0.25, 0.14, 0.07) * edge * 0.2;
  return col;
}

vec3 glasses(vec3 ro, vec3 rd){
  vec3 acc = vec3(0);
  for (int k=0; k<5; k++){
    vec4 G = uGlass[k];
    if (G.w < 0.001) continue;
    vec3 c = G.xyz;
    float t = dot(c - ro, uCamFwd) / dot(rd, uCamFwd);
    if (t < 0.0) continue;
    vec3 P = ro + rd*t;
    vec2 q = vec2(dot(P - c, uCamRight), dot(P - c, uCamUp));
    float depth = dot(c - ro, uCamFwd);
    float b = blurAt(depth);
    // glass is mostly invisible: two vertical glints, a thread of rim, dark wine
    vec2 bq = (q - vec2(0.0, 0.112))/vec2(0.036, 0.046);
    float bowl = length(bq) - 1.0;
    float inside = 1.0 - smoothstep(-b*25.0, b*25.0 + 0.02, bowl);
    float rimL = exp(-pow(bowl/(0.04 + b*30.0), 2.0)) * 0.035;
    float streak = exp(-pow((abs(bq.x) - 0.72)/(0.06 + b*25.0), 2.0)) * smoothstep(-0.9, 0.2, bq.y) * (1.0 - smoothstep(0.2, 0.8, bq.y)) * inside;
    float wine = inside * smoothstep(0.05, -0.1, bq.y);
    float stem = (1.0 - smoothstep(-b, b, abs(q.x) - 0.0025)) * step(0.0, q.y) * step(q.y, 0.066) * 0.02;
    vec2 hl = q - vec2(-0.014, 0.124);
    float spec = exp(-dot(hl, hl)/(0.000012 + b*b)) * 0.7 * 0.000012/(0.000012 + b*b);
    acc += (vec3(1.0, 0.78, 0.55)*(rimL + streak*0.09 + spec + stem) + vec3(0.5, 0.08, 0.05)*wine*0.03) * G.w;
  }
  return acc;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  float asp = uRes.x / uRes.y;
  vec2 uv = (frag / uRes) * 2.0 - 1.0;
  uv.x *= asp;
  vec3 fwd = uCamFwd, right = uCamRight, up = uCamUp;
  vec3 ro = uCamPos;
  vec3 rd = normalize(fwd + (uv.x*right + uv.y*up) * uTanHalf);

  // ---------------------------------------------------------- background
  vec3 col = vec3(0);
  float roomVis = 1.0 - smoothstep(0.0, 0.8, uMind);
  if (roomVis > 0.001){
    vec3 rc = room(ro, rd);
    // the room goes from the edges of her vision inward, and comes back
    // outward from the light
    float keep = 1.0;
    if (uMind > 0.001){
      float n = 1.0 - length(uv - uOrbScr)/2.6 + 0.18*(fbm(uv*2.2 + uTime*0.02) - 0.5);
      keep = smoothstep(uMind*1.3 - 0.2, uMind*1.3 + 0.05, n);
    }
    col += rc * keep * uRoom;
  }
  if (uMind > 0.15) col += voidSpace(ro, rd, uv) * smoothstep(0.15, 0.9, uMind);

  // ------------------------------------------------ figures, back to front
  float fd[NCH]; vec4 f[NCH];
  for (int i=0; i<NCH; i++){ f[i] = figure(i, ro, rd, fwd, right, up, fd[i]); }

  // Noor at the far end sits behind the table
  col = col*(1.0 - f[4].a) + f[4].rgb;

  float tdepth, tcov; vec3 R, tP;
  vec3 tcol = tableSurface(ro, rd, tdepth, tcov, R, tP);
  // thoughts that live on the table / the mirror
  vec3 tt = vec3(0);
  for (int s=0; s<2; s++){
    vec4 T = s==0 ? uT0 : uT1;
    if (T.w > 0.001 && (T.x > 0.5 && T.x < 1.5 || T.x > 5.5 && T.x < 6.5)){
      float a = thoughtOnPlane(s, tP.xz);
      tt += vec3(1.0, 0.82, 0.62) * a * 0.9;
    }
  }
  tcol += tt * tcov;
  if (uMind > 0.02 && tcov > 0.001){
    // her reflection in the mirror
    float rdep; vec4 rf = figure(0, tP + vec3(0.0, 0.0005, 0.0), R, fwd, right, up, rdep);
    tcol = tcol*(1.0 - rf.a*0.85*uMind) + rf.rgb*0.35*uMind;
  }
  if (uMind > 0.001 && tcov > 0.001){
    float n = 1.0 - length(uv - uOrbScr)/2.6 + 0.18*(fbm(uv*2.2 + 3.0) - 0.5);
    float keepT = mix(1.0, smoothstep(uMind*1.3 - 0.2, uMind*1.3 + 0.05, n), 1.0 - smoothstep(0.55, 0.9, uMind));
    tcov *= max(keepT, smoothstep(0.5, 0.9, uMind));
  }
  col = col*(1.0 - tcov) + tcol*tcov;

  // candles and glasses in the middle distance
  col += candle(ro, rd, 1, uCandleOn) * uRoom;
  // the far ones: Rafa, Bia
  if (fd[2] > fd[3]){ col = col*(1.0 - f[2].a) + f[2].rgb; col = col*(1.0 - f[3].a) + f[3].rgb; }
  else { col = col*(1.0 - f[3].a) + f[3].rgb; col = col*(1.0 - f[2].a) + f[2].rgb; }
  col += glasses(ro, rd) * max(uRoom, 0.0);
  col += candle(ro, rd, 0, uCandleOn * (1.0 - smoothstep(0.1, 0.5, uMind)));
  col = col*(1.0 - f[1].a) + f[1].rgb;

  // distant lights: what the others have become
  for (int k=0; k<4; k++){
    if (uFar[k].w > 0.001){
      col += glowAt(ro, rd, uFar[k].xyz, 0.05, vec3(1.0, 0.64, 0.34), uFar[k].w);
    }
  }
  col += motes(ro, rd, smoothstep(0.2, 1.0, uMind) * (1.0 - 0.7*uDark) + 0.25*uRoom*(1.0-uMind));
  col += interpretation(ro, rd);
  col += orb(ro, rd);

  // Sam, nearest
  col = col*(1.0 - f[0].a) + f[0].rgb;

  // everything sinks together into the dark; only the ember and her words survive
  col *= 1.0 - 0.9*uDark;
  col += orb(ro, rd) * uDark * 0.9;

  // thoughts in screen space
  for (int s=0; s<2; s++){
    vec4 T = s==0 ? uT0 : uT1;
    if (T.w > 0.001 && !(T.x > 0.5 && T.x < 1.5 || T.x > 5.5 && T.x < 6.5)) col += thought(s, uv, asp);
  }

  col *= uFade;
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

SHADERS.down = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThresh;
void main(){
  vec3 c = vec3(0);
  c += texture(uTex, vUv + uTexel*vec2(-1,-1)).rgb;
  c += texture(uTex, vUv + uTexel*vec2( 1,-1)).rgb;
  c += texture(uTex, vUv + uTexel*vec2(-1, 1)).rgb;
  c += texture(uTex, vUv + uTexel*vec2( 1, 1)).rgb;
  c *= 0.25;
  if (uThresh > 0.0){ float l = max(c.r, max(c.g, c.b)); c *= smoothstep(uThresh, uThresh*2.5, l); }
  o = vec4(c, 1.0);
}`;

SHADERS.up = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform sampler2D uPrev; uniform vec2 uTexel; uniform float uMix;
void main(){
  vec3 c = vec3(0);
  c += texture(uTex, vUv + uTexel*vec2(-1, 0)).rgb*0.25;
  c += texture(uTex, vUv + uTexel*vec2( 1, 0)).rgb*0.25;
  c += texture(uTex, vUv + uTexel*vec2( 0,-1)).rgb*0.25;
  c += texture(uTex, vUv + uTexel*vec2( 0, 1)).rgb*0.25;
  o = vec4(texture(uPrev, vUv).rgb + c*uMix, 1.0);
}`;

SHADERS.final = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uScene, uBloom, uTitle;
uniform vec2 uRes;           // output canvas size
uniform vec4 uBox;           // active picture area: x, y, w, h (pixels)
uniform float uTime, uGrain, uBloomAmt, uWarm, uHeart, uTitleA, uVignette, uExposure;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
void main(){
  vec2 px = gl_FragCoord.xy;
  vec2 lp = (px - uBox.xy) / uBox.zw;
  if (lp.x < 0.0 || lp.x > 1.0 || lp.y < 0.0 || lp.y > 1.0){ o = vec4(0,0,0,1); return; }
  vec2 c = lp - 0.5;
  // a trace of lens: colour fringing toward the edges
  float ca = 0.0005 * dot(c, c) * 4.0;
  vec3 col;
  col.r = texture(uScene, lp + c*ca).r;
  col.g = texture(uScene, lp).g;
  col.b = texture(uScene, lp - c*ca).b;
  vec3 bl = texture(uBloom, lp).rgb;
  col += bl * uBloomAmt;
  // halation: highlights bleed warm into the dark around them
  col += bl * vec3(0.35, 0.08, 0.02) * uBloomAmt * 0.8;
  col *= uExposure;
  // grade: warm highlights, cooler shadows
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col * vec3(0.92, 0.97, 1.08), col * vec3(1.06, 0.98, 0.9), smoothstep(0.0, 0.25, l) * uWarm);
  col = aces(col * 1.35);
  // vignette, breathing faintly with the heart
  float v = smoothstep(0.95, 0.25, length(c * vec2(1.0, 0.72)) * (1.0 + uHeart*0.06));
  col *= mix(1.0, v, uVignette);
  col = pow(col, vec3(1.0/2.2));
  // titles
  float ta = texture(uTitle, vec2(lp.x, 1.0 - lp.y)).r;
  col = mix(col, vec3(0.88, 0.86, 0.82), ta * uTitleA);
  // grain: fine, luma-weighted, alive
  float g = hash12(px + fract(uTime*37.13)*vec2(311.7, 157.3)) + hash12(px*1.7 + fract(uTime*11.1)*vec2(71.3, 19.9));
  g = (g - 1.0) * uGrain;
  float ld = dot(col, vec3(0.3333));
  col += g * (0.018 + 0.05*sqrt(max(ld, 0.0)));
  // black stays deep, never flat: a hair of blue in the floor
  col = max(col, vec3(0.0)) + vec3(0.002, 0.003, 0.006);
  o = vec4(col, 1.0);
}`;
