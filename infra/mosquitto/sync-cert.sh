#!/bin/sh
# Copies the domain certificate that Caddy keeps (root-only files in its volume) to secrets/mosquitto/tls,
# readable by the mosquitto user, and makes the broker reload it. Run from cron daily and after deploy.
set -eu
cd "$(dirname "$0")/../.."
. ./.env
source_dir=$(find /var/lib/docker/volumes/smartsku_caddy_data/_data/caddy/certificates -type d -name "$SMARTSKU_DOMAIN" | head -1)
target_dir=secrets/mosquitto/tls
mkdir -p "$target_dir"
if cmp -s "$source_dir/$SMARTSKU_DOMAIN.crt" "$target_dir/cert.pem" && cmp -s "$source_dir/$SMARTSKU_DOMAIN.key" "$target_dir/key.pem"; then
  exit 0
fi
install -m 0644 "$source_dir/$SMARTSKU_DOMAIN.crt" "$target_dir/cert.pem"
install -m 0600 -o 1883 -g 1883 "$source_dir/$SMARTSKU_DOMAIN.key" "$target_dir/key.pem"
docker compose -f docker-compose.yml -f docker-compose.prod.yml kill -s HUP mosquitto 2>/dev/null || true
echo "MQTT certificate updated"
