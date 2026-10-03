# Changelog

## [1.1.0] - 2026-10-03

### Added

- Batch transcription for up to five MP3 or Opus files, processed sequentially in upload order with per-file results and partial success.
- Browser multi-file selection, ordered filenames and sizes, maximum-file validation, processing state, and duplicate-submit prevention.
- Individual transcript/error cards, batch summaries, and an explicit no-speech state for empty successful transcripts.
- Filename-separated combined transcripts, Copy All with manual-copy fallback, and a single UTF-8 TXT download preserving Unicode and line endings.
- Responsive layouts, labeled controls, keyboard focus indicators, and accessible status messages.

### Changed

- Hardened temporary storage with UUID filenames, exclusive creation, awaited request-specific cleanup, and startup cleanup of files older than 24 hours.
- Added safe upload-error handling and a 25,000,000-byte transcription-input check while retaining the 50 MiB upload ceiling.
- Added a five-minute FFmpeg conversion timeout and explicitly configured the existing ten-minute OpenAI timeout with up to two retries.
- Updated setup and usage documentation, including the Node.js 20+ requirement, limits, exports, and cleanup behaviour.

### Fixed

- Preserved accented characters and emoji in uploaded filenames through UTF-8 multipart decoding.
- Cleaned partial WAV files and interrupted uploads without removing unrelated request files.
- Restored usable submission controls after browser back navigation and kept frontend helpers out of global scope.

## [2026-03-08]
- Initialized Node.js project and installed dependencies.
- Added Express + EJS app scaffold with upload form.
- Implemented `.opus`/`.mp3` upload validation and OpenAI transcription endpoint.
- Added setup docs, environment template, and gitignore.
- Added `.opus` to `.wav` conversion before transcription using bundled ffmpeg.
- Updated docs to note automatic conversion behavior for `.opus` uploads.
