(() => {
  "use strict";

  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const formatSelect = document.getElementById("format");
  const qualityGroup = document.getElementById("quality-group");
  const pngNote = document.getElementById("png-note");
  const levelBtns = document.querySelectorAll(".level-btn");
  const fileListSection = document.getElementById("file-list-section");
  const fileCount = document.getElementById("file-count");
  const fileTbody = document.getElementById("file-tbody");
  const summary = document.getElementById("summary");
  const clearAllBtn = document.getElementById("clear-all-btn");
  const compressBtn = document.getElementById("compress-btn");
  const saveAllBtn = document.getElementById("save-all-btn");
  const downloadAllBtn = document.getElementById("download-all-btn");

  // Queued files (before compression)
  let pendingFiles = []; // { id, file }
  // Compressed results (after compression)
  let results = []; // { id, name, originalSize, blob }
  let nextId = 0;
  let compressed = false;

  // Current quality from level buttons
  let currentQuality = 0.80;

  // ---- Helpers ----

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function outputExtension(mime) {
    if (mime === "image/jpeg") return ".jpg";
    if (mime === "image/png") return ".png";
    return ".webp";
  }

  function mimeForFile(file) {
    const t = file.type;
    if (t === "image/png") return "image/png";
    if (t === "image/webp") return "image/webp";
    return "image/jpeg";
  }

  function replaceExtension(filename, mime) {
    const base = filename.replace(/\.[^.]+$/, "");
    return base + outputExtension(mime);
  }

  // ---- Quality visibility ----

  function updateQualityVisibility() {
    const isPng = formatSelect.value === "image/png";
    qualityGroup.style.display = isPng ? "none" : "";
    pngNote.classList.toggle("hidden", !isPng);
  }

  // ---- File list rendering ----

  function renderFileList() {
    fileTbody.innerHTML = "";
    fileCount.textContent = pendingFiles.length;

    if (pendingFiles.length === 0) {
      fileListSection.classList.add("hidden");
      compressed = false;
      results = [];
      summary.textContent = "";
      saveAllBtn.disabled = true;
      downloadAllBtn.disabled = true;
      return;
    }

    fileListSection.classList.remove("hidden");

    for (const entry of pendingFiles) {
      const tr = document.createElement("tr");
      tr.dataset.id = entry.id;

      // Check if this file has a compressed result
      const result = results.find((r) => r.id === entry.id);

      let compressedCell = "—";
      let ratioCell = "—";
      let statusCell = '<span class="status-pending">待機中</span>';

      if (result) {
        compressedCell = formatSize(result.blob.size);
        const ratio = ((1 - result.blob.size / entry.file.size) * 100).toFixed(1);
        ratioCell = ratio + "%";
        statusCell = '<span class="status-done">完了</span>';
      }

      tr.innerHTML = `
        <td>${entry.file.name}</td>
        <td>${formatSize(entry.file.size)}</td>
        <td class="compressed-size">${compressedCell}</td>
        <td class="ratio">${ratioCell}</td>
        <td class="status-cell">${statusCell}</td>
        <td><button class="remove-btn" data-id="${entry.id}" title="削除">&times;</button></td>
      `;
      fileTbody.appendChild(tr);
    }

    saveAllBtn.disabled = !compressed || results.length === 0;
    downloadAllBtn.disabled = !compressed || results.length === 0;
  }

  // ---- Add files (incremental) ----

  function addFiles(fileList) {
    const imageFiles = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    for (const file of imageFiles) {
      pendingFiles.push({ id: nextId++, file });
    }

    renderFileList();
  }

  // ---- Remove file ----

  function removeFile(id) {
    pendingFiles = pendingFiles.filter((e) => e.id !== id);
    results = results.filter((r) => r.id !== id);
    if (results.length === 0 && compressed) {
      compressed = false;
      summary.textContent = "";
    }
    renderFileList();
    if (compressed && results.length > 0) updateSummary();
  }

  // ---- Clear all ----

  function clearAll() {
    pendingFiles = [];
    results = [];
    compressed = false;
    summary.textContent = "";
    renderFileList();
  }

  // ---- Compression ----

  function compressImage(file, mime, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);

        const q = mime === "image/png" ? undefined : quality;
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("圧縮に失敗しました"));
              return;
            }
            resolve(blob);
          },
          mime,
          q
        );
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        reject(new Error("画像の読み込みに失敗しました"));
      };
      img.src = URL.createObjectURL(file);
    });
  }

  function updateSummary() {
    if (results.length === 0) return;
    const totalOriginal = results.reduce((s, r) => s + r.originalSize, 0);
    const totalCompressed = results.reduce((s, r) => s + r.blob.size, 0);
    const ratio = ((1 - totalCompressed / totalOriginal) * 100).toFixed(1);
    summary.textContent =
      `合計: ${formatSize(totalOriginal)} → ${formatSize(totalCompressed)}（${ratio}% 削減）`;
  }

  async function compressAll() {
    if (pendingFiles.length === 0) return;

    const selectedFormat = formatSelect.value;
    const quality = currentQuality;

    results = [];
    compressBtn.disabled = true;

    for (const entry of pendingFiles) {
      const row = fileTbody.querySelector(`tr[data-id="${entry.id}"]`);
      if (!row) continue;

      row.querySelector(".status-cell").innerHTML =
        '<span class="status-processing">処理中…</span>';

      const mime = selectedFormat === "original" ? mimeForFile(entry.file) : selectedFormat;

      try {
        const blob = await compressImage(entry.file, mime, quality);
        const reduction = (1 - blob.size / entry.file.size) * 100;
        row.querySelector(".compressed-size").textContent = formatSize(blob.size);
        if (reduction >= 0) {
          row.querySelector(".ratio").textContent = reduction.toFixed(1) + "%";
          row.querySelector(".status-cell").innerHTML =
            '<span class="status-done">完了</span>';
        } else {
          row.querySelector(".ratio").innerHTML =
            '<span class="size-increase">サイズ増加</span>';
          row.querySelector(".status-cell").innerHTML =
            '<span class="status-warn">完了</span>';
        }
        results.push({
          id: entry.id,
          name: replaceExtension(entry.file.name, mime),
          originalSize: entry.file.size,
          blob,
        });
      } catch (err) {
        row.querySelector(".status-cell").innerHTML =
          '<span class="status-error">エラー</span>';
        console.error(entry.file.name, err);
      }
    }

    compressed = true;
    compressBtn.disabled = false;
    saveAllBtn.disabled = results.length === 0;
    downloadAllBtn.disabled = results.length === 0;
    updateSummary();
  }

  // ---- Save / Download ----

  async function saveAllToFolder() {
    if (results.length === 0) return;
    try {
      const dirHandle = await window.showDirectoryPicker();
      for (const r of results) {
        const fileHandle = await dirHandle.getFileHandle(r.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(r.blob);
        await writable.close();
      }
      alert(`${results.length} 件のファイルを保存しました。`);
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error(err);
        alert("保存中にエラーが発生しました: " + err.message);
      }
    }
  }

  function downloadAll() {
    for (const r of results) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(r.blob);
      a.download = r.name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  function supportsFileSystemAccess() {
    return typeof window.showDirectoryPicker === "function";
  }

  // ---- Events ----

  // Level buttons
  levelBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      levelBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentQuality = parseFloat(btn.dataset.value);
    });
  });

  // Format change
  formatSelect.addEventListener("change", updateQualityVisibility);

  // Drop zone click
  dropZone.addEventListener("click", () => fileInput.click());

  // File input change
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      addFiles(fileInput.files);
      // Reset so the same files can be re-selected if needed
      fileInput.value = "";
    }
  });

  // Drag & Drop
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  });

  // Remove button (delegated)
  fileTbody.addEventListener("click", (e) => {
    const btn = e.target.closest(".remove-btn");
    if (btn) {
      removeFile(parseInt(btn.dataset.id));
    }
  });

  // Clear all
  clearAllBtn.addEventListener("click", clearAll);

  // Compress
  compressBtn.addEventListener("click", compressAll);

  // Save buttons
  saveAllBtn.addEventListener("click", () => {
    if (supportsFileSystemAccess()) {
      saveAllToFolder();
    } else {
      alert("このブラウザではフォルダ保存機能に対応していません。\n個別ダウンロードをご利用ください。");
    }
  });

  downloadAllBtn.addEventListener("click", downloadAll);

  // Hide save button if not supported
  if (!supportsFileSystemAccess()) {
    saveAllBtn.style.display = "none";
  }

  // Initial state
  updateQualityVisibility();
})();
