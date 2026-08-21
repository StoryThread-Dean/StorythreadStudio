// ReaderMode.tsx -- Full-screen manuscript reader overlay
// =========================================================
//
// Pages mode architecture (two-page book spread):
//   Text flows through CSS `columns: 2` at a FIXED size based on
//   standard trade paperback dimensions (6" × 9" ≈ 440px × 680px per page).
//   The two page cards are centered in the available space and do NOT
//   resize when the app window grows -- they stay fixed, like holding a
//   physical book. If the window is smaller than the spread, the centering
//   wrapper shows scrollbars so the reader can pan to see both pages.
//
//   Each chapter is forced to start at the top of a new page via
//   `break-before: column` in CSS.
//
//   Navigation: clicking prev/next (or keyboard arrows, or mouse wheel)
//   advances by one spread (both pages) by incrementing `scrollLeft` on
//   the clip container by SPREAD_W pixels.
//
// Scroll mode:
//   Normal vertical overflow, single 680px-wide reading column, centered.
//
// Index panel:
//   Default open (240px). Click the collapse arrow → mini 40px dot strip.
//   Click the List icon on the strip → back to open.

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import {
  X, ChevronLeft, ChevronRight,
  Search, Settings2, List,
  Sun, Moon,
} from "lucide-react";
import { FONT_OPTIONS } from "../components/EditorToolbar";

const API_BASE   = "http://localhost:8000";
const SETTINGS_KEY = "storythread-reader-settings";

// ── Book page dimensions ───────────────────────────────────────────────────────
// Based on the 6" × 9" trade paperback (most common fiction format), scaled up
// 20% so the pages feel substantial on a modern monitor. These are fixed
// regardless of window size -- the pages are "paper", not fluid web columns.
const PAGE_W        = 528;       // px -- one page width
const PAGE_H        = 816;       // px -- one page height
const GUTTER_FRAME  = 80;        // px -- column-gap (spine between left and right page)
const PAGE_MARGIN_H = 40;        // px -- horizontal text margin (applied on chapter elements)
const PAGE_MARGIN_V = 24;        // px -- vertical text margin at chapter start
const SPREAD_W      = PAGE_W * 2 + GUTTER_FRAME;  // px -- visual spread width (container) = 1136px
//
// NAV_SPREAD_W: the actual pixels to scroll per spread advance.
// CSS `columns` inserts GUTTER_FRAME between EVERY pair of consecutive columns,
// including between spreads. Column 1 is at x=0, column 3 (spread 2) is at
// x = 2*(PAGE_W + GUTTER_FRAME) = 1216, not SPREAD_W=1136. The difference is
// always one extra GUTTER_FRAME, so: NAV_SPREAD_W = SPREAD_W + GUTTER_FRAME.
const NAV_SPREAD_W  = SPREAD_W + GUTTER_FRAME;    // px -- scroll distance per spread = 1216px

// ── Types ──────────────────────────────────────────────────────────────────────

interface Chapter { filename: string; title: string; content: string; }
type ReadMode    = "pages" | "scroll";
type ReaderTheme = "dark"  | "light";
type IndexState  = "open"  | "mini";

interface ReaderSettings {
  fontFamily:  string;
  fontSize:    number;
  lineSpacing: number;
  theme:       ReaderTheme;
  mode:        ReadMode;
}

const DEFAULT_SETTINGS: ReaderSettings = {
  fontFamily:  "'Georgia', serif",
  fontSize:    18,
  lineSpacing: 1.6,
  theme:       "dark",
  mode:        "pages",
};

const FONT_SIZE_OPTIONS    = [14, 16, 18, 20, 22, 24];
const LINE_SPACING_OPTIONS = [1.0, 1.25, 1.5, 1.75, 2.0];
const INDEX_OPEN_W  = 240;
const INDEX_MINI_W  = 40;

