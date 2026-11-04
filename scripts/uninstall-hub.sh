#!/bin/sh
set -eu
if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi
case "${1:-}" in
  ""|--purge) ;;
  *) echo "Usage: uninstall-hub.sh [--purge]" >&2; exit 1 ;;
esac
systemctl disable --now mediahunter-hub 2>/dev/null || true
rm -f /etc/systemd/system/mediahunter-hub.service
systemctl daemon-reload
# These fixed directories belong to the installer. Media never resides here.
rm -rf -- /opt/mediahunter
if [ "${1:-}" = --purge ]; then
  rm -rf -- /etc/mediahunter /var/lib/mediahunter
  echo "Hub source, configuration, queue and encryption key removed."
else
  echo "Hub removed. Configuration and queue retained for reinstallation."
fi
