#!/bin/sh
# Собирает папку программы (новую, пустую): файлы сайта + main.js/preload.js/package.json
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=$1
if [ -z "$OUT" ] || [ -e "$OUT" ]; then echo "Укажите новую (несуществующую) папку"; exit 1; fi
mkdir -p "$OUT"
cp -r "$ROOT/index.html" "$ROOT/css" "$ROOT/js" "$ROOT/icons" "$OUT/"
cp "$ROOT/desktop/main.js" "$ROOT/desktop/preload.js" "$ROOT/desktop/package.json" "$OUT/"
# только для программы: панель вкладок, избранное, история, синхронизация (сайт их не получает)
cp "$ROOT/desktop/ui.js" "$OUT/js/ui.js"
cp "$ROOT/desktop/pager.js" "$OUT/js/pager.js"
cp "$ROOT/desktop/ui.css" "$OUT/css/ui.css"
node "$ROOT/desktop/patch.js" "$OUT/js/app.js"
sed -i 's#<link rel="stylesheet" href="css/style.css">#<link rel="stylesheet" href="css/style.css">\n<link rel="stylesheet" href="css/ui.css">#' "$OUT/index.html"
sed -i 's#</body>#<script src="js/ui.js"></script>\n<script src="js/pager.js"></script>\n</body>#' "$OUT/index.html"
grep -q 'js/ui.js' "$OUT/index.html" || { echo "stage.sh: не удалось подключить ui.js"; exit 1; }
# версия программы (может обгонять версию сайта): подставляем в копию для программы, сайт не меняется
V=$(sed -n 's/.*"version": *"\([0-9.]*\)".*/\1/p' "$ROOT/desktop/package.json")
sed -i "s/Мое_граббер [0-9.]*<\/small>/Мое_граббер $V<\/small>/; s/<!-- Мое_граббер [0-9.]* -->/<!-- Мое_граббер $V -->/" "$OUT/index.html"
sed -i "s/var VERSION = '[0-9.]*';/var VERSION = '$V';/" "$OUT/js/app.js"
echo "$OUT"