// ── Markdown → HTML ────────────────────────────────────────────────────────────
// Each chapter becomes a <div class="reader-chapter"> (or "reader-chapter-first"
// for the opening chapter). Non-first chapters get `break-before: column` via CSS
// so every chapter starts at the top of its own page.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineHtml(text: string): string {
  let s = esc(text);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
  s = s.replace(/_(.+?)_/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

function mdToHtml(markdown: string, chapterId: string, isFirst: boolean): string {
  const lines = markdown.split("\n");
  const cls   = isFirst ? "reader-chapter reader-chapter-first" : "reader-chapter";
  let html    = `<div class="${cls}" id="${chapterId}">`;
  let inPara  = false;

  const closePara = () => { if (inPara) { html += "</p>"; inPara = false; } };

  for (const raw of lines) {
    const t = raw.trim();
    const hm = t.match(/^(#{1,3})\s+(.+)$/);
    if (hm) {
      closePara();
      html += `<h${hm[1].length}>${inlineHtml(hm[2])}</h${hm[1].length}>`;
      continue;
    }
    if (t === "---" || t === "* * *" || t === "***") {
      closePara();
      html += `<div class="reader-scene-break">* * *</div>`;
      continue;
    }
    if (t === "") { closePara(); continue; }
    if (!inPara) { html += "<p>"; inPara = true; } else { html += " "; }
    html += inlineHtml(t);
  }
  closePara();
  html += "</div>";
  return html;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface ReaderModeProps {
  projectPath: string;
  onClose: () => void;
}

export function ReaderMode({ projectPath, onClose }: ReaderModeProps) {

  // ── Settings ───────────────────────────────────────────────────────────────
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    try {
      const s = localStorage.getItem(SETTINGS_KEY);
      if (s) return { ...DEFAULT_SETTINGS, ...JSON.parse(s) };
    } catch { /* ignore */ }
    return DEFAULT_SETTINGS;
  });

  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // ── Data ───────────────────────────────────────────────────────────────────
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/documents/manuscript-content?folder_path=${encodeURIComponent(projectPath)}`)
      .then(r => r.ok ? r.json() : r.json().then((e: { detail?: string }) => Promise.reject(e.detail ?? "Load failed")))
      .then((data: Chapter[]) => { setChapters(data); setLoading(false); })
      .catch((e: unknown) => { setError(String(e)); setLoading(false); });
  }, [projectPath]);

  const fullHtml = chapters.map((ch, i) =>
    mdToHtml(ch.content, `chapter-${ch.filename}`, i === 0)
  ).join("\n");

  // ── Index panel ────────────────────────────────────────────────────────────
  const [indexState, setIndexState]  = useState<IndexState>("open");
  const toggleIndex = useCallback(() => setIndexState(s => s === "open" ? "mini" : "open"), []);

  // ── Navigation state (Pages mode) ─────────────────────────────────────────
  const [currentSpread, setCurrentSpread] = useState(1);
  const [totalSpreads, setTotalSpreads]   = useState(1);
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0);

  // ── Search state ───────────────────────────────────────────────────────────
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch]     = useState(false);
  const [searchQuery, setSearchQuery]   = useState("");
  const [searchHits, setSearchHits]     = useState(0);
  const [searchCurrent, setSearchCurrent] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── DOM refs ───────────────────────────────────────────────────────────────
  // clipRef: the overflow:auto scroll container (scrollbarWidth:none hides the
  //          native bar). overflow:auto is critical -- overflow:hidden causes
  //          Chrome/Blink to report scrollWidth === clientWidth, which breaks
  //          scrollLeft-based spread navigation entirely.
  // centerRef: the centering wrapper. overflow:auto shows scrollbars when the
  //            window is smaller than the spread so the reader can still pan.
  const clipRef   = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const wheelCooldown = useRef(false);

  // ── Spread count ───────────────────────────────────────────────────────────
  const recalcSpreads = useCallback(() => {
    if (settings.mode !== "pages" || !clipRef.current) return;
    const el = clipRef.current;
    const total = Math.max(1, Math.ceil(el.scrollWidth / NAV_SPREAD_W));
    setTotalSpreads(total);
    const cur = Math.floor(el.scrollLeft / NAV_SPREAD_W) + 1;
    setCurrentSpread(Math.max(1, Math.min(cur, total)));
  }, [settings.mode]);

  useLayoutEffect(() => { recalcSpreads(); }, [recalcSpreads, fullHtml, settings]);
  useEffect(() => { window.addEventListener("resize", recalcSpreads); return () => window.removeEventListener("resize", recalcSpreads); }, [recalcSpreads]);

  // ── Spread navigation ──────────────────────────────────────────────────────
  const goToSpread = useCallback((spread: number) => {
    if (!clipRef.current) return;
    const clamped = Math.max(1, Math.min(spread, totalSpreads));
    clipRef.current.scrollLeft = (clamped - 1) * NAV_SPREAD_W;
    setCurrentSpread(clamped);
  }, [totalSpreads]);

  const nextSpread = useCallback(() => {
    if (!clipRef.current) return;
    const cur = Math.floor(clipRef.current.scrollLeft / NAV_SPREAD_W) + 1;
    goToSpread(cur + 1);
  }, [goToSpread]);

  const prevSpread = useCallback(() => {
    if (!clipRef.current) return;
    const cur = Math.floor(clipRef.current.scrollLeft / NAV_SPREAD_W) + 1;
    goToSpread(cur - 1);
  }, [goToSpread]);

  // ── Mouse wheel → spread advance ──────────────────────────────────────────
  // Intercept wheel on the centering wrapper. `passive: false` lets us call
  // preventDefault() to stop the centering-wrapper from also scrolling.
  // (If the window is so small the user NEEDS to pan, they use the scrollbar.)
  useEffect(() => {
    const el = centerRef.current;
    if (!el || settings.mode !== "pages") return;

    const handle = (e: WheelEvent) => {
      // Only intercept vertical wheel -- horizontal scrolling still works for panning.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (wheelCooldown.current) return;
      wheelCooldown.current = true;
      if (e.deltaY > 0) nextSpread();
      else if (e.deltaY < 0) prevSpread();
      setTimeout(() => { wheelCooldown.current = false; }, 350);
    };

    el.addEventListener("wheel", handle, { passive: false });
    return () => el.removeEventListener("wheel", handle);
  }, [settings.mode, nextSpread, prevSpread]);

  // ── Chapter navigation ─────────────────────────────────────────────────────
  const goToChapter = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(idx, chapters.length - 1));
    setCurrentChapterIdx(clamped);

    const id = `chapter-${chapters[clamped]?.filename}`;
    const el = document.getElementById(id);
    if (!el) return;

    if (settings.mode === "scroll") {
      el.scrollIntoView({ behavior: "smooth" });
      return;
    }

    if (!clipRef.current) return;
    // In CSS columns, the element's offsetLeft gives its position within the
    // multi-column layout. Divide by NAV_SPREAD_W to get the spread index.
    const targetSpread = Math.floor(el.offsetLeft / NAV_SPREAD_W) + 1;
    goToSpread(targetSpread);
  }, [chapters, settings.mode, goToSpread]);

  // ── Search ─────────────────────────────────────────────────────────────────
  const clearHighlights = useCallback(() => {
    clipRef.current?.querySelectorAll("mark.reader-hi").forEach(m => {
      const p = m.parentNode;
      if (!p) return;
      p.replaceChild(document.createTextNode(m.textContent ?? ""), m);
      p.normalize();
    });
  }, []);

  const scrollMarkIntoView = useCallback((mark: HTMLElement) => {
    if (settings.mode === "pages" && clipRef.current) {
      const spread = Math.floor(mark.offsetLeft / NAV_SPREAD_W) + 1;
      goToSpread(spread);
    } else {
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [settings.mode, goToSpread]);

  const runSearch = useCallback((query: string) => {
    clearHighlights();
    if (!query.trim() || !clipRef.current) { setSearchHits(0); setSearchCurrent(0); return; }

    const walker = document.createTreeWalker(clipRef.current, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) textNodes.push(node as Text);

    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    let count = 0;

    textNodes.forEach(tn => {
      const text = tn.textContent ?? "";
      if (!re.test(text)) return;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0; let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const mark = document.createElement("mark");
        mark.className = "reader-hi"; mark.textContent = m[0];
        frag.appendChild(mark); last = re.lastIndex; count++;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      tn.parentNode?.replaceChild(frag, tn);
    });

    setSearchHits(count); setSearchCurrent(count > 0 ? 1 : 0);
    const first = clipRef.current.querySelector<HTMLElement>("mark.reader-hi");
    if (first) scrollMarkIntoView(first);
  }, [clearHighlights, scrollMarkIntoView]);

  const navSearch = useCallback((dir: 1 | -1) => {
    if (!clipRef.current || searchHits === 0) return;
    const marks = clipRef.current.querySelectorAll<HTMLElement>("mark.reader-hi");
    const next = ((searchCurrent - 1 + dir + marks.length) % marks.length);
    setSearchCurrent(next + 1);
    marks.forEach(m => m.classList.remove("reader-hi-current"));
    marks[next]?.classList.add("reader-hi-current");
    if (marks[next]) scrollMarkIntoView(marks[next]);
  }, [searchCurrent, searchHits, scrollMarkIntoView]);

  useEffect(() => {
    if (showSearch) setTimeout(() => searchInputRef.current?.focus(), 50);
    else { clearHighlights(); setSearchQuery(""); setSearchHits(0); setSearchCurrent(0); }
  }, [showSearch, clearHighlights]);

  // ── Keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (showSearch) { setShowSearch(false); return; } onClose(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") { e.preventDefault(); setShowSearch(s => !s); }
      if (settings.mode === "pages") {
        if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); nextSpread(); }
        if (e.key === "ArrowLeft"  || e.key === "PageUp")   { e.preventDefault(); prevSpread(); }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, showSearch, settings.mode, nextSpread, prevSpread]);

  // ── Colors ─────────────────────────────────────────────────────────────────
  const isDark   = settings.theme === "dark";
  // Outer background (the "room" around the pages)
  const outerBg  = isDark ? "#0F172A" : "#E8E0D5";
  // Page card color -- always paper-like; dark mode = dim amber, light = cream
  const pageBg   = isDark ? "#1C2333" : "#FAFAF2";
  const pageText  = isDark ? "#D8D0C4" : "#1A1814";
  const panelBg  = isDark ? "#1E293B" : "#EDE4D6";
  const mutedFg  = isDark ? "#6B7280" : "#6B5C4A";
  const borderC  = isDark ? "#2D3748" : "#C8B89A";
  const accent   = isDark ? "#3B82F6" : "#2563EB";
  // Shadow on page cards
  const pageShadow = isDark
    ? "0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)"
    : "0 4px 20px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.1)";

  // ── Spread label (bottom bar) ──────────────────────────────────────────────
  const leftPage  = (currentSpread - 1) * 2 + 1;
  const rightPage = currentSpread * 2;
  const totalPages = totalSpreads * 2;

  // ── Loading / error ────────────────────────────────────────────────────────
  if (loading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: outerBg }}>
      <p className="text-sm" style={{ color: mutedFg, fontFamily: settings.fontFamily }}>Loading manuscript...</p>
    </div>
  );
  if (error) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: outerBg }}>
      <div className="text-center">
        <p className="mb-4 text-sm" style={{ color: "#F87171" }}>{error}</p>
        <button onClick={onClose} style={{ color: "#F87171", border: "1px solid #F87171" }} className="rounded px-4 py-2 text-sm">Close</button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: outerBg }}>

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="flex h-12 shrink-0 items-center gap-1 px-3" style={{ borderBottom: `1px solid ${borderC}`, background: panelBg }}>
        {/* Chapter prev/next */}
        <TopBarBtn icon={<ChevronLeft  size={16} />} label="Previous chapter" isDark={isDark} disabled={currentChapterIdx === 0}                onClick={() => goToChapter(currentChapterIdx - 1)} />
        <span className="min-w-0 max-w-52 truncate px-1 text-xs" style={{ color: mutedFg }}>
          {chapters[currentChapterIdx]?.title ?? ""}
          <span className="ml-1 opacity-50">({currentChapterIdx + 1} / {chapters.length})</span>
        </span>
        <TopBarBtn icon={<ChevronRight size={16} />} label="Next chapter"     isDark={isDark} disabled={currentChapterIdx === chapters.length - 1} onClick={() => goToChapter(currentChapterIdx + 1)} />

        <div className="flex-1" />

        {/* Inline search */}
        {showSearch && (
          <div className="flex items-center gap-1">
            <input ref={searchInputRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") { e.shiftKey ? navSearch(-1) : navSearch(1); }
                if (e.key === "Escape") setShowSearch(false);
              }}
              placeholder="Search..." className="rounded border px-2 py-0.5 text-xs outline-none"
              style={{ background: pageBg, borderColor: borderC, color: pageText, width: 160 }} />
            <button onClick={() => runSearch(searchQuery)} className="rounded px-2 py-0.5 text-xs text-white" style={{ background: accent }}>Go</button>
            {searchHits > 0 && (
              <>
                <span className="text-xs" style={{ color: mutedFg }}>{searchCurrent} / {searchHits}</span>
                <TopBarBtn icon={<ChevronLeft  size={14} />} label="Prev match" isDark={isDark} onClick={() => navSearch(-1)} />
                <TopBarBtn icon={<ChevronRight size={14} />} label="Next match" isDark={isDark} onClick={() => navSearch(1)}  />
              </>
            )}
          </div>
        )}

        <TopBarBtn icon={<Search    size={16} />} label="Search (Ctrl+F)"  active={showSearch}   isDark={isDark} onClick={() => { setShowSearch(s => !s); setShowSettings(false); }} />
        <div className="flex overflow-hidden rounded border text-xs" style={{ borderColor: borderC }}>
          <ModeBtn label="Pages"  active={settings.mode === "pages"}  isDark={isDark} accent={accent} onClick={() => updateSettings({ mode: "pages"  })} />
          <ModeBtn label="Scroll" active={settings.mode === "scroll"} isDark={isDark} accent={accent} onClick={() => updateSettings({ mode: "scroll" })} />
        </div>
        <TopBarBtn icon={<Settings2 size={16} />} label="Display settings" active={showSettings} isDark={isDark} onClick={() => { setShowSettings(s => !s); setShowSearch(false); }} />
        <TopBarBtn icon={isDark ? <Sun size={16} /> : <Moon size={16} />} label="Toggle theme" isDark={isDark} onClick={() => updateSettings({ theme: isDark ? "light" : "dark" })} />
        <TopBarBtn icon={<X size={16} />} label="Close reader (Esc)" isDark={isDark} onClick={onClose} />
      </div>

      {/* ── Body row ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Index panel (persistent flex child, transitions between 240/40px) */}
        <div className="shrink-0 overflow-hidden flex flex-col" style={{
          width: indexState === "open" ? INDEX_OPEN_W : INDEX_MINI_W,
          minWidth: indexState === "open" ? INDEX_OPEN_W : INDEX_MINI_W,
          transition: "width 200ms ease, min-width 200ms ease",
          borderRight: `1px solid ${borderC}`,
          background: panelBg,
        }}>
          {indexState === "open" ? (
            <div className="flex flex-col" style={{ width: INDEX_OPEN_W }}>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-micro font-semibold uppercase tracking-widest" style={{ color: mutedFg }}>Chapters</span>
                <button onClick={toggleIndex} title="Collapse" className="flex h-6 w-6 items-center justify-center rounded" style={{ color: mutedFg }}>
                  <ChevronLeft size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto pb-4">
                {chapters.map((ch, idx) => (
                  <button key={ch.filename} onClick={() => goToChapter(idx)}
                    className="block w-full truncate rounded px-3 py-1.5 text-left text-sm transition-colors"
                    style={{ color: idx === currentChapterIdx ? accent : mutedFg, background: idx === currentChapterIdx ? (isDark ? "#1D4ED820" : "#DBEAFE60") : "transparent" }}
                    title={ch.title}>
                    {ch.title}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center" style={{ width: INDEX_MINI_W }}>
              <button onClick={toggleIndex} title="Expand chapter list" className="mt-2 flex h-7 w-7 items-center justify-center rounded" style={{ color: mutedFg }}>
                <List size={14} />
              </button>
              <div className="mt-2 flex flex-col items-center gap-1.5 overflow-y-auto pb-4">
                {chapters.map((ch, idx) => (
                  <button key={ch.filename} onClick={() => goToChapter(idx)} title={ch.title}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-micro font-medium"
                    style={{ background: idx === currentChapterIdx ? accent : (isDark ? "#374151" : "#C8B89A"), color: idx === currentChapterIdx ? "#fff" : mutedFg }}>
                    {idx + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Settings dropdown ──────────────────────────────────────────────── */}
        {showSettings && (
          <div className="absolute right-0 z-20 w-64 p-4" style={{ top: 48, background: panelBg, borderLeft: `1px solid ${borderC}`, borderBottom: `1px solid ${borderC}` }}>
            <label className="mb-1 block text-xs font-medium" style={{ color: mutedFg }}>Font</label>
            <select value={settings.fontFamily} onChange={e => updateSettings({ fontFamily: e.target.value })}
              className="mb-3 w-full rounded border px-2 py-1 text-xs outline-none"
              style={{ background: pageBg, borderColor: borderC, color: pageText, fontFamily: settings.fontFamily }}>
              {FONT_OPTIONS.map(f => <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>)}
            </select>

            <label className="mb-1 block text-xs font-medium" style={{ color: mutedFg }}>Size</label>
            <div className="mb-3 flex flex-wrap gap-1">
              {FONT_SIZE_OPTIONS.map(sz => (
                <button key={sz} onClick={() => updateSettings({ fontSize: sz })}
                  className="rounded px-2 py-0.5 text-xs"
                  style={{ background: settings.fontSize === sz ? accent : (isDark ? "#1E293B" : "#D4C4A8"), color: settings.fontSize === sz ? "#fff" : pageText, border: `1px solid ${borderC}` }}>
                  {sz}px
                </button>
              ))}
            </div>

            <label className="mb-1 block text-xs font-medium" style={{ color: mutedFg }}>Line Spacing</label>
            <div className="flex flex-wrap gap-1">
              {LINE_SPACING_OPTIONS.map(sp => (
                <button key={sp} onClick={() => updateSettings({ lineSpacing: sp })}
                  className="rounded px-2 py-0.5 text-xs"
                  style={{ background: settings.lineSpacing === sp ? accent : (isDark ? "#1E293B" : "#D4C4A8"), color: settings.lineSpacing === sp ? "#fff" : pageText, border: `1px solid ${borderC}` }}>
                  {sp}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Content area ──────────────────────────────────────────────────── */}
        <div
          ref={centerRef}
          className="flex flex-1 items-center justify-center overflow-auto"
          style={{ background: outerBg }}
        >
          {settings.mode === "pages" ? (
            // ── TWO-PAGE SPREAD ──────────────────────────────────────────────
            // The spread is fixed-size (SPREAD_W × PAGE_H). Two decorative page
            // frames sit behind the text content. The clip container uses
            // overflow:hidden + scrollLeft for pagination. The centering wrapper
            // handles showing scrollbars if the window is too small.
            <div style={{ position: "relative", width: SPREAD_W, height: PAGE_H, flexShrink: 0, margin: "32px" }}>

              {/* Left page frame (decorative) */}
              <div style={{
                position: "absolute", left: 0, top: 0,
                width: PAGE_W, height: PAGE_H,
                background: pageBg, boxShadow: pageShadow, borderRadius: 2,
              }} />

              {/* Spine / gutter (shows outer background) */}
              {/* No element needed -- the gap between frames shows outerBg */}

              {/* Right page frame (decorative) */}
              <div style={{
                position: "absolute", left: PAGE_W + GUTTER_FRAME, top: 0,
                width: PAGE_W, height: PAGE_H,
                background: pageBg, boxShadow: pageShadow, borderRadius: 2,
              }} />

              {/* ── Clip container ────────────────────────────────────────── */}
              {/* overflow:auto + scrollbarWidth:none gives correct scrollWidth
                  for multicol navigation. overflow:hidden breaks it in Chrome
                  because hidden containers report scrollWidth = clientWidth. */}
              <div
                ref={clipRef}
                className="reader-clip"
                style={{
                  position: "absolute", inset: 0,
                  overflowX: "auto",
                  overflowY: "hidden",
                  scrollbarWidth: "none",
                  zIndex: 1,
                }}
              >
                {/* ── Column content ──────────────────────────────────────── */}
                {/* Padding on the multicol container (box-sizing:border-box)
                    applies uniform margins to ALL columns, including mid-chapter
                    continuation pages where element-level padding would be
                    ignored by the CSS multicol fragmentation algorithm. */}
                <div
                  style={{
                    height: PAGE_H,
                    columns: 2,
                    columnGap: GUTTER_FRAME,
                    columnFill: "auto",
                    background: "transparent",
                    fontFamily: settings.fontFamily,
                    fontSize:   settings.fontSize,
                    lineHeight: settings.lineSpacing,
                    color:      pageText,
                  }}
                  dangerouslySetInnerHTML={{ __html: fullHtml }}
                />
              </div>
            </div>
          ) : (
            // ── SCROLL MODE ──────────────────────────────────────────────────
            // Single page-width reading column, vertically scrollable.
            <div style={{ width: PAGE_W, minHeight: "100%", background: pageBg, boxShadow: pageShadow, margin: "32px auto", padding: "48px 40px", borderRadius: 2 }}>
              <div
                style={{ fontFamily: settings.fontFamily, fontSize: settings.fontSize, lineHeight: settings.lineSpacing, color: pageText }}
                dangerouslySetInnerHTML={{ __html: fullHtml }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom bar ────────────────────────────────────────────────────────── */}
      <div className="flex h-10 shrink-0 items-center gap-3 px-4" style={{ borderTop: `1px solid ${borderC}`, background: panelBg }}>
        {settings.mode === "pages" ? (
          <>
            <button onClick={prevSpread} disabled={currentSpread <= 1} className="rounded p-1 disabled:opacity-30" style={{ color: mutedFg }} title="Previous spread (←)">
              <ChevronLeft size={14} />
            </button>

            {/* Progress bar spanning full width */}
            <div className="flex-1 overflow-hidden rounded-full" style={{ height: 4, background: borderC }}>
              <div className="h-full rounded-full transition-all duration-150" style={{
                width: `${totalSpreads > 1 ? ((currentSpread - 1) / (totalSpreads - 1)) * 100 : 100}%`,
                background: accent,
              }} />
            </div>

            <span className="shrink-0 text-xs tabular-nums" style={{ color: mutedFg }}>
              {leftPage}–{rightPage} / {totalPages}
            </span>

            <button onClick={nextSpread} disabled={currentSpread >= totalSpreads} className="rounded p-1 disabled:opacity-30" style={{ color: mutedFg }} title="Next spread (→)">
              <ChevronRight size={14} />
            </button>
          </>
        ) : (
          <p className="text-xs" style={{ color: mutedFg }}>
            Scroll mode — {chapters.length} chapter{chapters.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* ── CSS for rendered chapter HTML ─────────────────────────────────────── */}
      <style>{`
        /* Each chapter (except first) starts at the top of a new page/column.
           Horizontal padding (left/right) on block elements in CSS multicol is
           preserved in ALL column fragments -- it indents every line in every
           column. Vertical padding only applies to the first/last fragment of
           each chapter, which is fine (chapter-start gets top breathing room). */
        .reader-chapter, .reader-chapter-first {
          padding: ${PAGE_MARGIN_V}px ${PAGE_MARGIN_H}px 0;
        }
        .reader-chapter {
          break-before: column;
        }
        .reader-chapter-first {
          break-before: auto;
        }

        /* Chapter heading */
        .reader-chapter h1:first-child,
        .reader-chapter-first h1:first-child {
          margin-top: 8px;
          margin-bottom: 1.5em;
          font-size: 1.4em;
          font-weight: bold;
          line-height: 1.2;
        }
        .reader-chapter h2 { font-size: 1.15em; font-weight: bold; margin: 1.25em 0 0.5em; }
        .reader-chapter h3 { font-size: 1em;    font-weight: bold; margin: 1em 0 0.4em; }
        .reader-chapter p  { margin: 0 0 0.75em; orphans: 3; widows: 3; }

        /* Scene break */
        .reader-scene-break {
          text-align: center; margin: 1.5em 0;
          opacity: 0.35; letter-spacing: 0.5em;
        }

        /* Search highlights */
        mark.reader-hi         { background: #FBBF24; color: #1A1A1A; border-radius: 2px; }
        mark.reader-hi-current { background: #F97316; }

        /* Hide native scrollbar on the clip container */
        .reader-clip::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function TopBarBtn({ icon, label, onClick, active, disabled, isDark }: {
  icon: React.ReactNode; label: string; onClick: () => void;
  active?: boolean; disabled?: boolean; isDark: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={label}
      className="flex h-8 w-8 items-center justify-center rounded transition-colors disabled:opacity-30"
      style={{ color: active ? (isDark ? "#60A5FA" : "#2563EB") : (isDark ? "#9CA3AF" : "#6B5C4A"), background: active ? (isDark ? "#1D4ED820" : "#DBEAFE60") : "transparent" }}>
      {icon}
    </button>
  );
}

function ModeBtn({ label, active, isDark, accent, onClick }: {
  label: string; active: boolean; isDark: boolean; accent: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="px-2 py-0.5 text-xs transition-colors"
      style={{ background: active ? accent : "transparent", color: active ? "#fff" : (isDark ? "#9CA3AF" : "#6B5C4A") }}>
      {label}
    </button>
  );
}
