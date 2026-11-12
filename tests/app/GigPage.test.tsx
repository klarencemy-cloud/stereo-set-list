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

import { api, ApiError } from "../../src/app/api";
import GigPage from "../../src/app/pages/GigPage";
import GigsPage from "../../src/app/pages/GigsPage";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

const mk = (id: string, title: string, bandKey: string) => ({
  id, title, artist: "A", sourceUrl: null, originalKey: bandKey, bandKey, capo: 0, content: "", updatedAt: "x",
});
const songs = [mk("s1", "Alpha", "A"), mk("s2", "Beta", "C"), mk("s3", "Gamma", "E")];
const gig = { id: "g1", name: "Winter Show", date: "2026-12-20", songIds: ["s1", "s2"] };

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
  Object.values(mocked).forEach((f) => f.mockReset());
  mocked.getGig.mockResolvedValue({ ...gig });
  mocked.listSongs.mockResolvedValue(songs.map((s) => ({ ...s })));
  mocked.updateGig.mockImplementation(async (_id: string, patch: object) => ({ ...gig, ...patch }));
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
    mocked.getGig.mockResolvedValue({ ...gig, songIds: ["s1", "gone", "s2"] });
    renderGig();
    expect(await screen.findByText("1. Alpha — Key: A")).toBeInTheDocument();
    expect(screen.getByText("2. Beta — Key: C")).toBeInTheDocument();
  });

  it("Move up on row 2 saves the first two swapped", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    const rows = screen.getAllByRole("listitem");
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(mocked.updateGig).toHaveBeenCalledWith("g1", { songIds: ["s2", "s1"] }));
    expect(await screen.findByText("1. Beta — Key: C")).toBeInTheDocument();
  });

  it("Remove drops the row", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    fireEvent.click(within(screen.getAllByRole("listitem")[0]).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(mocked.updateGig).toHaveBeenCalledWith("g1", { songIds: ["s2"] }));
  });

  it("Add song picks from the song list", async () => {
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    fireEvent.change(screen.getByLabelText("Song to add"), { target: { value: "s3" } });
    fireEvent.click(screen.getByRole("button", { name: "Add song" }));
    await waitFor(() => expect(mocked.updateGig).toHaveBeenCalledWith("g1", { songIds: ["s1", "s2", "s3"] }));
    expect(await screen.findByText("3. Gamma — Key: E")).toBeInTheDocument();
  });

  it("reverts and shows the error when saving fails", async () => {
    mocked.updateGig.mockRejectedValue(new ApiError(500, "nope"));
    renderGig();
    await screen.findByText("1. Alpha — Key: A");
    fireEvent.click(screen.getByRole("button", { name: "Edit setlist" }));
    fireEvent.click(within(screen.getAllByRole("listitem")[1]).getByRole("button", { name: "Move up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(screen.getByText("1. Alpha — Key: A")).toBeInTheDocument();
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
      { id: "g2", name: "New Year", date: "2027-01-01", songIds: [] },
      { ...gig },
    ]);
    renderList();
    expect(await screen.findByText("New Year")).toBeInTheDocument();
    expect(screen.getByText("Fri, 1 Jan 2027")).toBeInTheDocument();
    expect(screen.getByText("Winter Show").closest("a")).toHaveAttribute("href", "/gigs/g1");
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
      expect(mocked.createGig).toHaveBeenCalledWith({ name: "Pub", date: "2026-12-31", songIds: [] }),
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
