# syntax=docker/dockerfile:1.7
#
# Pi agent harness sandbox image.
#
# Build / register as a Daytona snapshot:
#   bun sandbox/build-snapshot.ts
#
# This image bakes in the harness itself, so a sandbox created from the
# resulting snapshot has `pi` + extensions ready immediately — no
# per-sandbox install step. Edit the repo? Re-run build-snapshot.ts.
# (Heavy layers are split so the apt + node + npm + Chrome steps cache
# independently of repo changes.)

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    BUN_INSTALL=/root/.bun \
    HOME=/root \
    PATH=/root/.bun/bin:/usr/local/bin:/usr/bin:/bin

# Base tooling + pi-hashline-readmap deps (fd, ctags, ripgrep; ast-grep is
# npm below) + ffmpeg + Chromium runtime libs (agent-browser bundles
# Chromium but not its shared-library deps — list mirrors
# `playwright install-deps` for chromium on bookworm).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      curl ca-certificates git unzip xz-utils build-essential python3 \
      ffmpeg fd-find universal-ctags ripgrep \
      libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
      libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
      libasound2 libatspi2.0-0 libwayland-client0 fonts-liberation \
 && ln -sf /usr/bin/fdfind /usr/local/bin/fd

# Node 22 (gives us `npm`, needed for the global CLIs below).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs

# Bun for the workspace install + repo scripts.
RUN curl -fsSL https://bun.sh/install | bash \
 && ln -sf /root/.bun/bin/bun /usr/local/bin/bun \
 && ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx

# Global CLIs — own layer so the slow npm + Chrome download is cached
# independently of base tooling changes.
#   - @earendil-works/pi-coding-agent: gives us /usr/local/bin/pi
#   - agent-browser: Vercel's browser CLI (+ Chromium via `agent-browser install`)
#   - @ast-grep/cli: ships `ast-grep` and `sg`; --force because /usr/bin/sg
#     already exists (passwd's switch-group, which we don't need).
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm install -g @earendil-works/pi-coding-agent agent-browser \
 && npm install -g --force @ast-grep/cli \
 && agent-browser install

# difftastic via upstream release tarball — not packaged on Debian.
# Bump DIFFT_VERSION when you want a newer release.
ARG DIFFT_VERSION=0.64.0
RUN DIFFT_ARCH=$(uname -m | sed -e 's/x86_64/x86_64-unknown-linux-gnu/' -e 's/aarch64/aarch64-unknown-linux-gnu/') \
 && curl -fsSL "https://github.com/Wilfred/difftastic/releases/download/${DIFFT_VERSION}/difft-${DIFFT_ARCH}.tar.gz" \
      | tar -xz -C /usr/local/bin \
 && chmod +x /usr/local/bin/difft

# -----------------------------------------------------------------------
# Harness install. Anything below this line gets invalidated whenever the
# repo tarball changes — everything above stays cached.
# -----------------------------------------------------------------------

# The tarball is produced by sandbox/build-snapshot.ts before invoking
# the snapshot build. It contains the repo working tree minus
# node_modules / .git / dist / .turbo, so `bun install` runs clean inside
# the image.
COPY _context.tar.gz /tmp/fucc.tar.gz

RUN mkdir -p /opt/fucc \
 && tar -xzf /tmp/fucc.tar.gz -C /opt/fucc \
 && rm /tmp/fucc.tar.gz

WORKDIR /opt/fucc

# Workspace install. Cache the bun store across builds.
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    bun install --frozen-lockfile || bun install

# Wire manifest -> ~/.pi/agent/ and `pi install` the third-party packages
# listed in manifest.json. install.sh respects $HOME (=/root, set above),
# so the symlinks land at /root/.pi/agent/ and survive into the sandbox.
RUN ./install.sh

RUN pi update

WORKDIR /root
