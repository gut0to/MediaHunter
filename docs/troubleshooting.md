# Troubleshooting

## Hub or agent offline

Run `curl --fail http://127.0.0.1:8787/api/v1/health` on the Linux host.
Inspect `sudo systemctl status mediahunter-hub` and
`sudo journalctl -u mediahunter-hub -n 100`. Check Node.js 24, the environment
file, database permissions and the private HTTPS proxy.

On Windows, run `mediahunter-agent.exe status` and
`mediahunter-agent.exe diagnose`. Start it explicitly with `start` if
automatic login startup was not configured. Another instance for the same
user is rejected. Pair again when a token is revoked or cannot be decrypted
by the current Windows account.

## Pairing fails

Generate a fresh code locally on the Hub for the correct device kind.
Each code is single-use and expires after 10 minutes. Enter the Hub's exact
HTTPS origin with no path. Set the extension's exact origin in the Hub
environment and restart the service. Grant the requested host permission.

## Media is missing

Scan an HTTP(S) page. The scan is bounded and can miss content that the
page has not exposed. Use Reload and capture only after reviewing its
permissions and confirming the reload. Add exact CDN origins when needed.
Closed shadow roots, unauthorized frames, DRM and inaccessible browser
resources remain outside discovery. Read warnings from the scan.

## A transfer fails

- EXPIRED_URL or rescan_required requires a new scan and a fresh job.
- UNSAFE_SOURCE means the URL, resolved IP, port or redirect violated the
  public media-origin policy. Private Hub connectivity does not authorize
  media downloads from private services.
- TOOL_UNAVAILABLE requires explicitly configured local tool executables.
- PROTECTED_MEDIA rejects detected encryption or DRM.
- UNSUPPORTED_FORMAT can indicate an unsupported extractor, missing compatible
  tracks, or an extraction/remux failure. Check the configured tools with
  diagnose and use an accessible fixture to separate setup from site behavior.
- DESTINATION_ERROR requires an existing local drive directory, sufficient
  space, and an NTFS destination that supports hard links.
- HTTP_ERROR means the origin returned a non-success response. Temporary
  responses get bounded retries. The agent does not forward browser cookies.

## Interrupted files and history

A normal cancellation removes its lease-specific partial file. After a forced
shutdown, startup removes matching partial files older than 24 hours from
authorized roots. Leave the agent stopped before manually inspecting younger
partial files. A source that expires while Windows is offline needs a new scan.

Open file and Open folder are explicit requests to the agent and expire after
one minute. They require a completed download and a matching local receipt.
If you moved or renamed the file, open it directly through Windows.

Export JSON saves only job metadata through the browser's save dialog.
Browser-managed transfers have their own Chromium history and save behavior,
including the browser's retention of the original source URL.
