---
status: accepted (supersedes ADR-0001)
---

# Joining phones play by the clock alone, for now

Matching by ear (ADR-0001) made sync worse in the band's own tests: the old build (`d265883`) and the newest one both ended up further apart than the clock alone once a phone listened to the band. Joining by the clock alone was only a few ms off. So for now a joining phone plays by the clock only, and listens to nothing.

## Consequences

- Clock sync assumes the trip to the server and back take equally long. On mobile data they often don't, so the band's 5 ms target is not guaranteed there. Hearing the band is the only way to see that gap; bringing matching back means proving it beats the clock first.
- The listening code lives in git history from `a2acd91` (2026-11-15) if it comes back.
