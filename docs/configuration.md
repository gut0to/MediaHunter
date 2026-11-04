# Configuration and operation

## Hub environment

| Variable | Default | Accepted values |
| --- | --- | --- |
| MEDIAHUNTER_HOST | 127.0.0.1 | 127.0.0.1 or ::1 |
| MEDIAHUNTER_PORT | 8787 | Integer from 1024 to 65535 |
| MEDIAHUNTER_DATA_DIR | ./mediahunter-data | Writable private data directory |
| MEDIAHUNTER_SOURCE_TTL_MINUTES | 30 | Integer from 5 to 120 |
| MEDIAHUNTER_HISTORY_DAYS | 30 | Integer from 1 to 365 |
| MEDIAHUNTER_EXTENSION_ORIGINS | Empty | Comma-separated exact chrome-extension origins |

The installed service reads `/etc/mediahunter/hub.env`. Restart the service
after changing it. A development process reads its environment directly.
The Hub rejects public bind addresses. Put a private TLS reverse proxy in
front of the loopback endpoint. The [nginx example](../scripts/nginx-private.conf.example)
uses documentation-only addresses and certificate paths that you must replace.
Bind the proxy to a private interface, allow only your authorized network,
and install a certificate trusted by the browser and agent.

Tailscale is optional. Follow the private Serve example in
[getting started](getting-started.md) if it is already your chosen network.

## Windows settings

The agent stores configuration under `%LOCALAPPDATA%\MediaHunter`.
Tokens use user-scoped Windows DPAPI. Copying the settings to a different
Windows account does not transfer access.

```powershell
mediahunter-agent.exe configure "D:\Media" default
mediahunter-agent.exe configure "D:\Pictures" pictures
mediahunter-agent.exe tools "C:\MediaTools\yt-dlp.exe" "C:\MediaTools\ffmpeg.exe"
mediahunter-agent.exe limits 1073741824
mediahunter-agent.exe diagnose
```

Configure up to 20 existing local-drive destination profiles. Paths stay on
Windows. The Hub receives profile IDs. The byte limit accepts values from
1 MiB through 10 GiB and defaults to 10 GiB. The agent prechecks destination
free space and limits each transfer. Extraction staging is additionally
bounded because merging can temporarily require both inputs and output.

Download logs rotate at 5 MiB and retain three previous files. Logs contain
fixed events and error codes. Hub logs use the systemd journal's retention.
Check OS journal settings if you need a different retention policy.

## Installing optional media tools

Download Windows x64 builds from the [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases)
and a distributor linked by the [FFmpeg download page](https://ffmpeg.org/download.html).
Review the release license and published checksum before executing a binary.
Use `Get-FileHash -Algorithm SHA256` to compare the download against its
publisher's checksum. Configure the verified absolute paths with the tools
command above. Diagnose reports the version and current executable hash.
Tool installation and updates are explicit user decisions. The agent does not
download or update these executables automatically.

## Upgrade, backup, and removal

To upgrade, stop the Windows agent before replacing its installed executable.
For Linux, rerun `sudo sh scripts/install-hub.sh` from the new checkout.
The installer stages source before switching the service and retains the
previous install for recovery. Database migrations run transactionally at
startup. Downgrading to an older schema is rejected.

For a consistent Hub backup, stop `mediahunter-hub`, copy the whole
`/var/lib/mediahunter` directory and `/etc/mediahunter/hub.env` to protected
storage, then start the service. Preserve `source.key` with the database.
A restored database may contain expired source URLs and require a new scan.

`sudo sh scripts/uninstall-hub.sh` retains configuration and queue.
Add `--purge` only when you intend to delete both. Neither Linux script
stores or removes downloaded media. For Windows, run `uninstall` from an
external copy of the executable after stopping the installed agent. Add
`--credentials` to remove saved settings. Media stays in your chosen folders.
