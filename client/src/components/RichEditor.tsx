/**
 * RichEditor.tsx
 * Contenteditable-based rich text editor with formatting toolbar.
 * Preserves imported HTML structure (headings, bold, italic, lists, etc.).
 */

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import {
  Bold, Italic, Underline, Strikethrough,
  Heading1, Heading2, Heading3,
  List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight,
  Undo2, Redo2,
  RemoveFormatting,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface RichEditorHandle {
  getHtml: () => string;
  getText: () => string;
  setHtml: (html: string) => void;
  focus:   () => void;
}

interface Props {
  initialHtml: string;
  readOnly?:   boolean;
  onChange?:   (html: string, text: string) => void;
  className?:  string;
}

type Cmd =
  | { type: "exec"; cmd: string; arg?: string }
  | { type: "block"; tag: string };

const TOOLBAR_GROUPS: { label: string; items: { title: string; icon: React.ReactNode; cmd: Cmd }[] }[] = [
  {
    label: "Undo",
    items: [
      { title: "Отменить (Ctrl+Z)",    icon: <Undo2 className="h-4 w-4" />,  cmd: { type: "exec", cmd: "undo" } },
      { title: "Повторить (Ctrl+Y)",   icon: <Redo2 className="h-4 w-4" />,  cmd: { type: "exec", cmd: "redo" } },
    ],
  },
  {
    label: "Format",
    items: [
      { title: "Жирный (Ctrl+B)",      icon: <Bold          className="h-4 w-4" />, cmd: { type: "exec", cmd: "bold" } },
      { title: "Курсив (Ctrl+I)",      icon: <Italic        className="h-4 w-4" />, cmd: { type: "exec", cmd: "italic" } },
      { title: "Подчёркнутый (Ctrl+U)",icon: <Underline     className="h-4 w-4" />, cmd: { type: "exec", cmd: "underline" } },
      { title: "Зачёркнутый",          icon: <Strikethrough className="h-4 w-4" />, cmd: { type: "exec", cmd: "strikeThrough" } },
    ],
  },
  {
    label: "Headings",
    items: [
      { title: "Заголовок 1", icon: <Heading1 className="h-4 w-4" />, cmd: { type: "block", tag: "H1" } },
      { title: "Заголовок 2", icon: <Heading2 className="h-4 w-4" />, cmd: { type: "block", tag: "H2" } },
      { title: "Заголовок 3", icon: <Heading3 className="h-4 w-4" />, cmd: { type: "block", tag: "H3" } },
    ],
  },
  {
    label: "Lists",
    items: [
      { title: "Маркированный список",  icon: <List        className="h-4 w-4" />, cmd: { type: "exec", cmd: "insertUnorderedList" } },
      { title: "Нумерованный список",   icon: <ListOrdered className="h-4 w-4" />, cmd: { type: "exec", cmd: "insertOrderedList" } },
    ],
  },
  {
    label: "Align",
    items: [
      { title: "По левому краю",  icon: <AlignLeft   className="h-4 w-4" />, cmd: { type: "exec", cmd: "justifyLeft" } },
      { title: "По центру",       icon: <AlignCenter className="h-4 w-4" />, cmd: { type: "exec", cmd: "justifyCenter" } },
      { title: "По правому краю", icon: <AlignRight  className="h-4 w-4" />, cmd: { type: "exec", cmd: "justifyRight" } },
    ],
  },
  {
    label: "Clear",
    items: [
      { title: "Сбросить форматирование", icon: <RemoveFormatting className="h-4 w-4" />, cmd: { type: "exec", cmd: "removeFormat" } },
    ],
  },
];

const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { initialHtml, readOnly = false, onChange, className = "" },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);

  // Sync initial HTML once
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== initialHtml) {
      editorRef.current.innerHTML = initialHtml;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync when initialHtml changes (new document loaded)
  const prevHtmlRef = useRef(initialHtml);
  useEffect(() => {
    if (initialHtml !== prevHtmlRef.current) {
      prevHtmlRef.current = initialHtml;
      if (editorRef.current) {
        editorRef.current.innerHTML = initialHtml;
      }
    }
  }, [initialHtml]);

  const getHtml = useCallback(() => editorRef.current?.innerHTML ?? "", []);
  const getText = useCallback(() => editorRef.current?.innerText ?? "", []);
  const setHtml = useCallback((html: string) => {
    if (editorRef.current) editorRef.current.innerHTML = html;
  }, []);
  const focus = useCallback(() => editorRef.current?.focus(), []);

  useImperativeHandle(ref, () => ({ getHtml, getText, setHtml, focus }), [getHtml, getText, setHtml, focus]);

  const execCmd = useCallback((cmd: Cmd) => {
    if (readOnly) return;
    editorRef.current?.focus();
    if (cmd.type === "exec") {
      document.execCommand(cmd.cmd, false, cmd.arg ?? undefined);
    } else {
      // Block-level formatting: wrap selection in tag
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      // Toggle: if already inside this tag, unwrap → p; otherwise wrap
      const ancestor = range.commonAncestorContainer;
      const block    = (ancestor instanceof Element ? ancestor : ancestor.parentElement)?.closest(cmd.tag.toLowerCase());
      if (block) {
        document.execCommand("formatBlock", false, "p");
      } else {
        document.execCommand("formatBlock", false, cmd.tag);
      }
    }
    if (onChange && editorRef.current) {
      onChange(editorRef.current.innerHTML, editorRef.current.innerText);
    }
  }, [readOnly, onChange]);

  const handleInput = useCallback(() => {
    if (onChange && editorRef.current) {
      onChange(editorRef.current.innerHTML, editorRef.current.innerText);
    }
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Ctrl+B/I/U are handled natively by contenteditable
    // Prevent default tab (insert 4 spaces instead)
    if (e.key === "Tab") {
      e.preventDefault();
      document.execCommand("insertHTML", false, "\u00a0\u00a0\u00a0\u00a0");
    }
  }, []);

  return (
    <div className={`flex flex-col min-h-0 overflow-hidden ${className}`}>
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b bg-muted/30 shrink-0">
          {TOOLBAR_GROUPS.map((group, gi) => (
            <div key={gi} className="flex items-center gap-0.5">
              {gi > 0 && <Separator orientation="vertical" className="h-5 mx-1" />}
              {group.items.map((item) => (
                <Button
                  key={item.title}
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded"
                  title={item.title}
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent blur
                    execCmd(item.cmd);
                  }}
                >
                  {item.icon}
                </Button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Editable area */}
      <ScrollArea className="flex-1 min-h-0">
        <div
          ref={editorRef}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          spellCheck
          className={[
            "min-h-full p-6 outline-none text-sm leading-relaxed",
            "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:leading-tight",
            "[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:leading-tight",
            "[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4",
            "[&_h4]:text-base [&_h4]:font-semibold [&_h4]:mb-1 [&_h4]:mt-3",
            "[&_p]:mb-3 [&_p]:last:mb-0",
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
            readOnly ? "select-text cursor-text" : "cursor-text",
            "font-mono",
          ].join(" ")}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
        />
      </ScrollArea>
    </div>
  );
});

export default RichEditor;
