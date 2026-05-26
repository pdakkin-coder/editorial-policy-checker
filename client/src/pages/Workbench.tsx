import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText, Upload, Link2, Sun, Moon, Sparkles, BookOpen,
  AlertTriangle, CheckCircle2, Info, ChevronRight, Cpu, FileDown,
  PenSquare, RotateCcw, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { EPCLogo } from "@/components/Logo";
import { useTheme } from "@/components/ThemeProvider";
import { importFile, htmlToText } from "@/lib/importDoc";
import { apiRequest } from "@/lib/queryClient";
import { useChecker } from "@/hooks/useChecker";
import RichEditor, { type RichEditorHandle } from "@/components/RichEditor";
import { useLocalStorage, clearStorageByPrefix } from "@/hooks/useLocalStorage";
import type { PolicyViolation, PolicyDocument } from "@shared/types";

const LS = "epc_v1_";

type Panel = "violations" | "rules" | "stats";

const CATEGORY_LABELS: Record<string, string> = {
  "stop-word":  "Стоп-слово",
  style:        "Стиль",
  abbreviation: "Сокращение",
  tone:         "Тональность",
  structure:    "Структура",
  typography:   "Типографика",
  factual:      "Факт",
  custom:       "Правило политики",
};

const SEV_LABELS: Record<string, string> = {
  all:     "Все уровни",
  error:   "Ошибки",
  warning: "Предупреждения",
  info:    "Инфо",
};

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  error:   <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />,
  info:    <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />,
};

const PROSE_CLASS = [
  "prose prose-sm dark:prose-invert max-w-none",
  "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:leading-tight",
  "[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:leading-tight",
  "[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4",
  "[&_h4]:text-base [&_h4]:font-semibold [&_h4]:mb-1 [&_h4]:mt-3",
  "[&_p]:mb-3",
  "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3 [&_ul]:space-y-1",
  "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3 [&_ol]:space-y-1",
  "[&_li]:leading-relaxed",
  "[&_strong]:font-semibold [&_b]:font-semibold",
  "[&_em]:italic [&_i]:italic",
  "[&_u]:underline",
  "[&_s]:line-through",
  "[&_blockquote]:border-l-4 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:my-3",
  "[&_table]:border-collapse [&_table]:w-full [&_table]:my-3",
  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm",
  "[&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_th]:bg-muted/50",
].join(" ");

function annClass(v: PolicyViolation): string { return `ann-${v.category}`; }
function legendDotClass(v: PolicyViolation): string {
  return `legend-dot legend-dot-${v.severity === "error" ? "error" : v.severity === "warning" ? "warning" : "info"}`;
}

// ── DOM text node collector ───────────────────────────────────────────────────
// IMPORTANT: this function must produce the same offset arithmetic as
// htmlToText() in importDoc.ts so that violation start/end positions
// computed by the checker (which receives htmlToText output) map
// correctly onto the DOM nodes rendered from the same HTML.
//
// htmlToText rules (source of truth):
//   <br>            → "\n"   (+1)
//   </p>            → "\n"   (+1)
//   </h1-6>         → "\n"   (+1)
//   </li>           → "\n"   (+1)
//   all other tags  → ""     (+0)
//
// Therefore collectTextNodes must add +1 only at:
//   - a <BR> element (counts as a newline character)
//   - the END of a P / H1-H6 / LI element
// and must NOT add anything at the START of any element.
function collectTextNodes(
  container: HTMLElement,
): { node: Text; start: number; end: number }[] {
  // Tags whose closing position inserts a virtual "\n" (+1)
  const NEWLINE_CLOSE_TAGS = new Set(["P","H1","H2","H3","H4","H5","H6","LI"]);

  const result: { node: Text; start: number; end: number }[] = [];
  let offset = 0;

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node as Text;
      const len = t.textContent?.length ?? 0;
      if (len > 0) {
        result.push({ node: t, start: offset, end: offset + len });
        offset += len;
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el  = node as HTMLElement;
    const tag = el.tagName;

    // <BR> is self-closing and represents a single "\n" character
    if (tag === "BR") {
      offset += 1;
      return;
    }

    // Recurse into children
    el.childNodes.forEach((child) => walk(child));

    // After closing a block tag that htmlToText converts to "\n"
    if (NEWLINE_CLOSE_TAGS.has(tag)) {
      offset += 1;
    }
  }

  walk(container);
  return result;
}

