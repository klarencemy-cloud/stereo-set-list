import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { loadSetlist, loadSong, peekSong, prefetchSong, rememberSong } from "../songCache";
import type { Song, SongInput } from "../../shared/types";
import { transposeContent } from "../../shared/sheet";
import { transposeKey } from "../../shared/transpose";
import ChordSheet from "../components/ChordSheet";
import TrackPlayer from "../components/TrackPlayer";
import OriginalRecording from "../components/OriginalRecording";
import TransposeControl from "../components/TransposeControl";
import SaveNotice from "../components/SaveNotice";
import { useAutoscroll } from "../components/useAutoscroll";
import { useWakeLock } from "../components/useWakeLock";
import { useSongSpeed } from "../components/useSongSpeed";
import { useStageMode } from "../components/useStageMode";
import { useFontSize } from "../components/useFontSize";
import { useVersionedRecord } from "../components/useVersionedRecord";
import { useSwipe } from "../components/useSwipe";
import { useShowChords } from "../components/useShowChords";
import { PrintLyricsChoice, usePrintLyrics } from "../components/PrintLyrics";
import PrintEditor from "../components/PrintEditor";
import type { PrintJob } from "../components/PrintEditor";
import SongMetronome from "../components/SongMetronome";
import type { MetroSession } from "../../shared/metronome";
import { songTempo } from "../../shared/song";

const KEY_UNKNOWN = "Key unknown \u2014 fix it in Edit";

