#!/bin/sh
# Starts the daemon on the socket shared with hansi, then limits what sandboxes can reach.
set -eu

socket_dir=/var/run/hansi-sandbox
mkdir -p "$socket_dir"
# The bun user in the hansi image (gid 1000) opens the socket through its group.
dockerd-entrypoint.sh dockerd \
	--host="unix://$socket_dir/docker.sock" \
	--group="${SANDBOX_SOCKET_GID:-1000}" &
daemon=$!

until docker --host "unix://$socket_dir/docker.sock" info >/dev/null 2>&1; do
	kill -0 "$daemon" 2>/dev/null || exit 1
	sleep 1
done

# Sandboxes may reach the public internet, nothing else: not this container, not the compose
# network (hansi, the database), not private ranges, and not cloud metadata.
iptables -I INPUT -i docker0 -j DROP
for range in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16; do
	iptables -I DOCKER-USER -i docker0 -d "$range" -j DROP
done
echo 'hansi sandbox daemon ready'

wait "$daemon"
