/**
 * Workbench.tsx
 * Главная страница редактора.
 *
 * Новые возможности:
 * - Rich contenteditable редактор с тулбаром форматирования
 * - Структурированный импорт DOCX (заголовки, списки, жирный, курсив)
 * - Экспорт в DOCX и TXT
 * - Аннотации накладываются на plain text; переключение режимов просмотра
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText, Upload, Download, Link2, Sun, Moon, Sparkles, BookOpen,
  AlertTriangle, CheckCircle2, Info, ChevronRight, Cpu, Trash2,
  PenSquare, RotateCcw, Save, Bold, Italic, List, RefreshCw,
  Heading1, Heading2, Heading3, AlignLeft, Underline, Code, FileDown,
  ListOrdered, Quote, Strikethrough, Undo2, Redo2,
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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { EPCLogo } from "@/components/Logo";
import { useTheme } from "@/components/ThemeProvider";
import { apiRequest } from "@/lib/queryClient";
import { useChecker } from "@/hooks/useChecker";
import type { PolicyViolation, PolicyDocument } from "@shared/types";

type Panel = "violations" | "rules" | "stats";

const CATEGORY_LABELS: Record<string, string> = {
  "stop-word":    "Стоп-слово",
  style:          "Стиль",
  abbreviation:   "Сокращение",
  tone:           "Тональность",
  structure:      "Структура",
  typography:     "Типографика",
  factual:        "Факт",
  custom:         "Правило политики",
};

const SEVERITY_ICON = {
  error:   <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />,
  info:    <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />,
};

function annClass(v: PolicyViolation): string { return `ann-${v.category}`; }
function legendDotClass(v: PolicyViolation): string {
  const s = v.severity === "error" ? "error" : v.severity === "warning" ? "warning" : "info";
  return `legend-dot legend-dot-${s}`;
}

// ── HTML → plain text ─────────────────────────────────────────────────────────
function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

// ── drag-resize ───────────────────────────────────────────────────────────────
function useDragResize(initial: number, min: number, max: number, dir: "left" | "right" = "right") {
  const [width, setWidth] = useState(initial);
  const drag = useRef(false);
  const sx   = useRef(0);
  const sw   = useRef(0);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); drag.current = true; sx.current = e.clientX; sw.current = width;
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  }, [width]);
  useMemo(() => {
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

// ── Toolbar button ────────────────────────────────────────────────────────────
function TB({ title, onClick, active, children }: {
  title: string; onClick: () => void; active?: boolean; children: React.ReactNode;
}) {
  return (
    <button type="button" title={title} onClick={onClick}
      className={`h-7 w-7 flex items-center justify-center rounded text-xs transition-colors ${
        active ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground hover:text-foreground"
      }`}
    >{children}</button>
  );
}

// ── Rich Editor Toolbar ───────────────────────────────────────────────────────
function EditorToolbar({ onCommand }: { onCommand: (cmd: string, val?: string) => void }) {
  return (
    <div className="h-10 border-b flex items-center gap-0.5 px-3 bg-muted/20 shrink-0 flex-wrap overflow-hidden">
      <TB title="Отменить (Ctrl+Z)" onClick={() => onCommand("undo")}><Undo2 className="h-3.5 w-3.5" /></TB>
      <TB title="Повторить (Ctrl+Y)" onClick={() => onCommand("redo")}><Redo2 className="h-3.5 w-3.5" /></TB>
      <div className="w-px h-5 bg-border mx-1 shrink-0" />
      <TB title="Заголовок 1" onClick={() => onCommand("formatBlock", "h1")}><Heading1 className="h-3.5 w-3.5" /></TB>
      <TB title="Заголовок 2" onClick={() => onCommand("formatBlock", "h2")}><Heading2 className="h-3.5 w-3.5" /></TB>
      <TB title="Заголовок 3" onClick={() => onCommand("formatBlock", "h3")}><Heading3 className="h-3.5 w-3.5" /></TB>
      <TB title="Обычный текст" onClick={() => onCommand("formatBlock", "p")}><AlignLeft className="h-3.5 w-3.5" /></TB>
      <div className="w-px h-5 bg-border mx-1 shrink-0" />
      <TB title="Жирный (Ctrl+B)" onClick={() => onCommand("bold")}><Bold className="h-3.5 w-3.5" /></TB>
      <TB title="Курсив (Ctrl+I)" onClick={() => onCommand("italic")}><Italic className="h-3.5 w-3.5" /></TB>
      <TB title="Подчёркнутый (Ctrl+U)" onClick={() => onCommand("underline")}><Underline className="h-3.5 w-3.5" /></TB>
      <TB title="Зачёркнутый" onClick={() => onCommand("strikethrough")}><Strikethrough className="h-3.5 w-3.5" /></TB>
      <div className="w-px h-5 bg-border mx-1 shrink-0" />
      <TB title="Маркированный список" onClick={() => onCommand("insertUnorderedList")}><List className="h-3.5 w-3.5" /></TB>
      <TB title="Нумерованный список" onClick={() => onCommand("insertOrderedList")}><ListOrdered className="h-3.5 w-3.5" /></TB>
      <TB title="Цитата" onClick={() => onCommand("formatBlock", "blockquote")}><Quote className="h-3.5 w-3.5" /></TB>
    </div>
  );
}

export default function Workbench() {
  const { theme, toggle }    = useTheme();
  const { toast }            = useToast();
  const fileDocInput         = useRef<HTMLInputElement | null>(null);
  const filePolicyInput      = useRef<HTMLInputElement | null>(null);
  const editorRef            = useRef<HTMLDivElement | null>(null);

  // docHtml — источник истины для редактора; docText — plain text для чекера
  const [docName, setDocName]   = useState("Документ не загружен");
  const [docHtml, setDocHtml]   = useState("");   // rich HTML
  const [docText, setDocText]   = useState("");   // plain text для checker
  const [editMode, setEditMode] = useState(false);
  const [panel, setPanel]       = useState<Panel>("violations");
  const [selected, setSelected] = useState<{ start: number; end: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const [policies, setPolicies]         = useState<(Pick<PolicyDocument, "id" | "name" | "uploadedAt"> & { ruleCount: number; aiParsed: boolean })[]>([]);
  const [activePolicyId, setActivePolicyId] = useState<string | null>(null);
  const [policyRules, setPolicyRules]   = useState<PolicyDocument["rules"]>([]);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl]           = useState("");
  const [linkLoading, setLinkLoading]   = useState(false);
  const [catFilter, setCatFilter]       = useState("all");
  const [sevFilter, setSevFilter]       = useState("all");

  const sidebar    = useDragResize(220, 160, 320, "right");
  const rightPanel = useDragResize(340, 280, 520, "left");

  const { violations, loading: checkLoading, error: checkError, result: checkResult, activeModel, check, reset } = useChecker();
  const spanRefs = useRef<Map<string, HTMLSpanElement>>(new Map());

  // Sync editor content → docHtml/docText when in edit mode
  function syncFromEditor() {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      setDocHtml(html);
      setDocText(htmlToPlain(html));
    }
  }

  // Apply HTML to editor ref (on load/import)
  useEffect(() => {
    if (editMode && editorRef.current && editorRef.current.innerHTML !== docHtml) {
      editorRef.current.innerHTML = docHtml;
    }
  }, [editMode, docHtml]);

  function execCommand(cmd: string, val?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    syncFromEditor();
  }

  // ── Segments for annotation view ─────────────────────────────────────────
  const segments = useMemo(() => {
    if (!docText || violations.length === 0)
      return [{ kind: "plain" as const, text: docText, start: 0, end: docText.length }];
    type Seg = { kind: "plain" | "ann"; text: string; start: number; end: number; violation?: PolicyViolation };
    const segs: Seg[] = [];
    let cursor = 0;
    const sorted = [...violations]
      .filter(v => v.start >= 0 && v.end <= docText.length && v.start < v.end)
      .sort((a, b) => a.start - b.start);
    for (const v of sorted) {
      if (v.start < cursor) continue;
      if (v.start > cursor) segs.push({ kind: "plain", text: docText.slice(cursor, v.start), start: cursor, end: v.start });
      segs.push({ kind: "ann", text: docText.slice(v.start, v.end), start: v.start, end: v.end, violation: v });
      cursor = v.end;
    }
    if (cursor < docText.length) segs.push({ kind: "plain", text: docText.slice(cursor), start: cursor, end: docText.length });
    return segs;
  }, [docText, violations]);

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

  // ── Policy helpers ────────────────────────────────────────────────────────
  async function fetchPolicies() {
    try {
      const res  = await apiRequest("GET", "/api/policies");
      const data = await res.json();
      setPolicies(data);
    } catch (_) {}
  }

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

  // ── Document import ───────────────────────────────────────────────────────
  async function handleDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res  = await fetch("/api/import-docx", { method: "POST", body: formData });
      const data = await res.json() as { html?: string; text?: string; warnings: string[]; message?: string };
      if (!res.ok) throw new Error(data.message ?? "Ошибка импорта");
      if (!data.text?.trim()) throw new Error("Файл не содержит текста");

      const name = file.name.replace(/\.[^.]+$/, "");
      setDocName(name);
      setDocHtml(data.html ?? "");
      setDocText(data.text ?? "");
      reset();
      setSelected(null);

      if (data.warnings?.length) {
        toast({ title: "Файл загружен", description: data.warnings.join(" ") });
      } else {
        toast({ title: "Документ загружен", description: `«${name}» готов к проверке.` });
      }
    } catch (err) {
      toast({ title: "Ошибка импорта", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      e.target.value = "";
    }
  }

  async function handleUrlImport() {
    if (!linkUrl.trim()) return;
    setLinkLoading(true);
    try {
      const res  = await apiRequest("POST", "/api/import-url", { url: linkUrl });
      const data = await res.json() as { text?: string; html?: string; name?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      setDocName(data.name ?? "документ");
      setDocText(data.text ?? "");
      setDocHtml(data.html ?? data.text?.split("\n\n").map(p => `<p>${p}</p>`).join("") ?? "");
      reset(); setSelected(null); setLinkDialogOpen(false); setLinkUrl("");
    } catch (err) {
      toast({ title: "Ошибка", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setLinkLoading(false);
    }
  }

  // ── Check ─────────────────────────────────────────────────────────────────
  async function handleCheck() {
    if (!docText.trim() || !activePolicyId) return;
    await check(docText, activePolicyId);
    setPanel("violations");
    toast({ title: "Проверка завершена", description: `Найдено ${violations.length} нарушений.` });
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function exportTxt() {
    const blob = new Blob([docText], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${docName}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function exportDocx() {
    try {
      const res = await fetch("/api/export-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: docHtml, name: docName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext  = res.headers.get("Content-Disposition")?.includes(".docx") ? "docx" : "html";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${docName}.${ext}`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast({ title: "Документ экспортирован" });
    } catch (err) {
      toast({ title: "Ошибка экспорта", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }

  function scrollToViolation(v: PolicyViolation) {
    const el = spanRefs.current.get(v.id);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus({ preventScroll: true }); }
    setSelected({ start: v.start, end: v.end });
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
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
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <input ref={fileDocInput} type="file" accept=".docx,.pdf,.txt,.md" onChange={handleDocFile} className="hidden" />
          <input ref={filePolicyInput} type="file" accept=".docx,.pdf,.txt,.md" onChange={handlePolicyFile} className="hidden" />

          <Button variant="outline" size="sm" onClick={() => fileDocInput.current?.click()}>
            <Upload className="h-4 w-4 mr-1.5" />Документ
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLinkDialogOpen(true)}>
            <Link2 className="h-4 w-4 mr-1.5" />Ссылка
          </Button>

          {/* Export dropdown */}
          {docText && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <FileDown className="h-4 w-4 mr-1.5" />Экспорт
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportDocx}>
                  <FileDown className="h-4 w-4 mr-2" />Скачать DOCX
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportTxt}>
                  <FileText className="h-4 w-4 mr-2" />Скачать TXT
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            variant="default" size="sm"
            onClick={handleCheck}
            disabled={checkLoading || !docText.trim() || !activePolicyId || policyRules.length === 0}
          >
            <Sparkles className="h-4 w-4 mr-1.5" />{checkLoading ? "Проверка…" : "Проверить"}
          </Button>
          <Button variant="ghost" size="icon" onClick={toggle}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* ── AI status bar ─────────────────────────────────────────────────────── */}
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

      {/* ── URL dialog ────────────────────────────────────────────────────────── */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Импорт по ссылке</DialogTitle>
            <DialogDescription>Публичная ссылка на .docx, .pdf, .txt, .md или Google Docs.</DialogDescription>
          </DialogHeader>
          <Input placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleUrlImport()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleUrlImport} disabled={linkLoading || !linkUrl.trim()}>{linkLoading ? "Загрузка…" : "Импортировать"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Main layout ───────────────────────────────────────────────────────── */}
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
                <SelectTrigger className="h-8 w-full text-xs"><SelectValue placeholder="Выбрать…" /></SelectTrigger>
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

          {/* Edit mode toggle */}
          {docText && (
            <div className="p-2 border-t mt-auto">
              <Button
                variant={editMode ? "default" : "outline"}
                size="sm" className="w-full h-8 text-xs"
                onClick={() => {
                  if (!editMode) { setEditMode(true); }
                  else {
                    // Save: sync from editor
                    syncFromEditor();
                    setEditMode(false);
                    reset();
                    toast({ title: "Изменения сохранены" });
                  }
                }}
              >
                {editMode ? <><Save className="h-3.5 w-3.5 mr-1.5" />Сохранить</> : <><PenSquare className="h-3.5 w-3.5 mr-1.5" />Редактировать</>}
              </Button>
              {editMode && (
                <Button variant="ghost" size="sm" className="w-full h-8 text-xs mt-1"
                  onClick={() => { setEditMode(false); if (editorRef.current) editorRef.current.innerHTML = docHtml; }}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />Отмена
                </Button>
              )}
            </div>
          )}

          <div className="absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors" style={{ left: sidebar.width - 1 }} onMouseDown={sidebar.onMouseDown} />
        </aside>

        {/* Document area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          {editMode && <EditorToolbar onCommand={execCommand} />}

          <ScrollArea className="flex-1 min-h-0">
            {editMode ? (
              /* Rich editor */
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                spellCheck
                className="rich-editor p-6 min-h-full outline-none focus:outline-none"
                onInput={syncFromEditor}
                onKeyDown={(e) => {
                  if (e.key === "Tab") { e.preventDefault(); document.execCommand("insertHTML", false, "&nbsp;&nbsp;&nbsp;&nbsp;"); }
                }}
                dangerouslySetInnerHTML={{ __html: docHtml }}
              />
            ) : (
              /* Annotation view (plain text + highlights) */
              <div className="p-6 min-h-full font-mono text-sm leading-relaxed whitespace-pre-wrap select-text break-words">
                {docText ? segments.map((seg, idx) => {
                  if (seg.kind === "plain") return <span key={idx}>{seg.text}</span>;
                  const v = seg.violation!;
                  const isHov = hoveredId === v.id;
                  const isSel = selected?.start === seg.start && selected?.end === seg.end;
                  return (
                    <span key={idx}
                      ref={(el) => { if (el) spanRefs.current.set(v.id, el); else spanRefs.current.delete(v.id); }}
                      className={[annClass(v), isHov ? "ann-focused" : "", isSel ? "ann-selected" : ""].filter(Boolean).join(" ")}
                      tabIndex={0} role="mark"
                      aria-label={`${CATEGORY_LABELS[v.category]}: ${v.matchedText}`}
                      onMouseEnter={() => setHoveredId(v.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onClick={() => { setSelected({ start: v.start, end: v.end }); setPanel("violations"); }}
                    >{seg.text}</span>
                  );
                }) : (
                  <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center text-muted-foreground gap-3">
                    <FileText className="h-12 w-12 opacity-20" />
                    <p className="text-sm">Загрузите документ для проверки</p>
                    <p className="text-xs">Поддерживаются .docx (с форматированием), .pdf, .txt, .md или Google Docs по ссылке</p>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </main>

        {/* Right inspector panel */}
        <div className="flex flex-col border-l bg-background shrink-0 overflow-hidden relative" style={{ width: rightPanel.width }}>
          <div className="absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10" style={{ left: 0 }} onMouseDown={rightPanel.onMouseDown} />
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-4 min-w-0">

              {panel === "violations" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">Нарушения</h2>
                    <Badge variant="outline" className="text-[10px] shrink-0">{violations.length}</Badge>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Select value={catFilter} onValueChange={setCatFilter}>
                      <SelectTrigger className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">Все категории</SelectItem>
                        {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={sevFilter} onValueChange={setSevFilter}>
                      <SelectTrigger className="h-7 w-full text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">Все</SelectItem>
                        <SelectItem value="error" className="text-xs">Ошибки</SelectItem>
                        <SelectItem value="warning" className="text-xs">Предупреждения</SelectItem>
                        <SelectItem value="info" className="text-xs">Инфо</SelectItem>
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
                              <span className="font-medium truncate">{CATEGORY_LABELS[v.category]}</span>
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
                    {[
                      { label: "Всего нарушений", value: stats.total },
                      { label: "Ошибок",          value: stats.errors,   color: "text-destructive" },
                      { label: "Предупреждений",  value: stats.warnings, color: "text-amber-500" },
                      { label: "Инфо",            value: stats.info,     color: "text-blue-500" },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="rounded-md border p-3 overflow-hidden">
                        <div className={`text-xl font-bold ${color ?? ""}`}>{value}</div>
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
