/**
 * importDoc.ts — file import helper.
 * Supports .docx (mammoth via server), .txt, .md
 */

export interface ImportResult {
  text: string;
  name: string;
  warnings: string[];
}

export async function importFile(file: File): Promise<ImportResult> {
  const name = file.name;

  if (file.name.endsWith(".docx")) {
    // Send to server for mammoth extraction
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/import-docx", { method: "POST", body: formData });
      if (res.ok) {
        const data = await res.json() as { text: string; warnings: string[] };
        return { text: data.text, name, warnings: data.warnings ?? [] };
      }
    } catch (_) { /* fallback below */ }
    return { text: "", name, warnings: ["Не удалось распарсить DOCX — используйте TXT или MD."] };
  }

  // TXT / MD — read directly
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve({ text: String(e.target?.result ?? ""), name, warnings: [] });
    reader.onerror = () => resolve({ text: "", name, warnings: ["Ошибка чтения файла."] });
    reader.readAsText(file, "utf-8");
  });
}
