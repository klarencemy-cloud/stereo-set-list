---
status: superseded by ADR-0002
---

# Joining phones match the leader by ear

Clock sync alone left phones audibly apart. It can't see a lopsided network round trip, and each phone's output delay is different. Phones on different networks were up to 85 ms apart in simulation. So a joining phone first listens to the leader through its mic for about 2 bars, and shifts its grid to match what it heard (a2acd91). The server still sets the grid. The leader never sends a beat. That is why this is not the "leader phone" the original spec ruled out.

## Considered options

- **A better clock sync** (two server timestamps, NTP style): it fixes only the network part, not the output delay.
- **The nudge alone**: it depends on every bandmate calibrating carefully, and it doesn't follow changes of network.

## Consequences

- Joining takes about 2 bars longer, and asks for the mic.
- A phone whose loopback delay is unmeasured, or that can't hear the band, falls back to the clock alone.
- Once matched, the phone stops taking its offset from later sync rounds. So anything that breaks the clock behind the match (a paused clock after sleep) needs its own way back.
