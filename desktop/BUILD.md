# Сборка Мое_граббер для Windows

Программа = файлы сайта + `main.js`, `preload.js`, `package.json` поверх Electron (win32-x64).

1. Скачать `electron-vX-win32-x64.zip` с https://github.com/electron/electron/releases и распаковать в новую папку `Moe_grabber_vX.Y.Z`.
2. `electron.exe` → `Moe_grabber.exe`; в `locales` оставить `ru.pak` и `en-US.pak`; удалить `resources/default_app.asar`.
3. `desktop/stage.sh <папка>/resources/app` — кладёт сайт и файлы программы.
4. Иконка и сведения о версии: `node desktop/setexe.js <папка>/Moe_grabber.exe icon.ico X.Y.Z` (нужен пакет `resedit`).
5. Положить «Как запустить.txt», упаковать папку в `Moe_grabber_vX.Y.Z_Windows.zip`.

Архив больше 100 МБ, поэтому в «Мое_сайты» (ветка archives) он хранится через Git LFS.

## Автообновление (с 1.8.0)

Программа читает манифест `https://drakkkkon.github.io/maymani/updates/grabber.json` (файл `updates/grabber.json` в ветке `main` репозитория Drakkkkon/maymani):

```json
{ "app": "Мое_граббер", "version": "X.Y.Z", "date": "…", "electron": "45.3.2",
  "notes": ["что нового…"],
  "app_zip":  { "url": "https://github.com/Drakkkkon/maymani/raw/archives/grabber/Moe_grabber_app_vX.Y.Z.zip", "size": 0, "sha256": "…" },
  "full_zip": { "url": "https://github.com/Drakkkkon/maymani/raw/archives/grabber/Moe_grabber_vX.Y.Z_Windows.zip", "size": 0, "sha256": "…" } }
```

Выпуск новой версии:
1. Поднять `version` в `desktop/package.json`, собрать папку программы (см. выше).
2. `Moe_grabber_app_vX.Y.Z.zip` — содержимое `resources/app` в папке `Moe_grabber_app_vX.Y.Z` (~150 КБ, обычный файл в ветке archives).
3. `Moe_grabber_vX.Y.Z_Windows.zip` — вся папка (через Git LFS).
4. Обновить манифест (версия, sha256, размеры, заметки). Если поменялась версия Electron — поле `electron`: тогда программы предложат полное обновление.

Обновление кода кладётся в `%APPDATA%\Мое_граббер\app-updates\X.Y.Z` и запускается вместо встроенного (`updater.js`, `boot()`).
Проверка SHA-256; две неудачные загрузки подряд (или ошибка при запуске) — работает встроенная версия.
Для проверки на своём сервере: переменная окружения `MG_UPDATE_URL`.
