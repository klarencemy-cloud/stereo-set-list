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

// The data router (createMemoryRouter) builds a Request with an AbortSignal. In this jsdom environment that
// signal is jsdom's, which Node's own Request refuses. Drop the signal: tests never need to abort a navigation.
const NodeRequest = globalThis.Request;
if (NodeRequest) {
  globalThis.Request = class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init?.signal) {
        const { signal: _signal, ...rest } = init;
        super(input, rest);
      } else {
        super(input, init);
      }
    }
  } as typeof Request;
}
