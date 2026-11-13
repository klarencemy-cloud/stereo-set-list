import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { readPlaylist: vi.fn() } };
});

import { api, ApiError } from "../../src/app/api";
import PlaylistImport from "../../src/app/components/PlaylistImport";
import type { PlaylistTrack } from "../../src/shared/playlist";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const summary = (id: string, title: string, artist: string) => ({
  id, title, artist, sourceUrl: null, originalKey: "", bandKey: "", capo: 0, updatedAt: "x",
});
const songs = [summary("s1", "Wonderwall", "Oasis"), summary("s2", "Creep", "Radiohead")];
const LINK = "https://open.spotify.com/playlist/abc";

let ticked: PlaylistTrack[][] = [];
const last = () => ticked[ticked.length - 1];

function renderIt(props: Partial<Parameters<typeof PlaylistImport>[0]> = {}) {
  return render(<PlaylistImport songs={songs} onTicked={(t) => ticked.push(t)} {...props} />);
}

async function load(tracks: PlaylistTrack[], truncated = false) {
  mocked.readPlaylist.mockResolvedValue({ name: "Friday", tracks, truncated });
  fireEvent.change(screen.getByLabelText("Spotify playlist"), { target: { value: LINK } });
  fireEvent.click(screen.getByRole("button", { name: "Load" }));
  await screen.findByText("Friday");
}

const rowOf = (text: string) => screen.getByText(text).closest("label") as HTMLElement;

beforeEach(() => {
  mocked.readPlaylist.mockReset();
  ticked = [];
});

describe("PlaylistImport", () => {
  it("loads the playlist and lists every track, ticked, marked as in Songs or new", async () => {
    renderIt();
    expect(screen.getByRole("button", { name: "Load" })).toBeDisabled();
    await load([{ title: "WONDERWALL", artist: "oasis" }, { title: "Yellow", artist: "Coldplay" }]);
    expect(mocked.readPlaylist).toHaveBeenCalledWith(LINK);
    expect(within(rowOf("WONDERWALL — oasis")).getByText("in Songs")).toBeInTheDocument();
    expect(within(rowOf("Yellow — Coldplay")).getByText("new")).toBeInTheDocument();
    expect(within(rowOf("Yellow — Coldplay")).getByRole("checkbox")).toBeChecked();
    expect(last()).toEqual([{ title: "WONDERWALL", artist: "oasis" }, { title: "Yellow", artist: "Coldplay" }]);
  });

  it("leaves out unticked tracks", async () => {
    renderIt();
    await load([{ title: "Wonderwall", artist: "Oasis" }, { title: "Yellow", artist: "Coldplay" }]);
    fireEvent.click(within(rowOf("Yellow — Coldplay")).getByRole("checkbox"));
    expect(last()).toEqual([{ title: "Wonderwall", artist: "Oasis" }]);
  });

  it("can't tick a song that is already in the setlist", async () => {
    renderIt({ inSetlist: new Set(["s2"]) });
    await load([{ title: "Creep", artist: "Radiohead" }, { title: "Yellow", artist: "Coldplay" }]);
    const row = rowOf("Creep — Radiohead");
    expect(within(row).getByText("in setlist")).toBeInTheDocument();
    expect(within(row).getByRole("checkbox")).not.toBeChecked();
    expect(within(row).getByRole("checkbox")).toBeDisabled();
    expect(last()).toEqual([{ title: "Yellow", artist: "Coldplay" }]);
  });

  it("shows a repeated track once", async () => {
    renderIt();
    await load([{ title: "Yellow", artist: "Coldplay" }, { title: "yellow", artist: "Coldplay" }]);
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("says when Spotify may have left tracks out", async () => {
    renderIt();
    await load([{ title: "Yellow", artist: "Coldplay" }], true);
    expect(screen.getByText("Spotify only shows the first 100 tracks.")).toBeInTheDocument();
  });

  it("offers the paste box when the playlist can't be read, keeping the link", async () => {
    mocked.readPlaylist.mockRejectedValue(new ApiError(422, "Couldn't read that playlist. Paste the track list instead."));
    renderIt();
    fireEvent.change(screen.getByLabelText("Spotify playlist"), { target: { value: LINK } });
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't read that playlist. Paste the track list instead.");
    expect(screen.getByLabelText("Spotify playlist")).toHaveValue(LINK);
    fireEvent.change(screen.getByLabelText("Paste track list"), { target: { value: "Yellow - Coldplay\nCreep - Radiohead" } });
    expect(within(rowOf("Yellow — Coldplay")).getByText("new")).toBeInTheDocument();
    expect(within(rowOf("Creep — Radiohead")).getByText("in Songs")).toBeInTheDocument();
    expect(last()).toEqual([{ title: "Yellow", artist: "Coldplay" }, { title: "Creep", artist: "Radiohead" }]);
  });

  it("settles when the parent keeps the ticked list in state and passes a new setlist set each render", async () => {
    let calls = 0;
    function Parent() {
      const [t, setT] = useState<PlaylistTrack[]>([]);
      return (
        <>
          <PlaylistImport
            songs={songs}
            inSetlist={new Set(["s2"])}
            onTicked={(x) => {
              calls++;
              setT(x);
            }}
          />
          <p>{`ticked ${t.length}`}</p>
        </>
      );
    }
    render(<Parent />);
    await load([{ title: "Yellow", artist: "Coldplay" }]);
    expect(await screen.findByText("ticked 1")).toBeInTheDocument();
    expect(calls).toBeLessThan(5);
  });

  it("can paste a list without loading a link first", () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: "Paste track list" }));
    fireEvent.change(screen.getByLabelText("Paste track list"), { target: { value: "Yellow - Coldplay" } });
    expect(last()).toEqual([{ title: "Yellow", artist: "Coldplay" }]);
  });
  it("marks a track by the same copy of a duplicate song the server picks (smallest id)", async () => {
    // Title-sorted list with the larger id last: a "last one wins" lookup would pick dup-b.
    const dupes = [summary("dup-a", "Wonderwall", "Oasis"), summary("dup-b", "Wonderwall", "Oasis")];
    render(<PlaylistImport songs={dupes} inSetlist={new Set(["dup-a"])} onTicked={(t) => ticked.push(t)} />);
    await load([{ title: "Wonderwall", artist: "Oasis" }]);
    expect(within(rowOf("Wonderwall — Oasis")).getByText("in setlist")).toBeInTheDocument();
    expect(last()).toEqual([]);
  });
});
