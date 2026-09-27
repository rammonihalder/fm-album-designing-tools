"use strict";

const { runOpenPsd, buildOpenPsdToast } = require("./src/tools/openPsd");
const { runAutoPhotoFill } = require("./src/tools/autoPhotoFill");
const { runSwapPhotos } = require("./src/tools/swapPhotos");
const { runFlipPhoto, buildFlipPhotoToast } = require("./src/tools/flipPhoto");
const { runSavePage, buildSavePageToast, isValidPrefix, OUTPUT_MODE_STORAGE_KEY, normalizeOutputMode, getStoredValue: getSavePageStoredValue } = require("./src/tools/savePage");
const { runSaveEditedPhotos, buildSaveEditedPhotosToast } = require("./src/tools/saveEditedPhotos");
const { runSavePsdCategory, buildSavePsdCategoryToast } = require("./src/tools/savePsdCategory");
const { runRemovePhotos, buildRemovePhotosToast } = require("./src/tools/removePhotos");
const { createToastManager } = require("./src/ui/toast");

// Licensing Foundation (Phase 1 - Non-enforcing)
let licenseManager = null;
try {
  const { getLicenseManager } = require("./src/licensing/licenseManager");
  licenseManager = getLicenseManager();
  licenseManager.initialize().catch(err => {
    console.warn("[MM License] Startup initialization non-fatal error:", err?.message || err);
  });
} catch {
  // Test sandboxes that strictly whitelist required modules (e.g. dialog.test.js, removePhotos.test.js)
}

const $ = id => (typeof document !== "undefined" && typeof document.getElementById === "function" ? document.getElementById(id) : null);


const ui = {
  // Action buttons
  openPsdBtn: $("openPsdBtn"),
  autoPhotoFillBtn: $("autoPhotoFillBtn"),
  swapPhotosBtn: $("swapPhotosBtn"),
  flipPhotoBtn: $("flipPhotoBtn"),
  savePageBtn: $("savePageBtn"),
  saveEditedPhotosBtn: $("saveEditedPhotosBtn"),
  savePsdCategoryBtn: $("savePsdCategoryBtn"),
  removePhotosBtn: $("removePhotosBtn"),

  folderBrowserDialog: $("folderBrowserDialog"),
  folderBrowserCurrent: $("folderBrowserCurrent"),
  folderBrowserSelectBtn: $("folderBrowserSelectBtn"),
  folderBrowserOtherBtn: $("folderBrowserOtherBtn"),
  folderBrowserCancelBtn: $("folderBrowserCancelBtn"),

  // Save Page Dialogs
  savePageDialog: $("savePageDialog"),
  prefixInput: $("savePagePrefixInput"),
  formatPsd: $("savePageFormatPsd"),
  formatJpeg: $("savePageFormatJpeg"),
  formatBoth: $("savePageFormatBoth"),
  prefixError: $("savePagePrefixError"),
  dialogSaveBtn: $("savePageDialogSaveBtn"),
  dialogCancelBtn: $("savePageDialogCancelBtn"),


  // Save Edited Photos Dialogs
  deviceDialog: $("editedPhotosDeviceDialog"),
  deviceLaptopBtn: $("editedPhotosDeviceLaptopBtn"),
  deviceDesktopBtn: $("editedPhotosDeviceDesktopBtn"),
  deviceCancelBtn: $("editedPhotosDeviceCancelBtn"),


  // Save PSD Category Dialogs

  savePsdCategoryDeviceDialog: $("savePsdCategoryDeviceDialog"),
  savePsdCategoryDeviceLtBtn: $("savePsdCategoryDeviceLtBtn"),
  savePsdCategoryDevicePcBtn: $("savePsdCategoryDevicePcBtn"),
  savePsdCategoryDeviceCustomBtn: $("savePsdCategoryDeviceCustomBtn"),
  savePsdCategoryDeviceCustomSection: $("savePsdCategoryDeviceCustomSection"),
  savePsdCategoryDeviceCustomInput: $("savePsdCategoryDeviceCustomInput"),
  savePsdCategoryDeviceSaveBtn: $("savePsdCategoryDeviceSaveBtn"),
  savePsdCategoryDeviceCancelBtn: $("savePsdCategoryDeviceCancelBtn"),

  savePsdCategoryMainDialog: $("savePsdCategoryMainDialog"),
  savePsdCategoryDropdown: $("savePsdCategoryDropdown"),
  savePsdCustomNameInput: $("savePsdCustomNameInput"),
  savePsdDeleteCheckbox: $("savePsdDeleteCheckbox"),
  savePsdDeleteWarning: $("savePsdDeleteWarning"),
  savePsdSaveBtn: $("savePsdSaveBtn"),
  savePsdCancelBtn: $("savePsdCancelBtn"),

  savePsdOrientationDialog: $("savePsdOrientationDialog"),
  savePsdLandscapeInput: $("savePsdLandscapeInput"),
  savePsdPortraitInput: $("savePsdPortraitInput"),
  savePsdSquareInput: $("savePsdSquareInput"),
  savePsdOrientationContinueBtn: $("savePsdOrientationContinueBtn"),
  savePsdOrientationCancelBtn: $("savePsdOrientationCancelBtn"),

  savePsdDeleteConfirmDialog: $("savePsdDeleteConfirmDialog"),
  savePsdDeleteConfirmBtn: $("savePsdDeleteConfirmBtn"),
  savePsdDeleteCancelBtn: $("savePsdDeleteCancelBtn"),

  // License Dialog (Phase 1 Foundation)
  licenseDialog: $("licenseDialog"),
  licenseKeyInput: $("licenseKeyInput"),
  licenseActivateBtn: $("licenseActivateBtn"),
  licenseStatusMessage: $("licenseStatusMessage"),
  licenseInfoArea: $("licenseInfoArea"),
  licenseStateLabel: $("licenseStateLabel"),
  licenseDeviceLabel: $("licenseDeviceLabel"),
  licenseDialogCloseBtn: $("licenseDialogCloseBtn"),

  statusText: $("statusText"),
  toast: $("toast")
};

