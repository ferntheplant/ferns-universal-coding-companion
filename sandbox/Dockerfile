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

# --platform=linux/arm64 because Daytona's image builder defaults to amd64
# even when the host (Apple Silicon) is arm64 — leaving it default lands
# you with an x86_64 sandbox running under qemu-x86_64 userspace emulation,
# which makes Node / Pi / model-call latency unusable and triggers a Go
# runtime panic in gh ("marked free object in span"). Pin to arm64 so the
# whole thing runs natively. Change to linux/amd64 if you're on x86_64.
FROM --platform=linux/arm64 debian:bookworm-slim

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
      ffmpeg fd-find universal-ctags ripgrep zsh \
      procps lsof iproute2 \
      chromium \
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

# Global CLIs — own layer so the slow npm install is cached independently
# of base tooling changes.
#   - @earendil-works/pi-coding-agent: gives us /usr/local/bin/pi
#   - agent-browser: Vercel's browser CLI. On amd64 we'd run
#     `agent-browser install` here to fetch Chrome-for-Testing; on arm64
#     Chrome-for-Testing has no build, so we instead install Debian's
#     `chromium` package above and point agent-browser/Puppeteer at it
#     via env vars below.
#   - @ast-grep/cli: ships `ast-grep` and `sg`; --force because /usr/bin/sg
#     already exists (passwd's switch-group, which we don't need).
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm install -g @earendil-works/pi-coding-agent agent-browser \
 && npm install -g --force @ast-grep/cli

# Tell anything that looks for a Chrome/Chromium binary (Puppeteer,
# Playwright, agent-browser) to use the system chromium installed via apt.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
    AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium

# difftastic via upstream release tarball — not packaged on Debian.
# Bump DIFFT_VERSION when you want a newer release.
ARG DIFFT_VERSION=0.64.0
RUN DIFFT_ARCH=$(uname -m | sed -e 's/x86_64/x86_64-unknown-linux-gnu/' -e 's/aarch64/aarch64-unknown-linux-gnu/') \
 && curl -fsSL "https://github.com/Wilfred/difftastic/releases/download/${DIFFT_VERSION}/difft-${DIFFT_ARCH}.tar.gz" \
      | tar -xz -C /usr/local/bin \
 && chmod +x /usr/local/bin/difft

# GitHub CLI — used by the orchestrator to clone private repos with the
# host's `gh auth` token (mounted at /root/.config/gh/hosts.yml at
# provision time). Installed from GitHub's apt repo, not Debian's, so we
# get current versions.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | tee /usr/share/keyrings/githubcli-archive-keyring.gpg > /dev/null \
 && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh

# mise — runtime/tooling manager. Apps in the target repo declare their
# tool versions via mise.toml / .tool-versions; the provisioner runs
# `mise install` after cloning so deps come from the repo's own pin list,
# not the snapshot. mise install script writes the binary to ~/.local/bin
# and `mise activate` is wired below.
ENV MISE_DATA_DIR=/root/.local/share/mise \
    MISE_CONFIG_DIR=/root/.config/mise \
    PATH=/root/.local/bin:/root/.local/share/mise/shims:/root/.bun/bin:/usr/local/bin:/usr/bin:/bin
RUN curl -fsSL https://mise.run | sh \
 && /root/.local/bin/mise --version

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
