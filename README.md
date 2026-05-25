# Editorial Policy Checker

AI-powered web application for checking documents against editorial policies.

## Architecture

```
/
├── client/src/
│   ├── pages/Workbench.tsx        # Main UI: document viewer + inspector
│   ├── components/
│   │   ├── ThemeProvider.tsx      # Light/dark theme (no localStorage)
│   │   └── Logo.tsx               # Inline SVG logo
│   ├── hooks/
│   │   └── useChecker.ts          # Orchestrates heuristic + AI check
│   └── lib/
│       ├── heuristicChecker.ts    # Fast client-side checks (stop-words, typography)
│       ├── importDoc.ts           # .docx / .txt / .md loader
│       ├── queryClient.ts         # TanStack Query + apiRequest
│       └── utils.ts
├── server/
│   ├── index.ts                   # Express entry, port 5000
│   ├── routes.ts                  # HTTP routes
│   ├── geminiRouter.ts            # Gemini cascade router (3 models)
│   ├── policyParser.ts            # AI: extract rules from policy document
│   ├── documentChecker.ts         # AI: check document against rules
│   └── storage.ts                 # In-memory PolicyDocument store
└── shared/
    └── types.ts                   # Shared TypeScript types
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/policies/upload` | Upload policy document (multipart or JSON) |
| `GET`  | `/api/policies` | List all policies |
| `GET`  | `/api/policies/:id` | Get single policy with rules |
| `DELETE` | `/api/policies/:id` | Delete policy |
| `POST` | `/api/policies/:id/parse` | Parse rules via Gemini AI |
| `POST` | `/api/check` | Check document against policy |
| `POST` | `/api/import-url` | Import document by URL |

## Workflow

1. **Upload policy** — загрузить редакционную политику (.docx/.txt/.md)
2. **Parse rules** — Gemini извлекает структурированные правила (категория, severity, примеры)
3. **Load document** — загрузить проверяемый документ
4. **Check** — двухуровневая проверка: эвристика (мгновенно) + AI (Gemini)
5. **Review** — аннотированный текст + инспектор нарушений + карточки правил

## Violation Categories

| Category | Color | Description |
|----------|-------|-------------|
| `stop-word` | Red | Запрещённые слова и обороты |
| `style` | Purple | Стилистические ошибки |
| `abbreviation` | Blue | Неверные сокращения |
| `tone` | Amber | Нарушение тональности |
| `structure` | Green | Структурные проблемы |
| `typography` | Yellow | Типографика |
| `factual` | Orange | Фактические нормы |
| `custom` | Indigo | Пользовательские правила |

## Setup

```bash
npm install
export GEMINI_API_KEY=your_key
npm run dev
# → http://localhost:5000
```

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend:** Express.js + TypeScript + tsx
- **AI:** Google Gemini (cascade: 2.5 Flash → 1.5 Flash → 1.5 Flash 8B)
- **Doc import:** mammoth (DOCX), native FileReader (TXT/MD)
- **Arch base:** citadex `refactor/gemini-router`