console.log("[MM UI] main.js loaded");

console.log("[MM UI] buttons", {
  openPsd: !!ui.openPsdBtn,
  autoPhotoFill: !!ui.autoPhotoFillBtn,
  swapPhotos: !!ui.swapPhotosBtn,
  flipPhoto: !!ui.flipPhotoBtn,
  savePage: !!ui.savePageBtn,
  saveEditedPhotos: !!ui.saveEditedPhotosBtn,
  savePsdCategory: !!ui.savePsdCategoryBtn,
  removePhotos: !!ui.removePhotosBtn
});

const requiredButtons = [
  ["openPsdBtn", ui.openPsdBtn],
  ["autoPhotoFillBtn", ui.autoPhotoFillBtn],
  ["swapPhotosBtn", ui.swapPhotosBtn],
  ["flipPhotoBtn", ui.flipPhotoBtn],
  ["savePageBtn", ui.savePageBtn],
  ["saveEditedPhotosBtn", ui.saveEditedPhotosBtn],
  ["savePsdCategoryBtn", ui.savePsdCategoryBtn],
  ["removePhotosBtn", ui.removePhotosBtn]
];
for (const [id, btn] of requiredButtons) {
  if (!btn) {
    console.error("[MM UI] Missing button:", id);
  }
}

const toast = createToastManager(ui.toast);
let running = false;

function setButtonsDisabled(disabled) {
  const buttons = [
    ui.openPsdBtn,
    ui.autoPhotoFillBtn,
    ui.swapPhotosBtn,
    ui.flipPhotoBtn,
    ui.savePageBtn,
    ui.saveEditedPhotosBtn,
    ui.savePsdCategoryBtn,
    ui.removePhotosBtn
  ];
  for (const btn of buttons) {
    if (!btn) continue;
    btn.disabled = disabled;
    if (disabled) {
      if (typeof btn.classList?.add === "function") {
        btn.classList.add("is-disabled");
      } else if (typeof btn.className === "string" && !btn.className.includes("is-disabled")) {
        btn.className = (btn.className + " is-disabled").trim();
      }
      if (typeof btn.setAttribute === "function") {
        btn.setAttribute("aria-disabled", "true");
        btn.setAttribute("tabindex", "-1");
      }
    } else {
      if (typeof btn.classList?.remove === "function") {
        btn.classList.remove("is-disabled");
      } else if (typeof btn.className === "string") {
        btn.className = btn.className.replace(/\bis-disabled\b/g, "").trim();
      }
      if (typeof btn.setAttribute === "function") {
        btn.setAttribute("aria-disabled", "false");
        btn.setAttribute("tabindex", "0");
      }
    }
  }
}

