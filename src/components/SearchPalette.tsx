"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { COMPANIES } from "@/lib/companies";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { KIND_LABELS, type Scored } from "@/lib/search/types";

/**
 * The search box, and the panel it opens.
 *
 * One component for both, because they are one control: the thing in the header
 * is a button that looks like a field, and pressing it — or the shortcut — opens
 * the real field over the page. That indirection is what buys a search that is
 * genuinely usable on a header this crowded. An always-live input needs 200px it
 * cannot have, has nowhere to put results, and cannot be reached from the
 * keyboard; a panel has the whole width of the screen and opens on ⌘K from
 * wherever you are.
 *
 * Everything here is in service of one claim: that you can find a record without
 * taking your hands off the keyboard and without knowing which section it is in.
 * So — ⌘K or / to open, type, arrows to move, Enter to go, Escape to leave. The
 * first result is always selected, because the common case is that the first
 * result is right and Enter should just work.
 *
 * Results are not grouped by module. Grouping looks tidier and is worse: it
 * makes you scan five headings for the one row you want, and it throws away the
 * ranking, which is the part that knows the answer. One list, best first, each
 * row saying what it is.
 */

/** Long enough that typing a word doesn't fire five searches, short enough to feel live. */
const DEBOUNCE_MS = 160;

