#!/bin/sh
# Собирает папку программы (новую, пустую): файлы сайта + main.js/preload.js/package.json
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$1
if [ -z "$OUT" ] || [ -e "$OUT" ]; then echo "Укажите новую (несуществующую) папку"; exit 1; fi
mkdir -p "$OUT"
cp -r "$ROOT/index.html" "$ROOT/css" "$ROOT/js" "$ROOT/icons" "$OUT/"
cp "$ROOT/desktop/main.js" "$ROOT/desktop/preload.js" "$ROOT/desktop/package.json" "$OUT/"
echo "$OUT"
