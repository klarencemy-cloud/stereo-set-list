import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { UNSAVED_MESSAGE, useUnsavedChanges } from "../../src/app/components/useUnsavedChanges";

afterEach(() => vi.restoreAllMocks());

function Probe({ when }: { when: boolean }) {
  const { allowNavigation } = useUnsavedChanges(when);
  return <button onClick={allowNavigation}>allow</button>;
}

function setup(when: boolean) {
  const router = createMemoryRouter(
    [
      { path: "/form", element: <Probe when={when} /> },
      { path: "/other", element: <div>other page</div> },
    ],
    { initialEntries: ["/form"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("useUnsavedChanges", () => {
  it("exposes the message", () => {
    expect(UNSAVED_MESSAGE).toBe("You have unsaved changes. Leave without saving?");
  });

  it("does not ask when there is nothing to lose", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const router = setup(false);
    await act(() => router.navigate("/other"));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText("other page")).toBeInTheDocument();
  });

  it("asks, and stays when cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const router = setup(true);
    await act(() => router.navigate("/other"));
    expect(confirm).toHaveBeenCalledWith(UNSAVED_MESSAGE);
    expect(screen.queryByText("other page")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/form");
  });

  it("leaves when confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const router = setup(true);
    await act(() => router.navigate("/other"));
    expect(screen.getByText("other page")).toBeInTheDocument();
  });

  it("allowNavigation lets the next navigation through without asking", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const router = setup(true);
    fireEvent.click(screen.getByText("allow"));
    await act(() => router.navigate("/other"));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText("other page")).toBeInTheDocument();
  });

  it("allowNavigation covers only one navigation, then warnings come back", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const router = setup(true);
    fireEvent.click(screen.getByText("allow"));
    // Stays on the same page, so the hook (and its allowance) survives.
    await act(() => router.navigate("/form?x=1"));
    expect(confirm).not.toHaveBeenCalled();
    expect(router.state.location.search).toBe("?x=1");

    await act(() => router.navigate("/other"));
    expect(confirm).toHaveBeenCalledWith(UNSAVED_MESSAGE);
    expect(router.state.location.pathname).toBe("/form");
  });

  it("prevents the default on beforeunload only while there are changes", () => {
    const { unmount } = render(
      <RouterProvider router={createMemoryRouter([{ path: "/", element: <Probe when={false} /> }])} />,
    );
    const quiet = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);
    unmount();

    render(<RouterProvider router={createMemoryRouter([{ path: "/", element: <Probe when /> }])} />);
    const loud = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(loud);
    expect(loud.defaultPrevented).toBe(true);
  });
});
