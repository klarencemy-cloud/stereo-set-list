import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { printFileName } from "../../shared/print";
import type { PrintableSong, PrintFile, PrintRow } from "../../shared/print";
import type { SheetPart } from "../../shared/sheet";
import { applyStyle, selectAll, sizeAt, useKeptSelection } from "./richText";
import type { Align, TextStyle } from "./richText";

/** What the print editor opens with: a gig's floor sheet, or lyric sheets for one song or a whole setlist. */
export type PrintJob =
  | { kind: "floor"; file: PrintFile; titles: string[] }
  | { kind: "lyrics"; file: PrintFile; withChords: boolean; songs: PrintableSong[] };

type Font = { label: string; css: string };

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const FONT = {
  standard: { label: "Standard", css: MONO },
  arialBlack: { label: "Arial Black", css: '"Arial Black", Arial, Helvetica, sans-serif' },
  arial: { label: "Arial", css: "Arial, Helvetica, sans-serif" },
  impact: { label: "Impact", css: "Impact, Haettenschweiler, sans-serif" },
  verdana: { label: "Verdana", css: "Verdana, Geneva, sans-serif" },
  trebuchet: { label: "Trebuchet MS", css: '"Trebuchet MS", sans-serif' },
  georgia: { label: "Georgia", css: "Georgia, serif" },
  times: { label: "Times New Roman", css: '"Times New Roman", Times, serif' },
  courier: { label: "Courier New", css: '"Courier New", Courier, monospace' },
  consolas: { label: "Consolas", css: 'Consolas, "Lucida Console", monospace' },
  menlo: { label: "Menlo", css: "Menlo, Monaco, monospace" },
} satisfies Record<string, Font>;
const FLOOR_FONTS: Font[] = [
  FONT.arialBlack, FONT.arial, FONT.impact, FONT.verdana, FONT.trebuchet, FONT.georgia, FONT.times, FONT.courier,
];
const FLOOR_SIZES = [18, 24, 28, 34, 40, 48, 60, 72, 96];
/** The floor sheet's titles start at this size. */
const FLOOR_START = 34;
/** Chords only line up over their words in a font whose letters are all the same width. */
const CHORD_FONTS: Font[] = [FONT.standard, FONT.courier, FONT.consolas, FONT.menlo];
const LYRIC_FONTS: Font[] = [
  FONT.standard, FONT.arial, FONT.verdana, FONT.trebuchet, FONT.georgia, FONT.times, FONT.courier,
];
const LYRIC_SIZE = { start: 14, min: 10, max: 28, step: 2 };
const LYRIC_SIZES = Array.from(
  { length: (LYRIC_SIZE.max - LYRIC_SIZE.min) / LYRIC_SIZE.step + 1 },
  (_, i) => LYRIC_SIZE.min + i * LYRIC_SIZE.step,
);
/** A4 is 210mm wide: 793.7 CSS pixels. */
const PAGE_PX = (210 / 25.4) * 96;

/** Keeps a tool button from taking the focus, so the words selected in the sheet stay selected. */
const keepSelection = {
  onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
  onPointerDown: (e: { preventDefault: () => void }) => e.preventDefault(),
};

/**
 * The print editor: the sheet as white A4 pages, with tools to change its words and look before printing or
 * saving a PDF. Nothing changed here is saved to the song or gig.
 */
