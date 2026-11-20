# Changelog

## 0.2.0

- First public release as **Limit Radar**
- Codex: reads `rate_limits` from local Codex session logs (no network)
- Claude: reads `rate_limits` via Claude Code's official status line (no tokens, no network). Optional API mode for advanced users
- Antigravity: reads per-model quota from the running Antigravity app over 127.0.0.1
- Status bar items with warning/critical colors, threshold notifications, side panel with pace marker
- Runs on the local (UI) side even in WSL / SSH / Dev Containers
- Notifications fire once per window and level, even when the reported reset time jitters
- Explains why Claude has no data (status line not invoked vs. no `rate_limits` in input)