function attachActionHandler(element, handler) {
  if (!element || typeof element.addEventListener !== "function") return;

  function isLocked() {
    return running ||
      Boolean(element.disabled) ||
      element.getAttribute?.("aria-disabled") === "true" ||
      Boolean(element.classList?.contains?.("is-disabled")) ||
      (typeof element.className === "string" && element.className.includes("is-disabled"));
  }

  element.addEventListener("click", e => {
    if (isLocked()) {
      e?.preventDefault?.();
      return;
    }
    return handler(e);
  });

  element.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      if (isLocked()) {
        return;
      }
      return handler(e);
    }
  });
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

// -------------------------------------------------------------
// Generic Folder Choice Dialog Helper
// -------------------------------------------------------------
// -------------------------------------------------------------
// Save PSD Category Dialog Helpers
// -------------------------------------------------------------
async function promptForPsdCategoryDevice() {
  const dialog = ui.savePsdCategoryDeviceDialog;
  if (!dialog) return { deviceName: "PC", cancelled: false };

  return new Promise(async resolve => {
    let chosenDevice = null;
    let isCancelled = false;

    if (ui.savePsdCategoryDeviceCustomSection) {
      ui.savePsdCategoryDeviceCustomSection.hidden = true;
    }
    if (ui.savePsdCategoryDeviceCustomInput) {
      ui.savePsdCategoryDeviceCustomInput.value = "";
    }

    function onLt() {
      chosenDevice = "LT";
      if (typeof dialog.close === "function") dialog.close("LT");
    }

    function onPc() {
      chosenDevice = "PC";
      if (typeof dialog.close === "function") dialog.close("PC");
    }

    function onCustomClick() {
      if (ui.savePsdCategoryDeviceCustomSection) {
        ui.savePsdCategoryDeviceCustomSection.hidden = false;
        try { ui.savePsdCategoryDeviceCustomInput?.focus(); } catch (_) {}
      }
    }

    function onSaveCustom() {
      const val = ui.savePsdCategoryDeviceCustomInput ? ui.savePsdCategoryDeviceCustomInput.value : "";
      const cleaned = val.replace(/\s+/g, "").toUpperCase() || "CUSTOM";
      chosenDevice = cleaned;
      if (typeof dialog.close === "function") dialog.close(cleaned);
    }

    function onCancel() {
      isCancelled = true;
      if (typeof dialog.close === "function") dialog.close("cancel");
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && !ui.savePsdCategoryDeviceCustomSection?.hidden) {
        e.preventDefault();
        onSaveCustom();
      }
    }

    ui.savePsdCategoryDeviceLtBtn?.addEventListener("click", onLt);
    ui.savePsdCategoryDevicePcBtn?.addEventListener("click", onPc);
    ui.savePsdCategoryDeviceCustomBtn?.addEventListener("click", onCustomClick);
    ui.savePsdCategoryDeviceSaveBtn?.addEventListener("click", onSaveCustom);
    ui.savePsdCategoryDeviceCancelBtn?.addEventListener("click", onCancel);
    dialog.addEventListener("keydown", onKeyDown);

    try {
      let closeReason;
      if (typeof dialog.uxpShowModal === "function") {
        closeReason = await dialog.uxpShowModal({
          title: "Set Device Name",
          resize: "none",
          size: { width: 320, height: 260 }
        });
      } else if (typeof dialog.showModal === "function") {
        closeReason = await dialog.showModal();
      }

      const res = chosenDevice || (closeReason && closeReason !== "cancel" && closeReason !== "reasonCanceled" ? closeReason : null);
      if (!isCancelled && res) {
        resolve({ deviceName: res, cancelled: false });
      } else {
        resolve({ cancelled: true });
      }
    } catch (err) {
      resolve({ cancelled: true, error: err });
    } finally {
      ui.savePsdCategoryDeviceLtBtn?.removeEventListener("click", onLt);
      ui.savePsdCategoryDevicePcBtn?.removeEventListener("click", onPc);
      ui.savePsdCategoryDeviceCustomBtn?.removeEventListener("click", onCustomClick);
      ui.savePsdCategoryDeviceSaveBtn?.removeEventListener("click", onSaveCustom);
      ui.savePsdCategoryDeviceCancelBtn?.removeEventListener("click", onCancel);
      dialog.removeEventListener("keydown", onKeyDown);
    }
  });
}