export default function SongPage() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const gigId = searchParams.get("gig");
  const [neighbours, setNeighbours] = useState<{ prev: string | null; next: string | null }>({ prev: null, next: null });
  const [setlistNote, setSetlistNote] = useState<string | null>(null);
  // The key change and the metronome's tempo save both save through this one copy.
  const songSave = useVersionedRecord<Song, Partial<SongInput>>(api.updateSong, { onStored: rememberSong });
  const song = songSave.record;
  // Loading the song, or a key that can't be transposed. Save errors (and any conflict) are songSave's own.
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const speed = useSongSpeed(id);
  const stage = useStageMode();
  const [showTranspose, setShowTranspose] = useState(false);
  const chords = useShowChords();
  const printer = usePrintLyrics();
  const [choosingPrint, setChoosingPrint] = useState(false);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
  const [showMetronome, setShowMetronome] = useState(false);
  // For the pill's live dot: checked once when the song opens, then kept up to date by the open panel.
  const [metroSession, setMetroSession] = useState<MetroSession | null>(null);

  useEffect(() => {
    let alive = true;
    // Moving between songs reuses this component: start each one fresh, at the top.
    // A song fetched ahead of time shows straight away, with no loading screen.
    songSave.load(peekSong(id) ?? null);
    setError(null);
    setRunning(false);
    setShowTranspose(false);
    setChoosingPrint(false);
    setPrintJob(null);
    setShowMetronome(false);
    setMetroSession(null);
    window.scrollTo?.(0, 0);
    api.getMetronome(id).then(
      (a) => alive && setMetroSession(a.session),
      () => {
        // Only the live dot depends on this; the panel checks again when opened.
      },
    );
    loadSong(id).then(
      (s) => alive && songSave.load(s),
      (e) => alive && setError(e instanceof ApiError ? e.message : "Could not load this song."),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  // Opened from a gig's setlist: work out the neighbouring songs.
  useEffect(() => {
    setNeighbours({ prev: null, next: null });
    setSetlistNote(null);
    if (!gigId) return;
    let alive = true;
    loadSetlist(gigId).then(
      ({ ids, notes }) => {
        if (!alive) return;
        const i = ids.indexOf(id);
        if (i === -1) return;
        setSetlistNote(notes[id] ?? null);
        const prev = ids[i - 1] ?? null;
        const next = ids[i + 1] ?? null;
        setNeighbours({ prev, next });
        // Fetch the neighbours now so Next and Previous open instantly.
        if (next) prefetchSong(next);
        if (prev) prefetchSong(prev);
      },
      () => {
        // Navigation is a convenience; the song itself still works without it.
      },
    );
    return () => {
      alive = false;
    };
  }, [id, gigId]);

  useAutoscroll(speed.speed, running);
  // Keep the phone from dimming or locking for as long as a song is open.
  useWakeLock(true);
  const font = useFontSize();
  const navigate = useNavigate();
  const sheetRef = useRef<HTMLDivElement>(null);
  const { prev, next } = neighbours;
  useSwipe(sheetRef, {
    onLeft: next ? () => navigate(`/songs/${next}?gig=${gigId}`) : undefined,
    onRight: prev ? () => navigate(`/songs/${prev}?gig=${gigId}`) : undefined,
  });

  async function transpose(semitones: number) {
    if (!song || songSave.saving) return;
    let next: string;
    try {
      next = transposeKey(song.bandKey, semitones);
    } catch {
      setError(KEY_UNKNOWN);
      return;
    }
    setError(null);
    await songSave.save({ bandKey: next }, "Could not save the new key.");
  }

  // Also shown while a song loads or fails to load: the top bar is hidden in stage mode, so this is the way out.
  const exitStage = stage.on && (
    <button type="button" className="stage-exit" onClick={stage.toggle}>
      Exit stage
    </button>
  );

  if (!song) {
    return (
      <main className="page">
        {exitStage}
        {error ? <p role="alert" className="error">{error}</p> : <p className="muted">Loading...</p>}
      </main>
    );
  }

  let content = song.content;
  let keyUnknown = false;
  try {
    content = transposeContent(song.content, song.originalKey, song.bandKey);
  } catch {
    // A stored key we can't read: show the sheet as written rather than crash.
    keyUnknown = true;
  }
  const source = song.sourceUrl && /^https?:\/\//i.test(song.sourceUrl) ? song.sourceUrl : null;
  // Older offline copies have no tempo fields: that reads as unknown, shown as no number.
  const tempo = songTempo(song);

  return (
    <main className="page song-page">
      {exitStage}
      <h1 className="song-title">{song.title}</h1>
      {song.artist && (
        <p className="song-by">
          <span className="muted">by</span> <strong>{song.artist}</strong>
        </p>
      )}
      <div className="pill-row">
        <button type="button" className="pill pill-yellow" onClick={() => setRunning((r) => !r)}>
          <span aria-hidden="true">{running ? "\u23f8" : "\u25b6"}</span> Autoscroll
        </button>
        <button type="button" className="pill" onClick={speed.cycle}>
          {`Speed: ${speed.speed}`}
        </button>
        <div className="pill pill-split" role="group" aria-label="Text size">
          <button type="button" aria-label="Smaller text" disabled={!font.canShrink} onClick={font.smaller}>
            {"A−"}
          </button>
          <button type="button" aria-label="Bigger text" disabled={!font.canGrow} onClick={font.bigger}>
            A+
          </button>
        </div>
        <button type="button" className="pill" aria-expanded={showTranspose} onClick={() => setShowTranspose((v) => !v)}>
          Transpose
        </button>
        <button type="button" className="pill" aria-pressed={!chords.on} onClick={chords.toggle}>
          {chords.on ? "Chords: on" : "Chords: off"}
        </button>
        <button type="button" className="pill" aria-pressed={stage.on} onClick={stage.toggle}>
          Stage
        </button>
        <button type="button" className="pill" aria-expanded={choosingPrint} onClick={() => setChoosingPrint((v) => !v)}>
          Print lyrics
        </button>
        <button
          type="button"
          className="pill"
          aria-expanded={showMetronome}
          onClick={() => setShowMetronome((v) => !v)}
        >
          {metroSession?.running && <span className="live-dot" aria-hidden="true" />}
          Metronome
          {tempo.bpm !== null && ` · ${tempo.bpm}`}
          {metroSession?.running && <span className="sr-only"> (playing)</span>}
        </button>
        <Link className="pill" to={`/songs/${song.id}/edit${gigId ? `?gig=${encodeURIComponent(gigId)}` : ""}`}>Edit</Link>
      </div>
      {choosingPrint && (
        <PrintLyricsChoice
          busy={printer.busy}
          onPick={async (withChords) => {
            const current = song;
            const loaded = await printer.load(async () => [current], withChords);
            if (!loaded) return;
            setChoosingPrint(false);
            setPrintJob({ kind: "lyrics", file: { kind: "songLyrics", name: current.title }, withChords, songs: loaded });
          }}
        />
      )}
      {printer.error && <p role="alert" className="error">{printer.error}</p>}
      {showMetronome && (
        <SongMetronome
          song={song}
          onSession={setMetroSession}
          onSaveTempo={(tempo) => songSave.save(tempo, "Could not save the tempo.")}
          saving={songSave.saving}
        />
      )}
      {showTranspose && <TransposeControl bandKey={song.bandKey || "?"} onChange={transpose} busy={songSave.saving} />}
      {/* One save message for the song, whichever save failed (the key or the metronome's tempo). */}
      <SaveNotice error={songSave.error} conflict={songSave.conflict} onReload={songSave.reload} />
      {error && <p role="alert" className="error">{error}</p>}
      {setlistNote && <p className="setlist-note" role="note">{setlistNote}</p>}
      <p className="song-info">
        <span>Key: <strong>{song.bandKey || "?"}</strong></span>
        {" \u00b7 "}
        <span>{song.capo > 0 ? `Capo: ${song.capo}` : "No capo"}</span>
        {source && (
          <>
            {" \u00b7 "}
            <a className="source-link" href={source} target="_blank" rel="noopener noreferrer">
              Source
            </a>
          </>
        )}
      </p>
      {keyUnknown && <p className="muted key-note">{KEY_UNKNOWN}</p>}
      {song.trackId && <TrackPlayer key={song.trackId} trackId={song.trackId} />}
      {/* Copies saved before links existed have no spotifyTrackId: no player, the same as "". */}
      {song.spotifyTrackId && <OriginalRecording spotifyTrackId={song.spotifyTrackId} />}
      {song.content.trim() === "" ? (
        <p className="muted">No lyrics or chords yet {"—"} tap Edit to add them.</p>
      ) : (
        <ChordSheet
          content={content}
          chords={chords.on}
          sheetRef={sheetRef}
          fontSize={font.size}
          onTap={() => setRunning(false)}
        />
      )}
      {(neighbours.prev || neighbours.next) && (
        <nav className="song-nav" aria-label="Setlist">
          {neighbours.prev ? (
            <Link className="pill" to={`/songs/${neighbours.prev}?gig=${gigId}`}>
              <span aria-hidden="true">{"←"}</span> Previous song
            </Link>
          ) : <span />}
          {neighbours.next ? (
            <Link className="pill pill-yellow" to={`/songs/${neighbours.next}?gig=${gigId}`}>
              Next song <span aria-hidden="true">{"→"}</span>
            </Link>
          ) : <span />}
        </nav>
      )}
      {printJob && <PrintEditor job={printJob} onClose={() => setPrintJob(null)} />}
    </main>
  );
}
