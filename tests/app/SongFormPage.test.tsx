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
import { clearSongCache } from "../../src/app/songCache";

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
    // Only the changed field, plus the version the form loaded.
    expect(mocked.updateSong.mock.calls[0]).toEqual(["s1", { title: "Renamed" }, "x"]);
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
    // Only the changed field, plus the version the form loaded.
    expect(mocked.updateSong.mock.calls[0]).toEqual(["s1", { title: "Renamed" }, "x"]);
  });

  it("asks for a fresh copy of the song to edit", async () => {
    mocked.getSong.mockResolvedValue(stored);
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
    expect(mocked.getSong).toHaveBeenCalledWith("s1", { fresh: true });
  });

  // Forgetting cached copies after a save or delete is api.ts's job now: see tests/app/api.test.ts.

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

    it("leaves the stored content alone when Chords is not touched, even if it does not round-trip", async () => {
      const odd = "[ch]Am[/ch] intro riff";
      mocked.getSong.mockResolvedValue({ ...stored, content: odd });
      mocked.updateSong.mockResolvedValue({ ...stored });
      renderEdit();
      await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(1));
      expect(mocked.updateSong.mock.calls[0][1]).not.toHaveProperty("content");
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
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(1));
      expect(mocked.updateSong.mock.calls[0][1]).not.toHaveProperty("content");
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

describe("SongFormPage when a bandmate edits the song at the same time", () => {
  it("doesn't send the band key back, so a transpose made while the form was open stays", async () => {
    mocked.getSong.mockResolvedValue(stored);
    mocked.updateSong.mockResolvedValue({ ...stored, content: "[ch]A[/ch]" });
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Chords")).toHaveValue("G"));
    fireEvent.change(screen.getByLabelText("Chords"), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(1));
    expect(mocked.updateSong.mock.calls[0]).toEqual(["s1", { content: "[ch]A[/ch]" }, "x"]);
  });

  it("saves nothing when nothing changed", async () => {
    mocked.getSong.mockResolvedValue(stored);
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("song page")).toBeInTheDocument();
    expect(mocked.updateSong).not.toHaveBeenCalled();
  });

  it("on a conflict, keeps what was typed and offers Reload, which loads their version", async () => {
    const theirs = { ...stored, title: "Their title", bandKey: "A", updatedAt: "y" };
    mocked.getSong.mockResolvedValue(stored);
    mocked.updateSong.mockRejectedValue(
      new ApiError(409, "Someone else changed this song. Reload to see their changes.", theirs),
    );
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else changed this song");
    expect(screen.getByLabelText("Title")).toHaveValue("My title");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Their title");
    expect(screen.queryByRole("alert")).toBeNull();

    // Saving again sends the version it reloaded.
    mocked.updateSong.mockResolvedValue({ ...theirs, title: "Again" });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Again" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(2));
    expect(mocked.updateSong.mock.calls[1]).toEqual(["s1", { title: "Again" }, "y"]);
  });
});

describe("SongFormPage import while editing", () => {
  const UG = "https://tabs.ultimate-guitar.com/tab/coldplay/yellow-chords-1";
  const fromPlaylist = { ...stored, title: "Yellow", artist: "Coldplay", originalKey: "", bandKey: "", capo: 0, content: "" };
  const imported = {
    title: "Yellow (Acoustic)", artist: "Cold Play", originalKey: "B", capo: 2,
    content: markupFromPlainText("B\nLook at the stars"), sourceUrl: UG,
  };

  async function editAndImport(song: object) {
    mocked.getSong.mockResolvedValue(song);
    mocked.importSong.mockResolvedValue(imported);
    mocked.updateSong.mockResolvedValue({ ...stored, id: "s1" });
    const router = renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue((song as { title: string }).title));
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: UG } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByLabelText("Original key")).toHaveValue("B"));
    return router;
  }

  it("fills the key, capo and chords but keeps the title and artist, and saves nothing yet", async () => {
    await editAndImport(fromPlaylist);
    expect(mocked.importSong).toHaveBeenCalledWith(UG);
    expect(screen.getByLabelText("Title")).toHaveValue("Yellow");
    expect(screen.getByLabelText("Artist")).toHaveValue("Coldplay");
    expect(screen.getByLabelText("Capo")).toHaveValue(2);
    expect((screen.getByLabelText("Chords") as HTMLTextAreaElement).value).toContain("Look at the stars");
    expect(mocked.updateSong).not.toHaveBeenCalled();
  });

  it("saves the imported chords with the band key set to the new key", async () => {
    await editAndImport(fromPlaylist);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(1));
    // Title and artist are unchanged, so they aren't sent.
    expect(mocked.updateSong.mock.calls[0][1]).toEqual({
      originalKey: "B", bandKey: "B", capo: 2, sourceUrl: UG, content: imported.content,
    });
  });

  it("keeps a band key the band already chose", async () => {
    await editAndImport({ ...fromPlaylist, originalKey: "G", bandKey: "A" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(1));
    const patch = mocked.updateSong.mock.calls[0][1];
    expect(patch.originalKey).toBe("B");
    expect(patch).not.toHaveProperty("bandKey"); // unchanged: the server keeps A
  });

  it("keeps both keys when the UG page has no key", async () => {
    mocked.getSong.mockResolvedValue({ ...fromPlaylist, originalKey: "G", bandKey: "A" });
    mocked.importSong.mockResolvedValue({ ...imported, originalKey: "" });
    mocked.updateSong.mockResolvedValue({ ...stored, id: "s1" });
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Original key")).toHaveValue("G"));
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: UG } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByLabelText("Capo")).toHaveValue(2));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.updateSong).toHaveBeenCalledTimes(1));
    const patch = mocked.updateSong.mock.calls[0][1];
    expect(patch.content).toBe(imported.content);
    expect(patch).not.toHaveProperty("originalKey");
    expect(patch).not.toHaveProperty("bandKey");
  });

  it("counts as unsaved until saved", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const router = await editAndImport(fromPlaylist);
    await act(() => router.navigate("/songs"));
    expect(confirm).toHaveBeenCalledWith(UNSAVED_MESSAGE);
  });

  it("leaves everything as it was when the import fails", async () => {
    mocked.getSong.mockResolvedValue({ ...stored });
    mocked.importSong.mockRejectedValue(new ApiError(422, "Couldn't read that page. Paste the chords instead."));
    renderEdit();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Stored"));
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: UG } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Couldn't read that page. Paste the chords instead.")).toBeInTheDocument();
    expect(screen.getByLabelText("Original key")).toHaveValue("G");
    expect((screen.getByLabelText("Chords") as HTMLTextAreaElement).value).toContain("G");
  });
});
