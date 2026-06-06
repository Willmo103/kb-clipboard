"""
CLI command interface for `kb-clipboard`.
Provides endpoints to watch, start, stop, query status, serve, install autostart,
and import legacy JSON history.
"""

import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path

import typer
from kb_core.config import Config
from kb_core.utils import download_github_release_asset, check_github_latest_release

config = Config()
kb_clipboard_cli = typer.Typer(
    help="CLI for `kb-clipboard` - the clipboard component of the `kb` stack."
)

PID_FILE = config.root / "clipboard_watcher.pid"


def is_pid_running(pid: int) -> bool:
    """
    Check if a process with a given PID is currently active.

    Args:
        pid (int): The process ID to inspect.

    Returns:
        bool: True if process is active, False otherwise.
    """
    if pid <= 0:
        return False
    import sys

    if sys.platform == "win32":
        import ctypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION, False, pid
        )
        if handle == 0:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    else:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False


@kb_clipboard_cli.command("watch")
def watch(
    interval: float = typer.Option(
        0.2,
        "--interval",
        "-i",
        help="Polling interval in seconds.",
    )
):
    """
    Start the clipboard watcher synchronously in the foreground.

    Args:
        interval (float): Polling delay between clipboard updates. Defaults to 0.2.
    """
    from .watcher import run_watcher

    try:
        run_watcher(poll_interval=interval)
    except KeyboardInterrupt:
        typer.echo("\nWatcher stopped by user.")
    except Exception as e:
        typer.echo(f"Watcher stopped with error: {e}")


@kb_clipboard_cli.command("start")
def start():
    """
    Start the clipboard watcher in the background as a detached silent process.
    Uses pythonw.exe on Windows to prevent console windows from opening.
    """
    # Create config and root directories if they don't exist
    config.root.mkdir(parents=True, exist_ok=True)

    if PID_FILE.exists():
        try:
            pid = int(PID_FILE.read_text().strip())
            if is_pid_running(pid):
                typer.echo(f"Clipboard watcher is already running (PID: {pid}).")
                raise typer.Exit()
        except ValueError:
            pass

    # Find the pythonw.exe silent interpreter on Windows
    executable = sys.executable
    if sys.platform == "win32" and executable.endswith("python.exe"):
        w_executable = executable[:-10] + "pythonw.exe"
        if Path(w_executable).exists():
            executable = w_executable

    project_dir = Path(__file__).resolve().parent.parent.parent

    # Detach flags for Windows
    creationflags = 0
    if sys.platform == "win32":
        # DETACHED_PROCESS = 0x00000008, CREATE_NO_WINDOW = 0x08000000
        creationflags = 0x00000008 | 0x08000000

    try:
        proc = subprocess.Popen(
            [
                executable,
                "-c",
                "import kb_clipboard.watcher; kb_clipboard.watcher.run_watcher()",
            ],
            cwd=str(project_dir),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
            close_fds=True,
        )
        PID_FILE.write_text(str(proc.pid))
        typer.echo(f"Started clipboard watcher in background (PID: {proc.pid}).")
    except Exception as e:
        typer.echo(f"Failed to start clipboard watcher: {e}")


