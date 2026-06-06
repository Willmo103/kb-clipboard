# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.8] - 2026-06-06
### Fixed
- Intercepted window minimize events to collapse the app to the system tray.
- Prevented startup crashes by adding try-catch error handling for tray creation.
- Updated `install` and `serve` commands to check for and dynamically download the latest prebuilt desktop binary from GitHub Releases when missing locally.
- Configured Windows shortcut creation to explicitly set the icon location.
- Updated CI/CD release workflow to explicitly push release tags, solving packaging issues.
- Added `update` CLI subcommand to manually pull prebuilt desktop updates.

## [0.1.7] - 2026-06-04
### Added
- Unified installer options to copy the desktop app to user PATH, create shortcuts, and run database migrations.
- Packaged compiled standalone Electron app directly inside Python wheels.

## [0.1.6] - 2026-06-03
### Added
- Main process for clipboard history management with SQLite and tray support.
### Changed
- Cleaned up whitespace and formatting in build script.

## [0.1.5] - 2026-06-01
### Changed
- Added clean steps to `build.py` to purge previous dist artifacts.

## [0.1.4] - 2026-06-01
### Added
- Electron-based desktop clipboard manager and project assets.

## [0.1.3] - 2026-05-30
### Added
- Typer-based CLI for clipboard management including background process control and legacy data import.

## [0.1.2] - 2026-05-30
### Added
- CLI commands for clipboard management, background process control, and legacy data migration.

## [0.1.1] - 2026-05-30
### Added
- Silent startup configuration, autostart installation script, JSON history import, image thumbnail creation, and automated CI release workflow.

## [0.1.0] - 2026-05-30
### Added
- Initial project structure containing React-Electron UI, background python clipboard watcher, and build pipeline.