export default function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Scored[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /**
   * Which request is the current one.
   *
   * Responses can arrive out of order — a two-letter query is slower to answer
   * than the five-letter one typed after it, and without this the shorter,
   * staler result would land last and win. Compared on arrival; anything that is
   * not the latest is dropped.
   */
  const latest = useRef(0);

  /* ---- opening and closing ---------------------------------------------- */

  const close = useCallback(() => setOpen(false), []);

  /**
   * Closing clears, wherever the closing came from.
   *
   * Hung off `open` rather than written into a close handler because there are
   * four ways out — Escape, the Esc button, clicking away, and picking a result
   * — and three of them were once responsible for remembering to do this
   * themselves. Reacting to the state instead means a fifth way out added later
   * cannot forget, and reopening is always a clean box rather than the last
   * search still sitting in it.
   */
  useEffect(() => {
    if (open) return;
    setQuery("");
    setHits([]);
    setActive(0);
    setError(null);
  }, [open]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      // Escape closes from anywhere inside the panel, not only from the input.
      // Bound on the window rather than on the field because focus moves the
      // moment somebody reaches for a result with Tab, and a modal that stops
      // answering Escape once you have tabbed into it is a modal you can get
      // stuck in.
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // A bare slash, but never while something is being typed into — otherwise
      // the search box steals the slash out of a date, a note or a file path.
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // The page behind must not scroll while the panel is over it — on a phone the
  // panel is the whole screen and a scrolling background is how you lose it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  /* ---- fetching ---------------------------------------------------------- */

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setBusy(false);
      setError(null);
      return;
    }

    setBusy(true);
    const id = ++latest.current;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const body = await response.json();
        if (id !== latest.current) return; // a newer query has overtaken this one
        if (!response.ok) {
          setHits([]);
          setError(response.status === 401 ? "Session expired — reload to sign in." : "Search failed.");
        } else {
          setHits(body.hits ?? []);
          setActive(0);
          setError(null);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        if (id !== latest.current) return;
        setHits([]);
        setError("Search failed.");
      } finally {
        if (id === latest.current) setBusy(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  /* ---- keyboard inside the panel ----------------------------------------- */

  function go(hit: Scored | undefined) {
    if (!hit) return;
    close();
    router.push(hit.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    // Escape is handled on the window — see the shortcut effect above.
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (hits.length === 0 ? 0 : (i + 1) % hits.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (hits.length === 0 ? 0 : (i - 1 + hits.length) % hits.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      go(hits[active]);
    }
  }

  // Keep the selected row in view when the arrows walk past the fold.
  useEffect(() => {
    const node = listRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  /* ---- the trigger -------------------------------------------------------- */

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Search (⌘K)"
        aria-label="Search"
        className="btn btn-quiet gap-2 p-2.5 md:w-56 md:justify-start md:px-3"
      >
        <SearchMark />
        {/* The field's clothing, and only from `md`. Below that the button is
            the glyph alone — the headers this sits in are already at their
            limit on a phone, and a placeholder is the first thing worth
            dropping when a control has an icon that says the same thing. */}
        <span className="hidden text-[13.5px] font-normal text-ink-soft md:inline">Search…</span>
        <kbd className="ml-auto hidden rounded border border-ink-line px-1.5 py-0.5 text-[11px] font-medium text-ink-soft md:inline">
          ⌘K
        </kbd>
      </button>

      {!open ? null : (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Search the portal"
          className="fixed inset-0 z-50 flex items-start justify-center p-0 sm:p-6 sm:pt-[12vh]"
        >
          {/* Clicking away closes. A button rather than a bare div so it is a
              real target for a pointer and invisible to the keyboard, which has
              Escape for the same job. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={close}
            className="absolute inset-0 cursor-default bg-ink/40 backdrop-blur-[2px]"
          />

          <div className="relative flex h-dvh w-full flex-col overflow-hidden border-ink-line bg-card shadow-2xl sm:h-auto sm:max-h-[70vh] sm:max-w-2xl sm:rounded-2xl sm:border">
            <div className="flex shrink-0 items-center gap-3 border-b border-ink-line px-4 py-3.5">
              <SearchMark className="h-[18px] w-[18px] shrink-0 text-ink-soft" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search vouchers, orders, people, payments…"
                aria-label="Search"
                aria-controls="search-results"
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-soft"
              />
              {busy ? <span className="shrink-0 text-[12px] text-ink-soft">…</span> : null}
              <button
                type="button"
                onClick={close}
                className="btn btn-quiet shrink-0 px-2 py-1 text-[12px]"
              >
                Esc
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {error ? (
                <p role="alert" className="px-5 py-8 text-center text-[13.5px] text-red-700">
                  {error}
                </p>
              ) : query.trim().length < 2 ? (
                <Hint />
              ) : hits.length === 0 ? (
                <p className="px-5 py-10 text-center text-[13.5px] text-ink-soft">
                  {busy ? "Searching…" : `Nothing matches “${query.trim()}”.`}
                </p>
              ) : (
                <ul id="search-results" ref={listRef} role="listbox" className="py-1.5">
                  {hits.map((hit, i) => (
                    <li key={`${hit.kind}:${hit.id}`} role="option" aria-selected={i === active}>
                      <button
                        type="button"
                        onClick={() => go(hit)}
                        onMouseMove={() => setActive(i)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          i === active ? "bg-wash-strong" : ""
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="truncate text-[14px] font-medium">
                              {hit.title || hit.ref || "Untitled"}
                            </span>
                            <span className="chip chip-neutral shrink-0">
                              {KIND_LABELS[hit.kind]}
                            </span>
                            {hit.company ? (
                              <span className="shrink-0 text-[11.5px] text-ink-soft">
                                {COMPANIES[hit.company].name}
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 flex items-center gap-2 text-[12.5px] text-ink-soft">
                            {hit.ref ? <span className="mono shrink-0">{hit.ref}</span> : null}
                            {hit.detail ? <span className="truncate">{hit.detail}</span> : null}
                          </span>
                        </span>

                        <span className="shrink-0 text-right">
                          {hit.amount != null ? (
                            <span className="mono block text-[13.5px] font-semibold">
                              {hit.currency} {formatMoney(hit.amount, hit.currency)}
                            </span>
                          ) : null}
                          {hit.date ? (
                            <span className="block text-[11.5px] text-ink-soft">
                              {formatDate(hit.date)}
                            </span>
                          ) : null}
                          {hit.status ? (
                            <span className="block text-[11.5px] text-ink-soft">{hit.status}</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-line bg-wash-soft px-4 py-2 text-[11.5px] text-ink-soft">
              <span>
                <Key>↑</Key> <Key>↓</Key> to move
              </span>
              <span>
                <Key>↵</Key> to open
              </span>
              <span>
                <Key>esc</Key> to close
              </span>
              <span className="ml-auto hidden sm:inline">Searches every company and section</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * What to type, shown before anything has been.
 *
 * An empty panel is a fair question — "search what, exactly?" — and the honest
 * answer is the useful one: the things people actually arrive holding. A number
 * off a piece of paper, a name, a figure.
 */
function Hint() {
  return (
    <div className="px-5 py-7">
      <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
        Try
      </p>
      <ul className="mt-2.5 space-y-1.5 text-[13.5px] text-ink-soft">
        <li>
          <span className="mono text-ink">GR-202608-014</span> — or just{" "}
          <span className="mono text-ink">014</span>, a number the way you would read it out
        </li>
        <li>
          <span className="text-ink">a name</span> — whoever was paid, the vendor, an employee
        </li>
        <li>
          <span className="mono text-ink">4200</span> — an exact amount
        </li>
        <li>
          <span className="text-ink">new voucher</span> — a screen, to jump straight to it
        </li>
      </ul>
      <p className="mt-4 text-[12.5px] leading-relaxed text-ink-soft">
        Every word has to match, so two words narrow rather than widen.
      </p>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-ink-line px-1 py-0.5 font-sans text-[10.5px]">
      {children}
    </kbd>
  );
}

/**
 * A magnifier, stroke only — the same convention as the padlock and the house:
 * a glyph the interface draws itself, at the interface's own line weight, drawn
 * to the same optical box as its neighbours in the header.
 */
function SearchMark({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}
