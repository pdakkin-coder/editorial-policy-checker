/**
 * importDoc.ts
 * Supports: .docx (server mammoth → HTML), .pdf (server → HTML), .txt, .md
 * Returns html + text + name + warnings.
 */

export interface ImportResult {
  text:     string;
  html:     string;
  name:     string;
  warnings: string[];
}

export async function importFile(file: File): Promise<ImportResult> {
  const name = file.name.replace(/\.[^.]+$/, "");

  // DOCX + PDF → server (structured HTML via mammoth / pdf-parse)
  if (
    file.name.toLowerCase().endsWith(".docx") ||
    file.name.toLowerCase().endsWith(".pdf")
  ) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res  = await fetch("/api/import-docx", { method: "POST", body: formData });
      const data = await res.json() as { html?: string; text?: string; warnings?: string[]; message?: string };
      if (!res.ok) return { html: "", text: "", name, warnings: [data.message ?? `Ошибка сервера: HTTP ${res.status}`] };
      const html = data.html ?? textToHtml(data.text ?? "");
      return { html, text: data.text ?? htmlToText(html), name, warnings: data.warnings ?? [] };
    } catch (e) {
      return { html: "", text: "", name, warnings: [`Не удалось загрузить файл: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }

  // TXT / MD → read in browser, wrap in paragraphs
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload  = (e) => {
      const text = String(e.target?.result ?? "");
      resolve({ text, html: textToHtml(text), name, warnings: [] });
    };
    reader.onerror = () => resolve({ html: "", text: "", name, warnings: ["Ошибка чтения файла."] });
    reader.readAsText(file, "utf-8");
  });
}

/** Wraps plain text paragraphs in <p> tags */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("\n") || "<p></p>";
}

/** Strips HTML tags to plain text */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
