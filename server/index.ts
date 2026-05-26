import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { registerRoutes } from "./routes.js";

// ── Load .env ──────────────────────────────────────────────────────────────
// Dynamic import keeps esbuild bundle clean (dotenv stays external).
try {
  const { config } = await import("dotenv");
  config(); // reads .env from cwd
} catch {
  // dotenv not installed — silently skip; variables may come from the OS env
}

// ── Express setup ──────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

registerRoutes(app);

// ── Static / Dev middleware ────────────────────────────────────────────────
const distPublic = path.join(__dirname, "../dist/public");
if (process.env.NODE_ENV === "production") {
  app.use(express.static(distPublic));
  app.get("*", (_req, res) => res.sendFile(path.join(distPublic, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.ssrFixStacktrace);
  app.use(vite.middlewares);
}

const PORT = Number(process.env.PORT ?? 5000);
app.listen(PORT, () => console.log(`[epc] server listening on http://localhost:${PORT}`));
