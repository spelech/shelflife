---
"shelflife": minor
---

Improve media filter UX for Plex-only content

- Remove confusing `no_requester` pseudo-status (redundant with `not_requested` status and `unrequested` source)
- Rename source labels: "My Requests & Watched" → "My Activity", "Media Not Added By Request" → "Plex Direct"
- Status filter is now context-aware: only shows statuses that can actually exist for the selected source (e.g. Plex Direct only shows Not Requested/Removed)
- Sort resets to an appropriate default when source changes: Title A–Z for Plex Direct/Everything, Date Newest for request-based sources
- Vote/nomination filter is hidden for Plex Direct (Plex-only items have no requester so Nominated/Not Nominated has no meaning)
