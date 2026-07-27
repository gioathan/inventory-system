# Tech Debt / Known Shortcuts

Track anything done quick-and-dirty here the moment you do it — future you will not remember the context otherwise.

## Format
- **What:** the shortcut taken
- **Why:** why it was reasonable at the time
- **Fix later by:** what the proper fix looks like, and roughly when it matters

---

## [2026-07-26] Aspire dashboard using default/insecure local settings
- **What:** No auth hardening on the Aspire dashboard, default local URLs.
- **Why:** Local-only dev tool, not a security concern at this stage.
- **Fix later by:** N/A — this only matters if the dashboard is ever exposed beyond localhost, which it shouldn't be.

<!-- Add new entries above this line as you go -->