async function promptForPsdCategoryOptions({ categories = [], defaultCategory = "3 PHOTOS PSD", deleteOriginal = false } = {}) {
  const dialog = ui.savePsdCategoryMainDialog;
  if (!dialog) {
    return { category: defaultCategory, customName: "", deleteOriginal: false, cancelled: false };
  }

  return new Promise(async resolve => {
    let confirmed = false;

    if (ui.savePsdCategoryDropdown) {
      ui.savePsdCategoryDropdown.value = defaultCategory;
    }
    if (ui.savePsdCustomNameInput) {
      ui.savePsdCustomNameInput.value = "";
    }
    if (ui.savePsdDeleteCheckbox) {
      ui.savePsdDeleteCheckbox.checked = Boolean(deleteOriginal);
    }
    if (ui.savePsdDeleteWarning) {
      ui.savePsdDeleteWarning.hidden = !Boolean(deleteOriginal);
    }

    function onCheckboxChange() {
      if (ui.savePsdDeleteWarning && ui.savePsdDeleteCheckbox) {
        ui.savePsdDeleteWarning.hidden = !ui.savePsdDeleteCheckbox.checked;
      }
    }

    function onSave() {
      confirmed = true;
      if (typeof dialog.close === "function") dialog.close("save");
    }

    function onCancel() {
      if (typeof dialog.close === "function") dialog.close("cancel");
    }

    function onKeyDown(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        onSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }

    ui.savePsdDeleteCheckbox?.addEventListener("change", onCheckboxChange);
    ui.savePsdSaveBtn?.addEventListener("click", onSave);
    ui.savePsdCancelBtn?.addEventListener("click", onCancel);
    dialog.addEventListener("keydown", onKeyDown);

    try {
      let closeReason;
      if (typeof dialog.uxpShowModal === "function") {
        closeReason = await dialog.uxpShowModal({
          title: "Memory Maker - Save PSD",
          resize: "none",
          size: { width: 340, height: 280 }
        });
      } else if (typeof dialog.showModal === "function") {
        closeReason = await dialog.showModal();
      }

      if (confirmed || closeReason === "save") {
        resolve({
          cancelled: false,
          category: ui.savePsdCategoryDropdown ? ui.savePsdCategoryDropdown.value : defaultCategory,
          customName: ui.savePsdCustomNameInput ? ui.savePsdCustomNameInput.value : "",
          deleteOriginal: Boolean(ui.savePsdDeleteCheckbox?.checked)
        });
      } else {
        resolve({ cancelled: true });
      }
    } catch (err) {
      resolve({ cancelled: true, error: err });
    } finally {
      ui.savePsdDeleteCheckbox?.removeEventListener("change", onCheckboxChange);
      ui.savePsdSaveBtn?.removeEventListener("click", onSave);
      ui.savePsdCancelBtn?.removeEventListener("click", onCancel);
      dialog.removeEventListener("keydown", onKeyDown);
    }
  });
}

async function promptForOrientationCheck({ landscapeCount = 0, portraitCount = 0, squareCount = 0 } = {}) {
  const dialog = ui.savePsdOrientationDialog;
  if (!dialog) {
    return { landscapeCount, portraitCount, squareCount, cancelled: false };
  }

  return new Promise(async resolve => {
    let confirmed = false;

    if (ui.savePsdLandscapeInput) ui.savePsdLandscapeInput.value = landscapeCount;
    if (ui.savePsdPortraitInput) ui.savePsdPortraitInput.value = portraitCount;
    if (ui.savePsdSquareInput) ui.savePsdSquareInput.value = squareCount;

    function onContinue() {
      confirmed = true;
      if (typeof dialog.close === "function") dialog.close("continue");
    }

    function onCancel() {
      if (typeof dialog.close === "function") dialog.close("cancel");
    }

    function onKeyDown(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        onContinue();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }

    ui.savePsdOrientationContinueBtn?.addEventListener("click", onContinue);
    ui.savePsdOrientationCancelBtn?.addEventListener("click", onCancel);
    dialog.addEventListener("keydown", onKeyDown);

    try {
      let closeReason;
      if (typeof dialog.uxpShowModal === "function") {
        closeReason = await dialog.uxpShowModal({
          title: "Orientation Check",
          resize: "none",
          size: { width: 320, height: 230 }
        });
      } else if (typeof dialog.showModal === "function") {
        closeReason = await dialog.showModal();
      }

      if (confirmed || closeReason === "continue") {
        resolve({
          cancelled: false,
          landscapeCount: Math.max(0, parseInt(ui.savePsdLandscapeInput?.value, 10) || 0),
          portraitCount: Math.max(0, parseInt(ui.savePsdPortraitInput?.value, 10) || 0),
          squareCount: Math.max(0, parseInt(ui.savePsdSquareInput?.value, 10) || 0)
        });
      } else {
        resolve({ cancelled: true });
      }
    } catch (err) {
      resolve({ cancelled: true, error: err });
    } finally {
      ui.savePsdOrientationContinueBtn?.removeEventListener("click", onContinue);
      ui.savePsdOrientationCancelBtn?.removeEventListener("click", onCancel);
      dialog.removeEventListener("keydown", onKeyDown);
    }
  });
}

