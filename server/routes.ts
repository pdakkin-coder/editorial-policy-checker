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
 * POST /api/import-docx          — извлечь HTML-структуру из DOCX (заголовки, списки, форматирование)
 * POST /api/import-pdf           — извлечь текст из PDF
 * POST /api/export-docx          — экспорт HTML-контента в DOCX
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

// ── HTML → plain text (for checker) ──────────────────────────────────────────
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Text extraction helper ───────────────────────────────────────────────────
async function extractText(
  buffer:       Buffer,
  originalname: string,
  mimetype:     string,
): Promise<{ text: string; warnings: string[] }> {
  const name = originalname.toLowerCase();

  if (mimetype.includes("wordprocessingml") || name.endsWith(".docx")) {
    const r = await mammoth.extractRawText({ buffer });
    return {
      text:     r.value,
      warnings: r.messages.filter((m) => m.type === "warning").map((m) => m.message),
    };
  }

  if (mimetype === "application/pdf" || name.endsWith(".pdf")) {
    const r = await pdfParse(buffer);
    const warnings: string[] = [];
    if (!r.text.trim()) warnings.push("Документ выглядит как скан — текстовый слой не найден.");
    return { text: r.text, warnings };
  }

  if (mimetype.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    return { text: buffer.toString("utf-8"), warnings: [] };
  }

  return { text: buffer.toString("utf-8"), warnings: [`Неизвестный тип файла: ${mimetype}`] };
}

// ── DOCX → HTML (структурированный импорт) ───────────────────────────────────
async function extractHtml(
  buffer: Buffer,
  originalname: string,
  mimetype: string,
): Promise<{ html: string; text: string; warnings: string[] }> {
  const name = originalname.toLowerCase();

  if (mimetype.includes("wordprocessingml") || name.endsWith(".docx")) {
    const styleMap = [
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "p[style-name='Heading 4'] => h4:fresh",
      "p[style-name='Заголовок 1'] => h1:fresh",
      "p[style-name='Заголовок 2'] => h2:fresh",
      "p[style-name='Заголовок 3'] => h3:fresh",
      "p[style-name='Заголовок 4'] => h4:fresh",
      "p[style-name='Title'] => h1:fresh",
      "b => strong",
      "i => em",
    ];
    const r = await mammoth.convertToHtml({ buffer }, { styleMap });
    const html = r.value;
    const text = htmlToPlainText(html);
    console.info(`${LOG} mammoth HTML: ${html.length} chars, text: ${text.length} chars from ${originalname}`);
    return {
      html,
      text,
      warnings: r.messages.filter((m) => m.type === "warning").map((m) => m.message),
    };
  }

  // PDF — возвращаем plain text обёрнутый в параграфы
  if (mimetype === "application/pdf" || name.endsWith(".pdf")) {
    const r = await pdfParse(buffer);
    const warnings: string[] = [];
    if (!r.text.trim()) warnings.push("Скан-PDF: текстовый слой не найден.");
    const html = r.text
      .split(/\n{2,}/)
      .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
      .join("\n");
    return { html, text: r.text, warnings };
  }

  // TXT / MD — plain text → параграфы
  const text = buffer.toString("utf-8");
  const html = text
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return { html, text, warnings: [] };
}

export function registerRoutes(app: Express): void {

  // ── Import DOCX/PDF/TXT as structured HTML ────────────────────────────────
  app.post("/api/import-docx", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Файл не предоставлен" });
    try {
      const result = await extractHtml(
        req.file.buffer, req.file.originalname, req.file.mimetype,
      );
      if (!result.text.trim()) {
        return res.status(422).json({ message: "Файл не содержит текста." });
      }
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Import PDF as plain text (legacy) ────────────────────────────────────
  app.post("/api/import-pdf", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Файл не предоставлен" });
    try {
      const result = await extractHtml(
        req.file.buffer, req.file.originalname, req.file.mimetype,
      );
      if (!result.text.trim()) {
        return res.status(422).json({ message: "Скан-PDF: текстовый слой не найден." });
      }
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });

  // ── Export HTML → DOCX ────────────────────────────────────────────────────
  // Генерирует DOCX на сервере через mammoth-совместимый HTML → docx
  // Используем встроенный модуль (htmlDocx не нужен: клиент сам делает Blob)
  // Сервер просто возвращает очищенный HTML — клиент скачает его как .html
  // или конвертирует через browser API.
  // Для настоящего DOCX-экспорта клиент POST-ит сюда html, мы пишем .docx.
  app.post("/api/export-docx", express.json({ limit: "10mb" }), async (req, res) => {
    const { html, name } = req.body as { html: string; name: string };
    if (!html) return res.status(400).json({ message: "html обязателен" });
    try {
      // Используем html-to-docx (если доступен), иначе возвращаем HTML как fallback
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let htmlToDocx: any;
      try { htmlToDocx = (await import("html-to-docx" as string)).default; } catch { htmlToDocx = null; }

      if (htmlToDocx) {
        const docxBuffer = await htmlToDocx(html, null, {
          table: { row: { cantSplit: true } },
          footer: true,
          pageNumber: false,
          font: "Times New Roman",
          fontSize: 24, // half-points → 12pt
        });
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name ?? "document")}.docx"`);
        return res.end(docxBuffer);
      }

      // Fallback: возвращаем HTML-файл
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name ?? "document")}.html"`);
      return res.end(html);
    } catch (err) {
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
        const extracted = await extractText(req.file.buffer, req.file.originalname, req.file.mimetype);
        rawText = extracted.text;
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
      // Wrap plain text in paragraphs for rich editor
      const html = text.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n");
      return res.json({ text, html, name, warnings: [] });
    } catch (err) {
      return res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
    }
  });
}
