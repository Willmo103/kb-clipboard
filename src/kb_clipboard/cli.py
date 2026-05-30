import os
import signal
import subprocess
import sys
from pathlib import Path
from typing import Optional

import typer
from kb_core.config import Config

config = Config()
kb_clipboard_cli = typer.Typer(
    help="CLI for `kb-clipboard` - the clipboard component of the `kb` stack."
)

PID_FILE = config.root / "clipboard_watcher.pid"


def is_pid_running(pid: int) -> bool:
    """Check if process is running on Windows/Linux/macOS using signal 0."""
    if pid <= 0:
        return False
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
    """Start the clipboard watcher synchronously in the foreground."""
    from .watcher import run_watcher
    try:
        run_watcher(poll_interval=interval)
    except KeyboardInterrupt:
        typer.echo("\nWatcher stopped by user.")
    except Exception as e:
        typer.echo(f"Watcher stopped with error: {e}")


@kb_clipboard_cli.command("start")
def start():
    """Start the clipboard watcher in the background (detached process)."""
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

    # Spawn background process running: python -c "import kb_clipboard.watcher; kb_clipboard.watcher.run_watcher()"
    project_dir = Path(__file__).resolve().parent.parent.parent
    
    # Detach flags for Windows
    creationflags = 0
    if sys.platform == "win32":
        # DETACHED_PROCESS = 0x00000008, CREATE_NO_WINDOW = 0x08000000
        creationflags = 0x00000008 | 0x08000000

    try:
        proc = subprocess.Popen(
            [sys.executable, "-c", "import kb_clipboard.watcher; kb_clipboard.watcher.run_watcher()"],
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
    """Stop the background clipboard watcher."""
    if not PID_FILE.exists():
        typer.echo("No active clipboard watcher process found (no PID file).")
        return

    try:
        pid = int(PID_FILE.read_text().strip())
        if is_pid_running(pid):
            typer.echo(f"Terminating clipboard watcher process {pid}...")
            # Try gentle SIGTERM first, then taskkill on Windows if needed
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
                    subprocess.run(["taskkill", "/F", "/PID", str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    os.kill(pid, signal.SIGKILL)
            
            typer.echo("Clipboard watcher stopped.")
        else:
            typer.echo(f"Watcher process {pid} is not running. Cleaning up stale PID file.")
    except ValueError:
        typer.echo("Stale PID file detected. Cleaning up.")
    except Exception as e:
        typer.echo(f"Error while stopping watcher: {e}")
    finally:
        PID_FILE.unlink(missing_ok=True)


@kb_clipboard_cli.command("status")
def status():
    """Get the status of the background clipboard watcher."""
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
    """Launch the Electron desktop application to browse clipboard history."""
    desktop_dir = Path(__file__).resolve().parent.parent.parent / "desktop"
    typer.echo("Launching Electron application...")

    env = os.environ.copy()
    if dev:
        env["NODE_ENV"] = "development"
    else:
        env["NODE_ENV"] = "production"

    try:
        subprocess.run(
            ["npm", "start"],
            cwd=desktop_dir,
            check=True,
            shell=sys.platform == "win32",
            env=env,
        )
    except Exception as e:
        typer.echo(f"Error launching Electron: {e}")


if __name__ == "__main__":
    kb_clipboard_cli()
