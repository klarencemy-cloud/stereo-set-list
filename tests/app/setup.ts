import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Node 25+ has its own (disabled) localStorage global that hides jsdom's.
// Put jsdom's Web Storage back so app tests see what a browser has.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  }
}

afterEach(() => cleanup());
