import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../src/app/pages/SongsPage", () => ({
  default: () => {
    throw new Error("boom");
  },
}));
vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { listGigs: vi.fn(() => new Promise(() => {})), listTracks: vi.fn(() => new Promise(() => {})) } };
});

import { AppRoutes } from "../../src/app/App";
import ErrorBoundary from "../../src/app/components/ErrorBoundary";

afterEach(() => vi.restoreAllMocks());

describe("ErrorBoundary", () => {
  it("shows a message and Reload button instead of a blank page, keeping the bottom nav", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={["/songs"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toHaveTextContent("Songs");
    expect(nav).toHaveTextContent("Gigs");
  });

  it("recovers when navigating to another page", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={["/songs"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    fireEvent.click(screen.getByRole("link", { name: "Gigs" }));
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("Reload calls the reload handler", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onReload = vi.fn();
    const Bad = () => {
      throw new Error("bad");
    };
    render(
      <ErrorBoundary onReload={onReload}>
        <Bad />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
