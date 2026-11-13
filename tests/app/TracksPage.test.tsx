import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { listTracks: vi.fn(), getTrackPart: vi.fn(), linkTrackSong: vi.fn(), deleteTrack: vi.fn(), updateTrack: vi.fn() } };
});

import { api } from "../../src/app/api";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import TracksPage from "../../src/app/pages/TracksPage";
import { downloadFileName } from "../../src/app/upload";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const track = { id: "t1", title: "Demo Song", size: 3, parts: 1, uploadedParts: 1, createdAt: "x" };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/tracks"]}>
      <Routes>
        <Route path="/tracks" element={<TracksPage />} />
        <Route path="/songs/:id" element={<SongStub />} />
      </Routes>
    </MemoryRouter>,
  );
}
function SongStub() {
  const { id } = useParams();
  return <p>song page {id}</p>;
}

describe("downloadFileName", () => {
  it("uses the title with .mp3 and strips characters that are unsafe in file names", () => {
    expect(downloadFileName("Demo Song")).toBe("Demo Song.mp3");
    expect(downloadFileName('A/B: "C"?')).toBe("A B C.mp3");
    expect(downloadFileName("  ")).toBe("track.mp3");
  });
});

describe("TracksPage rename", () => {
  beforeEach(() => {
    Object.values(mocked).forEach((f) => f.mockReset());
    mocked.listTracks.mockResolvedValue([{ ...track }]);
    mocked.updateTrack.mockImplementation(async (_id: string, title: string) => ({ ...track, title }));
  });

  it("renames a track and shows the new title", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Rename Demo Song" }));
    const input = screen.getByLabelText("Title for Demo Song");
    expect(input).toHaveValue("Demo Song");
    fireEvent.change(input, { target: { value: " Better " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocked.updateTrack).toHaveBeenCalledWith("t1", "Better"));
    expect(await screen.findByText("Better")).toBeInTheDocument();
    expect(screen.queryByLabelText("Title for Demo Song")).not.toBeInTheDocument();
  });

  it("cancel keeps the old title", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Rename Demo Song" }));
    fireEvent.change(screen.getByLabelText("Title for Demo Song"), { target: { value: "Other" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Demo Song")).toBeInTheDocument();
    expect(mocked.updateTrack).not.toHaveBeenCalled();
  });

  it("does not save an empty title", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Rename Demo Song" }));
    fireEvent.change(screen.getByLabelText("Title for Demo Song"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocked.updateTrack).not.toHaveBeenCalled();
  });

  it("shows the error and stays in edit mode when saving fails", async () => {
    mocked.updateTrack.mockRejectedValue(new Error("nope"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Rename Demo Song" }));
    fireEvent.change(screen.getByLabelText("Title for Demo Song"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(screen.getByLabelText("Title for Demo Song")).toBeInTheDocument();
  });
});

describe("TracksPage download", () => {
  let created: HTMLAnchorElement[];
  beforeEach(() => {
    Object.values(mocked).forEach((f) => f.mockReset());
    mocked.listTracks.mockResolvedValue([{ ...track }]);
    mocked.getTrackPart.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    created = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("downloads the joined mp3 under the track title", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Download Demo Song" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].download).toBe("Demo Song.mp3");
    expect(created[0].href).toBe("blob:fake");
    expect(mocked.getTrackPart).toHaveBeenCalledWith("t1", 0);
  });

  it("shows an error when the download fails", async () => {
    mocked.getTrackPart.mockRejectedValue(new Error("offline"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Download Demo Song" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(created).toHaveLength(0);
  });
});

describe("TracksPage upload title", () => {
  beforeEach(() => {
    Object.values(mocked).forEach((f) => f.mockReset());
    mocked.listTracks.mockResolvedValue([]);
  });
  const pick = (name: string) =>
    fireEvent.change(screen.getByLabelText("mp3 file (max 25 MB)"), {
      target: { files: [new File(["x"], name, { type: "audio/mpeg" })] },
    });
  const titleInput = () => screen.getByLabelText("Title") as HTMLInputElement;

  it("fills an empty title from the file name", async () => {
    renderPage();
    await screen.findByText(/No songs yet/);
    pick("Demo Take.mp3");
    expect(titleInput().value).toBe("Demo Take");
  });

  it("keeps a title the user typed before picking the file", async () => {
    renderPage();
    await screen.findByText(/No songs yet/);
    fireEvent.change(titleInput(), { target: { value: "Real Name" } });
    pick("Demo Take.mp3");
    expect(titleInput().value).toBe("Real Name");
  });

  it("replaces an autofilled title when another file is picked", async () => {
    renderPage();
    await screen.findByText(/No songs yet/);
    pick("A.mp3");
    pick("B.mp3");
    expect(titleInput().value).toBe("B");
  });

  it("keeps an edited autofilled title when another file is picked", async () => {
    renderPage();
    await screen.findByText(/No songs yet/);
    pick("A.mp3");
    fireEvent.change(titleInput(), { target: { value: "A live" } });
    pick("B.mp3");
    expect(titleInput().value).toBe("A live");
  });
});

describe("TracksPage song links", () => {
  beforeEach(() => {
    Object.values(mocked).forEach((f) => f.mockReset());
  });

  it("the title links to the song page", async () => {
    mocked.listTracks.mockResolvedValue([{ ...track, songId: "s1" }]);
    renderPage();
    fireEvent.click(await screen.findByRole("link", { name: "Demo Song" }));
    expect(await screen.findByText("song page s1")).toBeInTheDocument();
    expect(mocked.linkTrackSong).not.toHaveBeenCalled();
  });

  it("links a legacy track before opening it", async () => {
    mocked.listTracks.mockResolvedValue([{ ...track }]);
    mocked.linkTrackSong.mockResolvedValue({ id: "s9", title: "Demo Song" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Open Demo Song" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Demo Song" }));
    expect(await screen.findByText("song page s9")).toBeInTheDocument();
    expect(mocked.linkTrackSong).toHaveBeenCalledTimes(1);
    expect(mocked.linkTrackSong).toHaveBeenCalledWith("t1");
  });

  it("shows an error if linking fails", async () => {
    mocked.listTracks.mockResolvedValue([{ ...track }]);
    mocked.linkTrackSong.mockRejectedValue(new Error("nope"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Open Demo Song" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(screen.queryByText(/song page/)).not.toBeInTheDocument();
  });

  it("the delete confirmation mentions the song page", async () => {
    mocked.listTracks.mockResolvedValue([{ ...track, songId: "s1" }]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Demo Song" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("lyrics and chords"));
    confirm.mockRestore();
  });
});
