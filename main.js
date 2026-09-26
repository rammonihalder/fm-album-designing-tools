"use strict";

const { runOpenPsd, buildOpenPsdToast } = require("./src/tools/openPsd");
const { runAutoPhotoFill } = require("./src/tools/autoPhotoFill");
const { runSwapPhotos } = require("./src/tools/swapPhotos");
const { runSavePage, buildSavePageToast, isValidPrefix } = require("./src/tools/savePage");
const { runSaveEditedPhotos, buildSaveEditedPhotosToast } = require("./src/tools/saveEditedPhotos");
const { createToastManager } = require("./src/ui/toast");

const $ = id => (typeof document !== "undefined" && typeof document.getElementById === "function" ? document.getElementById(id) : null);

const ui = {
  openPsdBtn: $("openPsdBtn"),
  autoPhotoFillBtn: $("autoPhotoFillBtn"),
  swapPhotosBtn: $("swapPhotosBtn"),
  savePageBtn: $("savePageBtn"),
  saveEditedPhotosBtn: $("saveEditedPhotosBtn"),
  savePageDialog: $("savePageDialog"),
  prefixInput: $("savePagePrefixInput"),
  prefixError: $("savePagePrefixError"),
  dialogSaveBtn: $("savePageDialogSaveBtn"),
  dialogCancelBtn: $("savePageDialogCancelBtn"),
  deviceDialog: $("editedPhotosDeviceDialog"),
  deviceLaptopBtn: $("editedPhotosDeviceLaptopBtn"),
  deviceDesktopBtn: $("editedPhotosDeviceDesktopBtn"),
  deviceCancelBtn: $("editedPhotosDeviceCancelBtn"),
  statusText: $("statusText"),
  toast: $("toast")
};

const toast = createToastManager(ui.toast);
let running = false;

function setButtonsDisabled(disabled) {
  if (ui.openPsdBtn) ui.openPsdBtn.disabled = disabled;
  if (ui.autoPhotoFillBtn) ui.autoPhotoFillBtn.disabled = disabled;
  if (ui.swapPhotosBtn) ui.swapPhotosBtn.disabled = disabled;
  if (ui.savePageBtn) ui.savePageBtn.disabled = disabled;
  if (ui.saveEditedPhotosBtn) ui.saveEditedPhotosBtn.disabled = disabled;
}

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

async function handleOpenPsd() {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  toast.dismiss();

  try {
    const result = await runOpenPsd({
      onProgress: (current, total) => {
        setStatus(`Opening PSD ${current} of ${total}...`);
      }
    });
    setStatus(null);
    const summary = buildOpenPsdToast(result);
    toast.show(summary.message, summary.type);
    return result;
  } catch (error) {
    console.error("Open PSD error:", error);
    setStatus(null);
    toast.show("Open PSD failed", "error");
    return { outcome: "error", successCount: 0, failureCount: 1, error };
  } finally {
    running = false;
    setButtonsDisabled(false);
  }
}

async function handleAutoPhotoFill() {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
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
    setButtonsDisabled(false);
  }
}

async function handleSwapPhotos() {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
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
    setButtonsDisabled(false);
  }
}

function promptForPrefix({ defaultPrefix = "" } = {}) {
  const dialog = ui.savePageDialog;
  if (!dialog) {
    return Promise.resolve({ cancelled: false, prefix: defaultPrefix || "" });
  }

  let confirmedPrefix = null;
  let isCancelled = false;

  if (ui.prefixInput) {
    ui.prefixInput.value = defaultPrefix || "";
  }
  if (ui.prefixError) {
    ui.prefixError.hidden = true;
  }

  return new Promise(async resolve => {
    function onSaveClick() {
      const val = ui.prefixInput ? ui.prefixInput.value : "";
      if (!isValidPrefix(val)) {
        if (ui.prefixError) {
          ui.prefixError.hidden = false;
        }
        toast.show("Invalid prefix", "error");
        try { ui.prefixInput?.focus(); } catch (_) {}
        return;
      }
      if (ui.prefixError) {
        ui.prefixError.hidden = true;
      }
      confirmedPrefix = val;
      if (typeof dialog.close === "function") {
        dialog.close("save");
      }
    }

    function onCancelClick() {
      isCancelled = true;
      if (typeof dialog.close === "function") {
        dialog.close("cancel");
      }
    }

    function onKeyDown(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        onSaveClick();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancelClick();
      }
    }

    ui.dialogSaveBtn?.addEventListener("click", onSaveClick);
    ui.dialogCancelBtn?.addEventListener("click", onCancelClick);
    ui.prefixInput?.addEventListener("keydown", onKeyDown);

    try {
      setTimeout(() => {
        try {
          ui.prefixInput?.focus();
        } catch (_) {}
      }, 20);

      let closeReason;
      if (typeof dialog.uxpShowModal === "function") {
        closeReason = await dialog.uxpShowModal({
          title: "Save Page",
          resize: "none",
          size: {
            width: 340,
            height: 200
          }
        });
      } else if (typeof dialog.showModal === "function") {
        closeReason = await dialog.showModal();
      }

      if (closeReason === "save" || (!isCancelled && closeReason !== "cancel" && closeReason !== "reasonCanceled" && confirmedPrefix !== null)) {
        resolve({
          cancelled: false,
          prefix: confirmedPrefix !== null ? confirmedPrefix : (ui.prefixInput ? ui.prefixInput.value : "")
        });
      } else {
        resolve({ cancelled: true });
      }
    } catch (err) {
      resolve({ cancelled: true, error: err });
    } finally {
      ui.dialogSaveBtn?.removeEventListener("click", onSaveClick);
      ui.dialogCancelBtn?.removeEventListener("click", onCancelClick);
      ui.prefixInput?.removeEventListener("keydown", onKeyDown);
      if (ui.prefixError) {
        ui.prefixError.hidden = true;
      }
    }
  });
}

