# Installation

## Prebuilt binaries

Each tagged release publishes binaries for Linux and macOS (amd64 and arm64) with a `checksums.txt`, on the [releases page](https://github.com/meain/vibediff/releases).

```bash
# Example: macOS on Apple Silicon
curl -L -o vibediff https://github.com/meain/vibediff/releases/latest/download/vibediff-darwin-arm64
chmod +x vibediff
mv vibediff ~/.local/bin/
```

Verify with `sha256sum -c checksums.txt` if you like.

## Build from source

You need Go 1.25+, Node.js 18+ and [Task](https://taskfile.dev).

```bash
git clone https://github.com/meain/vibediff.git
cd vibediff
task build        # produces ./vibediff
task install      # or install it globally
```

Without Task:

```bash
cd web && npm ci && npm run build && cd ..
go build -o vibediff .
```

The web assets are embedded in the binary, so the result is a single self-contained executable.

## Check it works

```bash
vibediff -version
cd some-git-or-jj-repo && vibediff
```

## Run it as a background server

VibeDiff reviews any number of repos from one instance, so the recommended setup is to start it once and leave it running:

```bash
vibediff -no-open &
```

Then open `http://localhost:8888` and add your repos from the directory switcher. To start it at login, run that command under tmux, a launchd agent (macOS) or a systemd user service (Linux).
