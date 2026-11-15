import { useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject, Ref } from "react";
import { lyricsOnly, parseSheet } from "../../shared/sheet";
import { layoutTabs } from "./tabLayout";

export default function ChordSheet({
  content,
  onTap,
  fontSize,
  sheetRef,
  full = true,
  chords = true,
}: {
  content: string;
  /** False shows lyrics only: chord lines dropped and the gaps closed up, section labels kept. */
  chords?: boolean;
  /** Run edge to edge (song view). False keeps it inside the page padding, e.g. the form preview. */
  full?: boolean;
  onTap?: () => void;
  fontSize?: number;
  sheetRef?: Ref<HTMLDivElement>;
}) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(Infinity);
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      // One monospace character's width, measured with a throwaway probe so the sheet's own text stays clean.
      const probe = document.createElement("span");
      probe.textContent = "0".repeat(50);
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
      el.appendChild(probe);
      const charWidth = probe.getBoundingClientRect().width / 50;
      el.removeChild(probe);
      const cs = getComputedStyle(el);
      const avail = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      setCols(charWidth > 0 && avail > 0 ? Math.max(10, Math.floor(avail / charWidth)) : Infinity);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fontSize]);
  const setRefs = (node: HTMLDivElement | null) => {
    innerRef.current = node;
    if (typeof sheetRef === "function") sheetRef(node);
    else if (sheetRef) (sheetRef as MutableRefObject<HTMLDivElement | null>).current = node;
  };
  const parsed = parseSheet(content);
  const lines = chords ? layoutTabs(parsed, cols) : lyricsOnly(parsed);
  return (
    <div
      ref={setRefs}
      className={`${full ? "sheet sheet-full" : "sheet"}${chords ? "" : " sheet-lyrics"}`}
      onClick={onTap}
      data-testid="sheet"
      style={fontSize ? { fontSize } : undefined}
    >
      {lines.map((line, i) =>
        line.kind === "section" ? (
          <div key={i} className="sheet-line sheet-section">{`[${line.label}]`}</div>
        ) : (
          <div key={i} className="sheet-line">
            {line.parts.map((p, j) =>
              p.type === "chord" ? (
                <span key={j} className="chord">{p.chord}</span>
              ) : (
                <span key={j}>{p.text}</span>
              ),
            )}
          </div>
        ),
      )}
    </div>
  );
}
