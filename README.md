# Voice to Text Transcriber

A local Node.js, Express and EJS utility for transcribing recorded audio with OpenAI. Upload one to five files, review each result, and copy or download a combined transcript.

## Supported formats and batching

- **MP3 (`.mp3`):** sent directly for transcription.
- **Opus (`.opus`):** converted by bundled FFmpeg to mono 16 kHz WAV before transcription. No separate FFmpeg installation is needed.

Files are processed sequentially and results remain in the selection/upload order displayed in the browser. Duplicate filenames remain separate results. An individual validation, conversion or transcription failure does not discard other successful results or stop later files.

File-count, upload-size and malformed multipart errors reject the whole upload before transcription starts. Partial success applies after the batch has been received successfully.

## Requirements

- Node.js **20 or later**, with npm. Verified locally with Node.js 22.12.0; Node.js 18 lacks the global `File` support required by the installed OpenAI SDK.
- An OpenAI API key with access to the configured transcription model, plus network access to OpenAI. Transcription uses your API account and may incur charges.
- A modern browser with JavaScript enabled for selection summaries and export controls.

## Installation and configuration

From the project directory, install the existing dependencies:

```bash
npm install
```

Copy `.env.example` to `.env` and replace the API-key placeholder locally:

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
PORT=3000
```

| Variable | Purpose | Default when omitted |
| --- | --- | --- |
| `OPENAI_API_KEY` | Server-side API credential; required for transcription | None |
| `OPENAI_TRANSCRIBE_MODEL` | OpenAI transcription model | `gpt-4o-mini-transcribe` |
| `PORT` | Local HTTP server port | `3000` |

Keep the real key in `.env`; it is excluded by `.gitignore`. The example file contains only a placeholder and defaults.

## Run

```bash
npm start
```

Open `http://localhost:3000`.

For development with automatic restart when server files change:

```bash
npm run dev
```

## Usage

1. Select **1-5 MP3 or Opus files**. Review the filenames, sizes and displayed order.
2. Click **Transcribe**. The page shows a processing state while the normal form request runs; there is no percentage progress.
3. Review the success/failure summary and individual transcripts or errors. A successful empty transcript displays "No speech was detected in this file."
4. Use **Copy All** or **Download All** in the combined transcript panel.

If more than five files are selected, choose a smaller selection before submitting. If every file fails, individual errors remain visible and combined export controls are hidden.

## Combined transcript

Successful results are combined in upload order, with the original filename separating each section:

```text
===== recording-1.mp3 =====

Transcript...

===== recording-2.opus =====

Transcript...
```

The displayed combined output, **Copy All**, and **Download All** use the same backend string. Failed-file errors are excluded. Unicode and line endings are preserved; a single-file export also includes its filename heading.

- **Copy All** copies the complete combined text. If clipboard access is unavailable or denied, the text is selected and instructions for manual copying appear.
- **Download All** saves one UTF-8 file named `combined-transcript.txt`.

## Limits and timeouts

| Setting | Value |
| --- | --- |
| Files per batch | 5 maximum |
| Multipart upload ceiling | 50 MiB per file (52,428,800 bytes) |
| Actual file sent to OpenAI | 25,000,000 bytes maximum |
| FFmpeg conversion timeout | 5 minutes per Opus file |
| OpenAI request timeout | 10 minutes per attempt |
| OpenAI retries | Up to 2 SDK retries for retryable failures; no extra application retry loop |
| Stale-upload age | Older than 24 hours, checked at startup |

The transcription size check examines the uploaded MP3 or the **converted WAV**. Opus conversion can increase file size, so an upload below the upload ceiling may still produce a WAV too large to transcribe. That file fails individually; audio is never silently truncated.

A timed-out conversion is terminated before its temporary files are removed. An API timeout becomes a per-file error after SDK retries are exhausted. A batch can take substantially longer than ten minutes because files run sequentially and retryable requests may be retried.

## Temporary files and privacy

Original uploads and conversion outputs are stored temporarily under `uploads/` using random internal filenames. Cleanup is awaited after success, failure or timeout. Rejected uploads receive request-specific cleanup. Missing files are harmless; filesystem deletion failures are logged and may require attention if permissions or locks persist.

At startup, regular upload files older than 24 hours are removed. Recent files, directories and `.gitkeep` are preserved. This is a startup check, not a periodic background task.

Only `public/` is served as static content; the upload directory and `.env` are not publicly served. Filenames, transcripts and errors are escaped in the page. The API credential stays on the server; audio is sent to OpenAI for transcription. There is no database or saved transcript history, so copy or download results you want to keep.

## Verification

Local regression checks exercise the backend and browser with mocked OpenAI responses, including partial success, cleanup, timeouts, exact exports and safe rendering. A real bundled FFmpeg conversion is also verified. No paid API call is required for these checks.

The current `npm test` script is a placeholder, not a checked-in regression suite. Temporary verification harnesses are not retained. For a manual end-to-end smoke test, configure your key, start the app, and submit a short recording; this makes a real API request.