@kb_clipboard_cli.command("stop")
def stop():
    """
    Stop the background clipboard watcher process.
    Cleans up the PID file.
    """
    if not PID_FILE.exists():
        typer.echo("No active clipboard watcher process found (no PID file).")
        return

    try:
        pid = int(PID_FILE.read_text().strip())
        if is_pid_running(pid):
            typer.echo(f"Terminating clipboard watcher process {pid}...")
            try:
                os.kill(pid, signal.SIGTERM)
            except Exception:
                pass

            # Wait briefly and verify shutdown
            for _ in range(10):
                import time

                if not is_pid_running(pid):
                    break
                time.sleep(0.1)

            # If still running, force termination
            if is_pid_running(pid):
                if sys.platform == "win32":
                    subprocess.run(
                        ["taskkill", "/F", "/PID", str(pid)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                else:
                    os.kill(pid, signal.SIGKILL)

            typer.echo("Clipboard watcher stopped.")
        else:
            typer.echo(
                f"Watcher process {pid} is not running. Cleaning up stale PID file."
            )
    except ValueError:
        typer.echo("Stale PID file detected. Cleaning up.")
    except Exception as e:
        typer.echo(f"Error while stopping watcher: {e}")
    finally:
        PID_FILE.unlink(missing_ok=True)


@kb_clipboard_cli.command("status")
def status():
    """
    Query the status of the background clipboard watcher.
    """
    if not PID_FILE.exists():
        typer.echo("Clipboard watcher is stopped.")
        return

    try:
        pid = int(PID_FILE.read_text().strip())
        if is_pid_running(pid):
            typer.echo(f"Clipboard watcher is running (PID: {pid}).")
        else:
            typer.echo(f"Clipboard watcher is stopped (stale PID file: {pid}).")
    except ValueError:
        typer.echo("Clipboard watcher is stopped (invalid PID file).")


@kb_clipboard_cli.command("serve")
def serve(
    dev: bool = typer.Option(
        False,
        "--dev",
        help="Run in development mode (pointing to localhost:3000 instead of built assets)",
    )
):
    """
    Launch the Electron desktop application to browse clipboard history.

    Args:
        dev (bool): Set to True to target the active Vite dev server. Defaults to False.
    """
    import shutil
    package_dir = Path(__file__).resolve().parent
    src_desktop_dir = package_dir.parent.parent / "desktop"

    if src_desktop_dir.exists() and (src_desktop_dir / "package.json").exists():
        # Development / Source checkout mode
        typer.echo("Launching Electron application in development source mode...")
        env = os.environ.copy()
        if dev:
            env["NODE_ENV"] = "development"
        else:
            env["NODE_ENV"] = "production"

        creationflags = 0
        if sys.platform == "win32":
            creationflags = 0x00000008 | 0x08000000

        try:
            subprocess.Popen(
                ["npm", "start"],
                cwd=src_desktop_dir,
                shell=sys.platform == "win32",
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=creationflags,
                close_fds=True,
            )
            return
        except Exception as e:
            typer.echo(f"Error launching Electron via npm start: {e}")
            raise typer.Exit(code=1)

    # Installed / Packaged mode
    # First check if the desktop app is in PATH under the distinct name "kb-clipboard-desktop"
    exe_name = "kb-clipboard-desktop"
    if sys.platform == "win32":
        exe_name += ".exe"

    path_exe = shutil.which(exe_name)
    target_exe = None

    if path_exe:
        target_exe = Path(path_exe)
    else:
        # Check standard installation locations or packaged desktop_dist folder
        base_name = "kb-clipboard.exe" if sys.platform == "win32" else "kb-clipboard"
        bundled_candidate = package_dir / "desktop_dist" / base_name
        
        # User app data local program files location (NSIS)
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        install_candidate = None
        if sys.platform == "win32" and local_app_data:
            install_candidate = Path(local_app_data) / "Programs" / "kb-clipboard" / "kb-clipboard.exe"

        if bundled_candidate.exists():
            target_exe = bundled_candidate
        elif install_candidate and install_candidate.exists():
            target_exe = install_candidate

    if not target_exe:
        typer.echo("Could not find built Electron application executable (kb-clipboard-desktop).")
        typer.echo("Attempting to download prebuilt desktop binary from the latest GitHub release...")
        bin_dir = Path.home() / ".kb" / "bin"
        dest_name = "kb-clipboard-desktop.exe" if sys.platform == "win32" else "kb-clipboard-desktop"
        dest_exe = bin_dir / dest_name
        asset_pattern = r"kb-clipboard.*\.exe" if sys.platform == "win32" else r"kb-clipboard.*"
        success = download_github_release_asset(
            repo="Willmo103/kb-clipboard",
            asset_pattern=asset_pattern,
            dest_path=dest_exe
        )
        if success:
            target_exe = dest_exe
            typer.echo(f"Successfully downloaded latest desktop binary to: {target_exe}")
        else:
            typer.echo("Error: Could not download prebuilt desktop binary from GitHub Releases.")
            typer.echo("Please run 'kb-clipboard install' first to install the desktop assets.")
            raise typer.Exit(code=1)

    typer.echo(f"Launching Electron application: {target_exe}")
    creationflags = 0
    if sys.platform == "win32":
        creationflags = 0x00000008 | 0x08000000

    env = os.environ.copy()
    env["NODE_ENV"] = "production"

    try:
        subprocess.Popen(
            [str(target_exe)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
            close_fds=True,
            env=env
        )
    except Exception as e:
        typer.echo(f"Error executing Electron binary: {e}")
        raise typer.Exit(code=1)


@kb_clipboard_cli.command("install")
def install():
    """
    Perform unified installation of the application:
    1. Initialize the SQLite database and run migrations.
    2. Stage the desktop app binary in the local binary directory.
    3. Add the local binary directory to the user's system PATH.
    4. Create a desktop shortcut.
    5. Register the clipboard background watcher to run at logon (Windows startup).
    """
    # 1. Run DB migration/initialization
    from .watcher import init_db
    db = config.get_db()
    init_db(db)
    typer.echo("Database migrations successfully executed.")

    # 2. Setup standard binary path ~/.kb/bin
    bin_dir = Path.home() / ".kb" / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)

    # 3. Locate and copy packaged portable executable
    package_dir = Path(__file__).resolve().parent
    base_name = "kb-clipboard.exe" if sys.platform == "win32" else "kb-clipboard"
    bundled_exe = package_dir / "desktop_dist" / base_name
    dest_name = "kb-clipboard-desktop.exe" if sys.platform == "win32" else "kb-clipboard-desktop"
    dest_exe = bin_dir / dest_name

    if bundled_exe.exists():
        try:
            shutil.copy2(bundled_exe, dest_exe)
            typer.echo(f"Installed Electron desktop binary to: {dest_exe}")
        except Exception as e:
            typer.echo(f"Failed to copy Electron binary to bin: {e}")
    else:
        typer.echo("No bundled Electron application binary found to install.")
        typer.echo("Downloading the prebuilt desktop binary from the latest GitHub release...")
        asset_pattern = r"kb-clipboard.*\.exe" if sys.platform == "win32" else r"kb-clipboard.*"
        success = download_github_release_asset(
            repo="Willmo103/kb-clipboard",
            asset_pattern=asset_pattern,
            dest_path=dest_exe
        )
        if success:
            typer.echo(f"Successfully downloaded and installed latest desktop binary to: {dest_exe}")
        else:
            typer.echo("Warning: Failed to download prebuilt desktop binary from GitHub Releases.")

    # 4. Add bin directory to PATH
    if sys.platform == "win32":
        import winreg
        import ctypes
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment", 0, winreg.KEY_ALL_ACCESS)
            path_val, _ = winreg.QueryValueEx(key, "Path")
            paths = [p.strip() for p in path_val.split(";")]
            bin_path_str = str(bin_dir)
            if bin_path_str not in paths:
                paths.append(bin_path_str)
                new_path_val = ";".join(paths)
                winreg.SetValueEx(key, "Path", 0, winreg.REG_EXPAND_SZ, new_path_val)
                # Broadcast WM_SETTINGCHANGE to notify running shells
                HWND_BROADCAST = 0xFFFF
                WM_SETTINGCHANGE = 0x001A
                ctypes.windll.user32.SendMessageW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, "Environment")
                typer.echo(f"Added {bin_dir} to User PATH.")
            else:
                typer.echo(f"{bin_dir} is already in PATH.")
        except Exception as e:
            typer.echo(f"Failed to modify Windows PATH registry: {e}")
    else:
        bin_path_str = str(bin_dir)
        for rc in [".bashrc", ".zshrc", ".profile"]:
            rc_path = Path.home() / rc
            if rc_path.exists():
                try:
                    content = rc_path.read_text(errors="ignore")
                    export_line = f'export PATH="$PATH:{bin_path_str}"'
                    if export_line not in content:
                        with open(rc_path, "a") as f:
                            f.write(f"\n{export_line}\n")
                        typer.echo(f"Added PATH export to {rc}")
                except Exception as e:
                    typer.echo(f"Failed to write to {rc}: {e}")

    # 5. Create desktop shortcut
    if sys.platform == "win32" and dest_exe.exists():
        desktop = Path.home() / "Desktop"
        shortcut_path = desktop / "kb-clipboard.lnk"
        ps_cmd = f"""
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut('{shortcut_path}')
        $Shortcut.TargetPath = '{dest_exe}'
        $Shortcut.WorkingDirectory = '{bin_dir}'
        $Shortcut.IconLocation = '{dest_exe},0'
        $Shortcut.Save()
        """
        try:
            subprocess.run(["powershell", "-Command", ps_cmd], check=True, capture_output=True)
            typer.echo(f"Created desktop shortcut: {shortcut_path}")
        except Exception as e:
            typer.echo(f"Failed to create desktop shortcut: {e}")
    elif sys.platform != "win32" and dest_exe.exists():
        desktop = Path.home() / "Desktop"
        shortcut_path = desktop / "kb-clipboard.desktop"
        content = f"""[Desktop Entry]
Name=kb-clipboard
Exec={dest_exe}
Type=Application
Terminal=false
"""
        try:
            shortcut_path.write_text(content)
            shortcut_path.chmod(0o755)
            typer.echo(f"Created desktop shortcut: {shortcut_path}")
        except Exception as e:
            typer.echo(f"Failed to create desktop shortcut: {e}")

    # 6. Autostart setup for Windows startup directory
    if sys.platform == "win32":
        startup_dir = (
            Path.home()
            / "AppData"
            / "Roaming"
            / "Microsoft"
            / "Windows"
            / "Start Menu"
            / "Programs"
            / "Startup"
        )
        startup_dir.mkdir(parents=True, exist_ok=True)

        # Resolve the pythonw.exe path for silent execution
        executable = sys.executable
        if executable.endswith("python.exe"):
            w_executable = executable[:-10] + "pythonw.exe"
            if Path(w_executable).exists():
                executable = w_executable

        startup_script = startup_dir / "start_kb_clipboard.cmd"
        script_content = f'@echo off\nstart "" "{executable}" -c "import kb_clipboard.watcher; kb_clipboard.watcher.run_watcher()"\n'
        try:
            startup_script.write_text(script_content)
            typer.echo(f"Successfully installed startup script at: {startup_script}")
        except Exception as e:
            typer.echo(f"Failed to install startup script: {e}")
    else:
        typer.echo("Note: Background daemon autostart configuration is only supported on Windows.")


@kb_clipboard_cli.command("import-json")
def import_json(
    json_file: str = typer.Argument(..., help="Path to the legacy exported JSON file.")
):
    """
    Import legacy clipboard history exported from the former clipboard manager.
    Recalculates unique hashes and imports all records cleanly.

    Args:
        json_file (str): Path to the legacy JSON backup.
    """
    import json
    import base64
    from .watcher import init_db, hash_content

    file_path = Path(json_file)
    if not file_path.exists():
        typer.echo(f"Error: Exported JSON file not found at {json_file}")
        raise typer.Exit(code=1)

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        typer.echo(f"Error reading JSON file: {e}")
        raise typer.Exit(code=1)

    items = data.get("items", [])
    if not items:
        typer.echo("No items found to import in the JSON file.")
        return

    db = config.get_db()
    init_db(db)
    conn = db.conn
    cursor = conn.cursor()

    imported_count = 0
    skipped_count = 0

    typer.echo(f"Importing {len(items)} items into {config.db_path}...")

    with typer.progressbar(items, label="Processing") as progress:
        for item in progress:
            content = item.get("content", "")
            if not content:
                continue

            content_hash = hash_content(content)

            # Check if exists to prevent duplicates
            cursor.execute(
                "SELECT id FROM clipboard_history WHERE content_hash = ?",
                (content_hash,),
            )
            row = cursor.fetchone()

            if row:
                skipped_count += 1
                continue

            # Decode base64 thumbnail string to bytes
            thumb_b64 = item.get("thumbnail")
            thumbnail = None
            if thumb_b64:
                try:
                    thumbnail = base64.b64decode(thumb_b64)
                except Exception:
                    pass

            is_favorite = 1 if item.get("is_favorite") else 0
            access_count = item.get("access_count", 0)
            backed_up = 1 if item.get("backed_up") else 0
            timestamp = item.get("timestamp")

            cursor.execute(
                """
                INSERT INTO clipboard_history
                (content, content_hash, content_type, file_path, file_size, mime_type, thumbnail, timestamp, is_favorite, access_count, backed_up)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
                (
                    content,
                    content_hash,
                    item.get("content_type", "text"),
                    item.get("file_path"),
                    item.get("file_size"),
                    item.get("mime_type"),
                    thumbnail,
                    timestamp,
                    is_favorite,
                    access_count,
                    backed_up,
                ),
            )
            imported_count += 1

    conn.commit()
    typer.echo(
        f"Successfully imported {imported_count} items (skipped {skipped_count} duplicates)."
    )


@kb_clipboard_cli.command("update")
def update():
    """
    Check the latest GitHub Release and download the updated desktop application if available.
    """
    typer.echo("Checking for updates on GitHub release channel...")
    release = check_github_latest_release("Willmo103/kb-clipboard")
    if not release:
        typer.echo("Could not check latest release on GitHub.")
        raise typer.Exit(code=1)

    tag_name = release.get("tag_name", "unknown")
    typer.echo(f"Latest release version: {tag_name}")

    import importlib.metadata
    try:
        current_version = "v" + importlib.metadata.version("kb-clipboard")
    except Exception:
        current_version = "v0.1.8"

    typer.echo(f"Current local package version: {current_version}")

    bin_dir = Path.home() / ".kb" / "bin"
    dest_name = "kb-clipboard-desktop.exe" if sys.platform == "win32" else "kb-clipboard-desktop"
    dest_exe = bin_dir / dest_name

    typer.echo(f"Downloading prebuilt desktop binary {tag_name}...")
    asset_pattern = r"kb-clipboard.*\.exe" if sys.platform == "win32" else r"kb-clipboard.*"
    success = download_github_release_asset(
        repo="Willmo103/kb-clipboard",
        asset_pattern=asset_pattern,
        dest_path=dest_exe
    )
    if success:
        typer.echo(f"Successfully updated desktop binary to: {dest_exe}")
    else:
        typer.echo("Failed to update desktop binary.")


if __name__ == "__main__":
    kb_clipboard_cli()
