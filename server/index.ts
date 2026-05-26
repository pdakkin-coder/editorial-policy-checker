import express from "express";
import path from "path";
import { registerRoutes } from "./routes.js";

// ── Load .env (CJS-safe, before any env reads) ─────────────────────────────
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config();
} catch {
  // dotenv not installed — env vars must come from the OS
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
(async () => {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  registerRoutes(app);

  // ── Static / Dev middleware ──────────────────────────────────────────────
  if (process.env.NODE_ENV === "production") {
    const distPublic = path.join(__dirname, "../dist/public");
    app.use(express.static(distPublic));
    app.get("*", (_req, res) =>
      res.sendFile(path.join(distPublic, "index.html"))
    );
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.ssrFixStacktrace);
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT ?? 5000);
  app.listen(PORT, () =>
    console.log(`[epc] server listening on http://localhost:${PORT}`)
  );
})();
