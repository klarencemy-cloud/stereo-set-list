import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { getSong: vi.fn(), updateSong: vi.fn() } };
});

import { api, ApiError } from "../../src/app/api";
import SongPage from "../../src/app/pages/SongPage";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const song = {
  id: "s1",
  title: "Test Song",
  artist: "The Band",
  sourceUrl: null,
  originalKey: "G",
  bandKey: "A",
  capo: 0,
  content: "[Intro]\n[ch]G[/ch] [ch]C[/ch]\nla la",
  updatedAt: "x",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/songs/s1"]}>
      <Routes>
        <Route path="/songs/:id" element={<SongPage />} />
        <Route path="/songs/:id/edit" element={<div>edit page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(mocked).forEach((f) => f.mockReset());
  mocked.getSong.mockResolvedValue({ ...song });
});

describe("SongPage", () => {
  it("shows chords in the band key and the key line", async () => {
    renderPage();
    expect((await screen.findByText("No capo")).parentElement).toHaveTextContent("Key: A");
    const chords = Array.from(document.querySelectorAll(".chord")).map((c) => c.textContent);
    expect(chords).toEqual(["A", "D"]);
    expect(screen.getByText("No capo")).toBeInTheDocument();
  });

  it("renders a section label on its own line", async () => {
    renderPage();
    await screen.findByText("[Intro]");
    expect(screen.getByText("[Intro]")).toBeInTheDocument();
  });

  it("transposes up, saves the new key and updates the chords", async () => {
    mocked.updateSong.mockResolvedValue({ ...song, bandKey: "Bb" });
    renderPage();
    await screen.findByText("[Intro]");
    fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
    fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
    expect(mocked.updateSong).toHaveBeenCalledWith("s1", { bandKey: "Bb" });
    await waitFor(() => {
      const chords = Array.from(document.querySelectorAll(".chord")).map((c) => c.textContent);
      expect(chords).toEqual(["Bb", "Eb"]);
    });
    expect(screen.getByText("Changes the key for the whole band.")).toBeInTheDocument();
  });

  it("reverts the key and shows an error when saving fails", async () => {
    mocked.updateSong.mockRejectedValue(new ApiError(500, "Could not save"));
    renderPage();
    await screen.findByText("[Intro]");
    fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
    fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
    const chords = Array.from(document.querySelectorAll(".chord")).map((c) => c.textContent);
    expect(chords).toEqual(["A", "D"]);
  });

  it("disables the transpose buttons while a save is pending", async () => {
    let resolve!: (v: unknown) => void;
    mocked.updateSong.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPage();
    await screen.findByText("[Intro]");
    fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
    fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
    expect(screen.getByRole("button", { name: "Transpose up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Transpose down" })).toBeDisabled();
    resolve({ ...song, bandKey: "Bb" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Transpose up" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Transpose down" })).toBeEnabled();
    expect(mocked.updateSong).toHaveBeenCalledTimes(1);
  });

  it("cycles the speed", async () => {
    renderPage();
    const btn = await screen.findByRole("button", { name: /Speed: 1$/ });
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Speed: 1.5" })).toBeInTheDocument();
  });

  it("shows the untransposed sheet and a note when the key is unknown", async () => {
    mocked.getSong.mockResolvedValue({ ...song, originalKey: "H", bandKey: "A" });
    renderPage();
    expect(await screen.findByText("Key unknown \u2014 fix it in Edit")).toBeInTheDocument();
    const chords = Array.from(document.querySelectorAll(".chord")).map((c) => c.textContent);
    expect(chords).toEqual(["G", "C"]);
  });

  it("shows an error instead of crashing when transposing an unknown key", async () => {
    mocked.getSong.mockResolvedValue({ ...song, originalKey: "H", bandKey: "H" });
    renderPage();
    await screen.findByText("Key unknown \u2014 fix it in Edit");
    fireEvent.click(screen.getByRole("button", { name: "Transpose" }));
    fireEvent.click(screen.getByRole("button", { name: "Transpose up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/key/i);
    expect(mocked.updateSong).not.toHaveBeenCalled();
  });

  it("shows a Source link that opens in a new tab when the song has one", async () => {
    const url = "https://tabs.ultimate-guitar.com/tab/x/y-chords-1";
    mocked.getSong.mockResolvedValue({ ...song, sourceUrl: url });
    renderPage();
    const link = await screen.findByRole("link", { name: "Source" });
    expect(link).toHaveAttribute("href", url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("has no Source link without a source URL or with a non-web URL", async () => {
    renderPage();
    await screen.findByText("[Intro]");
    expect(screen.queryByRole("link", { name: "Source" })).not.toBeInTheDocument();
    cleanup();
    mocked.getSong.mockResolvedValue({ ...song, sourceUrl: "javascript:alert(1)" });
    renderPage();
    await screen.findByText("[Intro]");
    expect(screen.queryByRole("link", { name: "Source" })).not.toBeInTheDocument();
  });

  it("shows an error when the song cannot be loaded", async () => {
    mocked.getSong.mockRejectedValue(new ApiError(404, "Song not found"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Song not found");
  });
});
