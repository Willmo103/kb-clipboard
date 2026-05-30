import base64
import hashlib
import io
import mimetypes
import os
import sys
import time
from pathlib import Path
from typing import Optional, Dict, Any

from kb_core.config import Config

# Helper to check if running on Windows and conditionally import win32 packages
IS_WINDOWS = sys.platform == "win32"

if IS_WINDOWS:
    import win32clipboard
    from PIL import Image, ImageGrab
else:
    # Fallback to prevent crash on non-Windows during initialization or packaging
    win32clipboard = None
    Image = None
    ImageGrab = None


def init_db(db) -> None:
    """Initialize the SQLite database schema and indexes."""
    # We use raw sql on the connection to set up tables and indexes
    conn = db.conn
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS clipboard_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            content_hash TEXT UNIQUE,
            content_type TEXT DEFAULT 'text',
            file_path TEXT,
            file_size INTEGER,
            mime_type TEXT,
            thumbnail BLOB,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_favorite INTEGER DEFAULT 0,
            access_count INTEGER DEFAULT 0,
            backed_up INTEGER DEFAULT 0
        )
    """)
    
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_timestamp ON clipboard_history(timestamp DESC)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_hash ON clipboard_history(content_hash)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_favorite ON clipboard_history(is_favorite)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_type ON clipboard_history(content_type)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_backed_up ON clipboard_history(backed_up)")
    conn.commit()


def hash_content(content: str) -> str:
    """Generate SHA-256 hash of the content string."""
    try:
        return hashlib.sha256(content.encode("utf-8", errors="ignore")).hexdigest()
    except Exception:
        return ""


def should_skip_self_copy(content_hash: str) -> bool:
    """Check if the clipboard update is a self-copy that should be skipped."""
    skip_file = Path.home() / ".kb" / "clip_skip.txt"
    if skip_file.exists():
        try:
            marked_hash = skip_file.read_text().strip()
            # If skip file is empty or hash matches, consume the skip-once flag
            if not marked_hash or content_hash == marked_hash:
                skip_file.unlink(missing_ok=True)
                return True
        except Exception as e:
            print(f"Error checking clip_skip.txt: {e}")
    return False


def get_clipboard_data() -> Optional[Dict[str, Any]]:
    """Retrieve data from Windows clipboard, identifying files, images, or text."""
    if not IS_WINDOWS:
        return None

    try:
        win32clipboard.OpenClipboard()
    except Exception:
        # Clipboard locked by another application
        return None

    try:
        # 1. Handle Files (CF_HDROP)
        if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_HDROP):
            files = win32clipboard.GetClipboardData(win32clipboard.CF_HDROP)
            if files:
                file_path = files[0]
                f_path = Path(file_path)
                if f_path.exists():
                    mime, _ = mimetypes.guess_type(f_path)
                    stat = f_path.stat()
                    size = stat.st_size
                    
                    thumbnail = None
                    if mime and mime.startswith("image/"):
                        try:
                            with Image.open(f_path) as img:
                                thumb = img.copy()
                                thumb.thumbnail((64, 64))
                                buf = io.BytesIO()
                                thumb.save(buf, format="PNG")
                                thumbnail = buf.getvalue()
                        except Exception as e:
                            print(f"Error creating file thumbnail: {e}")
                            
                    return {
                        "content": str(f_path),
                        "content_type": "file",
                        "file_path": str(f_path),
                        "file_size": size,
                        "mime_type": mime or "application/octet-stream",
                        "thumbnail": thumbnail,
                    }

        # 2. Handle Direct Images (CF_DIB)
        if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_DIB):
            try:
                img = ImageGrab.grabclipboard()
                if isinstance(img, Image.Image):
                    # Save full image to base64 PNG
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    image_bytes = buf.getvalue()
                    content = base64.b64encode(image_bytes).decode("ascii")

                    # Create thumbnail (64x64)
                    thumb = img.copy()
                    thumb.thumbnail((64, 64))
                    t_buf = io.BytesIO()
                    thumb.save(t_buf, format="PNG")
                    thumbnail = t_buf.getvalue()

                    return {
                        "content": content,
                        "content_type": "image",
                        "file_path": None,
                        "file_size": len(image_bytes),
                        "mime_type": "image/png",
                        "thumbnail": thumbnail,
                    }
            except Exception as e:
                print(f"Error handling direct clipboard image: {e}")

        # 3. Handle Text (CF_UNICODETEXT)
        if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):
            text = win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT)
            if text:
                text_str = text.strip()
                if text_str:
                    return {
                        "content": text_str,
                        "content_type": "text",
                        "file_path": None,
                        "file_size": len(text_str),
                        "mime_type": "text/plain",
                        "thumbnail": None,
                    }
    except Exception as e:
        print(f"Error processing clipboard data: {e}")
    finally:
        try:
            win32clipboard.CloseClipboard()
        except Exception:
            pass
    return None


def run_watcher(poll_interval: float = 0.2) -> None:
    """Continuously poll the Windows clipboard and persist updates to database."""
    print("Initializing clipboard watcher service...")
    config = Config()
    
    # Ensure configs directory exists
    config.configs_dir.mkdir(parents=True, exist_ok=True)
    
    db = config.get_db()
    init_db(db)
    
    last_hash = ""
    print(f"Watcher active. Monitoring clipboard (interval {poll_interval}s) and saving to: {config.db_path}")

    while True:
        try:
            data = get_clipboard_data()
            if data:
                content_hash = hash_content(data["content"])
                if content_hash != last_hash:
                    # Check if self-copy skip is requested
                    if should_skip_self_copy(content_hash):
                        print(f"Skipped self-copy hash: {content_hash[:8]}")
                        last_hash = content_hash
                        time.sleep(poll_interval)
                        continue

                    # Persist to DB
                    conn = db.conn
                    cursor = conn.cursor()
                    cursor.execute("SELECT id FROM clipboard_history WHERE content_hash = ?", (content_hash,))
                    row = cursor.fetchone()
                    
                    if row:
                        cursor.execute("""
                            UPDATE clipboard_history
                            SET timestamp = CURRENT_TIMESTAMP, access_count = access_count + 1
                            WHERE id = ?
                        """, (row[0],))
                        print(f"Updated existing clipboard item (Hash: {content_hash[:8]})")
                    else:
                        cursor.execute("""
                            INSERT INTO clipboard_history 
                            (content, content_hash, content_type, file_path, file_size, mime_type, thumbnail)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, (
                            data["content"],
                            content_hash,
                            data["content_type"],
                            data["file_path"],
                            data["file_size"],
                            data["mime_type"],
                            data["thumbnail"]
                        ))
                        print(f"Saved new clipboard item of type '{data['content_type']}' (Hash: {content_hash[:8]})")
                    
                    conn.commit()
                    last_hash = content_hash

        except Exception as e:
            print(f"Watcher loop error: {e}")
            time.sleep(0.5)

        time.sleep(poll_interval)
