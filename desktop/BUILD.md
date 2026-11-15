# Сборка Мое_граббер для Windows

Программа = файлы сайта + `main.js`, `preload.js`, `package.json` поверх Electron (win32-x64).

1. Скачать `electron-vX-win32-x64.zip` с https://github.com/electron/electron/releases и распаковать в новую папку `Moe_grabber_vX.Y.Z`.
2. `electron.exe` → `Moe_grabber.exe`; в `locales` оставить `ru.pak` и `en-US.pak`; удалить `resources/default_app.asar`.
3. `desktop/stage.sh <папка>/resources/app` — кладёт сайт и файлы программы.
4. Иконка и сведения о версии: `node desktop/setexe.js <папка>/Moe_grabber.exe icon.ico X.Y.Z` (нужен пакет `resedit`).
5. Положить «Как запустить.txt», упаковать папку в `Moe_grabber_vX.Y.Z_Windows.zip`.

Архив больше 100 МБ, поэтому в «Мое_сайты» (ветка archives) он хранится через Git LFS.
