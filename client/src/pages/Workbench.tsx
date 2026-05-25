import { useCallback, useMemo, useRef, useState } from "react";
import {
  FileText, Upload, Download, Link2, Sun, Moon, Sparkles, BookOpen,
  AlertTriangle, CheckCircle2, Info, ChevronRight, Cpu, Trash2,
  PenSquare, RotateCcw, Save, Bold, Italic, List, RefreshCw,
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
import { importFile } from "@/lib/importDoc";
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
  error:   <AlertTriangle className="h-3.5 w-3.5 text-destructive" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />,
  info:    <Info className="h-3.5 w-3.5 text-blue-500" />,
};

function annClass(v: PolicyViolation): string {
  return `ann-${v.category}`;
}

function legendDotClass(v: PolicyViolation): string {
  return `legend-dot legend-dot-${v.severity === "error" ? "error" : v.severity === "warning" ? "warning" : "info"}`;
}

// ── drag-resize ──────────────────────────────────────────────────────────────
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

export default function Workbench() {
  const { theme, toggle }    = useTheme();
  const { toast }            = useToast();
  const fileDocInput         = useRef<HTMLInputElement | null>(null);
  const filePolicyInput      = useRef<HTMLInputElement | null>(null);

  const [docName, setDocName]   = useState("Документ не загружен");
  const [docText, setDocText]   = useState("");
  const [draft, setDraft]       = useState("");
  const [editMode, setEditMode] = useState(false);
  const [panel, setPanel]       = useState<Panel>("violations");
  const [selected, setSelected] = useState<{ start: number; end: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Policy state
  const [policies, setPolicies]     = useState<Pick<PolicyDocument, "id" | "name" | "uploadedAt"> & { ruleCount: number; aiParsed: boolean }[]>([]);
  const [activePolicyId, setActivePolicyId] = useState<string | null>(null);
  const [policyRules, setPolicyRules] = useState<PolicyDocument["rules"]>([]);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);
  const [catFilter, setCatFilter] = useState("all");
  const [sevFilter, setSevFilter] = useState("all");

  const sidebar    = useDragResize(220, 160, 320, "right");
  const rightPanel = useDragResize(380, 280, 560, "left");

  const { violations, loading: checkLoading, error: checkError, result: checkResult, activeModel, check, reset } = useChecker();

  const spanRefs = useRef<Map<string, HTMLSpanElement>>(new Map());

  // ── Document segments ───────────────────────────────────────────────────
  const segments = useMemo(() => {
    if (!docText || violations.length === 0) return [{ kind: "plain" as const, text: docText, start: 0, end: docText.length }];
    type Seg = { kind: "plain" | "ann"; text: string; start: number; end: number; violation?: PolicyViolation };
    const segs: Seg[] = [];
    let cursor = 0;
    const sorted = [...violations].filter(v => v.start >= 0 && v.end <= docText.length && v.start < v.end).sort((a, b) => a.start - b.start);
    for (const v of sorted) {
      if (v.start < cursor) continue;
      if (v.start > cursor) segs.push({ kind: "plain", text: docText.slice(cursor, v.start), start: cursor, end: v.start });
      segs.push({ kind: "ann", text: docText.slice(v.start, v.end), start: v.start, end: v.end, violation: v });
      cursor = v.end;
    }
    if (cursor < docText.length) segs.push({ kind: "plain", text: docText.slice(cursor), start: cursor, end: docText.length });
    return segs;
  }, [docText, violations]);

  // ── Filtered violations ─────────────────────────────────────────────────
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

  // ── Fetch policy list ────────────────────────────────────────────────────
  async function fetchPolicies() {
    try {
      const res  = await apiRequest("GET", "/api/policies");
      const data = await res.json();
      setPolicies(data);
    } catch (_) {}
  }

  // ── Upload policy file ───────────────────────────────────────────────────
  async function handlePolicyFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPolicyLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res  = await fetch("/api/policies/upload", { method: "POST", body: formData });
      const data = await res.json() as { id: string; name: string; uploadedAt: string; ruleCount: number; aiParsed: boolean };
      if (!res.ok) throw new Error((data as { message?: string }).message ?? "Ошибка загрузки");
      await fetchPolicies();
      setActivePolicyId(data.id);
      toast({ title: "Политика загружена", description: `«${data.name}» — запустите AI-парсинг правил.` });
    } catch (err) {
      toast({ title: "Ошибка", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setPolicyLoading(false);
    }
  }

  // ── Parse policy rules via AI ────────────────────────────────────────────
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

  // ── Import document file ─────────────────────────────────────────────────
  async function handleDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const imported = await importFile(file);
    if (!imported.text) { toast({ title: "Импорт не удался", description: imported.warnings[0], variant: "destructive" }); return; }
    setDocName(imported.name); setDocText(imported.text); setDraft(imported.text);
    reset(); setSelected(null);
  }

  // ── Import by URL ────────────────────────────────────────────────────────
  async function handleUrlImport() {
    if (!linkUrl.trim()) return;
    setLinkLoading(true);
    try {
      const res  = await apiRequest("POST", "/api/import-url", { url: linkUrl });
      const data = await res.json() as { text?: string; name?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
      setDocName(data.name ?? "документ"); setDocText(data.text ?? ""); setDraft(data.text ?? "");
      reset(); setSelected(null); setLinkDialogOpen(false); setLinkUrl("");
    } catch (err) {
      toast({ title: "Ошибка", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setLinkLoading(false);
    }
  }

  // ── Run check ────────────────────────────────────────────────────────────
  async function handleCheck() {
    if (!docText.trim() || !activePolicyId) return;
    await check(docText, activePolicyId);
    setPanel("violations");
    toast({ title: "Проверка завершена", description: `Найдено ${violations.length} нарушений.` });
  }

  function scrollToViolation(v: PolicyViolation) {
    const el = spanRefs.current.get(v.id);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.focus({ preventScroll: true }); }
    setSelected({ start: v.start, end: v.end });
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="h-14 border-b flex items-center px-4 gap-3 shrink-0 bg-background/80 backdrop-blur">
        <span className="text-primary"><EPCLogo size={30} /></span>
        <div className="leading-none select-none">
          <div className="text-[15px] font-bold tracking-normal text-foreground">PolicyCheck</div>
          <div className="text-[11px] text-muted-foreground hidden sm:block">Editorial Policy Checker</div>
        </div>
        <Separator orientation="vertical" className="h-6 mx-1" />
        <div className="flex items-center gap-2 text-sm min-w-0 flex-1">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium truncate max-w-[28ch]">{docName}</span>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <input ref={fileDocInput} type="file" accept=".docx,.txt,.md" onChange={handleDocFile} className="hidden" />
          <input ref={filePolicyInput} type="file" accept=".docx,.txt,.md,.pdf" onChange={handlePolicyFile} className="hidden" />
          <Button variant="outline" size="sm" onClick={() => fileDocInput.current?.click()}>
            <Upload className="h-4 w-4 mr-1.5" />Документ
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLinkDialogOpen(true)}>
            <Link2 className="h-4 w-4 mr-1.5" />Ссылка
          </Button>
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

      {/* ── AI status bar ───────────────────────────────────────────────── */}
      {(checkLoading || checkResult || checkError) && (
        <div className="h-7 border-b px-4 flex items-center gap-2 text-[11px] bg-muted/40">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          {checkLoading && <span className="text-muted-foreground">AI-проверка…</span>}
          {!checkLoading && checkResult && (
            <span className="flex items-center gap-1.5">
              Найдено: {stats.errors} ошибок, {stats.warnings} предупреждений, {stats.info} заметок
              {activeModel && (
                <Badge variant="outline" className="ml-1 text-[10px] px-1.5 py-0 h-4 gap-1">
                  <Cpu className="h-2.5 w-2.5" />{activeModel}
                </Badge>
              )}
            </span>
          )}
          {!checkLoading && checkError && (
            <span className="text-destructive">{checkError}</span>
          )}
        </div>
      )}

      {/* ── URL dialog ──────────────────────────────────────────────────── */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Импорт по ссылке</DialogTitle>
            <DialogDescription>Публичная ссылка на .docx, .txt, .md или Google Docs.</DialogDescription>
          </DialogHeader>
          <Input placeholder="https://…" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleUrlImport()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleUrlImport} disabled={linkLoading || !linkUrl.trim()}>{linkLoading ? "Загрузка…" : "Импортировать"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Main layout ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* Left sidebar */}
        <aside className="flex flex-col border-r bg-muted/30 shrink-0 relative" style={{ width: sidebar.width }}>
          <div className="p-3 border-b space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Редакционная политика</p>
            <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() => filePolicyInput.current?.click()} disabled={policyLoading}>
              <Upload className="h-3.5 w-3.5 mr-1.5" />Загрузить политику
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
                <Sparkles className="h-3.5 w-3.5 mr-1.5" />{policyLoading ? "AI-парсинг…" : "Разобрать правила"}
              </Button>
            )}
          </div>

          <nav className="flex flex-col gap-1 p-2">
            {(["violations", "rules", "stats"] as Panel[]).map((key) => {
              const labels: Record<Panel, string> = { violations: "Нарушения", rules: "Правила политики", stats: "Статистика" };
              const icons: Record<Panel, typeof FileText> = { violations: AlertTriangle, rules: BookOpen, stats: Info };
              const Icon = icons[key];
              return (
                <button key={key} type="button" onClick={() => setPanel(key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm w-full text-left transition-colors ${
                    panel === key ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{labels[key]}</span>
                  {key === "violations" && violations.length > 0 && (
                    <Badge variant={stats.errors > 0 ? "destructive" : "secondary"} className="ml-auto text-[10px] px-1.5">{violations.length}</Badge>
                  )}
                  {key === "rules" && policyRules.length > 0 && (
                    <Badge variant="secondary" className="ml-auto text-[10px] px-1.5">{policyRules.length}</Badge>
                  )}
                </button>
              );
            })}
          </nav>
          <div className="absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors" style={{ left: sidebar.width - 1 }} onMouseDown={sidebar.onMouseDown} />
        </aside>

        {/* Document area */}
        <main className="flex-1 flex flex-col min-w-0 relative">
          {editMode && (
            <div className="h-9 border-b flex items-center gap-1 px-3 bg-muted/20 shrink-0">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => document.execCommand("bold")}><Bold className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => document.execCommand("italic")}><Italic className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => document.execCommand("insertUnorderedList")}><List className="h-3.5 w-3.5" /></Button>
              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setDraft(docText); setEditMode(false); }}><RotateCcw className="h-3 w-3 mr-1" />Отмена</Button>
                <Button size="sm" className="h-7 text-xs" onClick={() => { setDocText(draft); setEditMode(false); toast({ title: "Сохранено" }); }}><Save className="h-3.5 w-3.5 mr-1" />Сохранить</Button>
              </div>
            </div>
          )}

          <ScrollArea className="flex-1">
            {!editMode ? (
              <div className="p-6 min-h-full font-mono text-sm leading-relaxed whitespace-pre-wrap select-text">
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
                    <p className="text-xs">Поддерживаются .docx, .txt, .md или Google Docs по ссылке</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 min-h-full font-mono text-sm leading-relaxed outline-none whitespace-pre-wrap cursor-text"
                contentEditable suppressContentEditableWarning
                onInput={(e) => setDraft((e.target as HTMLDivElement).innerText)}
              >{docText}</div>
            )}
          </ScrollArea>

          {!editMode && docText && (
            <button type="button"
              className="absolute bottom-4 right-4 h-9 w-9 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
              onClick={() => setEditMode(true)} title="Редактировать документ"
            ><PenSquare className="h-4 w-4" /></button>
          )}
        </main>

        {/* Right inspector panel */}
        <div className="flex flex-col border-l bg-background shrink-0 relative" style={{ width: rightPanel.width }}>
          <div className="absolute top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10" style={{ left: 0 }} onMouseDown={rightPanel.onMouseDown} />
          <ScrollArea className="flex-1">
            <div className="p-4">

              {/* Violations panel */}
              {panel === "violations" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Нарушения</h2>
                    <Badge variant="outline" className="text-[10px]">{violations.length}</Badge>
                  </div>

                  <div className="flex gap-1.5">
                    <Select value={catFilter} onValueChange={setCatFilter}>
                      <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">Все категории</SelectItem>
                        {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k} className="text-xs">{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={sevFilter} onValueChange={setSevFilter}>
                      <SelectTrigger className="h-7 w-[100px] text-xs"><SelectValue /></SelectTrigger>
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
                            className={`w-full text-left rounded-md px-3 py-2 text-xs transition-colors border ${
                              isSel ? "bg-primary/10 border-primary/30" : "hover:bg-muted border-transparent hover:border-border"
                            }`}
                            onClick={() => scrollToViolation(v)}
                          >
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <span className={legendDotClass(v)} />
                              {SEVERITY_ICON[v.severity]}
                              <span className="font-medium">{CATEGORY_LABELS[v.category]}</span>
                              {v.source === "heuristic" && <Badge variant="outline" className="text-[9px] px-1 h-3.5">эвристика</Badge>}
                              {v.confidence !== undefined && <span className="ml-auto text-[10px] text-muted-foreground">{Math.round(v.confidence * 100)}%</span>}
                            </div>
                            <div className="text-muted-foreground truncate">«{v.matchedText}»</div>
                            {v.explanation && <div className="text-[10px] text-muted-foreground/70 mt-0.5 line-clamp-2">{v.explanation}</div>}
                            {v.suggestion && (
                              <div className="mt-1 text-[10px] flex items-center gap-1 text-primary">
                                <ChevronRight className="h-3 w-3" />→ {v.suggestion}
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Rules panel */}
              {panel === "rules" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Правила политики</h2>
                    <Badge variant="outline" className="text-[10px]">{policyRules.length}</Badge>
                  </div>
                  {policyRules.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Загрузите политику и запустите AI-парсинг.</p>
                  ) : (
                    <div className="space-y-2">
                      {policyRules.map((rule) => (
                        <div key={rule.id} className="rounded-md border p-3 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <Badge variant={rule.severity === "error" ? "destructive" : rule.severity === "warning" ? "secondary" : "outline"} className="text-[10px]">
                              {CATEGORY_LABELS[rule.category] ?? rule.category}
                            </Badge>
                            {rule.source && <span className="text-[10px] text-muted-foreground">{rule.source}</span>}
                          </div>
                          <p className="text-xs font-medium">{rule.name}</p>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">{rule.description}</p>
                          {rule.examples?.map((ex, i) => (
                            <div key={i} className="text-[10px] space-y-0.5 pt-1">
                              <div className="text-destructive">✗ {ex.bad}</div>
                              <div className="text-green-600 dark:text-green-400">✓ {ex.good}</div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Stats panel */}
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
                      <div key={label} className="rounded-md border p-3">
                        <div className={`text-xl font-bold ${color ?? ""}`}>{value}</div>
                        <div className="text-[11px] text-muted-foreground">{label}</div>
                      </div>
                    ))}
                  </div>
                  {checkResult?.summary && (
                    <div className="rounded-md bg-muted/40 p-3">
                      <p className="text-xs text-muted-foreground">{checkResult.summary}</p>
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
