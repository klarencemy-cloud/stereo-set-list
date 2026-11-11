import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("../../src/app/api", async () => {
  const actual = await vi.importActual<typeof import("../../src/app/api")>("../../src/app/api");
  return { ...actual, api: { listTracks: vi.fn(), getTrackPart: vi.fn(), deleteTrack: vi.fn(), updateTrack: vi.fn() } };
});

import { api } from "../../src/app/api";
import TracksPage from "../../src/app/pages/TracksPage";
import { downloadFileName } from "../../src/app/upload";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const track = { id: "t1", title: "Demo Song", size: 3, parts: 1, uploadedParts: 1, createdAt: "x" };

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
    render(<TracksPage />);
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
    render(<TracksPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Rename Demo Song" }));
    fireEvent.change(screen.getByLabelText("Title for Demo Song"), { target: { value: "Other" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Demo Song")).toBeInTheDocument();
    expect(mocked.updateTrack).not.toHaveBeenCalled();
  });

  it("does not save an empty title", async () => {
    render(<TracksPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Rename Demo Song" }));
    fireEvent.change(screen.getByLabelText("Title for Demo Song"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocked.updateTrack).not.toHaveBeenCalled();
  });

  it("shows the error and stays in edit mode when saving fails", async () => {
    mocked.updateTrack.mockRejectedValue(new Error("nope"));
    render(<TracksPage />);
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
    render(<TracksPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Download Demo Song" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].download).toBe("Demo Song.mp3");
    expect(created[0].href).toBe("blob:fake");
    expect(mocked.getTrackPart).toHaveBeenCalledWith("t1", 0);
  });

  it("shows an error when the download fails", async () => {
    mocked.getTrackPart.mockRejectedValue(new Error("offline"));
    render(<TracksPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Download Demo Song" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(created).toHaveLength(0);
  });
});
