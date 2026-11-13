import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { useSwipe } from "../../src/app/components/useSwipe";

function Box({ onLeft, onRight }: { onLeft?: () => void; onRight?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useSwipe(ref, { onLeft, onRight });
  return <div ref={ref} data-testid="box" />;
}

function swipe(el: HTMLElement, fromX: number, toX: number, dy = 0) {
  fireEvent.touchStart(el, { touches: [{ clientX: fromX, clientY: 100 }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: toX, clientY: 100 + dy }] });
}

function setup() {
  const onLeft = vi.fn();
  const onRight = vi.fn();
  render(<Box onLeft={onLeft} onRight={onRight} />);
  return { el: screen.getByTestId("box"), onLeft, onRight };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).visualViewport;
});

describe("useSwipe", () => {
  it("a left swipe calls onLeft", () => {
    const { el, onLeft, onRight } = setup();
    swipe(el, 300, 200);
    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(onRight).not.toHaveBeenCalled();
  });

  it("a right swipe calls onRight", () => {
    const { el, onLeft, onRight } = setup();
    swipe(el, 100, 200);
    expect(onRight).toHaveBeenCalledTimes(1);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("a short movement does nothing", () => {
    const { el, onLeft } = setup();
    swipe(el, 300, 260);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("a mostly vertical drag does nothing", () => {
    const { el, onLeft } = setup();
    swipe(el, 300, 220, 60);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("a slow drag does nothing", () => {
    const { el, onLeft } = setup();
    // Mock after rendering: React itself reads the clock while it renders.
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(700);
    swipe(el, 300, 200);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("scrolling to the edge during the gesture does not change song", () => {
    const { el, onLeft, onRight } = setup();
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: 800 });
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 300 });
    el.scrollLeft = 450;
    fireEvent.touchStart(el, { touches: [{ clientX: 300, clientY: 100 }] });
    el.scrollLeft = 500; // the drag itself scrolled the line to its right edge
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 200, clientY: 100 }] });
    el.scrollLeft = 50;
    fireEvent.touchStart(el, { touches: [{ clientX: 100, clientY: 100 }] });
    el.scrollLeft = 0;
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 200, clientY: 100 }] });
    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
  });

  it("a two-finger gesture does nothing", () => {
    const { el, onLeft } = setup();
    fireEvent.touchStart(el, { touches: [{ clientX: 300, clientY: 100 }, { clientX: 320, clientY: 160 }] });
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchStart(el, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchStart(el, { touches: [{ clientX: 300, clientY: 100 }, { clientX: 320, clientY: 160 }] });
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 200, clientY: 100 }] });
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("does nothing while the page is zoomed in", () => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: { scale: 2 } });
    const { el, onLeft } = setup();
    swipe(el, 300, 200);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("does not navigate while the content can still scroll that way", () => {
    const { el, onLeft, onRight } = setup();
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: 800 });
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 300 });
    el.scrollLeft = 100;
    swipe(el, 300, 200);
    swipe(el, 100, 200);
    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
  });
});
