# Still Here

*A short animated film about the moment a table changes language.*
**2 min 42 s · 2.39:1 · stereo · best with headphones, in the dark**

Five friends at dinner. Everyone is speaking English. Then, without anyone
deciding to, three of them aren't. Nothing bad happens and nobody is unkind,
but for Sam the room begins to fall away: consonants go first, then faces, then
the walls. She is left alone in the dark with one small light, trying to build
meaning out of a laugh, a glance, and her own name inside a sentence she can't
follow.

- **Watch:** `out/still-here.mp4`
- **Or run it live:** open `film/index.html` in a desktop browser with WebGL2 and
  press *Begin*. The picture is generated in real time on your GPU and plays
  against `film/soundtrack.mp3`. Space pauses; ← → skip 5 s.
- **Read it:** [`SCREENPLAY.md`](SCREENPLAY.md) has the script, what each moment is
  for, and the Portuguese dialogue with translations. The film itself never
  translates it.

## How it is made

Everything is procedural. There is no stock footage, no samples and no
recorded music.

| | |
|---|---|
| `audio/script.py` | The screenplay as data: every line, laugh and inner thought. |
| `audio/tts.py` | Voices from [Kokoro-82M](https://github.com/thewh1teagle/kokoro-onnx) running on CPU. A few words are fixed at the phoneme level, e.g. Sam's name inside Portuguese. |
| `audio/laughter.py` | Laughter synthesised from a glottal source through vocal-tract formants, with a different voice for each character. |
| `audio/foley.py` | Room tone, glass, cutlery, clothing, heartbeat, breath. |
| `audio/score.py` | Additive drones, bowed-glass tones, and the dialogue paulstretched and comb-tuned into a choir. |
| `audio/mix.py` | Lays out the scene and runs every voice through a time-varying "hearing" filter driven by the *clarity* curve. Writes `build/soundtrack.wav` and the cue sheet `film/cues.js`, whose curves and envelopes drive the picture. |
| `film/shaders.js` | WebGL2: a small splat renderer for the figures (capsules with soft depth ordering, rim and candle light, depth of field done in the SDFs), the room, the mirror, the orb, particle "interpretations", and thoughts that surface and crumble. |
| `film/film.js` | The director: shots and lenses, gaze (who looks at whom, and who stops checking on Sam), performance from the voice envelopes, and the transitions. |
| `render/render.js` | Offline render in headless Chromium, encoded with ffmpeg in resumable 10-second segments. |

### Rebuild

```bash
pip install numpy scipy soundfile kokoro-onnx pyloudnorm imageio-ffmpeg
mkdir -p build/models && cd build/models
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
cd ../..
python3 audio/mix.py                         # soundtrack + cue sheet (about 1 min)
npm install
node render/stills.js build/stills 30 80 142 # a few frames to look at
node render/render.js                        # the film: build/still-here-master.mp4
render/deliver.sh                            # shareable encode: out/still-here.mp4
```

On a machine without a GPU, Chromium falls back to SwiftShader and each 1080p
frame takes about 4 seconds (the released film took 4 h 13 min on 4 CPU cores).
With a GPU, the same page runs in real time.

## Credits

Written, designed, scored and rendered procedurally with Claude Code.
Voices: Kokoro-82M (Apache-2.0). Type: Cormorant Garamond and Jost (SIL Open
Font License). Everything else was synthesised for this film.
