/**
 * importDoc.ts — file import helper.
 * Supports: .docx (via server mammoth), .pdf (via server pdf-parse), .txt, .md
 */

export interface ImportResult {
  text:     string;
  name:     string;
  warnings: string[];
}

export async function importFile(file: File): Promise<ImportResult> {
  const name = file.name.replace(/\.[^.]+$/, "");

  // — DOCX: mammoth on server
  if (file.name.toLowerCase().endsWith(".docx")) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res  = await fetch("/api/import-docx", { method: "POST", body: formData });
      const data = await res.json() as { text?: string; warnings?: string[]; message?: string };
      if (!res.ok) return { text: "", name, warnings: [data.message ?? `Ошибка сервера: HTTP ${res.status}`] };
      return { text: data.text ?? "", name, warnings: data.warnings ?? [] };
    } catch (e) {
      return { text: "", name, warnings: [`Не удалось загрузить DOCX: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }

  // — PDF: pdf-parse on server
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res  = await fetch("/api/import-pdf", { method: "POST", body: formData });
      const data = await res.json() as { text?: string; warnings?: string[]; message?: string };
      if (!res.ok) return { text: "", name, warnings: [data.message ?? `Ошибка сервера: HTTP ${res.status}`] };
      return { text: data.text ?? "", name, warnings: data.warnings ?? [] };
    } catch (e) {
      return { text: "", name, warnings: [`Не удалось загрузить PDF: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }

  // — TXT / MD: read directly in browser
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve({ text: String(e.target?.result ?? ""), name, warnings: [] });
    reader.onerror = () => resolve({ text: "", name, warnings: ["Ошибка чтения файла."] });
    reader.readAsText(file, "utf-8");
  });
}
