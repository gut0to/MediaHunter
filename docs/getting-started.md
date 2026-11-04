# Getting started

## Hub on Debian ARM64 or AMD64

Install Node.js 24 and the pnpm version declared in the root package manifest.
Make both available system-wide when using systemd. Install `python3`, `make`,
and a C++ compiler in case SQLite needs to build its native binding. Run these commands from the repository root.

```sh
sudo sh scripts/install-hub.sh
curl --fail http://127.0.0.1:8787/api/v1/health
sudo journalctl -u mediahunter-hub -n 50
```

To remove the Hub while retaining its queue, use `sudo sh scripts/uninstall-hub.sh`.

The service reads `/etc/mediahunter/hub.env` and stores its database and key in
`/var/lib/mediahunter`. For a foreground development instance, run
`pnpm install --frozen-lockfile`, then `pnpm --filter @mediahunter/hub start`.

Keep the Hub on loopback. On a host already configured for a private tailnet,
`sudo tailscale serve --bg 8787` provides a private HTTPS origin. Enable HTTPS certificates in the tailnet if prompted. Use the HTTPS
origin printed by Tailscale. A TLS reverse proxy restricted to your private
network can also forward to `127.0.0.1:8787`. See the [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve).

Generate a separate code for each device. Run these commands when ready to
pair because each code expires in 10 minutes.

```sh
cd /opt/mediahunter/current/apps/hub
sudo -u mediahunter env MEDIAHUNTER_DATA_DIR=/var/lib/mediahunter node src/cli.ts pair windows_agent
sudo -u mediahunter env MEDIAHUNTER_DATA_DIR=/var/lib/mediahunter node src/cli.ts pair extension
```

To revoke a device, substitute `revoke <device-id>` for `pair <kind>`. Agent
pairing prints its ID. To list devices, run the same command with `devices`
in place of `pair <kind>`.

## Windows agent and browser extension

On Windows x64 with Go 1.27.3, run these commands from the repository root in PowerShell.

```powershell
Push-Location apps/windows-agent
go build -trimpath -o mediahunter-agent.exe ./cmd/mediahunter-agent
New-Item -ItemType Directory -Force "${env:USERPROFILE}\Videos\MediaHunter"
.\mediahunter-agent.exe configure "${env:USERPROFILE}\Videos\MediaHunter"
.\mediahunter-agent.exe pair https://hub.example.net
.\mediahunter-agent.exe start
# After stopping the agent with Ctrl+C:
Pop-Location
```

Replace `https://hub.example.net` with the Hub origin. Enter the Windows
pairing code at the prompt. Keep the agent running in its own terminal.
Use an NTFS destination because final publication requires hard links.

Build the extension in another terminal at the repository root with Node.js 24 and pnpm.

```powershell
pnpm install --frozen-lockfile
pnpm --filter @mediahunter/extension build
```

Open `chrome://extensions` or `edge://extensions`, enable Developer mode,
select **Load unpacked**, and choose `apps/extension/dist`. Add the exact
`chrome-extension://<id>` to `MEDIAHUNTER_EXTENSION_ORIGINS` in the Hub
environment file and run `sudo systemctl restart mediahunter-hub`.
Open the extension, enter the Hub origin and extension pairing code, and grant
the requested permission for the Hub host.

## Smoke test

Serve the contents of `fixtures/` from a publicly routed HTTP(S) static host
you control, using ordinary HTTP/HTTPS ports and correct media types. The
agent blocks local, private, and tailnet IPs for media downloads even though
the Hub itself uses private HTTPS. The automated downloader tests serve the
same files over isolated loopback fixtures through a test transport.

Open the fixture URL in Chromium. Click **Scan page**, select the agent, then
download `sample.png` and `sample.mp4`. Under **Downloads**, confirm
`completed` for both and match each job prefix to its Windows filename.
Run these commands in PowerShell from the repository root.

```powershell
Get-FileHash fixtures/sample.png,fixtures/sample.mp4
Get-ChildItem "${env:USERPROFILE}\Videos\MediaHunter" -File | Get-FileHash
```

Compare the SHA-256 hashes by extension. Stop the agent, queue another
fixture download, restart the Hub, and start the agent again within 30 minutes.
Verify that the queued download completes once. Stop the agent and cancel
a queued download from the popup. Restart the agent and verify it stays canceled.

## Removal

Remove the extension through the browser's extension manager. Stop the agent
and run `mediahunter-agent.exe unpair`, then remove the executable and, if
desired, `%LOCALAPPDATA%\MediaHunter`. Revoke both device IDs on the Hub.
Windows media files stay in the destination you chose.

On Linux, run `sudo systemctl disable --now mediahunter-hub`, remove
`/etc/systemd/system/mediahunter-hub.service`, and run
`sudo systemctl daemon-reload`. Remove installed source under
`/opt/mediahunter` when it is no longer needed. Back up or explicitly remove
`/etc/mediahunter` and `/var/lib/mediahunter` depending on whether you need
the configuration and queue. Remove the private HTTPS route you configured.

## CI artifacts and installed agent

Download the release-candidate artifact from a successful GitHub Actions run.
It contains the Windows executable, unpackable extension ZIP, Hub source
archive, and SHA256SUMS. Verify every file before use.

On Linux, run `sha256sum -c SHA256SUMS` in the artifact directory.
On Windows, use `Get-FileHash -Algorithm SHA256` and compare the hexadecimal
hash to the matching filename in SHA256SUMS.

Run the agent from its downloaded location to install a per-user copy.

```powershell
.\mediahunter-agent.exe install
# Optional automatic startup at user login:
.\mediahunter-agent.exe install --autostart
```

The optional startup command registers a limited-privilege scheduled task.
If the Windows account's policy rejects task registration, start the agent
manually. Configure and pair the installed executable under
`%LOCALAPPDATA%\MediaHunter\bin`. Run `diagnose` to check connectivity and
configured tool availability. Stable release tags are published only after
the hardware smoke procedure has been verified.
