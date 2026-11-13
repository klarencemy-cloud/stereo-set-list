import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return {
    ...actual,
    api: { listGigs: vi.fn(), listSongs: vi.fn(), createGig: vi.fn(), importSongs: vi.fn(), readPlaylist: vi.fn() },
  };
});

import { api, ApiError } from "../../src/app/api";
import GigsPage from "../../src/app/pages/GigsPage";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const song = (id: string, title: string, artist: string) => ({
  id, title, artist, sourceUrl: null, originalKey: "", bandKey: "", capo: 0, content: "", updatedAt: "x",
});
const tracks = [{ title: "Wonderwall", artist: "Oasis" }, { title: "Yellow", artist: "Coldplay" }];

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

async function openForm() {
  renderList();
  fireEvent.click(await screen.findByRole("button", { name: "New gig" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Pub" } });
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2099-12-31" } });
}

async function loadPlaylist() {
  fireEvent.click(screen.getByRole("button", { name: "Import Playlist" }));
  fireEvent.change(screen.getByLabelText("Spotify playlist"), { target: { value: "https://open.spotify.com/playlist/x" } });
  fireEvent.click(screen.getByRole("button", { name: "Load" }));
  await screen.findByText("Yellow — Coldplay");
}

beforeEach(() => {
  Object.values(mocked).forEach((f) => f.mockReset());
  mocked.listGigs.mockResolvedValue([]);
  mocked.listSongs.mockResolvedValue([{ ...song("s1", "Wonderwall", "Oasis") }]);
  mocked.readPlaylist.mockResolvedValue({ name: "Friday", tracks, truncated: false });
  mocked.importSongs.mockResolvedValue([song("s1", "Wonderwall", "Oasis"), song("s2", "Yellow", "Coldplay")]);
  mocked.createGig.mockResolvedValue({ id: "g9", name: "Pub", date: "2099-12-31", setlist: [], songIds: [] });
});

describe("GigsPage playlist import", () => {
  it("loads the songs list once when the playlist section is opened", async () => {
    await openForm();
    expect(mocked.listSongs).not.toHaveBeenCalled();
    await loadPlaylist();
    expect(mocked.listSongs).toHaveBeenCalledTimes(1);
    expect(within(screen.getByText("Wonderwall — Oasis").closest("label")!).getByText("in Songs")).toBeInTheDocument();
  });

  it("creates the gig with the playlist as its setlist, in order", async () => {
    await openForm();
    await loadPlaylist();
    fireEvent.click(screen.getByRole("button", { name: "Create gig" }));
    expect(await screen.findByText("gig page")).toBeInTheDocument();
    expect(mocked.importSongs).toHaveBeenCalledWith(tracks);
    expect(mocked.createGig).toHaveBeenCalledWith({
      name: "Pub",
      date: "2099-12-31",
      setlist: [{ type: "song", songId: "s1" }, { type: "song", songId: "s2" }],
    });
  });

  it("only imports the ticked tracks", async () => {
    mocked.importSongs.mockResolvedValue([song("s2", "Yellow", "Coldplay")]);
    await openForm();
    await loadPlaylist();
    fireEvent.click(within(screen.getByText("Wonderwall — Oasis").closest("label")!).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create gig" }));
    await screen.findByText("gig page");
    expect(mocked.importSongs).toHaveBeenCalledWith([tracks[1]]);
  });

  it("creates an empty gig as before when no playlist is used", async () => {
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Create gig" }));
    await screen.findByText("gig page");
    expect(mocked.importSongs).not.toHaveBeenCalled();
    expect(mocked.createGig).toHaveBeenCalledWith({ name: "Pub", date: "2099-12-31", setlist: [] });
  });

  it("keeps everything when the gig can't be saved, and trying again works", async () => {
    mocked.createGig.mockRejectedValueOnce(new ApiError(500, "Server is down"));
    await openForm();
    await loadPlaylist();
    fireEvent.click(screen.getByRole("button", { name: "Create gig" }));
    expect(await screen.findByText("Server is down")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Pub");
    expect(screen.getByLabelText("Date")).toHaveValue("2099-12-31");
    expect(within(screen.getByText("Yellow — Coldplay").closest("label")!).getByRole("checkbox")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Create gig" }));
    expect(await screen.findByText("gig page")).toBeInTheDocument();
    expect(mocked.importSongs).toHaveBeenCalledTimes(2);
    expect(mocked.createGig).toHaveBeenCalledTimes(2);
  });

  it("does not create the gig when the songs can't be imported", async () => {
    mocked.importSongs.mockRejectedValue(new ApiError(400, "title is required"));
    await openForm();
    await loadPlaylist();
    fireEvent.click(screen.getByRole("button", { name: "Create gig" }));
    expect(await screen.findByText("title is required")).toBeInTheDocument();
    expect(mocked.createGig).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveValue("Pub");
    await waitFor(() => expect(screen.getByRole("button", { name: "Create gig" })).toBeEnabled());
  });
});
