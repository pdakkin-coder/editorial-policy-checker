#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
#  Editorial Policy Checker — скрипт запуска для macOS / Linux
#
#  Использование:
#    chmod +x start.sh   (один раз)
#    ./start.sh
# ──────────────────────────────────────────────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PORT="${PORT:-5000}"

# ── 1. Проверить наличие .env ──────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "⚠️  Файл .env не найден."
  echo "   Скопируйте шаблон и добавьте ключ Gemini:"
  echo "     cp .env.example .env"
  echo "   Затем откройте .env и замените 'ваш_ключ_здесь' на реальный ключ."
  exit 1
fi

# ── 2. Освободить порт если занят ─────────────────────────────────────────
PIDS=$(lsof -ti :"$PORT" 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "⚠️  Порт $PORT занят (PID: $PIDS) — завершаем процесс..."
  echo "$PIDS" | xargs kill -9 2>/dev/null || true
  sleep 0.5
  echo "✅ Порт $PORT освобождён."
fi

# ── 3. Проверить наличие node_modules ─────────────────────────────────────
if [ ! -d node_modules ]; then
  echo "📦 Устанавливаем зависимости..."
  npm install
fi

# ── 4. Убедиться, что dotenv установлен ───────────────────────────────────
if [ ! -d node_modules/dotenv ]; then
  echo "📦 Устанавливаем dotenv..."
  npm install dotenv
fi

# ── 5. Запустить dev-сервер ────────────────────────────────────────────────
echo "🚀 Запуск Editorial Policy Checker..."
echo "   Открыть в браузере: http://localhost:${PORT}"
PORT="$PORT" npm run dev
