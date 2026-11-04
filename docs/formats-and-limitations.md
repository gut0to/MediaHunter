# Formats and limitations

## Discovery

The active-tab scanner reads DOM images and videos, srcset and picture
relationships, posters, Open Graph and Twitter metadata, CSS backgrounds,
open shadow roots, same-origin accessible frames, and resource performance
entries. It observes mutations for five seconds. The Stop scan action ends
that window early. Scans stop after 5,000 elements or 200 results and report
partial results.

Reload and capture is an explicit opt-in. Grant the page origin and any exact
media CDN origins you want to observe. Capture is tab-scoped, lasts at most
15 seconds, and stops when the capture view disconnects. Chromium can omit
cached requests and hosts for which permission was not granted. The capture
reads MIME type and URL, and does not collect cookies or authorization headers.

Image variants are grouped by an observed DOM relationship. Best available
ranks known pixel dimensions ahead of unknown dimensions. Responsive image
descriptors do not prove both dimensions and are shown as unknown.

## Downloads

Direct downloads accept JPEG, PNG, GIF, WebP, AVIF, BMP, ICO and supported
MP4, WebM, MOV, M4V and Ogg video MIME types. HTML and SVG are rejected.
Signed URLs expire from the Hub after 30 minutes.

HLS and DASH use a locally configured yt-dlp on Windows. Format inspection
reports metadata from the extractor, including dimensions, bitrate, frame
rate and audio presence. Best available requests the extractor's best video
and audio selection. FFmpeg merges compatible tracks without an explicit
transcoding step. Without FFmpeg, the default selection requires a combined
format. Explicit video-only selections require FFmpeg for audio merging.

Configure installed tools using `mediahunter-agent tools <yt-dlp.exe> <ffmpeg.exe>`
with absolute local executable paths. The tools are optional. Direct media
downloads continue to work without them. Inspect site with yt-dlp registers
the current page as an explicit extraction request. Site support depends on
the installed extractor version.

The agent restricts extractor HTTP(S) connections through a loopback proxy
with public-IP DNS validation. The configured executable is trusted local
software. External tools can execute code and must come from a source you
trust. Tool invocation includes a source URL in its argument list, so another
process with sufficient local permissions may observe that URL. Source URLs
are never included in application errors.

Protected HLS key declarations, DASH ContentProtection, and reported DRM
formats are rejected. Browser-managed downloads apply only to direct links
that require the legitimate browser session. Chromium shows its own save
dialog and manages these transfers separately from Hub jobs.

Pause stops the current transfer. Resume requeues it while the source remains
valid. An interrupted direct response attempts Range with a strong ETag or
Last-Modified validator. If the validator or response range cannot be
verified, the partial file is discarded and the bounded retry starts fresh.

## Validation

Original image and direct-video fixtures are in `fixtures/`.
The CI tests scanner grouping, DOM discovery, Hub authorization and leases,
direct-transfer integrity, redirects, and local HTTP fixtures. Real browser
permission prompts and the Arduino deployment still require the smoke
procedure in [getting-started.md](getting-started.md).
