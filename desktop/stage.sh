#!/bin/sh
# Собирает папку программы (новую, пустую): файлы сайта + main.js/preload.js/package.json
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$1
if [ -z "$OUT" ] || [ -e "$OUT" ]; then echo "Укажите новую (несуществующую) папку"; exit 1; fi
mkdir -p "$OUT"
cp -r "$ROOT/index.html" "$ROOT/css" "$ROOT/js" "$ROOT/icons" "$OUT/"
cp "$ROOT/desktop/main.js" "$ROOT/desktop/preload.js" "$ROOT/desktop/package.json" "$OUT/"
# версия программы (может обгонять версию сайта): подставляем в копию для программы, сайт не меняется
V=$(sed -n 's/.*"version": *"\([0-9.]*\)".*/\1/p' "$ROOT/desktop/package.json")
sed -i "s/Мое_граббер [0-9.]*<\/small>/Мое_граббер $V<\/small>/; s/<!-- Мое_граббер [0-9.]* -->/<!-- Мое_граббер $V -->/" "$OUT/index.html"
sed -i "s/var VERSION = '[0-9.]*';/var VERSION = '$V';/" "$OUT/js/app.js"
echo "$OUT"
