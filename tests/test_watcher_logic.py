import sqlite_utils

from kb_clipboard.watcher import (
    hash_content,
    should_skip_self_copy,
    init_db,
    load_ignore_patterns,
    should_ignore_content,
)


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


def test_load_ignore_patterns(tmp_path):
    ignore_file = tmp_path / "clipboard_ignore.txt"
    # Scenario 1: File does not exist
    assert load_ignore_patterns(ignore_file) == []

    # Scenario 2: File exists with comments, empty lines, valid and invalid regexes
    ignore_file.write_text(
        """# This is a comment
        
        # Another comment
        password
        .*\\.env
        [invalid(regex
        token_[a-z]+
        """,
        encoding="utf-8",
    )
    patterns = load_ignore_patterns(ignore_file)
    pattern_strs = [p[0] for p in patterns]
    assert "password" in pattern_strs
    assert ".*\\.env" in pattern_strs
    assert "token_[a-z]+" in pattern_strs
    assert "[invalid(regex" not in pattern_strs
    assert len(patterns) == 3


def test_should_ignore_content_text():
    import re

    compiled_patterns = [
        ("password", re.compile("password")),
        (".*secret.*", re.compile(".*secret.*")),
    ]

    # Matching text content
    data_match_1 = {"content_type": "text", "content": "my password is secret"}
    is_ignored, pattern = should_ignore_content(data_match_1, compiled_patterns)
    assert is_ignored
    assert pattern == "password" or pattern == ".*secret.*"

    # Non-matching text content
    data_no_match = {"content_type": "text", "content": "hello world"}
    is_ignored, pattern = should_ignore_content(data_no_match, compiled_patterns)
    assert not is_ignored
    assert pattern == ""

    # Non-text content type (e.g. image) shouldn't be matched against text ignore rules
    data_image = {"content_type": "image", "content": "base64passworddata"}
    is_ignored, pattern = should_ignore_content(data_image, compiled_patterns)
    assert not is_ignored


def test_should_ignore_content_file():
    import re

    compiled_patterns = [
        (".*\\.env", re.compile(".*\\.env")),
        ("sensitive_dir", re.compile("sensitive_dir")),
    ]

    # File path match absolute path
    data_match_path = {
        "content_type": "file",
        "file_path": "C:\\projects\\sensitive_dir\\my_file.txt",
    }
    is_ignored, pattern = should_ignore_content(data_match_path, compiled_patterns)
    assert is_ignored
    assert pattern == "sensitive_dir"

    # File path match filename extension
    data_match_filename = {
        "content_type": "file",
        "file_path": "C:\\projects\\app\\.env",
    }
    is_ignored, pattern = should_ignore_content(data_match_filename, compiled_patterns)
    assert is_ignored
    assert pattern == ".*\\.env"

    # Non-matching file
    data_no_match = {
        "content_type": "file",
        "file_path": "C:\\projects\\app\\main.py",
    }
    is_ignored, pattern = should_ignore_content(data_no_match, compiled_patterns)
    assert not is_ignored
