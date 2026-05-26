/**
 * Express routes
 *
 * POST /api/policies/upload      — загрузить документ политики
 * GET  /api/policies             — список политик
 * GET  /api/policies/:id         — одна политика
 * DELETE /api/policies/:id       — удалить
 * POST /api/policies/:id/parse   — (пере)парсить правила через AI
 * POST /api/check                — проверить документ по политике
 * POST /api/import-url           — импорт по URL
 * POST /api/import-docx          — извлечь текст из DOCX (для редактируемого документа)
 * POST /api/import-pdf           — извлечь текст из PDF  (для редактируемого документа)
 */

import express, { type Express } from "express";
import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { randomUUID } from "crypto";
import { parsePolicy } from "./policyParser.js";
import { checkDocument } from "./documentChecker.js";
import { savePolicy, getPolicy, listPolicies, deletePolicy } from "./storage.js";
import type { CheckDocumentRequest, PolicyDocument } from "../shared/types.js";

const LOG    = "[routes]";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// ── Text extraction helper ───────────────────────────────────────────────────
async function extractText(
  buffer:       Buffer,
  originalname: string,
  mimetype:     string,
): Promise<{ text: string; warnings: string[] }> {
  const name = originalname.toLowerCase();

  if (mimetype.includes("wordprocessingml") || name.endsWith(".docx")) {
    const r = await mammoth.extractRawText({ buffer });
    console.info(`${LOG} mammoth: ${r.value.length} chars from ${originalname}`);
    return {
      text:     r.value,
      warnings: r.messages.filter((m) => m.type === "warning").map((m) => m.message),
    };
  }

  if (mimetype === "application/pdf" || name.endsWith(".pdf")) {
    const r = await pdfParse(buffer);
    console.info(`${LOG} pdf-parse: ${r.text.length} chars, ${r.numpages} pages from ${originalname}`);
    const warnings: string[] = [];
    if (!r.text.trim()) {
      warnings.push("Документ выглядит как скан — текстовый слой не найден.");
    }
    return { text: r.text, warnings };
  }

  if (mimetype.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    return { text: buffer.toString("utf-8"), warnings: [] };
  }

  console.warn(`${LOG} unknown mime "${mimetype}" for "${originalname}" — trying UTF-8`);
  return { text: buffer.toString("utf-8"), warnings: [`Неизвестный тип файла: ${mimetype}`] };
}

export function registerRoutes(app: Express): void {

  // ── Import DOCX as plain text (for editable document) ────────────────────
  app.post("/api/import-docx", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Файл не предоставлен" });
    try {
      const { text, warnings } = await extractText(
        req.file.buffer, req.file.originalname, req.file.mimetype,
      );
      if (!text.trim()) {
        return res.status(422).json({ message: "DOCX не содержит текста." });
      }
      return res.json({ text, warnings });
    } catch (err) {
      console.error(`${LOG} import-docx error:`, err instanceof Error ? err.message : err);
      return res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Import PDF as plain text (for editable document) ─────────────────────
  app.post("/api/import-pdf", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Файл не предоставлен" });
    try {
      const { text, warnings } = await extractText(
        req.file.buffer, req.file.originalname, req.file.mimetype,
      );
      if (!text.trim()) {
        return res.status(422).json({ message: "Скан-PDF: текстовый слой не найден. Попробуйте скопировать текст вручную." });
      }
      return res.json({ text, warnings });
    } catch (err) {
      console.error(`${LOG} import-pdf error:`, err instanceof Error ? err.message : err);
      return res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Upload policy document ────────────────────────────────────────────────
  app.post("/api/policies/upload", upload.single("file"), async (req, res) => {
    try {
      let rawText = "";
      let name    = "Редакционная политика";

      if (req.file) {
        name = req.file.originalname.replace(/\.[^.]+$/, "");
        console.info(`${LOG} policy upload: "${req.file.originalname}" (${req.file.mimetype}, ${req.file.size} bytes)`);
        const extracted = await extractText(req.file.buffer, req.file.originalname, req.file.mimetype);
        rawText = extracted.text;
        console.info(`${LOG} extracted text: ${rawText.length} chars`);
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
      console.error(`${LOG} policy upload error:`, err instanceof Error ? err.message : err);
      return res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── List policies ─────────────────────────────────────────────────────────
  app.get("/api/policies", (_req, res) => {
    res.json(listPolicies().map((p) => ({
      id: p.id, name: p.name, uploadedAt: p.uploadedAt,
      ruleCount: p.rules.length, aiParsed: p.aiParsed,
    })));
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
    console.info(`${LOG} /parse triggered for "${doc.name}" (${doc.rawText.length} chars)`);
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

      const r = await fetch(fetchUrl, {
        headers: { "User-Agent": "editorial-policy-checker/0.1" },
        signal:  AbortSignal.timeout(15_000),
      });
      if (!r.ok) return res.status(r.status).json({ message: `HTTP ${r.status} при загрузке` });

      const text = await r.text();
      const name = new URL(fetchUrl).pathname.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "документ";
      return res.json({ text, name, warnings: [] });
    } catch (err) {
      return res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });
}
