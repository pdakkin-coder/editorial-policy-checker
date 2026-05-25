/**
 * Express routes
 *
 * POST /api/policies/upload      — загрузить документ политики (multipart или JSON)
 * GET  /api/policies             — список политик
 * GET  /api/policies/:id         — одна политика
 * DELETE /api/policies/:id       — удалить
 * POST /api/policies/:id/parse   — (пере)парсить правила через AI
 * POST /api/check                — проверить документ по политике
 * POST /api/import-url           — импорт документа по URL (Google Docs / raw)
 */

import express, { type Express } from "express";
import multer from "multer";
import mammoth from "mammoth";
import { randomUUID } from "crypto";
import { parsePolicy } from "./policyParser.js";
import { checkDocument } from "./documentChecker.js";
import { savePolicy, getPolicy, listPolicies, deletePolicy } from "./storage.js";
import type { CheckDocumentRequest, PolicyDocument } from "../shared/types.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export function registerRoutes(app: Express): void {
  // ── Upload policy document ────────────────────────────────────────────────
  app.post("/api/policies/upload", upload.single("file"), async (req, res) => {
    try {
      let rawText = "";
      let name    = "Редакционная политика";

      if (req.file) {
        name = req.file.originalname.replace(/\.[^.]+$/, "");
        if (req.file.mimetype.includes("wordprocessingml") || req.file.originalname.endsWith(".docx")) {
          const r = await mammoth.extractRawText({ buffer: req.file.buffer });
          rawText = r.value;
        } else {
          rawText = req.file.buffer.toString("utf-8");
        }
      } else if (req.body?.rawText) {
        rawText = req.body.rawText;
        name    = req.body.name ?? name;
      } else {
        return res.status(400).json({ message: "Файл или текст не предоставлен" });
      }

      const doc: PolicyDocument = {
        id:         randomUUID(),
        name,
        uploadedAt: new Date().toISOString(),
        rawText,
        rules:      [],
        aiParsed:   false,
      };
      savePolicy(doc);
      return res.json(doc);
    } catch (err) {
      return res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── List policies ─────────────────────────────────────────────────────────
  app.get("/api/policies", (_req, res) => {
    res.json(listPolicies().map((p) => ({ id: p.id, name: p.name, uploadedAt: p.uploadedAt, ruleCount: p.rules.length, aiParsed: p.aiParsed })));
  });

  // ── Get single policy ─────────────────────────────────────────────────────
  app.get("/api/policies/:id", (req, res) => {
    const doc = getPolicy(req.params.id);
    if (!doc) return res.status(404).json({ message: "Политика не найдена" });
    return res.json(doc);
  });

  // ── Delete policy ─────────────────────────────────────────────────────────
  app.delete("/api/policies/:id", (req, res) => {
    const ok = deletePolicy(req.params.id);
    return res.json({ ok });
  });

  // ── Parse policy rules via AI ─────────────────────────────────────────────
  app.post("/api/policies/:id/parse", async (req, res) => {
    const doc = getPolicy(req.params.id);
    if (!doc) return res.status(404).json({ message: "Политика не найдена" });
    if (!process.env.GEMINI_API_KEY) {
      return res.status(501).json({ message: "GEMINI_API_KEY не задан" });
    }
    const result = await parsePolicy({ rawText: doc.rawText, name: doc.name });
    if (result.error) return res.status(502).json(result);
    doc.rules    = result.rules;
    doc.aiParsed = true;
    savePolicy(doc);
    return res.json({ ...result, ruleCount: result.rules.length });
  });

  // ── Check document ────────────────────────────────────────────────────────
  app.post("/api/check", async (req, res) => {
    const body = req.body as CheckDocumentRequest;
    if (!body.documentText || !body.policyId) {
      return res.status(400).json({ message: "documentText и policyId обязательны" });
    }
    const policy = getPolicy(body.policyId);
    if (!policy) return res.status(404).json({ message: "Политика не найдена" });
    if (!policy.rules.length) return res.status(400).json({ message: "Правила не разобраны. Сначала запустите /parse" });
    if (!process.env.GEMINI_API_KEY) return res.status(501).json({ message: "GEMINI_API_KEY не задан" });
    const result = await checkDocument(body, policy.rules);
    return res.json(result);
  });

  // ── Import document by URL ────────────────────────────────────────────────
  app.post("/api/import-url", async (req, res) => {
    const { url } = req.body as { url?: string };
    if (!url) return res.status(400).json({ message: "url обязателен" });
    try {
      let fetchUrl = url;
      const gdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (gdMatch) fetchUrl = `https://docs.google.com/document/d/${gdMatch[1]}/export?format=txt`;

      const r = await fetch(fetchUrl, { headers: { "User-Agent": "editorial-policy-checker/0.1" }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) return res.status(r.status).json({ message: `HTTP ${r.status} при загрузке` });

      const text = await r.text();
      const name = new URL(fetchUrl).pathname.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "документ";
      return res.json({ text, name, warnings: [] });
    } catch (err) {
      return res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });
}
