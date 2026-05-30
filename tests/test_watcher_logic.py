import os
from pathlib import Path
import pytest
import sqlite_utils

from kb_clipboard.watcher import hash_content, should_skip_self_copy, init_db


def test_hash_content():
    content = "Hello World!"
    expected_hash = "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069"
    assert hash_content(content) == expected_hash
    assert (
        hash_content("")
        == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )


def test_should_skip_self_copy(tmp_path, mocker):
    # Mock Path.home() so we control where ~/.kb is located
    mocker.patch("pathlib.Path.home", return_value=tmp_path)

    kb_dir = tmp_path / ".kb"
    kb_dir.mkdir(parents=True, exist_ok=True)
    skip_file = kb_dir / "clip_skip.txt"

    # Scenario 1: skip_file doesn't exist
    assert not should_skip_self_copy("somehash")

    # Scenario 2: skip_file exists with blank content (skip anything)
    skip_file.write_text("   ")
    assert should_skip_self_copy("anyhash")
    assert not skip_file.exists()  # consumed

    # Scenario 3: skip_file exists with specific hash, match
    skip_file.write_text("matchinghash")
    assert should_skip_self_copy("matchinghash")
    assert not skip_file.exists()  # consumed

    # Scenario 4: skip_file exists with specific hash, mismatch
    skip_file.write_text("matchinghash")
    assert not should_skip_self_copy("mismatchinghash")
    assert skip_file.exists()  # NOT consumed

    # Clean up
    skip_file.unlink(missing_ok=True)


def test_init_db():
    db = sqlite_utils.Database(memory=True)
    init_db(db)

    # Verify tables and columns exist
    tables = db.table_names()
    assert "clipboard_history" in tables

    table_columns = [col.name for col in db["clipboard_history"].columns]
    assert "id" in table_columns
    assert "content" in table_columns
    assert "content_hash" in table_columns
    assert "content_type" in table_columns
    assert "file_path" in table_columns
    assert "file_size" in table_columns
    assert "mime_type" in table_columns
    assert "thumbnail" in table_columns
    assert "timestamp" in table_columns
    assert "is_favorite" in table_columns
    assert "access_count" in table_columns
    assert "backed_up" in table_columns