async function promptForDeleteConfirmation({ fileName = "", docName = "" } = {}) {
  const dialog = ui.savePsdDeleteConfirmDialog;
  if (!dialog) return { confirmed: false, cancelled: true };

  return new Promise(async resolve => {
    let confirmed = false;

    function onDelete() {
      confirmed = true;
      if (typeof dialog.close === "function") dialog.close("delete");
    }

    function onCancel() {
      if (typeof dialog.close === "function") dialog.close("cancel");
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }

    ui.savePsdDeleteConfirmBtn?.addEventListener("click", onDelete);
    ui.savePsdDeleteCancelBtn?.addEventListener("click", onCancel);
    dialog.addEventListener("keydown", onKeyDown);

    try {
      let closeReason;
      if (typeof dialog.uxpShowModal === "function") {
        closeReason = await dialog.uxpShowModal({
          title: "Delete Original PSD",
          resize: "none",
          size: { width: 330, height: 180 }
        });
      } else if (typeof dialog.showModal === "function") {
        closeReason = await dialog.showModal();
      }

      if (confirmed || closeReason === "delete") {
        resolve({ confirmed: true, cancelled: false });
      } else {
        resolve({ confirmed: false, cancelled: true });
      }
    } catch (err) {
      resolve({ confirmed: false, cancelled: true, error: err });
    } finally {
      ui.savePsdDeleteConfirmBtn?.removeEventListener("click", onDelete);
      ui.savePsdDeleteCancelBtn?.removeEventListener("click", onCancel);
      dialog.removeEventListener("keydown", onKeyDown);
    }
  });
}

// -------------------------------------------------------------
// Tool Handlers
// -------------------------------------------------------------
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

async function handleFlipPhoto() {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  toast.dismiss();

  try {
    const result = await runFlipPhoto();
    const summary = buildFlipPhotoToast(result);
    toast.show(summary.message, summary.type);
    return result;
  } catch (error) {
    console.error("Flip Photo error:", error);
    toast.show("Photo flip failed", "error");
    return { success: false, outcome: "error", error, message: "Photo flip failed" };
  } finally {
    running = false;
    setButtonsDisabled(false);
  }
}

