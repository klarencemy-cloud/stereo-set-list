import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return {
    ...actual,
    api: {
      listGigs: vi.fn(),
      getGig: vi.fn(),
      createGig: vi.fn(),
      updateGig: vi.fn(),
      deleteGig: vi.fn(),
      listSongs: vi.fn(),
    },
  };
});

vi.mock("../../src/app/offline", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/offline")>("../../src/app/offline");
  return { ...actual, canSaveOffline: vi.fn(() => false), saveGigForOffline: vi.fn() };
});

import { api, ApiError } from "../../src/app/api";
import { NOT_READY, canSaveOffline, saveGigForOffline } from "../../src/app/offline";
import GigPage from "../../src/app/pages/GigPage";
import GigsPage from "../../src/app/pages/GigsPage";
import { clearSongCache, loadSetlist } from "../../src/app/songCache";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const mk = (id: string, title: string, bandKey: string) => ({
  id, title, artist: "A", sourceUrl: null, originalKey: bandKey, bandKey, capo: 0, content: "", updatedAt: "x",
});
const sl = (...ids: string[]) => ids.map((songId) => ({ type: "song" as const, songId }));
const songs = [mk("s1", "Alpha", "A"), mk("s2", "Beta", "C"), mk("s3", "Gamma", "E")];
const gig = { id: "g1", name: "Winter Show", date: "2026-12-20", setlist: sl("s1", "s2"), songIds: ["s1", "s2"] };

/** An edit-mode row (a song or a break), found through its drag handle. */
const rowOf = (dragLabel: string) => screen.getByRole("button", { name: dragLabel }).closest("li") as HTMLElement;

function renderGig() {
  return render(
    <MemoryRouter initialEntries={["/gigs/g1"]}>
      <Routes>
        <Route path="/gigs/:id" element={<GigPage />} />
        <Route path="/songs/:id" element={<div>song page</div>} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearSongCache();
  Object.values(mocked).forEach((f) => f.mockReset());
  mocked.getGig.mockResolvedValue({ ...gig });
  mocked.listSongs.mockResolvedValue(songs.map((s) => ({ ...s })));
  mocked.updateGig.mockImplementation(async (_id: string, patch: object) => ({ ...gig, ...patch }));
});

describe("GigPage no-chords tag", () => {
  it("marks setlist songs that have no chords yet", async () => {
    mocked.listSongs.mockResolvedValue([
      { ...songs[0], hasChords: false },
      { ...songs[1], hasChords: true },
      { ...songs[2], hasChords: true },
    ]);
    renderGig();
    const row = (await screen.findByText("1. Alpha — Key: A")).closest("a")!;
    expect(within(row).getByText("No chords yet")).toBeInTheDocument();
    expect(screen.getAllByText("No chords yet")).toHaveLength(1);
  });
});

describe("GigPage offline saving", () => {
  const canSave = canSaveOffline as unknown as ReturnType<typeof vi.fn>;
  const save = saveGigForOffline as unknown as ReturnType<typeof vi.fn>;
  beforeEach(() => {
    canSave.mockReturnValue(true);
    save.mockReset();
  });
  afterEach(() => canSave.mockReturnValue(false));

  it("hides the button when the browser can't save offline", async () => {
    canSave.mockReturnValue(false);
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    expect(screen.queryByRole("button", { name: "Save for offline" })).not.toBeInTheDocument();
  });

  it("is hidden while editing the setlist", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    expect(screen.queryByRole("button", { name: "Save for offline" })).not.toBeInTheDocument();
  });

  it("saves the gig and reports how many songs were saved", async () => {
    let resolve!: (v: unknown) => void;
    save.mockReturnValue(new Promise((r) => (resolve = r)));
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Save for offline" }));
    expect(save).toHaveBeenCalledWith("g1");
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    resolve({ saved: 3, total: 3 });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved 3 songs for offline.");
    expect(screen.getByRole("button", { name: "Save for offline" })).toBeEnabled();
  });

  it("says when some songs could not be saved", async () => {
    save.mockResolvedValue({ saved: 2, total: 3 });
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Save for offline" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved 2 of 3 songs. Try again with better signal.");
  });

  it("shows the not-ready message", async () => {
    save.mockRejectedValue(new Error(NOT_READY));
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Save for offline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(NOT_READY);
  });

  it("shows a general error for other failures", async () => {
    save.mockRejectedValue(new ApiError(0, "Can't reach the server."));
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Save for offline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save for offline.");
  });
});

