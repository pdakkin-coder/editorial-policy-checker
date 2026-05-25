import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { registerRoutes } from "./routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

registerRoutes(app);

// Serve static in production
const distPublic = path.join(__dirname, "../dist/public");
if (process.env.NODE_ENV === "production") {
  app.use(express.static(distPublic));
  app.get("*", (_req, res) => res.sendFile(path.join(distPublic, "index.html")));
} else {
  // Dev: vite middleware
  const { createServer } = await import("vite");
  const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.ssrFixStacktrace);
  app.use(vite.middlewares);
}

const PORT = Number(process.env.PORT ?? 5000);
app.listen(PORT, () => console.log(`[epc] server listening on http://localhost:${PORT}`));