// ── Export menu ───────────────────────────────────────────────────────────────
function ExportMenu({ onExport, disabled }: { onExport: (f: "docx" | "html" | "txt") => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);
  const items: { label: string; fmt: "docx" | "html" | "txt" }[] = [
    { label: ".docx (Word)", fmt: "docx" },
    { label: ".html",        fmt: "html" },
    { label: ".txt",         fmt: "txt"  },
  ];
  return (
    <div ref={ref} className="relative">
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        <FileDown className="h-4 w-4 mr-1.5" />Экспорт
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md border bg-popover shadow-md py-1">
          {items.map(({ label, fmt }) => (
            <button key={fmt} type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
              onMouseDown={() => { onExport(fmt); close(); }}
            >{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drag-resize ───────────────────────────────────────────────────────────────
function useDragResize(initial: number, min: number, max: number, dir: "left" | "right" = "right") {
  const [width, setWidth] = useState(initial);
  const drag = useRef(false);
  const sx   = useRef(0);
  const sw   = useRef(0);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); drag.current = true; sx.current = e.clientX; sw.current = width;
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  }, [width]);
  useEffect(() => {
    function mv(e: MouseEvent) {
      if (!drag.current) return;
      const d = dir === "right" ? e.clientX - sx.current : sx.current - e.clientX;
      setWidth(Math.min(max, Math.max(min, sw.current + d)));
    }
    function up() { drag.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; }
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { width, onMouseDown };
}

// ── Annotated HTML view ───────────────────────────────────────────────────────
function AnnotatedHtmlView({
  html, violations, hoveredId, selected, onHover, onSelect, spanRefs,
}: {
  html:       string;
  violations: PolicyViolation[];
  hoveredId:  string | null;
  selected:   { start: number; end: number } | null;
  onHover:    (id: string | null) => void;
  onSelect:   (v: PolicyViolation) => void;
  spanRefs:   React.MutableRefObject<Map<string, HTMLSpanElement>>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll("mark[data-vid]").forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
    spanRefs.current.clear();
    if (!violations.length) return;
    const nodes = collectTextNodes(container);
    const totalLen = nodes.length > 0 ? nodes[nodes.length - 1].end : 0;
    const sorted = [...violations]
      .filter(v => v.start >= 0 && v.end > v.start && v.end <= totalLen + 10)
      .sort((a, b) => b.start - a.start);
    for (const v of sorted) {
      const overlapping = nodes.filter(n => n.end > v.start && n.start < v.end);
      if (!overlapping.length) continue;
      if (overlapping.length === 1) {
        const { node: textNode, start: nodeStart } = overlapping[0];
        const localStart = v.start - nodeStart;
        const localEnd   = v.end   - nodeStart;
        const text = textNode.textContent ?? "";
        if (localStart < 0 || localEnd > text.length || localStart >= localEnd) continue;
        const before = document.createTextNode(text.slice(0, localStart));
        const mark   = document.createElement("mark");
        mark.dataset.vid = v.id;
        mark.textContent = text.slice(localStart, localEnd);
        const after = document.createTextNode(text.slice(localEnd));
        const parent = textNode.parentNode;
        if (!parent) continue;
        parent.insertBefore(before, textNode);
        parent.insertBefore(mark, textNode);
        parent.insertBefore(after, textNode);
        parent.removeChild(textNode);
        overlapping[0].node  = after as unknown as Text;
        overlapping[0].start = nodeStart + localEnd;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, violations]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll<HTMLElement>("mark[data-vid]").forEach((el) => {
      const vid = el.dataset.vid!;
      const v   = violations.find(x => x.id === vid);
      if (!v) return;
      el.className = [
        annClass(v),
        hoveredId === vid ? "ann-focused" : "",
        (selected?.start === v.start && selected?.end === v.end) ? "ann-selected" : "",
      ].filter(Boolean).join(" ");
      spanRefs.current.set(vid, el as HTMLSpanElement);
      el.onmouseenter = () => onHover(vid);
      el.onmouseleave = () => onHover(null);
      el.onclick      = () => onSelect(v);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [violations, hoveredId, selected]);

  return (
    <div
      ref={containerRef}
      className={`p-6 min-h-full text-sm leading-relaxed select-text ${PROSE_CLASS}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function Workbench() {
  const { theme, toggle }    = useTheme();
  const { toast }            = useToast();
  const fileDocInput         = useRef<HTMLInputElement | null>(null);
  const filePolicyInput      = useRef<HTMLInputElement | null>(null);
  const editorRef            = useRef<RichEditorHandle>(null);

  // ── Persisted state ─────────────────────────────────────────────────────────
  const [docName, setDocName, clearDocName]       = useLocalStorage(`${LS}docName`, "Документ не загружен");
  const [docHtml, setDocHtml, clearDocHtml]       = useLocalStorage(`${LS}docHtml`, "", 800);
  const [docText, setDocText, clearDocText]       = useLocalStorage(`${LS}docText`, "", 800);
  const [activePolicyId, setActivePolicyId,
         clearActivePolicyId]                     = useLocalStorage<string | null>(`${LS}activePolicyId`, null, 0);
  const [catFilter, setCatFilter, clearCatFilter] = useLocalStorage(`${LS}catFilter`, "all", 0);
  const [sevFilter, setSevFilter, clearSevFilter] = useLocalStorage(`${LS}sevFilter`, "all", 0);
  const [savedViolations, setSavedViolations,
         clearSavedViolations]                    = useLocalStorage<PolicyViolation[]>(`${LS}violations`, [], 800);

  // ── Transient state ──────────────────────────────────────────────────────────
  const [editMode, setEditMode]       = useState(false);
  const [panel, setPanel]             = useState<Panel>("violations");
  const [selected, setSelected]       = useState<{ start: number; end: number } | null>(null);
  const [hoveredId, setHoveredId]     = useState<string | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const [policies, setPolicies]           = useState<(Pick<PolicyDocument, "id" | "name" | "uploadedAt"> & { ruleCount: number; aiParsed: boolean })[]>([]);
  const [policyRules, setPolicyRules]     = useState<PolicyDocument["rules"]>([]);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl]             = useState("");
  const [linkLoading, setLinkLoading]     = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  const sidebar    = useDragResize(220, 160, 320, "right");
  const rightPanel = useDragResize(340, 280, 520, "left");

  const { violations: liveViolations, loading: checkLoading, error: checkError,
          result: checkResult, activeModel, check, reset, setViolations } = useChecker();

  // Restore violations from localStorage on first mount
  useEffect(() => {
    if (savedViolations.length > 0) {
      setViolations(savedViolations);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep savedViolations in sync with live checker output
  useEffect(() => {
    if (liveViolations.length > 0) {
      setSavedViolations(liveViolations);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveViolations]);

  const violations = liveViolations.length > 0 ? liveViolations : savedViolations;

  const spanRefs = useRef<Map<string, HTMLSpanElement>>(new Map());

  const filteredViolations = useMemo(() => violations.filter(v => {
    if (catFilter !== "all" && v.category !== catFilter) return false;
    if (sevFilter !== "all" && v.severity !== sevFilter) return false;
    return true;
  }), [violations, catFilter, sevFilter]);

  const stats = useMemo(() => ({
    total:    violations.length,
    errors:   violations.filter(v => v.severity === "error").length,
    warnings: violations.filter(v => v.severity === "warning").length,
    info:     violations.filter(v => v.severity === "info").length,
  }), [violations]);

  const hasDraft = docHtml.length > 0 || docText.length > 0;

  function handleClearDraft() {
    clearDocName(); clearDocHtml(); clearDocText();
    clearActivePolicyId(); clearCatFilter(); clearSevFilter();
    clearSavedViolations();
    clearStorageByPrefix(LS);
    reset();
    setSelected(null);
    setEditMode(false);
    setPanel("violations");
    setClearDialogOpen(false);
    toast({ title: "Черновик очищен", description: "Все локальные данные удалены." });
  }

  async function fetchPolicies() {
    try {
      const res  = await apiRequest("GET", "/api/policies");
      const data = await res.json();
      setPolicies(data);
    } catch (_) {}
  }

  useEffect(() => { fetchPolicies(); }, []);

  const prevPolicyId = useRef<string | null>(null);
  useEffect(() => {
    if (!activePolicyId || activePolicyId === prevPolicyId.current) return;
    prevPolicyId.current = activePolicyId;
    apiRequest("GET", `/api/policies/${activePolicyId}`)
      .then(r => r.json())
      .then((data: PolicyDocument) => {
        if (data?.rules?.length) setPolicyRules(data.rules);
      })
      .catch(() => {});
  }, [activePolicyId]);

  async function handlePolicyFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPolicyLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res  = await fetch("/api/policies/upload", { method: "POST", body: formData });
      const data = await res.json() as { id: string; name: string; uploadedAt: string; ruleCount: number; aiParsed: boolean; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Ошибка загрузки");
      await fetchPolicies();
      setActivePolicyId(data.id);
      toast({ title: "Политика загружена", description: `«${data.name}» — запустите AI-парсинг правил.` });
    } catch (err) {
      toast({ title: "Ошибка", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setPolicyLoading(false);
      e.target.value = "";
    }
  }

  async function handleParsePolicy() {
    if (!activePolicyId) return;
    setPolicyLoading(true);
    try {
      const res  = await apiRequest("POST", `/api/policies/${activePolicyId}/parse`);
      const data = await res.json() as { rules: PolicyDocument["rules"]; ruleCount: number; error?: string; summary?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPolicyRules(data.rules);
      await fetchPolicies();
      toast({ title: "Правила разобраны", description: `Извлечено ${data.ruleCount} правил. ${data.summary ?? ""}` });
      setPanel("rules");
    } catch (err) {
      toast({ title: "AI-парсинг не удался", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setPolicyLoading(false);
    }
  }

  async function handleDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const imported = await importFile(file);
    if (!imported.html && !imported.text) {
      toast({ title: "Импорт не удался", description: imported.warnings[0] ?? "Неизвестная ошибка", variant: "destructive" });
      e.target.value = "";
      return;
    }
    if (imported.warnings.length) {
      toast({ title: "Файл загружен", description: imported.warnings.join(" ") });
    }
    setDocName(imported.name);
    setDocHtml(imported.html);
    // Always derive docText from HTML via the canonical htmlToText so that
    // stored offsets are always consistent with the DOM rendering.
    setDocText(htmlToText(imported.html));
    setEditMode(false);
    reset();
    clearSavedViolations();
    setSelected(null);
    e.target.value = "";
  }

  async function handleUrlImport() {
    if (!linkUrl.trim()) return;
    setLinkLoading(true);
    try {
      const res  = await apiRequest("POST", "/api/import-url", { url: linkUrl });
      const data = await res.json() as { text?: string; html?: string; name?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      const html = data.html ?? "";
      // Always derive plain text from HTML for offset consistency.
      const text = htmlToText(html);
      setDocName(data.name ?? "документ");
      setDocHtml(html);
      setDocText(text);
      setEditMode(false);
      reset(); clearSavedViolations(); setSelected(null); setLinkDialogOpen(false); setLinkUrl("");
    } catch (err) {
      toast({ title: "Ошибка", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setLinkLoading(false);
    }
  }

  async function handleCheck() {
    if (!activePolicyId) return;

    let htmlToCheck: string;
    let textToCheck: string;

    if (editMode && editorRef.current) {
      htmlToCheck = editorRef.current.getHtml();
      setDocHtml(htmlToCheck);
    } else {
      htmlToCheck = docHtml;
    }

    if (!htmlToCheck.trim()) return;

    // Always recompute plain text from the current HTML right before
    // passing it to the checker. This guarantees that the offset
    // coordinate system used by heuristicChecker / AI is identical
    // to what collectTextNodes will reconstruct from the same HTML.
    textToCheck = htmlToText(htmlToCheck);
    setDocText(textToCheck);

    await check(textToCheck, activePolicyId);
    setEditMode(false);
    setPanel("violations");
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleExport(format: "docx" | "html" | "txt") {
    const html = editMode && editorRef.current ? editorRef.current.getHtml() : docHtml;
    const text = editMode && editorRef.current ? editorRef.current.getText() : docText;
    if (!html && !text) {
      toast({ title: "Нет документа", description: "Загрузите документ перед экспортом.", variant: "destructive" });
      return;
    }
    setExportLoading(true);
    try {
      if (format === "txt") {
        downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${docName}.txt`);
      } else if (format === "html") {
        const full = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${docName}</title></head><body>${html}</body></html>`;
        downloadBlob(new Blob([full], { type: "text/html;charset=utf-8" }), `${docName}.html`);
      } else {
        const res = await fetch("/api/export-docx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ html, name: docName }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { message?: string };
          throw new Error(d.message ?? `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const ext  = res.headers.get("content-disposition")?.match(/filename="[^"]+\.([^"]+)"/)?.[1] ?? "docx";
        downloadBlob(blob, `${docName}.${ext}`);
      }
      toast({ title: "Экспорт завершён", description: `${docName} сохранён.` });
    } catch (err) {
      toast({ title: "Ошибка экспорта", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  }

  function scrollToViolation(v: PolicyViolation) {
    const el = spanRefs.current.get(v.id);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); }
    setSelected({ start: v.start, end: v.end });
  }

  function handleEditorChange(html: string, text: string) {
    setDocHtml(html);
    // Keep docText in sync using canonical htmlToText
    setDocText(htmlToText(html));
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

      {/* Header */}
      <header className="h-14 border-b flex items-center px-4 gap-3 shrink-0 bg-background/80 backdrop-blur">
        <span className="text-primary"><EPCLogo size={30} /></span>
        <div className="leading-none select-none shrink-0">
          <div className="text-[15px] font-bold tracking-normal text-foreground">PolicyCheck</div>
          <div className="text-[11px] text-muted-foreground hidden sm:block">Editorial Policy Checker</div>
        </div>
        <Separator orientation="vertical" className="h-6 mx-1 shrink-0" />
        <div className="flex items-center gap-2 text-sm min-w-0 flex-1 overflow-hidden">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium truncate">{docName}</span>
          {editMode && <Badge variant="outline" className="text-[10px] ml-1 shrink-0">Редактирование</Badge>}
          {hasDraft && !editMode && (
            <Badge variant="secondary" className="text-[10px] ml-1 shrink-0 gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/70" />
              Сохранено
            </Badge>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <input ref={fileDocInput}    type="file" accept=".docx,.pdf,.txt,.md" onChange={handleDocFile}    className="hidden" />
          <input ref={filePolicyInput} type="file" accept=".docx,.pdf,.txt,.md" onChange={handlePolicyFile} className="hidden" />

          <Button variant="outline" size="sm" onClick={() => fileDocInput.current?.click()}>
            <Upload className="h-4 w-4 mr-1.5" />Документ
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLinkDialogOpen(true)}>
            <Link2 className="h-4 w-4 mr-1.5" />Ссылка
          </Button>

          {docHtml && (
            editMode ? (
              <Button variant="outline" size="sm" onClick={() => setEditMode(false)}>
                <RotateCcw className="h-4 w-4 mr-1.5" />Просмотр
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setEditMode(true)}>
                <PenSquare className="h-4 w-4 mr-1.5" />Редактировать
              </Button>
            )
          )}

          {(docHtml || docText) && (
            <ExportMenu onExport={handleExport} disabled={exportLoading} />
          )}

          <Button
            variant="default" size="sm"
            onClick={handleCheck}
            disabled={checkLoading || !docHtml.trim() || !activePolicyId || policyRules.length === 0}
          >
            <Sparkles className="h-4 w-4 mr-1.5" />{checkLoading ? "Проверка…" : "Проверить"}
          </Button>

          {hasDraft && (
            <Button
              variant="ghost" size="sm"
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={() => setClearDialogOpen(true)}
              title="Очистить черновик"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}

          <Button variant="ghost" size="icon" onClick={toggle}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* AI status bar */}
      {(checkLoading || checkResult || checkError) && (
        <div className="h-7 border-b px-4 flex items-center gap-2 text-[11px] bg-muted/40 shrink-0">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          {checkLoading && <span className="text-muted-foreground">Проверка…</span>}
          {!checkLoading && checkResult && (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate">Найдено: {stats.errors} ошибок, {stats.warnings} предупреждений, {stats.info} заметок</span>
              {activeModel && (
                <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0 h-4 gap-1 shrink-0">
                  <Cpu className="h-2.5 w-2.5" />{activeModel}
                </Badge>
              )}
            </span>
          )}
          {!checkLoading && checkError && (
            <span className="text-destructive truncate">{checkError}</span>
          )}
        </div>
      )}

      {/* URL import dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Импорт по ссылке</DialogTitle>
            <DialogDescription>Публичная ссылка на .docx, .pdf, .txt, .md или Google Docs.</DialogDescription>
          </DialogHeader>
          <Input placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUrlImport()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleUrlImport} disabled={linkLoading || !linkUrl.trim()}>{linkLoading ? "Загрузка…" : "Импортировать"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear draft dialog */}
      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Очистить черновик?</DialogTitle>
            <DialogDescription>
              Документ, текст и результаты проверки будут удалены из локального
              хранилища браузера. Загруженные политики останутся на сервере.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearDialogOpen(false)}>Отмена</Button>
            <Button variant="destructive" onClick={handleClearDraft}>
              <Trash2 className="h-4 w-4 mr-1.5" />Очистить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Main layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left sidebar */}
        <aside className="flex flex-col border-r bg-muted/30 shrink-0 overflow-hidden relative" style={{ width: sidebar.width }}>
          <div className="p-3 border-b space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Редакционная политика</p>
            <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() => filePolicyInput.current?.click()} disabled={policyLoading}>
              <Upload className="h-3.5 w-3.5 mr-1.5 shrink-0" />Загрузить политику
            </Button>
            {policies.length > 0 && (
              <Select value={activePolicyId ?? ""} onValueChange={setActivePolicyId}>
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue placeholder="Выбрать…" />
                </SelectTrigger>
                <SelectContent>
                  {policies.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.name} {p.aiParsed ? `(${p.ruleCount} пр.)` : "(не разобрана)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {activePolicyId && (
              <Button variant="default" size="sm" className="w-full h-8 text-xs" onClick={handleParsePolicy} disabled={policyLoading}>
                <Sparkles className="h-3.5 w-3.5 mr-1.5 shrink-0" />{policyLoading ? "AI-парсинг…" : "Разобрать правила"}
              </Button>
            )}
          </div>

          <nav className="flex flex-col gap-1 p-2 overflow-hidden">
            {(["violations", "rules", "stats"] as Panel[]).map((key) => {
              const labels: Record<Panel, string> = { violations: "Нарушения", rules: "Правила политики", stats: "Статистика" };
              const icons: Record<Panel, typeof FileText> = { violations: AlertTriangle, rules: BookOpen, stats: Info };
              const Icon = icons[key];
              return (
                <button key={key} type="button" onClick={() => setPanel(key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm w-full text-left transition-colors min-w-0 ${
                    panel === key ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate flex-1">{labels[key]}</span>
                  {key === "violations" && violations.length > 0 && (
                    <Badge variant={stats.errors > 0 ? "destructive" : "secondary"} className="ml-auto text-[10px] px-1.5 shrink-0">{violations.length}</Badge>
                  )}
                  {key === "rules" && policyRules.length > 0 && (
                    <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 shrink-0">{policyRules.length}</Badge>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors" style={{ left: sidebar.width - 1 }} onMouseDown={sidebar.onMouseDown} />
        </aside>

        {/* Document area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          {editMode ? (
            <RichEditor
              ref={editorRef}
              initialHtml={docHtml}
              onChange={handleEditorChange}
              className="flex-1 min-h-0"
            />
          ) : (
            <ScrollArea className="flex-1 min-h-0">
              {docHtml ? (
                <AnnotatedHtmlView
                  html={docHtml}
                  violations={violations}
                  hoveredId={hoveredId}
                  selected={selected}
                  onHover={setHoveredId}
                  onSelect={(v) => { setSelected({ start: v.start, end: v.end }); setPanel("violations"); }}
                  spanRefs={spanRefs}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center text-muted-foreground gap-3">
                  <FileText className="h-12 w-12 opacity-20" />
                  <p className="text-sm">Загрузите документ для проверки</p>
                  <p className="text-xs">Поддерживаются .docx, .pdf, .txt, .md или Google Docs по ссылке</p>
                </div>
              )}
            </ScrollArea>
          )}
        </main>

        {/* Right inspector */}
        <div className="flex flex-col border-l bg-background shrink-0 overflow-hidden relative" style={{ width: rightPanel.width }}>
          <div className="absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10" style={{ left: 0 }} onMouseDown={rightPanel.onMouseDown} />
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 min-w-0">

              {panel === "violations" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">Нарушения</h2>
                    <Badge variant="outline" className="text-[10px] shrink-0">{filteredViolations.length}/{violations.length}</Badge>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Select value={catFilter} onValueChange={setCatFilter}>
                      <SelectTrigger className="h-7 w-full text-xs">
                        <SelectValue placeholder="Все категории" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">Все категории</SelectItem>
                        {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                          <SelectItem key={k} value={k} className="text-xs">{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={sevFilter} onValueChange={setSevFilter}>
                      <SelectTrigger className="h-7 w-full text-xs">
                        <SelectValue placeholder="Все уровни" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(SEV_LABELS).map(([k, label]) => (
                          <SelectItem key={k} value={k} className="text-xs">{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {filteredViolations.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                      <CheckCircle2 className="h-8 w-8 opacity-30" />
                      <p className="text-xs">{violations.length === 0 ? "Нарушений не найдено" : "Нет совпадений с фильтром"}</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {filteredViolations.map((v) => {
                        const isSel = selected?.start === v.start && selected?.end === v.end;
                        return (
                          <button key={v.id} type="button"
                            className={`w-full text-left rounded-md px-3 py-2 text-xs transition-colors border overflow-hidden ${
                              isSel ? "bg-primary/10 border-primary/30" : "hover:bg-muted border-transparent hover:border-border"
                            }`}
                            onClick={() => scrollToViolation(v)}
                          >
                            <div className="flex items-center gap-1.5 mb-1 min-w-0">
                              <span className={legendDotClass(v)} />
                              {SEVERITY_ICON[v.severity]}
                              <span className="font-medium truncate">{CATEGORY_LABELS[v.category] ?? v.category}</span>
                              {v.source === "heuristic" && (
                                <Badge variant="outline" className="text-[9px] px-1 h-3.5 shrink-0 ml-auto">эвристика</Badge>
                              )}
                              {v.confidence !== undefined && v.source !== "heuristic" && (
                                <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{Math.round(v.confidence * 100)}%</span>
                              )}
                            </div>
                            <div className="text-muted-foreground break-words line-clamp-3">«{v.matchedText}»</div>
                            {v.explanation && (
                              <div className="text-[10px] text-muted-foreground/70 mt-0.5 break-words line-clamp-3">{v.explanation}</div>
                            )}
                            {v.suggestion && (
                              <div className="mt-1 text-[10px] flex items-center gap-1 text-primary min-w-0">
                                <ChevronRight className="h-3 w-3 shrink-0" />
                                <span className="truncate">→ {v.suggestion}</span>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {panel === "rules" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">Правила политики</h2>
                    <Badge variant="outline" className="text-[10px] shrink-0">{policyRules.length}</Badge>
                  </div>
                  {policyRules.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Загрузите политику и запустите AI-парсинг.</p>
                  ) : (
                    <div className="space-y-2">
                      {policyRules.map((rule) => (
                        <div key={rule.id} className="rounded-md border p-3 space-y-1 overflow-hidden">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant={rule.severity === "error" ? "destructive" : rule.severity === "warning" ? "secondary" : "outline"} className="text-[10px] shrink-0">
                              {CATEGORY_LABELS[rule.category] ?? rule.category}
                            </Badge>
                            {rule.source && <span className="text-[10px] text-muted-foreground truncate">{rule.source}</span>}
                          </div>
                          <p className="text-xs font-medium break-words">{rule.name}</p>
                          <p className="text-[11px] text-muted-foreground leading-relaxed break-words">{rule.description}</p>
                          {rule.examples?.map((ex, i) => (
                            <div key={i} className="text-[10px] space-y-0.5 pt-1">
                              <div className="text-destructive break-words">✗ {ex.bad}</div>
                              <div className="text-green-600 dark:text-green-400 break-words">✓ {ex.good}</div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {panel === "stats" && (
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold">Статистика проверки</h2>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { label: "Всего",          value: stats.total,    color: "" },
                      { label: "Ошибок",         value: stats.errors,   color: "text-destructive" },
                      { label: "Предупреждений", value: stats.warnings, color: "text-amber-500" },
                      { label: "Инфо",           value: stats.info,     color: "text-blue-500" },
                    ] as { label: string; value: number; color: string }[]).map(({ label, value, color }) => (
                      <div key={label} className="rounded-md border p-3 overflow-hidden">
                        <div className={`text-xl font-bold ${color}`}>{value}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{label}</div>
                      </div>
                    ))}
                  </div>
                  {checkResult?.summary && (
                    <div className="rounded-md bg-muted/40 p-3 overflow-hidden">
                      <p className="text-xs text-muted-foreground break-words">{checkResult.summary}</p>
                    </div>
                  )}
                </div>
              )}

            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
