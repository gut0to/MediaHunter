# Architecture

```text
Chromium popup -- HTTPS scans and jobs --> Linux Hub / SQLite
Windows agent  -- HTTPS leases and progress --> Linux Hub
Media origin   -- HTTP(S) file bytes --> Windows destination
```

The MV3 popup injects a one-shot scanner into the top frame of the active tab.
It collects direct DOM URLs and declared variants. Unknown dimensions stay
unknown. Results are limited to 200 distinct HTTP(S) URLs per scan. The popup
polls the Hub only while open. Bounded mutation scanning and explicit network capture add authorized observations.
See [formats and limitations](formats-and-limitations.md) for adaptive streams
and browser-managed downloads.

The download queue separates active work, completed work, and tasks needing
attention. It supports search, batch pause/resume/retry/cancel, and progress
with an explicit unknown-size state. History shows job IDs and transfer state;
it does not retain source URLs.

The Hub uses SQLite WAL and a versioned schema for devices, pairing codes,
scans, candidates, jobs, and state transition events. It issues independent bearer tokens and stores
their hashes. Pairing is local and codes expire in 10 minutes. Job ownership
and agent assignment are checked separately. Candidate URLs are encrypted
with AES-256-GCM using a key in the data directory and are deleted at scan
expiry. History contains status, byte counts and typed errors. The Hub
does not request candidate URLs.

## API v1

All routes have the prefix `/api/v1`. Authenticated routes take a bearer token.
JSON error responses contain a stable `code`.

| Method and path | Access | Behavior |
| --- | --- | --- |
| GET /health | Public | Health status |
| POST /pairing/claim | One-time code | Claim a device ID and token |
| GET /devices | Extension | Available Windows agents and recent presence |
| POST /scans | Extension | Register a scan and receive candidate IDs |
| GET /jobs | Extension | Recent jobs owned by the caller |
| POST /jobs | Extension | Queue a candidate for an explicit agent with an idempotency key |
| POST /jobs/:id/cancel | Extension | Cancel the caller's unfinished job |
| POST /jobs/:id/pause | Extension | Stop an active transfer and hold the job |
| POST /jobs/:id/retry | Extension | Resume or retry a valid source |
| DELETE /jobs | Extension | Delete the caller's finished history |
| POST /jobs/:id/open | Extension | Request opening a completed file or folder |
| POST /agent/actions/lease | Agent | Consume a time-limited open action |
| POST /agent/jobs/lease | Agent | Claim one assigned job or receive null |
| POST /agent/jobs/:id/heartbeat | Agent | Confirm the lease and report progress |
| POST /agent/jobs/:id/complete | Agent | Acknowledge a published file |
| POST /agent/jobs/:id/fail | Agent | Report a typed failure |

A 45-second lease is fenced by an ID renewed during progress. An expired
lease can be reassigned to the same device with a fresh ID up to three
attempts. After 30 minutes the source expires, including for an active transfer, and unfinished jobs transition to
`rescan_required`. A 401, 403, or 410 from the origin also requests a new
scan. Other transfer failures surface in history.

Jobs can request download or metadata inspection, select an extractor format,
and name one of the destination profiles advertised by the agent.

The Windows agent protects its token with user-scoped DPAPI. It maps the Hub lease profile ID `default` to a locally configured destination. Media requests
block private IPs after DNS resolution and validate each redirect. Requests use
standard HTTP(S) ports and do not send browser credentials. Files stream into
a rooted, unique partial path. Publication uses an atomic hard link with no
replacement. The final filename is derived from the job ID and media type. Completed files get a local receipt used to validate
explicit open actions. The Hub never supplies an arbitrary local path.
A retransmission only accepts an existing final file when its contents match.

The agent supports two transfers concurrently and a 10 GiB limit per
file. A forced process or machine shutdown may leave a lease-specific
`.part` file, which can be removed after the agent has stopped.

The agent accepts supported raster images and common direct video MIME types.
SVG and HTML responses are rejected. If the agent loses connectivity after
publishing but before the Hub acknowledges completion, a file may be present
while the job still shows an unfinished or failed state.
