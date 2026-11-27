import { spotifyEmbedUrl, spotifyTrackUrl } from "../../shared/spotify";
import { useOnline } from "./useOnline";

/**
 * Plays a song's original recording in Spotify's own player. It plays the full song only for someone
 * logged into spotify.com in a desktop browser; on a phone it plays a short preview, so "Open in
 * Spotify" opens the Spotify app, which plays the whole song.
 */
export default function OriginalRecording({ spotifyTrackId }: { spotifyTrackId: string }) {
  const online = useOnline();
  if (!online) {
    return <p className="muted original-recording">Original recording: needs internet.</p>;
  }
  return (
    <div className="original-recording">
      <iframe
        title="Original recording on Spotify"
        src={spotifyEmbedUrl(spotifyTrackId)}
        width="100%"
        height="152"
        loading="lazy"
        // encrypted-media is what lets a logged-in listener hear the full song rather than a preview.
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      />
      <a className="source-link" href={spotifyTrackUrl(spotifyTrackId)} target="_blank" rel="noopener noreferrer">
        Open in Spotify
      </a>
    </div>
  );
}