function promptForPrefix({ defaultPrefix = "", defaultOutputMode } = {}) {
  const dialog = ui.savePageDialog;
  if (!dialog) {
    return Promise.resolve({ cancelled: false, prefix: defaultPrefix || "" });
  }

  let confirmedPrefix = null;
  let isCancelled = false;
  let selectedOutputMode = normalizeOutputMode(defaultOutputMode || getSavePageStoredValue(OUTPUT_MODE_STORAGE_KEY));

  if (ui.prefixInput) {
    ui.prefixInput.value = defaultPrefix || "";
  }
  function formatOptions() { return [ui.formatPsd, ui.formatJpeg, ui.formatBoth].filter(Boolean); }
  function setFormatMode(mode) {
    selectedOutputMode = normalizeOutputMode(mode);
    for (const option of formatOptions()) {
      const selected = option.getAttribute?.("data-mode") === selectedOutputMode;
      option.setAttribute?.("aria-pressed", String(selected));
      option.classList?.toggle?.("is-selected", selected);
    }
  }
  setFormatMode(selectedOutputMode);
  if (ui.prefixError) {
    ui.prefixError.hidden = true;
  }

  return new Promise(async resolve => {
    const formatKeyHandlers = new Map();
    let saveSubmitted = false;
    function onSaveClick() {
      if (saveSubmitted || isCancelled) return;
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
      saveSubmitted = true;
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

    function onFormatActivate(event) {
      const mode = event.currentTarget?.getAttribute?.("data-mode");
      if (mode) setFormatMode(mode);
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
    for (const option of formatOptions()) {
      option.addEventListener("click", onFormatActivate);
      const keyHandler = event => {
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
          event.preventDefault(); event.stopPropagation(); onFormatActivate({ currentTarget: option });
        }
      };
      formatKeyHandlers.set(option, keyHandler);
      option.addEventListener("keydown", keyHandler);
    }
    ui.dialogSaveBtn?.addEventListener("keydown", onKeyDown);
    const onCancelKeyDown = event => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault(); event.stopPropagation(); onCancelClick();
      }
    };
    ui.dialogCancelBtn?.addEventListener("keydown", onCancelKeyDown);

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
            height: 240
          }
        });
      } else if (typeof dialog.showModal === "function") {
        closeReason = await dialog.showModal();
      }

      if (closeReason === "save" || (!isCancelled && closeReason !== "cancel" && closeReason !== "reasonCanceled" && confirmedPrefix !== null)) {
        resolve({
          cancelled: false,
          prefix: confirmedPrefix !== null ? confirmedPrefix : (ui.prefixInput ? ui.prefixInput.value : ""),
          outputMode: selectedOutputMode
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
      for (const option of formatOptions()) {
        option.removeEventListener("click", onFormatActivate);
        option.removeEventListener("keydown", formatKeyHandlers.get(option));
      }
      ui.dialogSaveBtn?.removeEventListener("keydown", onKeyDown);
      ui.dialogCancelBtn?.removeEventListener("keydown", onCancelKeyDown);
      if (ui.prefixError) {
        ui.prefixError.hidden = true;
      }
    }
  });
}

async function promptForFolderBrowser({ initialFolder, tool } = {}) {
  const dialog = ui.folderBrowserDialog;
  if (!dialog) return { cancelled: true };
  const { createFolderBrowser } = require("./src/folderBrowser");
  const { storage } = require("uxp");
  let result = null;
  let closeReason = "";
  let resolveClose = null;
  const cleanup = [];

  function close(reason) {
    closeReason = reason;
    dialog.close(reason);
    if (resolveClose) resolveClose(reason);
  }
  function render(state) {
    ui.folderBrowserCurrent.textContent = state.currentFolderPath;
    ui.folderBrowserSelectBtn.setAttribute("aria-disabled", String(!state.canSelect));
    ui.folderBrowserOtherBtn.setAttribute("aria-disabled", String(state.busy));
  }
  const browser = createFolderBrowser({ initialFolder, tool, onChange: render,
    pickOtherLocation: () => storage.localFileSystem.getFolder() });
  function listen(element, event, handler) {
    element.addEventListener(event, handler);
    cleanup.push(() => element.removeEventListener(event, handler));
  }
  function bindButton(element, handler) {
    const activate = () => { if (element.getAttribute("aria-disabled") === "true") return; return handler(); };
    listen(element, "click", activate);
    listen(element, "keydown", event => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault(); event.stopPropagation(); return activate();
      }
    });
  }
  function cancel() { result = browser.cancel(); close("cancel"); }
  bindButton(ui.folderBrowserOtherBtn, () => close("other"));
  bindButton(ui.folderBrowserSelectBtn, () => {
    const selected = browser.select();
    if (selected) { result = selected; close("select"); }
  });
  bindButton(ui.folderBrowserCancelBtn, cancel);
  listen(dialog, "keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
  });
  listen(dialog, "cancel", event => { event.preventDefault(); cancel(); });
  listen(dialog, "close", () => { if (resolveClose) resolveClose(closeReason || "cancel"); });

  try {
    await browser.start();
    while (!result) {
      closeReason = "";
      dialog.hidden = false;
      if (typeof dialog.uxpShowModal === "function") {
        await dialog.uxpShowModal({ title: "Select Save Folder", resize: "none", size: { width: 400, height: 260 } });
      } else {
        await new Promise((resolve, reject) => {
          resolveClose = resolve;
          try {
            const shown = dialog.showModal();
            if (shown && typeof shown.then === "function") shown.then(resolve, reject);
          } catch (error) { reject(error); }
        });
        resolveClose = null;
      }
      dialog.hidden = true;
      if (result) break;
      if (closeReason === "other") {
        // Release the custom dialog before invoking the native picker, then
        // reopen the same confirmation state even when the picker is cancelled.
        await browser.chooseOtherLocation();
      } else result = browser.cancel();
    }
    return result;
  } catch (error) {
    console.error("[FOLDER BROWSER]", { tool, stage: "dialog", errorName: error?.name,
      errorMessage: error?.message, stack: error?.stack });
    return browser.cancel();
  } finally {
    if (!result) browser.cancel();
    dialog.hidden = true;
    for (const remove of cleanup) remove();
  }
}

