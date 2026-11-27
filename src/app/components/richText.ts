import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/** Where the floor sheet's align tools line text up. */
export type Align = "left" | "center" | "right";

/** A look the floor sheet's tools put on the selected words. */
export type TextStyle =
  | { kind: "bold" | "italic" | "underline" }
  | { kind: "align"; to: Align }
  | { kind: "font"; family: string }
  | { kind: "size"; pt: number };

const MARK = "pe-mark";

function exec(command: string, value?: string) {
  // Deprecated, but still the only way every browser styles a selection inside contentEditable.
  if (typeof document.execCommand === "function") document.execCommand(command, false, value);
}

/**
 * Wraps the selected text in spans that `set` styles, and clears the same property on anything inside them, so
 * the new font or size wins over an earlier one. The browser marks the selection with a throwaway font face
 * first, because it knows how to split the selection across lines and tags.
 */
function wrapSelection(root: HTMLElement, set: (el: HTMLElement) => void, prop: "fontFamily" | "fontSize") {
  exec("styleWithCSS", "false");
  exec("fontName", MARK);
  const spans: HTMLElement[] = [];
  root.querySelectorAll(`font[face="${MARK}"]`).forEach((font) => {
    const span = document.createElement("span");
    span.append(...Array.from(font.childNodes));
    span.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
      el.style[prop] = "";
    });
    set(span);
    font.replaceWith(span);
    spans.push(span);
    // Stepping the same words again (A+ twice) would nest a span per step: drop what the new one overrides.
    let outer = span.parentElement;
    while (outer && outer !== root && outer.tagName === "SPAN" && outer.childNodes.length === 1 && outer.style[prop]) {
      outer.style[prop] = "";
      const next: HTMLElement | null = outer.parentElement;
      if (!outer.getAttribute("style")) outer.replaceWith(...Array.from(outer.childNodes));
      outer = next;
    }
  });
  if (spans.length === 0) return;
  // Keep the same words selected, so another tool can be used on them straight away.
  const range = document.createRange();
  range.setStartBefore(spans[0]);
  range.setEndAfter(spans[spans.length - 1]);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Puts `style` on whatever is selected inside `root`. */
export function applyStyle(root: HTMLElement, style: TextStyle) {
  switch (style.kind) {
    case "bold":
    case "italic":
    case "underline":
      exec(style.kind);
      return;
    case "align":
      exec(style.to === "left" ? "justifyLeft" : style.to === "center" ? "justifyCenter" : "justifyRight");
      return;
    case "font":
      wrapSelection(root, (el) => (el.style.fontFamily = style.family), "fontFamily");
      return;
    case "size":
      wrapSelection(root, (el) => (el.style.fontSize = `${style.pt}pt`), "fontSize");
      return;
  }
}

/** Selects everything inside `root`. */
export function selectAll(root: HTMLElement) {
  root.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(root);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** The size, in points, of the text where `range` starts; null when the browser can't tell. */
export function sizeAt(range: Range): number | null {
  let node: Node | null = range.startContainer;
  // A range set around elements starts in their parent: look at the first element it covers instead.
  if (node instanceof Element && node.childNodes[range.startOffset]) node = node.childNodes[range.startOffset];
  const el = node instanceof Element ? node : node.parentElement;
  const px = el ? parseFloat(getComputedStyle(el).fontSize) : NaN;
  return px > 0 ? Math.round(px * 0.75) : null;
}

/**
 * Remembers the last selection inside `ref`, so a tool (a font list on a phone, say) that takes the focus away
 * can put it back before styling it. `onSelect` hears about each new selection there.
 */
export function useKeptSelection(ref: RefObject<HTMLElement>, onSelect?: (range: Range) => void) {
  const kept = useRef<Range | null>(null);
  const heard = useRef(onSelect);
  heard.current = onSelect;
  useEffect(() => {
    const onChange = () => {
      const root = ref.current;
      const sel = window.getSelection();
      if (!root || !sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      kept.current = range.cloneRange();
      heard.current?.(range);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [ref]);

  /** Puts the kept selection back. False when no words are selected in `ref`, so there is nothing to style. */
  return function restore(): boolean {
    const root = ref.current;
    const range = kept.current;
    if (!root || !range || range.collapsed || !root.contains(range.commonAncestorContainer)) return false;
    root.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return true;
  };
}
