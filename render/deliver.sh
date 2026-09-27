#!/usr/bin/env bash
# Make the shareable file (out/still-here.mp4, kept under GitHub's 100 MB limit)
# from the high-quality master that render.js writes.
set -euo pipefail
cd "$(dirname "$0")/.."
FF=${FFMPEG:-$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")}
IN=build/still-here-master.mp4
OUT=out/still-here.mp4
VBR=${VBR:-3900k}
mkdir -p out build/pass
"$FF" -y -loglevel error -i "$IN" -c:v libx264 -preset slow -tune grain -b:v "$VBR" -maxrate 9M -bufsize 12M \
  -pix_fmt yuv420p -pass 1 -passlogfile build/pass/x264 -an -f mp4 /dev/null
"$FF" -y -loglevel error -i "$IN" -c:v libx264 -preset slow -tune grain -b:v "$VBR" -maxrate 9M -bufsize 12M \
  -pix_fmt yuv420p -pass 2 -passlogfile build/pass/x264 -c:a aac -b:a 256k \
  -metadata title="Still Here" -movflags +faststart "$OUT"
ls -la "$OUT"
