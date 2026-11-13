import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { listSongs: vi.fn() } };
});

import { api } from "../../src/app/api";
import SongsPage from "../../src/app/pages/SongsPage";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const base = { artist: "", sourceUrl: null, originalKey: "C", bandKey: "C", capo: 0, updatedAt: "x" };
const regular = { ...base, id: "s1", title: "Wonderwall", artist: "Oasis" };
const original = { ...base, id: "s2", title: "My Demo", trackId: "t1" };

function renderPage() {
  return render(
    <MemoryRouter>
      <SongsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocked.listSongs.mockReset();
  mocked.listSongs.mockResolvedValue([regular, original]);
});

describe("SongsPage original songs", () => {
  it("labels original songs", async () => {
    renderPage();
    const row = (await screen.findByText("My Demo")).closest("a")!;
    expect(within(row).getByText("Original")).toBeInTheDocument();
    expect(screen.getAllByText("Original")).toHaveLength(1);
  });

  it("finds original songs with the search box", async () => {
    renderPage();
    await screen.findByText("My Demo");
    fireEvent.change(screen.getByLabelText("Search songs"), { target: { value: "demo" } });
    expect(screen.getByText("My Demo")).toBeInTheDocument();
    expect(screen.queryByText("Wonderwall")).not.toBeInTheDocument();
  });

  it("shows no key for a song whose key is not known yet", async () => {
    mocked.listSongs.mockResolvedValue([regular, { ...original, originalKey: "", bandKey: "" }]);
    renderPage();
    const row = (await screen.findByText("My Demo")).closest("a")!;
    expect(row.querySelector(".pill")).toBeNull();
    const other = screen.getByText("Wonderwall").closest("a")!;
    expect(within(other).getByText("C")).toHaveClass("pill");
  });

  it("does not render an empty artist line", async () => {
    renderPage();
    const row = (await screen.findByText("My Demo")).closest("a")!;
    expect(row.querySelectorAll(".muted")).toHaveLength(0);
  });
});
