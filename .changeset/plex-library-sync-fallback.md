---
"shelflife": minor
---

Refactored entire library sync pipeline to use a 3-layer architecture tracking native Plex media alongside Overseerr requests. Plex Library Sync is opt-in via a new admin toggle (disabled by default) to avoid adding sync time for users who don't need it. Automatically creates UI badges for native library items and gracefully falls back to Plex API for deleting standalone TV/movies missing from \*arr pipelines.
