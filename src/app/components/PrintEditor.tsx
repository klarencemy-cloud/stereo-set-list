import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { printFileName } from "../../shared/print";
import type { PrintableSong, PrintFile, PrintRow } from "../../shared/print";
import type { SheetPart } from "../../shared/sheet";
import { applyStyle, selectAll, useKeptSelection } from "./richText";
import type { TextStyle } from "./richText";

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
/** Chords only line up over their words in a font whose letters are all the same width. */
const CHORD_FONTS: Font[] = [FONT.standard, FONT.courier, FONT.consolas, FONT.menlo];
const LYRIC_FONTS: Font[] = [
  FONT.standard, FONT.arial, FONT.verdana, FONT.trebuchet, FONT.georgia, FONT.times, FONT.courier,
];
const LYRIC_SIZE = { start: 14, min: 10, max: 28, step: 2 };
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

function FloorSheet({ titles, onChanged }: { titles: string[]; onChanged: (changed: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const restore = useKeptSelection(ref);
  // Bumped by Reset: a fresh sheet, back as it opened.
  const [version, setVersion] = useState(0);

  function style(s: TextStyle) {
    const root = ref.current;
    // Nothing selected: nothing to style, and nothing changed.
    if (!root || !restore()) return;
    applyStyle(root, s);
    onChanged(true);
  }

  const tool = (label: string, s: TextStyle, content: ReactNode = label) => (
    <button
      type="button"
      className="btn pe-tool"
      aria-label={label}
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
        <select
          className="input pe-select"
          aria-label="Size"
          value=""
          onChange={(e) => {
            const pt = Number(e.target.value);
            if (pt) style({ kind: "size", pt });
          }}
        >
          <option value="">Size</option>
          {FLOOR_SIZES.map((pt) => (
            <option key={pt} value={pt}>
              {`${pt} pt`}
            </option>
          ))}
        </select>
        {tool("Bold", { kind: "bold" }, <b>B</b>)}
        {tool("Italic", { kind: "italic" }, <i>I</i>)}
        {tool("Underline", { kind: "underline" }, <u>U</u>)}
        {tool("Left", { kind: "align", to: "left" })}
        {tool("Centre", { kind: "align", to: "center" })}
        {tool("Right", { kind: "align", to: "right" })}
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
        <div className="pill pill-split" role="group" aria-label="Lyrics size">
          <button
            type="button"
            aria-label="Smaller lyrics"
            disabled={look.size <= LYRIC_SIZE.min}
            onClick={() => setLook({ size: Math.max(LYRIC_SIZE.min, look.size - LYRIC_SIZE.step) })}
          >
            {"A−"}
          </button>
          <span className="pe-size">{`${look.size} pt`}</span>
          <button
            type="button"
            aria-label="Bigger lyrics"
            disabled={look.size >= LYRIC_SIZE.max}
            onClick={() => setLook({ size: Math.min(LYRIC_SIZE.max, look.size + LYRIC_SIZE.step) })}
          >
            A+
          </button>
        </div>
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