async function handleSavePage() {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  toast.dismiss();

  try {
    const result = await runSavePage({
      promptForPrefix
    });

    const summary = buildSavePageToast(result);
    toast.show(summary.message, summary.type);
    return result;
  } catch (error) {
    console.error("Save Page error:", error);
    toast.show("Save Page failed", "error");
    return { outcome: "error", error };
  } finally {
    running = false;
    setButtonsDisabled(false);
  }
}

async function promptForDeviceType() {
  const dialog = ui.deviceDialog;
  if (!dialog) {
    return { cancelled: true };
  }

  return new Promise(async resolve => {
    let chosenDevice = null;
    let isCancelled = false;

    function onLaptopClick() {
      chosenDevice = "LT";
      if (typeof dialog.close === "function") {
        dialog.close("LT");
      }
    }

    function onDesktopClick() {
      chosenDevice = "DT";
      if (typeof dialog.close === "function") {
        dialog.close("DT");
      }
    }

    function onCancelClick() {
      isCancelled = true;
      if (typeof dialog.close === "function") {
        dialog.close("cancel");
      }
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancelClick();
      }
    }

    ui.deviceLaptopBtn?.addEventListener("click", onLaptopClick);
    ui.deviceDesktopBtn?.addEventListener("click", onDesktopClick);
    ui.deviceCancelBtn?.addEventListener("click", onCancelClick);
    dialog.addEventListener("keydown", onKeyDown);

    try {
      let closeReason;
      if (typeof dialog.uxpShowModal === "function") {
        closeReason = await dialog.uxpShowModal({
          title: "Computer Type",
          resize: "none",
          size: {
            width: 320,
            height: 200
          }
        });
      } else if (typeof dialog.showModal === "function") {
        closeReason = await dialog.showModal();
      }

      const res = chosenDevice || (closeReason === "LT" || closeReason === "DT" ? closeReason : null);
      if (!isCancelled && res && (res === "LT" || res === "DT")) {
        resolve({ cancelled: false, deviceType: res });
      } else {
        resolve({ cancelled: true });
      }
    } catch (err) {
      resolve({ cancelled: true, error: err });
    } finally {
      ui.deviceLaptopBtn?.removeEventListener("click", onLaptopClick);
      ui.deviceDesktopBtn?.removeEventListener("click", onDesktopClick);
      ui.deviceCancelBtn?.removeEventListener("click", onCancelClick);
      dialog.removeEventListener("keydown", onKeyDown);
    }
  });
}

async function handleSaveEditedPhotos() {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  toast.dismiss();

  try {
    const result = await runSaveEditedPhotos({
      promptForDeviceType
    });
    const summary = buildSaveEditedPhotosToast(result);
    toast.show(summary.message, summary.type);
    return result;
  } catch (error) {
    console.error("Save Edited Photos error:", error);
    toast.show("Edited photo export failed", "error");
    return { outcome: "error", error };
  } finally {
    running = false;
    setButtonsDisabled(false);
  }
}

if (ui.openPsdBtn && typeof ui.openPsdBtn.addEventListener === "function") {
  ui.openPsdBtn.addEventListener("click", handleOpenPsd);
}
if (ui.autoPhotoFillBtn && typeof ui.autoPhotoFillBtn.addEventListener === "function") {
  ui.autoPhotoFillBtn.addEventListener("click", handleAutoPhotoFill);
}
if (ui.swapPhotosBtn && typeof ui.swapPhotosBtn.addEventListener === "function") {
  ui.swapPhotosBtn.addEventListener("click", handleSwapPhotos);
}
if (ui.savePageBtn && typeof ui.savePageBtn.addEventListener === "function") {
  ui.savePageBtn.addEventListener("click", handleSavePage);
}
if (ui.saveEditedPhotosBtn && typeof ui.saveEditedPhotosBtn.addEventListener === "function") {
  ui.saveEditedPhotosBtn.addEventListener("click", handleSaveEditedPhotos);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildAutoPhotoFillToast,
    buildOpenPsdToast,
    buildSavePageToast,
    buildSaveEditedPhotosToast,
    handleOpenPsd,
    handleAutoPhotoFill,
    handleSwapPhotos,
    handleSavePage,
    handleSaveEditedPhotos,
    promptForPrefix,
    promptForDeviceType,
    setButtonsDisabled,
    toast,
    ui
  };
}