describe("GigPage print setlist", () => {
  const printTitles = (container: HTMLElement) =>
    Array.from(container.querySelectorAll(".print-setlist li")).map((li) => li.textContent);

  it("opens the browser print dialog", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Print setlist" }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it("prints only the titles, in capitals and setlist order", async () => {
    mocked.getGig.mockResolvedValue({ ...gig, setlist: sl("s2", "s1") });
    const { container } = renderGig();
    await screen.findByText("1. Beta — Key: C");
    expect(printTitles(container)).toEqual(["BETA", "ALPHA"]);
  });

  it("leaves deleted songs off the printed sheet", async () => {
    mocked.getGig.mockResolvedValue({ ...gig, setlist: sl("s1", "gone", "s3") });
    const { container } = renderGig();
    await screen.findByText("1. Alpha — Key: A");
    expect(printTitles(container)).toEqual(["ALPHA", "GAMMA"]);
  });

  it("keeps the printed list out of the on-screen setlist", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("is hidden while editing the setlist", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    expect(screen.queryByRole("button", { name: "Print setlist" })).not.toBeInTheDocument();
  });

  it("is hidden when the setlist is empty", async () => {
    mocked.getGig.mockResolvedValue({ ...gig, setlist: [] });
    const { container } = renderGig();
    await screen.findByText("No songs in the setlist yet.");
    expect(screen.queryByRole("button", { name: "Print setlist" })).not.toBeInTheDocument();
    expect(container.querySelector(".print-setlist")).toBeNull();
  });
});

describe("GigPage", () => {
  it("shows name, formatted date and numbered setlist rows linking to songs", async () => {
    renderGig();
    expect(await screen.findByRole("heading", { name: "Winter Show" })).toBeInTheDocument();
    expect(screen.getByText("Sun, 20 Dec 2026")).toBeInTheDocument();
    const first = await screen.findByText("1. Alpha — Key: A");
    expect(screen.getByText("2. Beta — Key: C")).toBeInTheDocument();
    expect(first.closest("a")).toHaveAttribute("href", "/songs/s1?gig=g1");
  });

  it("skips setlist ids whose song no longer exists", async () => {
    mocked.getGig.mockResolvedValue({ ...gig, setlist: sl("s1", "gone", "s2") });
    renderGig();
    expect(await screen.findByText("1. Alpha — Key: A")).toBeInTheDocument();
    expect(screen.getByText("2. Beta — Key: C")).toBeInTheDocument();
  });

  it("reorders by dragging only: no Move up or Move down buttons", async () => {
    mocked.getGig.mockResolvedValue({ ...gig, setlist: [...sl("s1", "s2"), { type: "break", id: "k1", label: "Set 2" }] });
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    expect(screen.queryByRole("button", { name: "Move up" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move down" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drag Alpha" })).toBeInTheDocument();
  });

  it("forgets the cached setlist after the setlist is saved", async () => {
    await loadSetlist("g1");
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);
    await waitFor(() => expect(mocked.updateGig).toHaveBeenCalledTimes(1));
    const before = mocked.getGig.mock.calls.length;
    await loadSetlist("g1");
    expect(mocked.getGig.mock.calls.length).toBe(before + 1);
  });

  it("Remove drops the row", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    fireEvent.click(within(rowOf("Drag Alpha")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocked.updateGig).toHaveBeenCalledWith("g1", { setlist: sl("s2") }));
  });

  it("puts the add-songs box at the top of edit mode, under the Setlist heading and above the rows", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    const heading = screen.getByRole("heading", { name: "Setlist" });
    const search = screen.getByLabelText("Find songs to add");
    const firstRow = screen.getByRole("button", { name: "Drag Alpha" });
    expect(heading.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(search.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not show the empty-setlist message while editing", async () => {
    mocked.getGig.mockResolvedValue({ ...gig, setlist: [] });
    renderGig();
    await screen.findByText("No songs in the setlist yet.");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    expect(screen.queryByText("No songs in the setlist yet.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Find songs to add")).toBeInTheDocument();
  });

  it("adds several ticked songs at once, in the order ticked", async () => {
    mocked.listSongs.mockResolvedValue([...songs.map((x) => ({ ...x })), mk("s4", "Delta", "D")]);
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Delta — D" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma — E" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 songs" }));
    await waitFor(() => expect(mocked.updateGig).toHaveBeenCalledWith("g1", { setlist: sl("s1", "s2", "s4", "s3") }));
    expect(await screen.findByText("3. Delta — Key: D")).toBeInTheDocument();
    expect(screen.getByText("4. Gamma — Key: E")).toBeInTheDocument();
  });

  it("keeps the ticked songs when adding them fails, so they can be added again", async () => {
    mocked.updateGig.mockRejectedValue(new ApiError(400, "too many"));
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Gamma — E" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 song" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("too many");
    expect(screen.getByRole("checkbox", { name: "Gamma — E" })).toBeChecked();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add 1 song" })).toBeEnabled());
  });

  it("reverts and shows the error when saving fails", async () => {
    mocked.updateGig.mockRejectedValue(new ApiError(500, "nope"));
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    fireEvent.click(within(rowOf("Drag Alpha")).getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(screen.getByText("1. Alpha — Key: A")).toBeInTheDocument();
    expect(screen.getByText("2. Beta — Key: C")).toBeInTheDocument();
  });

  it("deletes the gig after confirm and goes home", async () => {
    mocked.deleteGig.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete gig" }));
    await waitFor(() => expect(mocked.deleteGig).toHaveBeenCalledWith("g1"));
    expect(await screen.findByText("home")).toBeInTheDocument();
  });

  it("shows Delete gig without entering setlist edit mode", async () => {
    mocked.deleteGig.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Delete gig" }));
    await waitFor(() => expect(mocked.deleteGig).toHaveBeenCalledWith("g1"));
  });

  it("does not delete when the confirm is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Delete gig" }));
    expect(mocked.deleteGig).not.toHaveBeenCalled();
  });

  it("edits the gig name and date", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Winter Show");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-12-20");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Spring Show " } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2027-03-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocked.updateGig).toHaveBeenCalledWith("g1", { name: "Spring Show", date: "2027-03-05" }),
    );
    expect(await screen.findByRole("heading", { name: "Spring Show" })).toBeInTheDocument();
    expect(screen.getByText("Fri, 5 Mar 2027")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("rejects an empty name when editing details", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a name and a date.");
    expect(mocked.updateGig).not.toHaveBeenCalled();
  });

  it("cancel leaves the details unchanged", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Other" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Winter Show" })).toBeInTheDocument();
    expect(mocked.updateGig).not.toHaveBeenCalled();
  });

  it("shows an error when saving details fails", async () => {
    mocked.updateGig.mockRejectedValue(new ApiError(400, "bad date"));
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Other" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("bad date");
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("shows an error when the gig is missing", async () => {
    mocked.getGig.mockRejectedValue(new ApiError(404, "Gig not found"));
    renderGig();
    expect(await screen.findByRole("alert")).toHaveTextContent("Gig not found");
  });
});

