import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { markupFromPlainText } from "../../src/shared/sheet";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return {
    ...actual,
    api: { importSong: vi.fn(), createSong: vi.fn(), updateSong: vi.fn(), getSong: vi.fn(), deleteSong: vi.fn() },
  };
});

import { api, ApiError } from "../../src/app/api";
import SongFormPage from "../../src/app/pages/SongFormPage";
import { UNSAVED_MESSAGE } from "../../src/app/components/useUnsavedChanges";
import { clearSongCache, peekSong, rememberSong } from "../../src/app/songCache";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function renderRouter(initial: string) {
  const router = createMemoryRouter(
    [
      { path: "/songs/new", element: <SongFormPage /> },
      { path: "/songs/:id/edit", element: <SongFormPage /> },
      { path: "/songs/:id", element: <div>song page</div> },
      { path: "/songs", element: <div>songs list</div> },
      { path: "/tracks", element: <div>original songs list</div> },
    ],
    { initialEntries: [initial] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function renderForm() {
  return renderRouter("/songs/new");
}

function renderEdit() {
  return renderRouter("/songs/s1/edit");
}

const stored = {
  id: "s1", title: "Stored", artist: "Band", sourceUrl: null, originalKey: "G", bandKey: "G", capo: 0,
  content: "[ch]G[/ch]", updatedAt: "x",
};

beforeEach(() => {
  Object.values(mocked).forEach((f) => f.mockReset());
  vi.restoreAllMocks();
  clearSongCache();
});

describe("SongFormPage", () => {
  it("imports from a link and fills the form with a preview", async () => {
    mocked.importSong.mockResolvedValue({
      title: "Wonderwall",
      artist: "Oasis",
      sourceUrl: "https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-1",
      originalKey: "Em",
      capo: 2,
      content: "[ch]Em7[/ch]Today is gonna be the day",
    });
    renderForm();
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Wonderwall"));
    expect(screen.getByLabelText("Artist")).toHaveValue("Oasis");
    expect(screen.getByLabelText("Original key")).toHaveValue("Em");
    expect(screen.getByTestId("preview")).toHaveTextContent("Today is gonna be the day");
  });

  it("shows the server message, reveals the paste box and keeps the link when import fails", async () => {
    mocked.importSong.mockRejectedValue(new ApiError(422, "Couldn't read that page. Paste the chords instead."));
    mocked.createSong.mockResolvedValue({ id: "s1" });
    renderForm();
    const link = "https://tabs.ultimate-guitar.com/tab/x/y-chords-9";
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: link } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Couldn't read that page. Paste the chords instead.")).toBeInTheDocument();
    expect(screen.getByLabelText("Chords")).toBeVisible();
    expect(screen.getByLabelText("Link")).toHaveValue(link);

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "T" } });
    fireEvent.change(screen.getByLabelText("Original key"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Chords"), { target: { value: "G\nHello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.createSong).toHaveBeenCalled());
    expect(mocked.createSong.mock.calls[0][0].sourceUrl).toBe(link);
  });

  it("saves pasted text as markup, defaults band key, and disables Save until there is a title", async () => {
    mocked.createSong.mockResolvedValue({ id: "s2" });
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Paste chords" }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    const text = "G       C\nHello there";
    fireEvent.change(screen.getByLabelText("Chords"), { target: { value: text } });
    fireEvent.change(screen.getByLabelText("Original key"), { target: { value: "G" } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Hello" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(mocked.createSong).toHaveBeenCalledTimes(1));
    const sent = mocked.createSong.mock.calls[0][0];
    expect(sent.content).toBe(markupFromPlainText(text));
    expect(sent.bandKey).toBe("G");
    expect(sent.originalKey).toBe("G");
    expect(sent.sourceUrl).toBeNull();
  });

  it("has no Delete song button when adding", () => {
    renderForm();
    expect(screen.queryByRole("button", { name: "Delete song" })).not.toBeInTheDocument();
  });

  it("deletes the song after confirming and goes to the song list", async () => {
    mocked.getSong.mockResolvedValue(stored);
    mocked.deleteSong.mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
    fireEvent.click(screen.getByRole("button", { name: "Delete song" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Stored"));
    expect(mocked.deleteSong).toHaveBeenCalledWith("s1");
    expect(await screen.findByText("songs list")).toBeInTheDocument();
  });

  it("warns that deleting an original song deletes the mp3, then returns to Original Songs", async () => {
    mocked.getSong.mockResolvedValue({ ...stored, trackId: "t1" });
    mocked.deleteSong.mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
    fireEvent.click(screen.getByRole("button", { name: "Delete song" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("This also deletes the mp3."));
    expect(await screen.findByText("original songs list")).toBeInTheDocument();
  });

  it("saves an original song that has no key yet without asking for one", async () => {
    mocked.getSong.mockResolvedValue({ ...stored, originalKey: "", bandKey: "", trackId: "t1" });
    mocked.updateSong.mockResolvedValue({ ...stored, id: "s1" });
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
    expect(screen.getByLabelText("Original key")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(1));
    expect(mocked.updateSong.mock.calls[0][1]).toMatchObject({ title: "Renamed", originalKey: "", bandKey: "" });
  });

  it("clears the band key when an original song's key is removed", async () => {
    mocked.getSong.mockResolvedValue({ ...stored, originalKey: "G", bandKey: "A", trackId: "t1" });
    mocked.updateSong.mockResolvedValue({ ...stored, id: "s1" });
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Original key")).toHaveValue("G"));
    fireEvent.change(screen.getByLabelText("Original key"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(1));
    expect(mocked.updateSong.mock.calls[0][1]).toMatchObject({ originalKey: "", bandKey: "" });
  });

  it("saves a song that is not an original with no key yet", async () => {
    mocked.getSong.mockResolvedValue({ ...stored, originalKey: "", bandKey: "" });
    mocked.updateSong.mockResolvedValue({ ...stored, id: "s1" });
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(1));
    expect(mocked.updateSong.mock.calls[0][1]).toMatchObject({ title: "Renamed", originalKey: "", bandKey: "" });
  });

  it("asks for a fresh copy of the song to edit", async () => {
    mocked.getSong.mockResolvedValue(stored);
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
    expect(mocked.getSong).toHaveBeenCalledWith("s1", { fresh: true });
  });

  it("forgets the cached copy of a song after saving it", async () => {
    mocked.getSong.mockResolvedValue(stored);
    mocked.updateSong.mockResolvedValue({ ...stored, title: "New" });
    rememberSong(stored);
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(peekSong("s1")).toBeUndefined());
  });

  it("forgets the cached copy of a song after deleting it", async () => {
    mocked.getSong.mockResolvedValue(stored);
    mocked.deleteSong.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    rememberSong(stored);
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
    fireEvent.click(screen.getByRole("button", { name: "Delete song" }));
    expect(await screen.findByText("songs list")).toBeInTheDocument();
    expect(peekSong("s1")).toBeUndefined();
  });

  it("does nothing when the delete is not confirmed", async () => {
    mocked.getSong.mockResolvedValue(stored);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
    fireEvent.click(screen.getByRole("button", { name: "Delete song" }));
    expect(mocked.deleteSong).not.toHaveBeenCalled();
  });

  it("shows an error when the delete fails", async () => {
    mocked.getSong.mockResolvedValue(stored);
    mocked.deleteSong.mockRejectedValue(new ApiError(500, "Could not delete"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
    fireEvent.click(screen.getByRole("button", { name: "Delete song" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not delete");
    expect(screen.queryByText("songs list")).not.toBeInTheDocument();
  });

  describe("editing the chords in place", () => {
    it("fills the Chords box with the current sheet as plain text, and previews it", async () => {
      mocked.getSong.mockResolvedValue(stored);
      renderEdit();
      await waitFor(() => expect(screen.getByLabelText("Chords")).toHaveValue("G"));
      expect(screen.getByTestId("preview").querySelector(".chord")).toHaveTextContent("G");
    });

    it("sends the stored content unchanged when Chords is not touched, even if it does not round-trip", async () => {
      const odd = "[ch]Am[/ch] intro riff";
      mocked.getSong.mockResolvedValue({ ...stored, content: odd });
      mocked.updateSong.mockResolvedValue({ ...stored });
      renderEdit();
      await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(1));
      expect(mocked.updateSong.mock.calls[0][1].content).toBe(odd);
    });

    it("sends the edited chords as markup", async () => {
      mocked.getSong.mockResolvedValue(stored);
      mocked.updateSong.mockResolvedValue({ ...stored });
      renderEdit();
      await waitFor(() => expect(screen.getByLabelText("Chords")).toHaveValue("G"));
      fireEvent.change(screen.getByLabelText("Chords"), { target: { value: "A" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(1));
      expect(mocked.updateSong.mock.calls[0][1].content).toBe("[ch]A[/ch]");
    });

    it("keeps the current chords when the box is emptied", async () => {
      mocked.getSong.mockResolvedValue(stored);
      mocked.updateSong.mockResolvedValue({ ...stored });
      renderEdit();
      await waitFor(() => expect(screen.getByLabelText("Chords")).toHaveValue("G"));
      fireEvent.change(screen.getByLabelText("Chords"), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(1));
      expect(mocked.updateSong.mock.calls[0][1].content).toBe("[ch]G[/ch]");
    });

    it("uses the new placeholder in edit mode", async () => {
      mocked.getSong.mockResolvedValue({ ...stored, content: "" });
      renderEdit();
      await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
      expect(screen.getByLabelText("Chords")).toHaveAttribute(
        "placeholder",
        "Fix chords here. Leave empty to keep the current chords",
      );
    });
  });

  describe("unsaved changes", () => {
    async function loadEdit() {
      mocked.getSong.mockResolvedValue(stored);
      const router = renderEdit();
      await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
      return router;
    }

    it("lets you leave without asking when nothing changed", async () => {
      const confirm = vi.spyOn(window, "confirm");
      const router = await loadEdit();
      await act(() => router.navigate("/songs"));
      expect(confirm).not.toHaveBeenCalled();
      expect(await screen.findByText("songs list")).toBeInTheDocument();
    });

    it("asks first when changed, and stays if you cancel", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const router = await loadEdit();
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
      await act(() => router.navigate("/songs"));
      expect(confirm).toHaveBeenCalledWith(UNSAVED_MESSAGE);
      expect(screen.getByLabelText("Title")).toHaveValue("Changed");
      expect(screen.queryByText("songs list")).not.toBeInTheDocument();
    });

    it("leaves when you confirm", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const router = await loadEdit();
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
      await act(() => router.navigate("/songs"));
      expect(await screen.findByText("songs list")).toBeInTheDocument();
    });

    it("asks first on a new song once something is typed", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      const router = renderForm();
      await act(() => router.navigate("/songs"));
      expect(confirm).not.toHaveBeenCalled();
      await act(() => router.navigate("/songs/new"));
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
      await act(() => router.navigate("/songs"));
      expect(confirm).toHaveBeenCalledWith(UNSAVED_MESSAGE);
    });

    it("counts a changed chord box or capo as unsaved, and changing it back as clean", async () => {
      const unloadPrevented = () => {
        const e = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(e);
        return e.defaultPrevented;
      };
      await loadEdit();
      expect(unloadPrevented()).toBe(false);
      fireEvent.change(screen.getByLabelText("Chords"), { target: { value: "A" } });
      expect(unloadPrevented()).toBe(true);
      fireEvent.change(screen.getByLabelText("Chords"), { target: { value: "G" } });
      expect(unloadPrevented()).toBe(false);
      fireEvent.change(screen.getByLabelText("Capo"), { target: { value: "2" } });
      expect(unloadPrevented()).toBe(true);
    });

    it("Save on a changed form goes to the song without asking", async () => {
      const confirm = vi.spyOn(window, "confirm");
      mocked.updateSong.mockResolvedValue({ ...stored, title: "Changed" });
      await loadEdit();
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByText("song page")).toBeInTheDocument();
      expect(confirm).not.toHaveBeenCalled();
    });

    it("Delete on a changed form goes to the list with only the delete confirmation", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      mocked.deleteSong.mockResolvedValue(undefined);
      await loadEdit();
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
      fireEvent.click(screen.getByRole("button", { name: "Delete song" }));
      expect(await screen.findByText("songs list")).toBeInTheDocument();
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm).not.toHaveBeenCalledWith(UNSAVED_MESSAGE);
    });

    it("sets the browser's leave-page prompt on reload or close only while changed", async () => {
      await loadEdit();
      const clean = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(clean);
      expect(clean.defaultPrevented).toBe(false);
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
      const dirty = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(dirty);
      expect(dirty.defaultPrevented).toBe(true);
    });
  });
});
