import express from "express";
import path from "path";
import { registerRoutes } from "./routes.js";

// Примечание: tsx автоматически загружает .env (строка '◇ injected env from .env' в логе).
// require("dotenv") был удалён, так как перезаписывал PORT после того как tsx его уже загрузил.

(async () => {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  registerRoutes(app);

  if (process.env.NODE_ENV === "production") {
    const distPublic = path.join(__dirname, "../dist/public");
    app.use(express.static(distPublic));
    app.get("*", (_req, res) =>
      res.sendFile(path.join(distPublic, "index.html"))
    );
  } else {
    try {
      const { createServer } = await import("vite");
      const root = path.resolve(__dirname, "..");
      const vite = await createServer({
        configFile: path.join(root, "vite.config.ts"),
        root,
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.ssrFixStacktrace);
      app.use(vite.middlewares);
      console.log("[epc] Vite dev middleware активен");
    } catch (err) {
      console.error("[epc] Ошибка запуска Vite:", err);
      process.exit(1);
    }
  }

  const PORT = Number(process.env.PORT ?? 5000);
  app.listen(PORT, () =>
    console.log(`[epc] server listening on http://localhost:${PORT}`)
  );
})();