describe("GigPage setlist items", () => {
  const withBreak = [
    { type: "song", songId: "s1", note: "Klarence count-in" },
    { type: "break", id: "k1", label: "Set 2" },
    { type: "song", songId: "s2" },
  ];
  beforeEach(() => {
    mocked.listSongs.mockResolvedValue([mk("s1", "Alpha", "A"), mk("s2", "Beta", "C"), mk("s3", "Gamma", "E")]);
  });

  it("shows breaks and notes", async () => {
    mocked.getGig.mockResolvedValue({ ...gig, setlist: withBreak });
    renderGig();
    expect(await screen.findByText("1. Alpha — Key: A")).toBeInTheDocument();
    expect(screen.getByText("Klarence count-in")).toBeInTheDocument();
    expect(screen.getByText("Set 2")).toBeInTheDocument();
    expect(screen.getByText("2. Beta — Key: C")).toBeInTheDocument();
  });

  it("leaves the key off a song that has no key yet, in view, edit and the add picker", async () => {
    mocked.listSongs.mockResolvedValue([mk("s1", "Alpha", "A"), mk("s2", "Beta", ""), mk("s3", "Gamma", "")]);
    renderGig();
    expect(await screen.findByText("2. Beta")).toBeInTheDocument();
    expect(screen.getByText("1. Alpha — Key: A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    expect(within(rowOf("Drag Beta")).getByText("2. Beta")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Gamma" })).toBeInTheDocument();
  });

  it("still lists the songs of a legacy gig that only has songIds", async () => {
    mocked.getGig.mockResolvedValue({ id: "g1", name: "Winter Show", date: "2026-12-20", songIds: ["s1", "s2"] });
    renderGig();
    expect(await screen.findByText("1. Alpha — Key: A")).toBeInTheDocument();
    expect(screen.getByText("2. Beta — Key: C")).toBeInTheDocument();
  });

  it("saves a changed note on blur and removes the key when cleared", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    const note = screen.getByLabelText("Note for Alpha");
    fireEvent.change(note, { target: { value: " Segue " } });
    fireEvent.blur(note);
    await waitFor(() =>
      expect(mocked.updateGig).toHaveBeenCalledWith("g1", {
        setlist: [{ type: "song", songId: "s1", note: "Segue" }, { type: "song", songId: "s2" }],
      }),
    );
    await waitFor(() => expect(screen.getByLabelText("Note for Alpha")).toHaveValue("Segue"));
    fireEvent.change(screen.getByLabelText("Note for Alpha"), { target: { value: "" } });
    fireEvent.blur(screen.getByLabelText("Note for Alpha"));
    await waitFor(() => expect(mocked.updateGig).toHaveBeenCalledTimes(2));
    expect(mocked.updateGig.mock.calls[1][1]).toStrictEqual({ setlist: sl("s1", "s2") });
  });

  it("keeps the typed note in the box when saving it fails", async () => {
    mocked.updateGig.mockRejectedValue(new ApiError(500, "nope"));
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    const note = screen.getByLabelText("Note for Alpha");
    fireEvent.change(note, { target: { value: "capo 2" } });
    fireEvent.blur(note);
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    await waitFor(() => expect(screen.getByLabelText("Note for Alpha")).toBeEnabled());
    expect(screen.getByLabelText("Note for Alpha")).toHaveValue("capo 2");
  });

  it("keeps a typed break label in the box when saving it fails", async () => {
    mocked.getGig.mockResolvedValue({ ...gig, setlist: withBreak });
    mocked.updateGig.mockRejectedValue(new ApiError(500, "nope"));
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    const label = screen.getByLabelText("Label for Set 2");
    fireEvent.change(label, { target: { value: "Second half" } });
    fireEvent.blur(label);
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    await waitFor(() => expect(screen.getByLabelText("Label for Set 2")).toBeEnabled());
    expect(screen.getByLabelText("Label for Set 2")).toHaveValue("Second half");
  });

  it("does not save when a note is blurred unchanged", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    fireEvent.blur(screen.getByLabelText("Note for Alpha"));
    expect(mocked.updateGig).not.toHaveBeenCalled();
  });

  it("adds a set break at the end, labelled by how many sets there are", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    fireEvent.click(screen.getByRole("button", { name: "Add set break" }));
    await waitFor(() => expect(mocked.updateGig).toHaveBeenCalledTimes(1));
    const { setlist } = mocked.updateGig.mock.calls[0][1];
    expect(setlist).toHaveLength(3);
    expect(setlist[2]).toEqual({ type: "break", label: "Set 2", id: expect.any(String) });
    expect(await screen.findByLabelText("Label for Set 2")).toBeInTheDocument();
  });

  it("renames a break on blur, and a break has its own Remove button", async () => {
    mocked.getGig.mockResolvedValue({ ...gig, setlist: withBreak });
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    const label = screen.getByLabelText("Label for Set 2");
    fireEvent.change(label, { target: { value: "Second half" } });
    fireEvent.blur(label);
    await waitFor(() =>
      expect(mocked.updateGig).toHaveBeenCalledWith("g1", {
        setlist: [withBreak[0], { type: "break", id: "k1", label: "Second half" }, withBreak[2]],
      }),
    );
    // The handle is named after the break, which has just been renamed.
    const row = await waitFor(() => rowOf("Drag Second half"));
    expect(within(row).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("removes a break", async () => {
    mocked.getGig.mockResolvedValue({ ...gig, setlist: withBreak });
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    fireEvent.click(within(rowOf("Drag Set 2")).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(mocked.updateGig).toHaveBeenCalledWith("g1", { setlist: [withBreak[0], withBreak[2]] }),
    );
  });

  it("shows a drag handle for each song and break in edit mode only", async () => {
    mocked.getGig.mockResolvedValue({ ...gig, setlist: withBreak });
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    expect(screen.queryByRole("button", { name: /^Drag / })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    expect(screen.getByRole("button", { name: "Drag Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drag Set 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drag Beta" })).toBeInTheDocument();
  });

  it("prints only the song titles, leaving set breaks off the paper", async () => {
    mocked.getGig.mockResolvedValue({ ...gig, setlist: withBreak });
    const { container } = renderGig();
    await screen.findByText("1. Alpha — Key: A");
    const printed = Array.from(container.querySelectorAll(".print-setlist li")).map((li) => li.textContent);
    expect(printed).toEqual(["ALPHA", "BETA"]);
  });
});

describe("GigsPage", () => {
  function renderList() {
    return render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<GigsPage />} />
          <Route path="/gigs/:id" element={<div>gig page</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("lists gigs with name and date", async () => {
    mocked.listGigs.mockResolvedValue([
      { id: "g2", name: "New Year", date: "2027-01-01", songIds: [], setlist: [] },
      { ...gig },
    ]);
    renderList();
    expect(await screen.findByText("New Year")).toBeInTheDocument();
    expect(screen.getByText("Fri, 1 Jan 2027")).toBeInTheDocument();
    expect(screen.getByText("Winter Show").closest("a")).toHaveAttribute("href", "/gigs/g1");
  });

  describe("sections", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 10, 12, 12));
    });
    afterEach(() => vi.useRealTimers());

    it("shows upcoming gigs soonest first, and past gigs separately", async () => {
      mocked.listGigs.mockResolvedValue([
        { id: "a", name: "December", date: "2026-12-20", songIds: [] },
        { id: "b", name: "Mid Nov", date: "2026-11-15", songIds: [] },
        { id: "c", name: "October", date: "2026-10-01", songIds: [] },
      ]);
      renderList();
      const upcoming = await screen.findByRole("region", { name: "Upcoming" });
      expect(within(upcoming).getAllByRole("link").map((l) => l.textContent)).toEqual([
        expect.stringContaining("Mid Nov"),
        expect.stringContaining("December"),
      ]);
      const past = screen.getByRole("region", { name: "Past" });
      expect(within(past).getByText("October")).toBeInTheDocument();
    });

    it("says there are no upcoming gigs when only past ones exist", async () => {
      mocked.listGigs.mockResolvedValue([{ id: "c", name: "October", date: "2026-10-01", songIds: [] }]);
      renderList();
      const upcoming = await screen.findByRole("region", { name: "Upcoming" });
      expect(within(upcoming).getByText("No upcoming gigs.")).toBeInTheDocument();
    });

    it("has no Past section when there are no past gigs", async () => {
      mocked.listGigs.mockResolvedValue([{ id: "a", name: "December", date: "2026-12-20", songIds: [] }]);
      renderList();
      await screen.findByRole("region", { name: "Upcoming" });
      expect(screen.queryByRole("region", { name: "Past" })).not.toBeInTheDocument();
    });
  });

  it("creates a gig from name and date and opens it", async () => {
    mocked.listGigs.mockResolvedValue([]);
    mocked.createGig.mockResolvedValue({ id: "g9", name: "Pub", date: "2026-12-31", songIds: [] });
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "New gig" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Pub " } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Create gig" }));
    await waitFor(() =>
      expect(mocked.createGig).toHaveBeenCalledWith({ name: "Pub", date: "2026-12-31", setlist: [] }),
    );
    expect(await screen.findByText("gig page")).toBeInTheDocument();
  });

  describe("past dates", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 11, 20, 15, 0) });
    });
    afterEach(() => vi.useRealTimers());

    it("blocks a past date and does not create the gig", async () => {
      mocked.listGigs.mockResolvedValue([]);
      renderList();
      fireEvent.click(await screen.findByRole("button", { name: "New gig" }));
      expect(screen.getByLabelText("Date")).toHaveAttribute("min", "2026-12-20");
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Old" } });
      fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-12-19" } });
      fireEvent.click(screen.getByRole("button", { name: "Create gig" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("past");
      expect(mocked.createGig).not.toHaveBeenCalled();
    });

    it("allows today", async () => {
      mocked.listGigs.mockResolvedValue([]);
      mocked.createGig.mockResolvedValue({ id: "g9", name: "Now", date: "2026-12-20", songIds: [] });
      renderList();
      fireEvent.click(await screen.findByRole("button", { name: "New gig" }));
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Now" } });
      fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-12-20" } });
      fireEvent.click(screen.getByRole("button", { name: "Create gig" }));
      await waitFor(() => expect(mocked.createGig).toHaveBeenCalled());
    });
  });

  it("shows an error when creating fails", async () => {
    mocked.listGigs.mockResolvedValue([]);
    mocked.createGig.mockRejectedValue(new ApiError(400, "bad date"));
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "New gig" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pub" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Create gig" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("bad date");
  });
});
