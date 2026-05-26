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

# ── 1. Проверить наличие .env ──────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "⚠️  Файл .env не найден."
  echo "   Скопируйте шаблон и добавьте ключ Gemini:"
  echo "     cp .env.example .env"
  echo "   Затем откройте .env и замените 'ваш_ключ_здесь' на реальный ключ."
  exit 1
fi

# ── 2. Читать PORT из .env (если задан и не закомментирован) ──────────────
ENV_PORT=$(grep -E '^PORT=' .env | head -1 | cut -d'=' -f2 | tr -d '[:space:]' || true)
PORT="${ENV_PORT:-5000}"

echo "🔧 Используется порт: $PORT"

# ── 3. Освободить порт если занят — ждём полного закрытия ─────────────────
for attempt in 1 2 3; do
  PIDS=$(lsof -ti :"$PORT" 2>/dev/null || true)
  if [ -z "$PIDS" ]; then break; fi
  echo "⚠️  Порт $PORT занят (PID: $PIDS) — завершаем (попытка $attempt)..."
  echo "$PIDS" | xargs kill -9 2>/dev/null || true
  sleep 1
done

PIDS=$(lsof -ti :"$PORT" 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "❌ Не удалось освободить порт $PORT. Попробуйте: sudo kill -9 $PIDS"
  exit 1
fi
echo "✅ Порт $PORT свободен."

# ── 4. Проверить наличие node_modules ─────────────────────────────────────
if [ ! -d node_modules ]; then
  echo "📦 Устанавливаем зависимости..."
  npm install
fi

# ── 5. Убедиться, что dotenv установлен ───────────────────────────────────
if [ ! -d node_modules/dotenv ]; then
  echo "📦 Устанавливаем dotenv..."
  npm install dotenv
fi

# ── 6. Запустить dev-сервер ────────────────────────────────────────────────
echo "🚀 Запуск Editorial Policy Checker..."
echo "   Открыть в браузере: http://localhost:${PORT}"
export PORT="$PORT"
npm run dev
