#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root." >&2
  exit 1
fi
case "$(uname -m)" in
  aarch64|x86_64) ;;
  *) echo "Expected Linux ARM64 or AMD64." >&2; exit 1 ;;
esac
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) process.exit(1)'
command -v pnpm >/dev/null

repo=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
base=/opt/mediahunter
install -d -m 0755 "$base"
stage=$(mktemp -d "$base/hub.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
install -m 0644 "$repo/package.json" "$repo/pnpm-workspace.yaml" "$repo/pnpm-lock.yaml" "$stage/"
install -d "$stage/apps/hub" "$stage/packages/contracts" "$stage/apps/extension"
install -m 0644 "$repo/apps/hub/package.json" "$stage/apps/hub/"
install -m 0644 "$repo/packages/contracts/package.json" "$stage/packages/contracts/"
install -m 0644 "$repo/apps/extension/package.json" "$stage/apps/extension/"
cp -R "$repo/apps/hub/src" "$stage/apps/hub/"
cp -R "$repo/packages/contracts/src" "$stage/packages/contracts/"
(cd "$stage" && pnpm --filter @mediahunter/hub... install --prod --frozen-lockfile)
chmod 0755 "$stage"

getent passwd mediahunter >/dev/null || useradd --system --user-group --home-dir /var/lib/mediahunter --shell /usr/sbin/nologin mediahunter
install -d -o mediahunter -g mediahunter -m 0700 /var/lib/mediahunter
install -d -m 0755 /etc/mediahunter
if [ ! -e /etc/mediahunter/hub.env ]; then
  install -m 0644 "$repo/.env.example" /etc/mediahunter/hub.env
  sed -i 's|^MEDIAHUNTER_DATA_DIR=.*|MEDIAHUNTER_DATA_DIR=/var/lib/mediahunter|' /etc/mediahunter/hub.env
fi
install -m 0644 "$repo/scripts/mediahunter-hub.service" /etc/systemd/system/
systemctl daemon-reload

previous=$(readlink "$base/current" || true)
ln -s "$stage" "$stage.next"
mv -Tf "$stage.next" "$base/current"
if ! systemctl enable --now mediahunter-hub || ! systemctl restart mediahunter-hub; then
  if [ -n "$previous" ]; then
    ln -s "$previous" "$stage.rollback"
    mv -Tf "$stage.rollback" "$base/current"
    systemctl restart mediahunter-hub || true
  else
    systemctl disable --now mediahunter-hub || true
    unlink "$base/current"
  fi
  exit 1
fi
trap - EXIT
echo "Hub installed. Inspect systemctl status mediahunter-hub and verify /api/v1/health."
