import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/app/api", () => ({
  api: {
    createTrack: vi.fn(),
    putTrackPart: vi.fn(),
    getTrackPart: vi.fn(),
    deleteTrack: vi.fn(),
  },
}));

import { api } from "../../src/app/api";
import { uploadTrack, loadTrackUrl, titleFromFileName } from "../../src/app/upload";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const track = (size: number, parts: number) => ({
  id: "t1", title: "Demo", size, parts, uploadedParts: 0, createdAt: "x",
});
const mp3 = (size: number, name = "demo.mp3", type = "audio/mpeg") =>
  new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
  Object.values(mocked).forEach((f) => f.mockReset());
  mocked.putTrackPart.mockResolvedValue(undefined);
  mocked.deleteTrack.mockResolvedValue(undefined);
});

describe("uploadTrack", () => {
  it("sends a 7 MB file as three parts, in order, one at a time", async () => {
    mocked.createTrack.mockResolvedValue(track(7_000_000, 3));
    const sizes: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    mocked.putTrackPart.mockImplementation(async (_id: string, n: number, blob: Blob) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      expect(n).toBe(sizes.length);
      sizes.push(blob.size);
      await Promise.resolve();
      inFlight--;
    });
    const progress: number[] = [];
    const result = await uploadTrack(mp3(7_000_000), "Demo", (f) => progress.push(f));
    expect(mocked.createTrack).toHaveBeenCalledWith("Demo", 7_000_000);
    expect(sizes).toEqual([3_145_728, 3_145_728, 708_544]);
    expect(maxInFlight).toBe(1);
    expect(progress[progress.length - 1]).toBe(1);
    expect(result.id).toBe("t1");
  });

  it("refuses a non-mp3 file before any API call", async () => {
    await expect(uploadTrack(mp3(1000, "a.wav", "audio/wav"), "x", () => {})).rejects.toThrow("Only mp3 files");
    expect(mocked.createTrack).not.toHaveBeenCalled();
  });

  it("accepts an .mp3 name in any case even without a mime type", async () => {
    mocked.createTrack.mockResolvedValue(track(10, 1));
    await uploadTrack(mp3(10, "LOUD.MP3", ""), "x", () => {});
    expect(mocked.putTrackPart).toHaveBeenCalledTimes(1);
  });

  it("refuses an mp3 over 25 MB before any API call", async () => {
    await expect(uploadTrack(mp3(26_214_401), "x", () => {})).rejects.toThrow("That file is over 25 MB");
    expect(mocked.createTrack).not.toHaveBeenCalled();
  });

  it("stops at the first failed part and cleans up the partial track", async () => {
    mocked.createTrack.mockResolvedValue(track(7_000_000, 3));
    mocked.putTrackPart.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("boom"));
    await expect(uploadTrack(mp3(7_000_000), "Demo", () => {})).rejects.toThrow("boom");
    expect(mocked.putTrackPart).toHaveBeenCalledTimes(2);
    expect(mocked.deleteTrack).toHaveBeenCalledWith("t1");
  });
});

describe("loadTrackUrl", () => {
  it("joins all parts into one audio/mpeg blob URL", async () => {
    mocked.getTrackPart.mockImplementation(async (_id: string, n: number) => new Uint8Array([n, n]).buffer);
    const create = vi.fn().mockReturnValue("blob:abc");
    URL.createObjectURL = create;
    const url = await loadTrackUrl(track(6, 3));
    expect(url).toBe("blob:abc");
    expect(mocked.getTrackPart.mock.calls.map((c) => c[1])).toEqual([0, 1, 2]);
    const blob = create.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("audio/mpeg");
    expect(blob.size).toBe(6);
  });
});

describe("titleFromFileName", () => {
  it("drops the extension and tidies separators", () => {
    expect(titleFromFileName("My Song.mp3")).toBe("My Song");
    expect(titleFromFileName("my_new-song.MP3")).toBe("my new-song");
    expect(titleFromFileName("  Demo  .mp3")).toBe("Demo");
    expect(titleFromFileName("no-extension")).toBe("no-extension");
    expect(titleFromFileName(".mp3")).toBe("");
  });
});
