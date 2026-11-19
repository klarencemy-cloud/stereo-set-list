# Stereo Set

A private site for one band: its songs, chord sheets, gigs and recordings, and the tools the band plays along to.

## Language

### Synced metronome

**Session**:
One song's shared metronome: a tempo, beats per bar, and whether it is running. Each song has at most one.
_Avoid_: Room, gig session

**Grid**:
Where a session's beats fall on the server's clock, counted from its start. Every phone in a session plays the same grid.
_Avoid_: Timeline, schedule

**Lead**:
The warning time between a start or change and the bar line it takes effect on, so every phone hears about it first.
_Avoid_: Count-in delay, buffer

**Join**:
Making this phone play a session that is already running. Leaving stops this phone only.
_Avoid_: Connect, subscribe

**Leader**:
The phone that started the session. Joining phones match its clicks by ear. It does not set the grid or send the beat.
_Avoid_: Master, host

**Match**:
A joining phone's adjustment, found by listening to the leader through its mic, that lines its clicks up with the leader's.
_Avoid_: Calibration (that is the nudge), sync

**Nudge**:
A per-phone setting that plays this phone's clicks earlier or later, to make up for its own speaker or earphone delay.
_Avoid_: Offset, latency setting

**Network round trip**:
The time from a phone asking the server something to getting the answer. "Synced ±N ms" is half of it.
_Avoid_: Round trip (on its own), ping, RTT

**Loopback delay**:
The time from this phone's speaker playing a click to its own mic hearing it, measured with "Measure this phone".
_Avoid_: Round trip (on its own), output latency

**Follow**:
A per-phone switch that joins the running session of whichever song this phone opens, in any order.
_Avoid_: Gig mode, auto-join
