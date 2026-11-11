import { api } from "./api";
import { CHUNK_SIZE, MAX_AUDIO_BYTES } from "../shared/types";
import type { Track } from "../shared/types";

export async function uploadTrack(
  file: File,
  title: string,
  onProgress: (fraction: number) => void,
): Promise<Track> {
  const isMp3 = file.type === "audio/mpeg" || file.name.toLowerCase().endsWith(".mp3");
  if (!isMp3) throw new Error("Only mp3 files");
  if (file.size > MAX_AUDIO_BYTES) throw new Error("That file is over 25 MB");

  onProgress(0);
  const track = await api.createTrack(title, file.size);
  try {
    for (let n = 0; n < track.parts; n++) {
      await api.putTrackPart(track.id, n, file.slice(n * CHUNK_SIZE, (n + 1) * CHUNK_SIZE));
      onProgress((n + 1) / track.parts);
    }
  } catch (e) {
    // Best effort: remove the half-uploaded track (it is hidden from the list anyway).
    await api.deleteTrack(track.id).catch(() => {});
    throw e;
  }
  return track;
}

/** File name for a saved track: the title, minus characters that are unsafe in file names. */
export function downloadFileName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return `${clean || "track"}.mp3`;
}

export async function loadTrackUrl(track: Track): Promise<string> {
  const parts: ArrayBuffer[] = [];
  for (let n = 0; n < track.parts; n++) parts.push(await api.getTrackPart(track.id, n));
  return URL.createObjectURL(new Blob(parts, { type: "audio/mpeg" }));
}
