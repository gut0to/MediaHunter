# MediaHunter

MediaHunter finds direct images and videos in a Chrome or Edge tab and queues
downloads to a folder chosen on Windows. The Linux Hub coordinates pairing,
progress, and history. The Windows agent downloads files directly from the
media origin.

**Experimental release candidate.** Discovery includes active-page DOM, CSS, open shadow roots,
performance entries and explicit network capture. Optional Windows yt-dlp and
FFmpeg support accessible HLS/DASH and extractor formats. Download availability depends on the origin, supported media types, and
whether the file is accessible without browser credentials. Use it only for
media you have permission to download.

## First download

1. Set up the Hub on Linux ARM64 or AMD64 with Node.js 24 and expose it over
   private HTTPS. Debian on Arduino UNO Q is the reference target.
2. Build the Go agent for Windows x64, configure a local folder, and pair it
   with the Hub. Load the Chromium extension and pair it separately.
3. Open the generated [fixture](fixtures/index.html) from an eligible HTTP(S)
   host, choose **Scan page**, and download the PNG and MP4. Compare SHA-256
   hashes on Windows.

See the [setup and smoke test](docs/getting-started.md) for commands, the [installation guide in Portuguese](docs/instalacao.md),
[architecture](docs/architecture.md) for the API and data flow,
[formats and limitations](docs/formats-and-limitations.md) for advanced media,
[configuration](docs/configuration.md) and [troubleshooting](docs/troubleshooting.md) for operation, and
[contribution guide](CONTRIBUTING.md) for build and test commands.

There is no telemetry. Pairing tokens are per device, full source URLs expire
after 30 minutes and are encrypted in SQLite, and job history expires after
30 days. See the [security policy](SECURITY.md) for private reporting.
MediaHunter source is [MIT licensed](LICENSE).
