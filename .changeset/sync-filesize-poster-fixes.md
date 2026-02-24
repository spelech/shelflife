---
"shelflife": patch
---

Fix TV show file sizes being reported too low, and fix missing posters for items that are only in Sonarr/Radarr.

- **File sizes**: TV show sizes now always use the Plex direct episode-level sum instead of Tautulli's often-stale show-level aggregate, resulting in more accurate total library size reporting.
- **Posters (Sonarr tmdbId)**: Layer 2 Sonarr sync now captures and backfills `tmdbId` from Sonarr's API response so that TV shows without an Overseerr request can still get poster enrichment via TMDB.
- **Posters (tvdbId fallback)**: A new Phase B in poster enrichment attempts to resolve poster art for TV items that have only a `tvdbId` and no `tmdbId`, using Sonarr's images endpoint as a fallback.
- **Poster rendering**: `ClickablePoster` and `MediaDetailModal` now handle full-URL poster paths (from Sonarr's `remoteUrl`) in addition to TMDB relative paths.
