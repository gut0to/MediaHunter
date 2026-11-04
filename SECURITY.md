# Security policy

MediaHunter is experimental. Security fixes target the latest development
version.

Use the repository's enabled [private vulnerability reporting channel](https://github.com/gut0to/MediaHunter/security/advisories/new).
A maintainer's private contact method listed on their GitHub profile is another option. Include the affected commit, impact, and
a minimal reproduction with synthetic credentials and URLs. Keep active
vulnerability details out of public issues.

Use a private HTTPS endpoint. Pairing codes are single-use and expire after
10 minutes. Revoke a device from the Hub's local CLI if its token is exposed.
Protect the Hub data directory and its encryption key. The extension and
agent do not send browser cookies or session authorization headers to the Hub.
