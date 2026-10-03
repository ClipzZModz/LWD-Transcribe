(() => {
  "use strict";

  const MAX_FILES = 5;
  const form = document.getElementById("transcription-form");
  const audioInput = document.getElementById("audio");
  const transcribeButton = document.getElementById("transcribe-button");
  const selectionSummary = document.getElementById("selection-summary");
  const selectionCount = document.getElementById("selection-count");
  const selectedFiles = document.getElementById("selected-files");
  const selectionError = document.getElementById("selection-error");
  const processingStatus = document.getElementById("processing-status");
  let submitting = false;

  function formatSize(bytes) {
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unit = 0;
    while (size >= 1000 && unit < units.length - 1) {
      size /= 1000;
      unit += 1;
    }
    return `${size.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
  }

  function updateSelection() {
    const files = Array.from(audioInput.files);
    const tooMany = files.length > MAX_FILES;
    const message = tooMany ? `You can upload a maximum of ${MAX_FILES} files at once.` : "";
    selectedFiles.replaceChildren();
    for (const file of files) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = file.name;
      const size = document.createElement("span");
      size.className = "file-size";
      size.textContent = ` — ${formatSize(file.size)}`;
      item.append(name, size);
      selectedFiles.append(item);
    }
    selectionSummary.hidden = files.length === 0;
    selectionCount.textContent = files.length ? `${files.length} ${files.length === 1 ? "file" : "files"} selected` : "";
    selectionError.textContent = message;
    audioInput.setCustomValidity(message);
    audioInput.setAttribute("aria-invalid", String(tooMany));
    transcribeButton.disabled = submitting || tooMany || files.length === 0;
  }

  audioInput.addEventListener("change", updateSelection);
  form.addEventListener("submit", (event) => {
    if (submitting) {
      event.preventDefault();
      return;
    }
    updateSelection();
    if (!form.reportValidity()) {
      event.preventDefault();
      return;
    }
    submitting = true;
    transcribeButton.disabled = true;
    transcribeButton.textContent = "Transcribing…";
    form.setAttribute("aria-busy", "true");
    const count = audioInput.files.length;
    processingStatus.textContent = `Processing ${count} ${count === 1 ? "file" : "files"}. This may take a few minutes.`;
    // Keep the input enabled: disabled file controls are omitted from the native POST.
  });

  function resetSubmission() {
    submitting = false;
    transcribeButton.textContent = "Transcribe";
    form.removeAttribute("aria-busy");
    processingStatus.textContent = "";
    updateSelection();
  }

  // Restore usable controls when returning through the browser's back/forward cache.
  window.addEventListener("pageshow", resetSubmission);
  resetSubmission();

  const combinedSource = document.getElementById("combined-source");
  if (combinedSource) {
    const combinedText = JSON.parse(combinedSource.value);
    const combinedOutput = document.getElementById("combined-transcript");
    const copyButton = document.getElementById("copy-all");
    const downloadButton = document.getElementById("download-all");
    const exportStatus = document.getElementById("export-status");
    let feedbackTimer;
    combinedOutput.textContent = combinedText;
    document.getElementById("export-actions").hidden = false;

    copyButton.addEventListener("click", async () => {
      clearTimeout(feedbackTimer);
      copyButton.disabled = true;
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(combinedText);
        copyButton.textContent = "Copied!";
        exportStatus.textContent = "Combined transcript copied.";
        feedbackTimer = setTimeout(() => {
          copyButton.textContent = "Copy All";
          exportStatus.textContent = "";
        }, 2000);
      } catch {
        copyButton.textContent = "Copy All";
        combinedOutput.focus();
        const range = document.createRange();
        range.selectNodeContents(combinedOutput);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        exportStatus.textContent = "Automatic copying is unavailable. The combined transcript is selected; use your device’s Copy command.";
      } finally {
        copyButton.disabled = false;
      }
    });

    downloadButton.addEventListener("click", () => {
      let url;
      const link = document.createElement("a");
      try {
        const blob = new Blob([combinedText], { type: "text/plain;charset=utf-8" });
        url = URL.createObjectURL(blob);
        link.href = url;
        link.download = "combined-transcript.txt";
        document.body.append(link);
        link.click();
        exportStatus.textContent = "Download requested: combined-transcript.txt";
      } catch {
        exportStatus.textContent = "Download could not start. Try again or copy the combined transcript.";
      } finally {
        link.remove();
        // Allow the browser to start consuming the Blob before releasing its URL.
        if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
  }
})();
