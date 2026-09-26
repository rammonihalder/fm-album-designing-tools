"use strict";

const { runAutoPhotoFill } = require("./src/tools/autoPhotoFill");
const { runSwapPhotos } = require("./src/tools/swapPhotos");
const { createToastManager } = require("./src/ui/toast");

const $ = id => (typeof document !== "undefined" && typeof document.getElementById === "function" ? document.getElementById(id) : null);

const ui = {
  autoPhotoFillBtn: $("autoPhotoFillBtn"),
  swapPhotosBtn: $("swapPhotosBtn"),
  statusText: $("statusText"),
  toast: $("toast")
};

const toast = createToastManager(ui.toast);
let running = false;

function setStatus(message) {
  if (!ui.statusText) return;
  if (!message) {
    ui.statusText.hidden = true;
    ui.statusText.textContent = "";
  } else {
    ui.statusText.textContent = message;
    ui.statusText.hidden = false;
  }
}

function buildAutoPhotoFillToast(result) {
  if (!result) return { message: "Auto Photo Fill completed.", type: "info" };

  if (result.outcome === "no-placeholders") {
    return { message: "Select one or more placeholder layers first.", type: "warning" };
  }
  if (result.outcome === "invalid-placeholders") {
    return { message: "Could not read the selected placeholder layers.", type: "error" };
  }
  if (result.outcome === "cancelled") {
    return { message: "Cancelled.", type: "info" };
  }
  if (result.outcome === "error") {
    return { message: "Auto Photo Fill failed", type: "error" };
  }

  const parts = [];
  const placed = result.placedCount || 0;
  parts.push(`${placed} ${placed === 1 ? "photo" : "photos"} filled`);

  const skippedPhotos = (result.unmatchedPhotos && result.unmatchedPhotos.length) || 0;
  const skippedPlaceholders = (result.unmatchedPlaceholders && result.unmatchedPlaceholders.length) || 0;
  const skippedTotal = skippedPhotos + skippedPlaceholders;
  if (skippedTotal > 0) {
    parts.push(`${skippedTotal} skipped`);
  }

  const failedPhotosCount = (result.failedPhotos && result.failedPhotos.length) || 0;
  if (failedPhotosCount > 0) {
    parts.push(`${failedPhotosCount} failed`);
  }

  const moveFailedCount = (result.moveFailures && result.moveFailures.length) || 0;
  if (moveFailedCount > 0) {
    parts.push(`${moveFailedCount} ${moveFailedCount === 1 ? "move failed" : "moves failed"}`);
  }

  const message = parts.join(" • ");
  const hasFailures = failedPhotosCount > 0 || moveFailedCount > 0;
  const type = hasFailures ? "warning" : "success";

  return { message, type };
}

async function handleAutoPhotoFill() {
  if (running) return;
  running = true;
  if (ui.autoPhotoFillBtn) ui.autoPhotoFillBtn.disabled = true;
  if (ui.swapPhotosBtn) ui.swapPhotosBtn.disabled = true;
  toast.dismiss();

  try {
    const result = await runAutoPhotoFill({
      setStatus: msg => setStatus(msg),
      showDialog: async () => {}
    });
    setStatus(null);
    const summary = buildAutoPhotoFillToast(result);
    toast.show(summary.message, summary.type);
    return result;
  } catch (error) {
    console.error("Auto Photo Fill error:", error);
    setStatus(null);
    toast.show("Auto Photo Fill failed", "error");
    return { outcome: "error", error };
  } finally {
    running = false;
    if (ui.autoPhotoFillBtn) ui.autoPhotoFillBtn.disabled = false;
    if (ui.swapPhotosBtn) ui.swapPhotosBtn.disabled = false;
  }
}

async function handleSwapPhotos() {
  if (running) return;
  running = true;
  if (ui.autoPhotoFillBtn) ui.autoPhotoFillBtn.disabled = true;
  if (ui.swapPhotosBtn) ui.swapPhotosBtn.disabled = true;
  toast.dismiss();
  setStatus("Swapping photos...");

  try {
    const result = await runSwapPhotos();
    setStatus(null);
    if (result.success) {
      toast.show(result.message, "success");
    } else {
      const toastType = result.outcome === "error" ? "error" : "warning";
      toast.show(result.message, toastType);
    }
    return result;
  } catch (error) {
    console.error("Swap Photos error:", error);
    setStatus(null);
    toast.show("Swap failed", "error");
    return { success: false, outcome: "error", error, message: "Swap failed" };
  } finally {
    running = false;
    if (ui.autoPhotoFillBtn) ui.autoPhotoFillBtn.disabled = false;
    if (ui.swapPhotosBtn) ui.swapPhotosBtn.disabled = false;
  }
}

if (ui.autoPhotoFillBtn && typeof ui.autoPhotoFillBtn.addEventListener === "function") {
  ui.autoPhotoFillBtn.addEventListener("click", handleAutoPhotoFill);
}
if (ui.swapPhotosBtn && typeof ui.swapPhotosBtn.addEventListener === "function") {
  ui.swapPhotosBtn.addEventListener("click", handleSwapPhotos);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildAutoPhotoFillToast,
    handleAutoPhotoFill,
    handleSwapPhotos,
    toast,
    ui
  };
}