async function handleSavePage(event) {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  toast.dismiss();

  try {
    const result = await runSavePage({
      promptForPrefix,
      browseFolder: promptForFolderBrowser,
      useRememberedDirectly: Boolean(event?.shiftKey)
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
            height: 240
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

async function handleSaveEditedPhotos(event) {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  toast.dismiss();

  try {
    const result = await runSaveEditedPhotos({
      promptForDeviceType,
      browseFolder: promptForFolderBrowser,
      useRememberedDirectly: Boolean(event?.shiftKey)
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

async function handleSavePsdCategory(event) {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  toast.dismiss();

  try {
    const result = await runSavePsdCategory({
      browseFolder: promptForFolderBrowser,
      useRememberedDirectly: Boolean(event?.shiftKey),
      promptForDeviceName: promptForPsdCategoryDevice,
      promptForCategoryOptions: promptForPsdCategoryOptions,
      promptForOrientationCheck: promptForOrientationCheck,
      promptForDeleteConfirmation: promptForDeleteConfirmation
    });
    const summary = buildSavePsdCategoryToast(result);
    toast.show(summary.message, summary.type);
    return result;
  } catch (error) {
    console.error("Save PSD Category error:", error);
    toast.show("PSD save failed", "error");
    return { outcome: "error", error };
  } finally {
    running = false;
    setButtonsDisabled(false);
  }
}

async function handleRemovePhotos() {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  toast.dismiss();

  try {
    const result = await runRemovePhotos();
    const summary = buildRemovePhotosToast(result);
    toast.show(summary.message, summary.type);
    return result;
  } catch (error) {
    console.error("Remove Photos error:", error);
    toast.show("Photo removal failed", "error");
    return { outcome: "error", error };
  } finally {
    running = false;
    setButtonsDisabled(false);
  }
}

// Attach action handlers (click + Enter/Space)
attachActionHandler(ui.openPsdBtn, handleOpenPsd);
attachActionHandler(ui.autoPhotoFillBtn, handleAutoPhotoFill);
attachActionHandler(ui.swapPhotosBtn, handleSwapPhotos);
attachActionHandler(ui.flipPhotoBtn, handleFlipPhoto);
attachActionHandler(ui.savePageBtn, handleSavePage);
attachActionHandler(ui.saveEditedPhotosBtn, handleSaveEditedPhotos);
attachActionHandler(ui.savePsdCategoryBtn, handleSavePsdCategory);
attachActionHandler(ui.removePhotosBtn, handleRemovePhotos);

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    buildAutoPhotoFillToast,
    buildOpenPsdToast,
    buildFlipPhotoToast,
    buildSavePageToast,
    buildSaveEditedPhotosToast,
    buildSavePsdCategoryToast,
    buildRemovePhotosToast,
    handleOpenPsd,
    handleAutoPhotoFill,
    handleSwapPhotos,
    handleFlipPhoto,
    handleSavePage,
    handleSaveEditedPhotos,
    handleSavePsdCategory,
    handleRemovePhotos,
    promptForPrefix,
    promptForFolderBrowser,
    promptForDeviceType,
    promptForPsdCategoryDevice,
    promptForPsdCategoryOptions,
    promptForOrientationCheck,
    promptForDeleteConfirmation,
    setButtonsDisabled,
    attachActionHandler,
    toast,
    ui,
    licenseManager
  };
}