export default function PrintEditor({ job, onClose }: { job: PrintJob; onClose: () => void }) {
  const [changed, setChanged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pdfNote, setPdfNote] = useState(false);
  const pageTitle = useRef<string | null>(null);

  const restoreTitle = () => {
    if (pageTitle.current === null) return;
    document.title = pageTitle.current;
    pageTitle.current = null;
  };

  useEffect(() => {
    document.documentElement.classList.add("print-editor-open");
    window.addEventListener("afterprint", restoreTitle);
    return () => {
      document.documentElement.classList.remove("print-editor-open");
      window.removeEventListener("afterprint", restoreTitle);
      restoreTitle();
    };
  }, []);

  function print(pdf: boolean) {
    // Shown before the dialog opens: on a computer the page can't update again until it closes.
    if (pdf) flushSync(() => setPdfNote(true));
    // Browsers name the PDF after the page title.
    if (pageTitle.current === null) pageTitle.current = document.title;
    document.title = printFileName(job.file);
    window.print();
  }

  function close() {
    if (changed) setConfirming(true);
    else onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return createPortal(
    <div className="print-editor" role="dialog" aria-modal="true" aria-label="Print editor">
      <div className="pe-bar">
        <button type="button" className="btn" onClick={close}>
          Close
        </button>
        <span className="pe-bar-title">{printFileName(job.file)}</span>
        <button type="button" className="btn" onClick={() => print(true)}>
          Download PDF
        </button>
        <button type="button" className="btn primary" onClick={() => print(false)}>
          Print
        </button>
      </div>
      {pdfNote && (
        <p role="status" className="pe-note">
          In the print window, choose <strong>Save as PDF</strong> as the printer, then save.
        </p>
      )}
      {confirming && (
        <div className="pe-confirm" role="alertdialog" aria-label="Throw away your changes?">
          <p>Throw away your changes? Nothing here is saved.</p>
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Keep editing
          </button>
          <button type="button" className="btn danger" onClick={onClose}>
            Throw away
          </button>
        </div>
      )}
      {job.kind === "floor" ? (
        <FloorSheet titles={job.titles} onChanged={setChanged} />
      ) : (
        <LyricSheets songs={job.songs} withChords={job.withChords} onChanged={setChanged} />
      )}
    </div>,
    document.body,
  );
}

/** The grey area the pages sit on. On a narrow screen the pages shrink to fit, as they would look printed. */
function Desk({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const room = el.clientWidth - 16;
      setScale(room > 0 ? Math.min(1, room / PAGE_PX) : 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="pe-desk" ref={ref}>
      <div className="pe-pages" style={scale < 1 ? { zoom: scale } : undefined}>
        {children}
      </div>
    </div>
  );
}

/**
 * A− and A+ either side of a list of sizes: the buttons step through the list, the list jumps straight to one.
 * `value` null shows "Size" (nothing selected yet).
 */
function SizeControl({
  label,
  smaller,
  bigger,
  sizes,
  value,
  onChange,
}: {
  label: string;
  smaller: string;
  bigger: string;
  sizes: number[];
  value: number | null;
  onChange: (pt: number) => void;
}) {
  // A size picked some other way (pasted text, say) still shows, between its neighbours.
  const options = value === null || sizes.includes(value) ? sizes : [...sizes, value].sort((a, b) => a - b);
  const down = value === null ? undefined : [...sizes].reverse().find((s) => s < value);
  const up = value === null ? undefined : sizes.find((s) => s > value);
  return (
    <div className="pill pill-split pe-size-control" role="group" aria-label={label}>
      <button
        type="button"
        aria-label={smaller}
        disabled={value !== null && down === undefined}
        {...keepSelection}
        onClick={() => down !== undefined && onChange(down)}
      >
        {"A−"}
      </button>
      <select
        className="pe-size-select"
        aria-label={label}
        value={value === null ? "" : String(value)}
        onChange={(e) => {
          const pt = Number(e.target.value);
          if (pt) onChange(pt);
        }}
      >
        {value === null && <option value="">Size</option>}
        {options.map((pt) => (
          <option key={pt} value={pt}>
            {`${pt} pt`}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={bigger}
        disabled={value !== null && up === undefined}
        {...keepSelection}
        onClick={() => up !== undefined && onChange(up)}
      >
        A+
      </button>
    </div>
  );
}

const ICON_MARGIN = 2;
const ICON_LONG = 14;
const ICON_SHORT = 9;
/** Where each align symbol's short lines start. */
const SHORT_START: Record<Align, number> = {
  left: ICON_MARGIN,
  center: ICON_MARGIN + (ICON_LONG - ICON_SHORT) / 2,
  right: ICON_MARGIN + ICON_LONG - ICON_SHORT,
};

/** The align symbol: long and short lines in turn, the short ones lined up the way the button aligns text. */
function AlignIcon({ to }: { to: Align }) {
  const start = SHORT_START[to];
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {[3, 7, 11, 15].map((y, i) =>
          i % 2 === 0 ? (
            <line key={y} x1={ICON_MARGIN} y1={y} x2={ICON_MARGIN + ICON_LONG} y2={y} />
          ) : (
            <line key={y} x1={start} y1={y} x2={start + ICON_SHORT} y2={y} />
          ),
        )}
      </g>
    </svg>
  );
}

function FloorSheet({ titles, onChanged }: { titles: string[]; onChanged: (changed: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // The size of the selected words, shown between A− and A+; null until words are selected.
  const [size, setSize] = useState<number | null>(null);
  const restore = useKeptSelection(ref, (range) => setSize(range.collapsed ? null : (sizeAt(range) ?? FLOOR_START)));
  // Bumped by Reset: a fresh sheet, back as it opened.
  const [version, setVersion] = useState(0);

  function style(s: TextStyle) {
    const root = ref.current;
    // Nothing selected: nothing to style, and nothing changed.
    if (!root || !restore()) return;
    applyStyle(root, s);
    if (s.kind === "size") setSize(s.pt);
    onChanged(true);
  }

  const tool = (label: string, s: TextStyle, content: ReactNode = label) => (
    <button
      type="button"
      className="btn pe-tool"
      aria-label={label}
      title={label}
      {...keepSelection}
      onClick={() => style(s)}
    >
      {content}
    </button>
  );

  return (
    <>
      <div className="pe-tools" role="toolbar" aria-label="Floor sheet tools">
        <select
          className="input pe-select"
          aria-label="Font"
          value=""
          onChange={(e) => {
            const font = FLOOR_FONTS.find((f) => f.css === e.target.value);
            if (font) style({ kind: "font", family: font.css });
          }}
        >
          <option value="">Font</option>
          {FLOOR_FONTS.map((f) => (
            <option key={f.label} value={f.css}>
              {f.label}
            </option>
          ))}
        </select>
        <SizeControl
          label="Size"
          smaller="Smaller text"
          bigger="Bigger text"
          sizes={FLOOR_SIZES}
          value={size}
          onChange={(pt) => style({ kind: "size", pt })}
        />
        {tool("Bold", { kind: "bold" }, <b>B</b>)}
        {tool("Italic", { kind: "italic" }, <i>I</i>)}
        {tool("Underline", { kind: "underline" }, <u>U</u>)}
        {tool("Align left", { kind: "align", to: "left" }, <AlignIcon to="left" />)}
        {tool("Align centre", { kind: "align", to: "center" }, <AlignIcon to="center" />)}
        {tool("Align right", { kind: "align", to: "right" }, <AlignIcon to="right" />)}
        <button
          type="button"
          className="btn pe-tool"
          {...keepSelection}
          onClick={() => ref.current && selectAll(ref.current)}
        >
          Select all
        </button>
        <button
          type="button"
          className="btn pe-tool"
          onClick={() => {
            setVersion((v) => v + 1);
            setSize(null);
            onChanged(false);
          }}
        >
          Reset
        </button>
      </div>
      <Desk>
        <div
          key={version}
          ref={ref}
          className="pe-page pe-floor"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          role="textbox"
          aria-multiline="true"
          aria-label="Floor sheet"
          onInput={() => onChanged(true)}
        >
          {titles.map((t, i) => (
            <div key={i}>{t}</div>
          ))}
        </div>
      </Desk>
    </>
  );
}

type Look = { size: number; font: string };

function LyricSheets({
  songs,
  withChords,
  onChanged,
}: {
  songs: PrintableSong[];
  withChords: boolean;
  onChanged: (changed: boolean) => void;
}) {
  const fonts = withChords ? CHORD_FONTS : LYRIC_FONTS;
  const fresh: Look = { size: LYRIC_SIZE.start, font: fonts[0].css };
  const [looks, setLooks] = useState<Look[]>(() => songs.map(() => fresh));
  const [edited, setEdited] = useState<boolean[]>(() => songs.map(() => false));
  // Bumped by Reset, for the one song it reset: a fresh sheet, back as it opened.
  const [versions, setVersions] = useState<number[]>(() => songs.map(() => 0));
  // The song you're working on: the tools change only this one.
  const [active, setActive] = useState(0);
  const look = looks[active];

  const changed = edited.some((e) => e) || looks.some((l) => l.size !== fresh.size || l.font !== fresh.font);
  useEffect(() => onChanged(changed), [changed]);

  const setLook = (next: Partial<Look>) => setLooks((ls) => ls.map((l, i) => (i === active ? { ...l, ...next } : l)));
  const setAt = <T,>(list: T[], value: T, at = active) => list.map((x, i) => (i === at ? value : x));

  return (
    <>
      <div className="pe-tools" role="toolbar" aria-label="Lyric sheet tools">
        {songs.length > 1 && (
          <span className="pe-active">
            Changing: <strong>{songs[active].title}</strong>
          </span>
        )}
        <SizeControl
          label="Lyrics size"
          smaller="Smaller lyrics"
          bigger="Bigger lyrics"
          sizes={LYRIC_SIZES}
          value={look.size}
          onChange={(size) => setLook({ size })}
        />
        <select
          className="input pe-select"
          aria-label="Lyrics font"
          value={look.font}
          onChange={(e) => setLook({ font: e.target.value })}
        >
          {fonts.map((f) => (
            <option key={f.label} value={f.css}>
              {f.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn pe-tool"
          onClick={() => {
            setLooks((ls) => setAt(ls, fresh));
            setEdited((es) => setAt(es, false));
            setVersions((vs) => setAt(vs, vs[active] + 1));
          }}
        >
          Reset
        </button>
      </div>
      <Desk>
        {songs.map((song, i) => {
          return (
            <article
              key={`${song.id}:${i}:${versions[i]}`}
              className={`pe-page pe-song${i === active && songs.length > 1 ? " pe-active-page" : ""}`}
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              role="textbox"
              aria-multiline="true"
              aria-label={`Lyric sheet: ${song.title}`}
              // On the sheet itself, not the lyrics inside it: typing can delete those, never the sheet.
              // The title and the line under it set their own font and size.
              style={{ fontSize: `${looks[i].size}pt`, fontFamily: looks[i].font }}
              onFocus={() => setActive(i)}
              onPointerDown={() => setActive(i)}
              onInput={() => setEdited((es) => setAt(es, true, i))}
            >
              <h2 className="print-song-title">{song.title}</h2>
              {song.meta && <p className="print-song-meta">{song.meta}</p>}
              {song.empty ? (
                <p className="print-empty">
                  No lyrics yet
                </p>
              ) : (
                <div className="print-sheet">
                  {song.blocks.map((block, b) => (
                    <div key={b} className="print-block">
                      {block.label !== null && <div className="sheet-line sheet-section">{`[${block.label}]`}</div>}
                      {block.rows.map((row, r) => (
                        <Row key={r} row={row} />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </Desk>
    </>
  );
}

function Parts({ parts }: { parts: SheetPart[] }) {
  return (
    <>
      {parts.map((p, j) =>
        p.type === "chord" ? (
          <span key={j} className="chord">
            {p.chord}
          </span>
        ) : (
          <span key={j}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** A plain line, or a chord line and its lyric as segments that wrap together at the same word. */
function Row({ row }: { row: PrintRow }) {
  if (row.kind === "line") {
    return (
      <div className="sheet-line">
        <Parts parts={row.parts} />
      </div>
    );
  }
  return (
    <div className="sheet-line pe-pair">
      {row.segments.map((s, j) => (
        <span key={j} className="pe-seg">
          <span className="pe-seg-chord">
            <Parts parts={s.chord} />
          </span>
          {row.lyric && <span className="pe-seg-lyric">{s.lyric}</span>}
        </span>
      ))}
    </div>
  );
}
