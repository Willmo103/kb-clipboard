# <img src="assets/kb-clipboard-icon.svg" width="48" height="48" valign="middle" style="margin-right: 10px;"/> kb-clipboard

Clipboard manager for the Knowledge-Base (`kb`) stack.

## Architecture

This application consists of two main components:
1. **Background Watcher Service (Python)**: A lightweight daemon that monitors the OS clipboard using the Windows Win32 API (`pywin32`) and Pillow (`PIL`). It detects copied text (identifying URLs), files, and direct images/screenshots (generating 64x64 thumbnails and base64-encoded content), and records them into the shared `kb-core` SQLite database.
2. **Desktop UI Client (Electron + React)**: An earth-toned desktop interface built using Vite, Tailwind CSS, and Lucide React icons. It directly queries the SQLite database to list history, filter by type (Text, File, Image) or favorite status, and lets the user preview, copy, open, delete, or export items.

To avoid recording duplicates when copying items *from* the history client back to the clipboard, the desktop UI writes the hash to `~/.kb/clip_skip.txt`. The watcher checks this file and suppresses logging for that specific copy action.

## CLI Usage

Run commands using `uv run kb-clipboard <command>` (or `kb-clipboard` if package is installed in your python environment):

- **watch**: Run the clipboard watcher in the foreground.
  ```bash
  uv run kb-clipboard watch [--interval 0.2]
  ```
- **start**: Detach and start the clipboard watcher in the background (Windows creation flags enable windowless detached operation). Saves the process ID in `~/.kb/clipboard_watcher.pid`.
  ```bash
  uv run kb-clipboard start
  ```
- **stop**: Safely terminate the running background clipboard watcher.
  ```bash
  uv run kb-clipboard stop
  ```
- **status**: Check if the background clipboard watcher is currently active.
  ```bash
  uv run kb-clipboard status
  ```
- **serve**: Start the Electron desktop client.
  ```bash
  # Dev mode (pointing to local dev server)
  uv run kb-clipboard serve --dev

  # Production mode (using compiled build assets)
  uv run kb-clipboard serve
  ```

## Local Development & Compilation

To build and compile the application:
1. Sync python virtual environment:
   ```bash
   uv sync
   ```
2. Setup node modules and run in development mode:
   ```bash
   cd desktop
   npm install

   # Start Vite frontend dev server (port 3000)
   npm run dev

   # Launch Electron (in a separate terminal)
   uv run kb-clipboard serve --dev
   ```
3. Compile production executable packages using the automated pipeline:
   ```bash
   python build.py
   ```

## CI/CD Pipeline

The project includes an automated GitHub Actions workflow configured in `.github/workflows/test-and-release.yml`:
- Runs Python tests (`pytest`) on every push or PR.
- Bumps the project patch version on successful merges to `master`.
- Commits and pushes the version bump, and tags the release.
- Builds the Electron standalone application and Python CLI packaging artifacts.
- Automatically creates a GitHub Release and uploads the portable `.exe` and python packages (`.whl`, `.tar.gz`).
