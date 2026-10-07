# syntax=docker/dockerfile:1
# The Docker daemon review sandboxes run on: Docker-in-Docker with gVisor as the default runtime.
# Only this container is privileged; the hansi container talks to it over a shared socket.
FROM docker:29-dind

ARG GVISOR_VERSION=20260928.0
RUN set -eux; \
	url="https://storage.googleapis.com/gvisor/releases/release/${GVISOR_VERSION}/$(uname -m)"; \
	cd /tmp; \
	wget -q "$url/gvisor.tar.bz2" "$url/gvisor.tar.bz2.sha512"; \
	sha512sum -c gvisor.tar.bz2.sha512; \
	tar -xjf gvisor.tar.bz2 -C /usr/local/bin; \
	rm gvisor.tar.bz2 gvisor.tar.bz2.sha512; \
	runsc --version

# No TLS certificates: the daemon only listens on the unix socket below, never on TCP.
ENV DOCKER_TLS_CERTDIR=
COPY daemon.json /etc/docker/daemon.json
COPY entrypoint.sh /usr/local/bin/hansi-sandbox
ENTRYPOINT ["hansi-sandbox"]
