@echo off
REM ──────────────────────────────────────────────────────────────────────────
REM  Editorial Policy Checker — скрипт запуска для Windows (cmd.exe)
REM
REM  Использование: дважды щёлкните start.bat или запустите из cmd
REM ──────────────────────────────────────────────────────────────────────────
SETLOCAL

cd /d "%~dp0"

REM ── 1. Проверить .env ─────────────────────────────────────────────────────
IF NOT EXIST ".env" (
    echo [!] Файл .env не найден.
    echo     Скопируйте шаблон:
    echo       copy .env.example .env
    echo     Затем откройте .env и замените 'ваш_ключ_здесь' на реальный ключ.
    pause
    exit /b 1
)

REM ── 2. Установить зависимости если нужно ──────────────────────────────────
IF NOT EXIST "node_modules" (
    echo [*] Устанавливаем зависимости...
    call npm install
    IF ERRORLEVEL 1 ( echo [!] npm install завершился с ошибкой. & pause & exit /b 1 )
)

REM ── 3. Проверить dotenv ───────────────────────────────────────────────────
IF NOT EXIST "node_modules\dotenv" (
    echo [*] Устанавливаем dotenv...
    call npm install dotenv
    IF ERRORLEVEL 1 ( echo [!] Не удалось установить dotenv. & pause & exit /b 1 )
)

REM ── 4. Запустить сервер ───────────────────────────────────────────────────
echo [*] Запуск Editorial Policy Checker...
echo     Откройте в браузере: http://localhost:5000
call npm run dev

ENDLOCAL
pause
