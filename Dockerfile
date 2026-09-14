FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash netcat-openbsd python3 qemu-system-x86 qemu-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY experiments/xp-vm/ /app/experiments/xp-vm/

USER root
EXPOSE 80
ENTRYPOINT ["/app/experiments/xp-vm/entrypoint.sh"]
