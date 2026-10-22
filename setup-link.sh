#!/data/data/com.termux/files/usr/bin/bash
# Dex link setup - run in Termux on Larry's phone:
#   bash setup-link.sh <this phone's Tailscale IP>
# The IP (100.x.y.z) is shown in the Tailscale app on the phone.
#
# What this does, and nothing else:
#   1. Installs openssh in Termux if sshd is missing.
#   2. Generates sshd host keys if none exist.
#   3. Authorizes exactly ONE public key: LiTT's VM key (below).
#   4. Starts sshd listening ONLY on the phone's Tailscale address,
#      port 8022, public-key auth only - no passwords, no LAN, no public net.
# Stop the door anytime with:  pkill sshd
# Revoke permanently:           rm ~/.ssh/authorized_keys  (and pkill sshd)
set -e
TS_IP="$1"
if [ -z "$TS_IP" ]; then
  echo "Usage: bash setup-link.sh <phone Tailscale IP, from the Tailscale app>"
  exit 1
fi

if ! command -v sshd >/dev/null 2>&1; then
  echo "Installing openssh..."
  pkg install -y openssh
fi

if [ ! -f "$PREFIX/etc/ssh/ssh_host_ed25519_key" ]; then
  echo "Generating host keys..."
  ssh-keygen -A
fi

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKpuYZ96gJA/sPgnmL4s6/GqADf8cL1ordlBdDwDE6RG hatch"
touch "$HOME/.ssh/authorized_keys"
grep -qxF "$KEY" "$HOME/.ssh/authorized_keys" || echo "$KEY" >> "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"

SSHD_BIN="$(command -v sshd)"
pkill sshd 2>/dev/null || true
"$SSHD_BIN" -o Port=8022 -o "ListenAddress=$TS_IP" -o PasswordAuthentication=no -o PubkeyAuthentication=yes

echo ""
echo "Dex link is UP."
echo "  user:    $(whoami)"
echo "  address: $TS_IP"
echo "  port:    8022"
echo "Stop it anytime with: pkill sshd"
pgrep -a sshd || true
