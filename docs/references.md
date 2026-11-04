# Technical references

MediaHunter's own source is MIT licensed. Installed dependencies and optional
external tools retain their own licenses. External tool executables are
supplied by the user and are not bundled in the repository.

- [Chromium permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions) describes runtime host permission grants.
- [Chromium webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest) defines observational capture and host access restrictions.
- [Chromium sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) defines the persistent browser view.
- [Chromium downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads) defines browser-managed save dialogs.
- [Go rooted filesystem operations](https://pkg.go.dev/os#Root) documents the destination boundary.
- [Fastify](https://fastify.dev/docs/latest/) documents the Hub server API.
- [SQLite WAL](https://sqlite.org/wal.html) explains concurrency and durability settings.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) documents extraction and format selectors. Review the release and dependency licenses when installing binaries.
- [FFmpeg protocols](https://ffmpeg.org/ffmpeg-protocols.html) documents tool protocol restrictions and [FFmpeg legal information](https://ffmpeg.org/legal.html) describes build-dependent licensing.
- [HLS RFC 8216](https://www.rfc-editor.org/rfc/rfc8216) defines playlist, rendition, and encryption declarations.
- [DASH-IF](https://dashif.org/) provides DASH interoperability guidance.
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) documents one private HTTPS deployment option.
