# ──────────────────────────────────────────────────────────────────────────────
#  Editorial Policy Checker — скрипт запуска для Windows PowerShell
#
#  Использование (если политика выполнения ограничена):
#    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
#    .\start.ps1
# ──────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $root

# ── 1. Проверить .env ─────────────────────────────────────────────────────
if (-not (Test-Path ".env")) {
    Write-Host "[!] Файл .env не найден." -ForegroundColor Yellow
    Write-Host "    Скопируйте шаблон:"
    Write-Host "      Copy-Item .env.example .env"
    Write-Host "    Затем откройте .env и замените 'ваш_ключ_здесь' на реальный ключ."
    Read-Host "Нажмите Enter для выхода"
    exit 1
}

# ── 2. Установить зависимости если нужно ──────────────────────────────────
if (-not (Test-Path "node_modules")) {
    Write-Host "[*] Устанавливаем зависимости..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Error "npm install завершился с ошибкой"; exit 1 }
}

# ── 3. Проверить dotenv ───────────────────────────────────────────────────
if (-not (Test-Path "node_modules/dotenv")) {
    Write-Host "[*] Устанавливаем dotenv..." -ForegroundColor Cyan
    npm install dotenv
    if ($LASTEXITCODE -ne 0) { Write-Error "Не удалось установить dotenv"; exit 1 }
}

# ── 4. Запустить сервер ───────────────────────────────────────────────────
$port = if ($env:PORT) { $env:PORT } else { "5000" }
Write-Host "[*] Запуск Editorial Policy Checker..." -ForegroundColor Green
Write-Host "    Откройте в браузере: http://localhost:$port"
npm run dev
