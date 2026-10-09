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

// Production Licensing Runtime
let licenseManager = null;
let licensingConstants = {};
try {
  licensingConstants = require("./src/licensing/constants");
} catch {}
const {
  ADMIN_CONTACT_DISPLAY = "7001514367",
  ADMIN_CONTACT_E164 = "917001514367",
  ADMIN_WHATSAPP_MESSAGE = "I want to buy a license for FM Album Designing Tools.",
  getAdminWhatsAppUrl = () => `https://wa.me/917001514367?text=${encodeURIComponent("I want to buy a license for FM Album Designing Tools.")}`
} = licensingConstants;

try {
  const { getLicenseManager } = require("./src/licensing/licenseManager");
  licenseManager = getLicenseManager();
  licenseManager.initialize().then(() => {
    if (typeof updateBottomLicenseStatusUI === "function") {
      updateBottomLicenseStatusUI();
    }
  }).catch(err => {
    console.error("[FM License] Startup initialization non-fatal error:", err?.message || err);
    if (typeof updateBottomLicenseStatusUI === "function") {
      updateBottomLicenseStatusUI();
    }
  });
} catch (err) {
  console.error("[FM License] Failed to load licensing runtime:", err?.message || err);
  licenseManager = null;
}

const $ = id => (typeof document !== "undefined" && typeof document.getElementById === "function" ? document.getElementById(id) : null);


const ui = {
  // Create Album / Create Page
  createPageBtn: $("createPageBtn"),
  createPagePresetPanel: $("createPagePresetPanel"),
  createAlbum12x36Btn: $("createAlbum12x36Btn"),
  createAlbum12x18Btn: $("createAlbum12x18Btn"),
  createInstagramBtn: $("createInstagramBtn"),
  createFacebookBtn: $("createFacebookBtn"),
  createYouTubeBtn: $("createYouTubeBtn"),
  createCustomBtn: $("createCustomBtn"),

  createCustomPageDialog: $("createCustomPageDialog"),
  createCustomWidthInput: $("createCustomWidthInput"),
  createCustomHeightInput: $("createCustomHeightInput"),
  createCustomUnitSelect: $("createCustomUnitSelect"),
  createCustomBackgroundSelect: $("createCustomBackgroundSelect"),
  createCustomPageError: $("createCustomPageError"),
  createCustomPageCreateBtn: $("createCustomPageCreateBtn"),
  createCustomPageCancelBtn: $("createCustomPageCancelBtn"),

  // Action buttons
  openPsdBtn: $("openPsdBtn"),
  autoPhotoFillBtn: $("autoPhotoFillBtn"),
  swapPhotosBtn: $("swapPhotosBtn"),
  flipPhotoBtn: $("flipPhotoBtn"),
  savePageBtn: $("savePageBtn"),
  saveEditedPhotosBtn: $("saveEditedPhotosBtn"),
  savePsdCategoryBtn: $("savePsdCategoryBtn"),
  removePhotosBtn: $("removePhotosBtn"),
  addFrameBtn: $("addFrameBtn"),
  saveFrameBtn: $("saveFrameBtn"),
  addAssetBtn: $("addAssetBtn"),
  saveAssetBtn: $("saveAssetBtn"),
  pngMaskBtn: $("pngMaskBtn"),
  pngTextBtn: $("pngTextBtn"),
  clipArtBtn: $("clipArtBtn"),
  changeBackgroundBtn: $("changeBackgroundBtn"),

  // ADD FRAME root configuration dialog
  addFrameDialog: $("addFrameDialog"),
  addFrameFolderPath: $("addFrameFolderPath"),
  addFrameMessage: $("addFrameMessage"),
  addFrameFolderBtn: $("addFrameFolderBtn"),
  addFrameSelectBtn: $("addFrameSelectBtn"),
  addFrameCancelBtn: $("addFrameCancelBtn"),

  // Shared PNG asset configuration dialog
  assetDialog: $("assetDialog"),
  assetDialogTitle: $("assetDialogTitle"),
  assetFolderPath: $("assetFolderPath"),
  assetMessage: $("assetMessage"),
  assetFolderBtn: $("assetFolderBtn"),
  assetSelectBtn: $("assetSelectBtn"),
  assetCancelBtn: $("assetCancelBtn"),

  // SAVE FRAME library / photo-count dialog
  saveFrameDialog: $("saveFrameDialog"),
  saveFrameFolderPath: $("saveFrameFolderPath"),
  saveFramePhotoCount: $("saveFramePhotoCount"),
  saveFrameMessage: $("saveFrameMessage"),
  saveFrameFolderBtn: $("saveFrameFolderBtn"),
  saveFrameSaveBtn: $("saveFrameSaveBtn"),
  saveFrameCancelBtn: $("saveFrameCancelBtn"),

  // ADD ASSET Dialog
  addAssetDialog: $("addAssetDialog"),
  addAssetFolderPath: $("addAssetFolderPath"),
  addAssetCategorySelect: $("addAssetCategorySelect"),
  addAssetMessage: $("addAssetMessage"),
  addAssetFolderBtn: $("addAssetFolderBtn"),
  addAssetSelectBtn: $("addAssetSelectBtn"),
  addAssetCancelBtn: $("addAssetCancelBtn"),

  // SAVE ASSET Dialog
  saveAssetDialog: $("saveAssetDialog"),
  saveAssetFolderPath: $("saveAssetFolderPath"),
  saveAssetCategorySelect: $("saveAssetCategorySelect"),
  saveAssetMessage: $("saveAssetMessage"),
  saveAssetFolderBtn: $("saveAssetFolderBtn"),
  saveAssetSaveBtn: $("saveAssetSaveBtn"),
  saveAssetCancelBtn: $("saveAssetCancelBtn"),

  // CHANGE BACKGROUND Dialog
  changeBackgroundDialog: $("changeBackgroundDialog"),
  changeBackgroundFolderPath: $("changeBackgroundFolderPath"),
  changeBackgroundMessage: $("changeBackgroundMessage"),
  changeBackgroundFolderBtn: $("changeBackgroundFolderBtn"),
  changeBackgroundSelectBtn: $("changeBackgroundSelectBtn"),
  changeBackgroundCancelBtn: $("changeBackgroundCancelBtn"),

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

  saveResultDialog: $("saveResultDialog"),
  saveResultIcon: $("saveResultIcon"),
  saveResultTitle: $("saveResultTitle"),
  saveResultFormat: $("saveResultFormat"),
  saveResultPath: $("saveResultPath"),
  saveResultReason: $("saveResultReason"),


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

  // License Dialog & Management UI
  licenseDialog: $("licenseDialog"),
  licenseActivationForm: $("licenseActivationForm"),
  licenseKeyInput: $("licenseKeyInput"),
  licenseActivateBtn: $("licenseActivateBtn"),
  licenseStartTrialBtn: $("licenseStartTrialBtn"),
  licenseOrDivider: $("licenseOrDivider"),
  licenseDeactivateBtn: $("licenseDeactivateBtn"),
  licenseStatusMessage: $("licenseStatusMessage"),
  licenseInfoArea: $("licenseInfoArea"),
  licenseStateLabel: $("licenseStateLabel"),
  licensePlanRow: $("licensePlanRow"),
  licensePlanLabel: $("licensePlanLabel"),
  licenseDeviceLabel: $("licenseDeviceLabel"),
  licenseNextRefreshRow: $("licenseNextRefreshRow"),
  licenseNextRefreshLabel: $("licenseNextRefreshLabel"),
  licenseTrialEndsRow: $("licenseTrialEndsRow"),
  licenseTrialEndsLabel: $("licenseTrialEndsLabel"),
  licenseDaysRemainingRow: $("licenseDaysRemainingRow"),
  licenseDaysRemainingLabel: $("licenseDaysRemainingLabel"),
  licenseDialogCloseBtn: $("licenseDialogCloseBtn"),
  manageLicenseBtn: $("manageLicenseBtn"),
  bottomLicenseStatus: $("bottomLicenseStatus"),

  licenseContactAdminArea: $("licenseContactAdminArea"),
  licenseContactAdminTitle: $("licenseContactAdminTitle"),
  licenseContactAdminText: $("licenseContactAdminText"),
  licenseAdminPhoneDisplay: $("licenseAdminPhoneDisplay"),
  licenseContactAdminBtn: $("licenseContactAdminBtn"),
  licenseContactError: $("licenseContactError"),

  licenseBuyArea: $("licenseBuyArea"),
  licenseBuyTitle: $("licenseBuyTitle"),
  licenseBuyText: $("licenseBuyText"),
  licenseBuyPhoneDisplay: $("licenseBuyPhoneDisplay"),
  licenseBuyBtn: $("licenseBuyBtn"),
  licenseBuyContactError: $("licenseBuyContactError"),
  licenseAlreadyHaveKeySection: $("licenseAlreadyHaveKeySection"),

  statusText: $("statusText"),
  toast: $("toast")
};


console.log("[FM UI] main.js loaded");

console.log("[FM UI] buttons", {
  createPage: !!ui.createPageBtn,
  openPsd: !!ui.openPsdBtn,
  autoPhotoFill: !!ui.autoPhotoFillBtn,
  swapPhotos: !!ui.swapPhotosBtn,
  flipPhoto: !!ui.flipPhotoBtn,
  savePage: !!ui.savePageBtn,
  saveEditedPhotos: !!ui.saveEditedPhotosBtn,
  savePsdCategory: !!ui.savePsdCategoryBtn,
  removePhotos: !!ui.removePhotosBtn,
  addFrame: !!ui.addFrameBtn,
  saveFrame: !!ui.saveFrameBtn,
  addAsset: !!ui.addAssetBtn,
  saveAsset: !!ui.saveAssetBtn,
  pngMask: !!ui.pngMaskBtn,
  pngText: !!ui.pngTextBtn,
  clipArt: !!ui.clipArtBtn,
  changeBackground: !!ui.changeBackgroundBtn
});

const requiredButtons = [
  ["createPageBtn", ui.createPageBtn],
  ["createAlbum12x36Btn", ui.createAlbum12x36Btn],
  ["createAlbum12x18Btn", ui.createAlbum12x18Btn],
  ["createInstagramBtn", ui.createInstagramBtn],
  ["createFacebookBtn", ui.createFacebookBtn],
  ["createYouTubeBtn", ui.createYouTubeBtn],
  ["createCustomBtn", ui.createCustomBtn],
  ["openPsdBtn", ui.openPsdBtn],
  ["autoPhotoFillBtn", ui.autoPhotoFillBtn],
  ["swapPhotosBtn", ui.swapPhotosBtn],
  ["flipPhotoBtn", ui.flipPhotoBtn],
  ["savePageBtn", ui.savePageBtn],
  ["saveEditedPhotosBtn", ui.saveEditedPhotosBtn],
  ["savePsdCategoryBtn", ui.savePsdCategoryBtn],
  ["removePhotosBtn", ui.removePhotosBtn],
  ["addFrameBtn", ui.addFrameBtn],
  ["saveFrameBtn", ui.saveFrameBtn],
  ["addAssetBtn", ui.addAssetBtn],
  ["saveAssetBtn", ui.saveAssetBtn],
  ["pngMaskBtn", ui.pngMaskBtn],
  ["pngTextBtn", ui.pngTextBtn],
  ["clipArtBtn", ui.clipArtBtn],
  ["changeBackgroundBtn", ui.changeBackgroundBtn]
];
for (const [id, btn] of requiredButtons) {
  if (!btn) {
    console.error("[FM UI] Missing button:", id);
  }
}

const toast = createToastManager(ui.toast);
let running = false;

function setButtonsDisabled(disabled) {
  const buttons = [
    ui.createPageBtn,
    ui.createAlbum12x36Btn,
    ui.createAlbum12x18Btn,
    ui.createInstagramBtn,
    ui.createFacebookBtn,
    ui.createYouTubeBtn,
    ui.createCustomBtn,
    ui.openPsdBtn,
    ui.autoPhotoFillBtn,
    ui.swapPhotosBtn,
    ui.flipPhotoBtn,
    ui.savePageBtn,
    ui.saveEditedPhotosBtn,
    ui.savePsdCategoryBtn,
    ui.removePhotosBtn,
    ui.addFrameBtn,
    ui.saveFrameBtn,
    ui.addAssetBtn,
    ui.saveAssetBtn,
    ui.pngMaskBtn,
    ui.pngTextBtn,
    ui.clipArtBtn,
    ui.changeBackgroundBtn
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
          title: "Frame Mitra - Save PSD",
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
// Create Album / Create Page
// -------------------------------------------------------------
function toggleCreatePagePanel() {
  if (!ui.createPagePresetPanel || !ui.createPageBtn) return { outcome: "unavailable" };
  const willOpen = Boolean(ui.createPagePresetPanel.hidden);
  ui.createPagePresetPanel.hidden = !willOpen;
  ui.createPageBtn.setAttribute?.("aria-expanded", String(willOpen));
  return { outcome: "success", open: willOpen };
}

function promptForCustomPageOptions() {
  const dialog = ui.createCustomPageDialog;
  if (!dialog) {
    return Promise.resolve({ cancelled: false, width: 12, height: 12, unit: "in", background: "white" });
  }

  if (ui.createCustomWidthInput) ui.createCustomWidthInput.value = "12";
  if (ui.createCustomHeightInput) ui.createCustomHeightInput.value = "12";
  if (ui.createCustomUnitSelect) ui.createCustomUnitSelect.value = "in";
  if (ui.createCustomBackgroundSelect) ui.createCustomBackgroundSelect.value = "white";
  if (ui.createCustomPageError) {
    ui.createCustomPageError.hidden = true;
    ui.createCustomPageError.textContent = "";
  }

  return new Promise(async resolve => {
    let confirmed = false;
    let cancelled = false;

    function readAndValidate() {
      const width = Number(ui.createCustomWidthInput?.value);
      const height = Number(ui.createCustomHeightInput?.value);
      const unit = ui.createCustomUnitSelect?.value === "px" ? "px" : "in";
      const background = ui.createCustomBackgroundSelect?.value || "white";

      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        if (ui.createCustomPageError) {
          ui.createCustomPageError.textContent = "Enter a valid width and height.";
          ui.createCustomPageError.hidden = false;
        }
        return null;
      }

      const widthPx = unit === "in" ? width * 300 : width;
      const heightPx = unit === "in" ? height * 300 : height;
      if (widthPx > 300000 || heightPx > 300000) {
        if (ui.createCustomPageError) {
          ui.createCustomPageError.textContent = "Page size is too large for Photoshop.";
          ui.createCustomPageError.hidden = false;
        }
        return null;
      }

      if (ui.createCustomPageError) {
        ui.createCustomPageError.hidden = true;
        ui.createCustomPageError.textContent = "";
      }
      return { width, height, unit, background };
    }

    function onCreate() {
      const options = readAndValidate();
      if (!options) return;
      confirmed = options;
      dialog.close?.("create");
    }

    function onCancel() {
      cancelled = true;
      dialog.close?.("cancel");
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (event.key === "Enter") {
        event.preventDefault();
        onCreate();
      }
    }

    ui.createCustomPageCreateBtn?.addEventListener("click", onCreate);
    ui.createCustomPageCancelBtn?.addEventListener("click", onCancel);
    dialog.addEventListener("keydown", onKeyDown);

    try {
      let closeReason;
      if (typeof dialog.uxpShowModal === "function") {
        closeReason = await dialog.uxpShowModal({
          title: "Create Custom Page",
          resize: "none",
          size: { width: 340, height: 390 }
        });
      } else if (typeof dialog.showModal === "function") {
        closeReason = await dialog.showModal();
      }

      if (!cancelled && (confirmed || closeReason === "create")) {
        resolve({ cancelled: false, ...(confirmed || readAndValidate()) });
      } else {
        resolve({ cancelled: true });
      }
    } catch (error) {
      resolve({ cancelled: true, error });
    } finally {
      ui.createCustomPageCreateBtn?.removeEventListener("click", onCreate);
      ui.createCustomPageCancelBtn?.removeEventListener("click", onCancel);
      dialog.removeEventListener("keydown", onKeyDown);
      if (ui.createCustomPageError) {
        ui.createCustomPageError.hidden = true;
        ui.createCustomPageError.textContent = "";
      }
    }
  });
}

async function handleCreatePagePreset(presetId) {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  toast.dismiss();

  try {
    let customOptions;
    if (presetId === "custom") {
      const customResult = await promptForCustomPageOptions();
      if (customResult.cancelled) {
        return { outcome: "cancelled" };
      }
      customOptions = customResult;
    }

    setStatus("Creating page...");
    const { runCreatePage, buildCreatePageToast } = require("./src/tools/createPage");
    const result = await runCreatePage({ presetId, customOptions });
    setStatus(null);
    const summary = buildCreatePageToast(result);
    toast.show(summary.message, summary.type);
    return result;
  } catch (error) {
    console.error("Create Page error:", error);
    setStatus(null);
    toast.show("Create Page failed", "error");
    return { outcome: "error", success: false, error };
  } finally {
    running = false;
    setButtonsDisabled(false);
  }
}

// -------------------------------------------------------------
// Add Frame Dialog & Handler
// -------------------------------------------------------------
async function promptForAddFrameDialog({ folder = null, folderPath = "", message = "" } = {}) {
  const dialog = ui.addFrameDialog;
  if (!dialog) return { action: "cancel" };
  const hasFolder = Boolean(folder);
  ui.addFrameFolderPath.textContent = hasFolder ? folderPath || folder.nativePath || folder.name : "No frame folder selected";
  ui.addFrameFolderPath.setAttribute("title", hasFolder ? ui.addFrameFolderPath.textContent : "");
  ui.addFrameMessage.textContent = message;
  ui.addFrameMessage.hidden = !message;
  ui.addFrameFolderBtn.textContent = hasFolder ? "CHANGE FOLDER" : "SET FOLDER";
  ui.addFrameSelectBtn.disabled = !hasFolder;
  ui.addFrameSelectBtn.setAttribute("aria-disabled", String(!hasFolder));
  const cleanup = [];
  let closed = false, chosenAction = "cancel", resolveClose;
  const closePromise = new Promise(resolve => { resolveClose = resolve; });
  function listen(element, event, handler) {
    element.addEventListener(event, handler);
    cleanup.push(() => element.removeEventListener(event, handler));
  }
  function close(action) {
    if (closed) return;
    closed = true; chosenAction = action;
    try { dialog.close(action); } finally { resolveClose(); }
  }
  function bindButton(element, action) {
    const activate = () => { if (!element.disabled) close(action); };
    listen(element, "click", activate);
    listen(element, "keydown", event => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault(); event.stopPropagation(); activate();
      }
    });
  }
  bindButton(ui.addFrameFolderBtn, hasFolder ? "change-folder" : "set-folder");
  bindButton(ui.addFrameSelectBtn, "select");
  bindButton(ui.addFrameCancelBtn, "cancel");
  listen(dialog, "keydown", event => { if (event.key === "Escape") { event.preventDefault(); close("cancel"); } });
  listen(dialog, "cancel", event => { event.preventDefault(); close("cancel"); });
  listen(dialog, "close", () => { closed = true; resolveClose(); });
  try {
    dialog.hidden = false;
    let shown;
    if (typeof dialog.uxpShowModal === "function") {
      shown = dialog.uxpShowModal({ title: "Add Frame", resize: "none", size: { width: 360, height: message ? 350 : 300 } });
    } else if (typeof dialog.showModal === "function") shown = dialog.showModal();
    else throw new Error("ADD FRAME dialog API is not available.");
    (hasFolder ? ui.addFrameSelectBtn : ui.addFrameFolderBtn).focus?.();
    if (shown && typeof shown.then === "function") await shown;
    else await closePromise;
    return { action: chosenAction };
  } finally {
    dialog.hidden = true;
    for (const remove of cleanup) remove();
  }
}
async function handleAddFrame() {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  toast.dismiss();

  try {
    let uxp = null;
    try {
      uxp = require("uxp");
    } catch (_) {}

    let photoshop = null;
    try {
      photoshop = require("photoshop");
    } catch (_) {}

    const localFileSystem = uxp?.storage?.localFileSystem || null;
    const storage = typeof localStorage !== "undefined" ? localStorage : null;

    const { runAddFrame, buildAddFrameToast } = require("./src/tools/addFrame");
    const result = await runAddFrame({
      promptForFolder: async () => {
        if (!localFileSystem || typeof localFileSystem.getFolder !== "function") {
          throw new Error("Folder selection API is not available.");
        }
        return localFileSystem.getFolder();
      },
      showAddFrameDialog: promptForAddFrameDialog,
      onResult: result => {
        const summary = buildAddFrameToast(result);
        if (summary?.message) toast.show(summary.message, summary.type);
      },
      photoshop,
      localFileSystem,
      storage
    });

    if (result && result.outcome !== "cancelled") {
      const summary = buildAddFrameToast(result);
      if (summary?.message) {
        toast.show(summary.message, summary.type);
      }
    }
    return result;
  } catch (error) {
    console.error("Add Frame error:", error);
    toast.show(error?.message || "Add Frame failed", "error");
    return { outcome: "error", success: false, error };
  } finally {
    running = false;
    setButtonsDisabled(false);
  }
}

// -------------------------------------------------------------
// Tool Handlers
// -------------------------------------------------------------
async function promptForAssetDialog({ config, folder = null, folderPath = "", message = "" } = {}) {
  const dialog = ui.assetDialog;
  if (!dialog) return { action: "cancel" };
  const hasFolder = Boolean(folder);
  ui.assetDialogTitle.textContent = config.title;
  ui.assetFolderPath.textContent = hasFolder ? folderPath || folder.nativePath || folder.name : "No folder selected";
  ui.assetFolderPath.setAttribute("title", hasFolder ? ui.assetFolderPath.textContent : "");
  ui.assetMessage.textContent = message; ui.assetMessage.hidden = !message;
  ui.assetFolderBtn.textContent = hasFolder ? "CHANGE FOLDER" : "SET FOLDER";
  ui.assetSelectBtn.textContent = config.selectLabel;
  ui.assetSelectBtn.disabled = !hasFolder;
  ui.assetSelectBtn.setAttribute("aria-disabled", String(!hasFolder));
  const cleanup = [];
  let closed = false, chosenAction = "cancel", resolveClose;
  const closePromise = new Promise(resolve => { resolveClose = resolve; });
  function listen(element, event, handler) {
    element.addEventListener(event, handler); cleanup.push(() => element.removeEventListener(event, handler));
  }
  function close(action) {
    if (closed) return;
    closed = true; chosenAction = action;
    try { dialog.close(action); } finally { resolveClose(); }
  }
  function bindButton(element, action) {
    const activate = () => { if (!element.disabled) close(action); };
    listen(element, "click", activate);
    listen(element, "keydown", event => {
      if (["Enter", " ", "Spacebar"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); activate(); }
    });
  }
  bindButton(ui.assetFolderBtn, hasFolder ? "change-folder" : "set-folder");
  bindButton(ui.assetSelectBtn, "select"); bindButton(ui.assetCancelBtn, "cancel");
  listen(dialog, "keydown", event => { if (event.key === "Escape") { event.preventDefault(); close("cancel"); } });
  listen(dialog, "cancel", event => { event.preventDefault(); close("cancel"); });
  listen(dialog, "close", () => { closed = true; resolveClose(); });
  try {
    dialog.hidden = false;
    let shown;
    if (typeof dialog.uxpShowModal === "function") shown = dialog.uxpShowModal({ title: config.title, resize: "none", size: { width: 360, height: message ? 350 : 300 } });
    else if (typeof dialog.showModal === "function") shown = dialog.showModal();
    else throw new Error("Asset dialog API is not available.");
    (hasFolder ? ui.assetSelectBtn : ui.assetFolderBtn).focus?.();
    if (shown && typeof shown.then === "function") await shown;
    else await closePromise;
    return { action: chosenAction };
  } finally {
    dialog.hidden = true;
    for (const remove of cleanup) remove();
  }
}
async function handleAddAsset(type) {
  if (running) return;
  running = true; setButtonsDisabled(true); toast.dismiss();
  let config;
  try {
    const { getAssetConfig, runAddAsset, buildAssetToast } = require("./src/tools/addAsset");
    config = getAssetConfig(type);
    const localFileSystem = require("uxp").storage.localFileSystem, photoshop = require("photoshop");
    const report = result => { const summary = buildAssetToast(result); if (summary?.message) toast.show(summary.message, summary.type); };
    const result = await runAddAsset({ config, showAssetDialog: promptForAssetDialog, onResult: report,
      localFileSystem, photoshop, storage: typeof localStorage !== "undefined" ? localStorage : null });
    report(result);
    return result;
  } catch (error) {
    console.error(`[${config?.title || "ASSET"}]`, error);
    const message = `${config?.errorMessage || "Could not add asset."} ${error?.message || "Please try again."}`;
    toast.show(message, "error");
    return { outcome: "error", success: false, error, message };
  } finally {
    running = false; setButtonsDisabled(false);
  }
}
async function promptForSaveFrameDialog({ folder = null, folderPath = "", photoCount = 3, message = "" } = {}) {
  const dialog = ui.saveFrameDialog;
  if (!dialog) return { action: "cancel" };
  const hasFolder = Boolean(folder);
  ui.saveFrameFolderPath.textContent = hasFolder ? folderPath || folder.nativePath || folder.name : "No frame library folder selected";
  ui.saveFrameFolderPath.setAttribute("title", hasFolder ? ui.saveFrameFolderPath.textContent : "");
  ui.saveFramePhotoCount.value = String(photoCount);
  ui.saveFrameMessage.textContent = message; ui.saveFrameMessage.hidden = !message;
  ui.saveFrameFolderBtn.textContent = hasFolder ? "CHANGE FOLDER" : "SET FOLDER";
  ui.saveFrameSaveBtn.disabled = !hasFolder;
  ui.saveFrameSaveBtn.setAttribute("aria-disabled", String(!hasFolder));
  const cleanup = [];
  let closed = false, chosenAction = "cancel", resolveClose;
  const closePromise = new Promise(resolve => { resolveClose = resolve; });
  function listen(element, event, handler) {
    element.addEventListener(event, handler); cleanup.push(() => element.removeEventListener(event, handler));
  }
  function close(action) {
    if (closed) return;
    closed = true; chosenAction = action;
    try { dialog.close(action); } finally { resolveClose(); }
  }
  function bindButton(element, action) {
    const activate = () => { if (!element.disabled) close(action); };
    listen(element, "click", activate);
    listen(element, "keydown", event => {
      if (["Enter", " ", "Spacebar"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); activate(); }
    });
  }
  bindButton(ui.saveFrameFolderBtn, hasFolder ? "change-folder" : "set-folder");
  bindButton(ui.saveFrameSaveBtn, "save"); bindButton(ui.saveFrameCancelBtn, "cancel");
  listen(dialog, "keydown", event => { if (event.key === "Escape") { event.preventDefault(); close("cancel"); } });
  listen(dialog, "cancel", event => { event.preventDefault(); close("cancel"); });
  listen(dialog, "close", () => {
    // A browser can deliver the previous close event after this dialog opens.
    if (dialog.open === true) return;
    closed = true; resolveClose();
  });
  try {
    dialog.hidden = false;
    let shown;
    if (typeof dialog.uxpShowModal === "function") shown = dialog.uxpShowModal({ title: "SAVE FRAME", resize: "none", size: { width: 360, height: message ? 460 : 390 } });
    else if (typeof dialog.showModal === "function") shown = dialog.showModal();
    else throw new Error("Save frame dialog API is not available.");
    (hasFolder ? ui.saveFramePhotoCount : ui.saveFrameFolderBtn).focus?.();
    if (shown && typeof shown.then === "function") await shown;
    else await closePromise;
    return { action: chosenAction, photoCount: Number(ui.saveFramePhotoCount.value) };
  } finally {
    dialog.hidden = true;
    for (const remove of cleanup) remove();
  }
}
async function handleSaveFrame() {
  if (running) return;
  running = true; setButtonsDisabled(true); toast.dismiss();
  try {
    const { runSaveFrame, buildSaveFrameToast } = require("./src/tools/saveFrame");
    const report = result => { const summary = buildSaveFrameToast(result); if (summary?.message) toast.show(summary.message, summary.type); };
    const result = await runSaveFrame({ showSaveFrameDialog: promptForSaveFrameDialog, onResult: report,
      photoshop: require("photoshop"), localFileSystem: require("uxp").storage.localFileSystem,
      storage: typeof localStorage !== "undefined" ? localStorage : null });
    report(result); return result;
  } catch (error) {
    console.error("[SAVE FRAME]", error);
    const message = `Could not save frame PSD. ${error?.message || "Please try again."}`;
    toast.show(message, "error"); return { outcome: "error", success: false, error, message };
  } finally { running = false; setButtonsDisabled(false); }
}

async function promptForAddAssetDialog({ folder = null, folderPath = "", category = "PNG ASSET", message = "" } = {}) {
  const dialog = ui.addAssetDialog;
  if (!dialog) return { action: "cancel" };
  const hasFolder = Boolean(folder);
  ui.addAssetFolderPath.textContent = hasFolder ? folderPath || folder.nativePath || folder.name : "No asset library folder selected";
  ui.addAssetFolderPath.setAttribute("title", hasFolder ? ui.addAssetFolderPath.textContent : "");
  if (ui.addAssetCategorySelect) ui.addAssetCategorySelect.value = category;
  ui.addAssetMessage.textContent = message;
  ui.addAssetMessage.hidden = !message;
  ui.addAssetFolderBtn.textContent = hasFolder ? "CHANGE FOLDER" : "SET FOLDER";
  ui.addAssetSelectBtn.disabled = !hasFolder;
  ui.addAssetSelectBtn.setAttribute("aria-disabled", String(!hasFolder));
  const cleanup = [];
  let closed = false, chosenAction = "cancel", resolveClose;
  const closePromise = new Promise(resolve => { resolveClose = resolve; });
  function listen(element, event, handler) {
    if (!element) return;
    element.addEventListener(event, handler);
    cleanup.push(() => element.removeEventListener(event, handler));
  }
  function close(action) {
    if (closed) return;
    closed = true; chosenAction = action;
    try { dialog.close(action); } finally { resolveClose(); }
  }
  function bindButton(element, action) {
    const activate = () => { if (!element?.disabled) close(action); };
    listen(element, "click", activate);
    listen(element, "keydown", event => {
      if (["Enter", " ", "Spacebar"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); activate();
      }
    });
  }
  bindButton(ui.addAssetFolderBtn, hasFolder ? "change-folder" : "set-folder");
  bindButton(ui.addAssetSelectBtn, "select");
  bindButton(ui.addAssetCancelBtn, "cancel");
  listen(dialog, "keydown", event => { if (event.key === "Escape") { event.preventDefault(); close("cancel"); } });
  listen(dialog, "cancel", event => { event.preventDefault(); close("cancel"); });
  listen(dialog, "close", () => {
    if (dialog.open === true) return;
    closed = true; resolveClose();
  });
  try {
    dialog.hidden = false;
    let shown;
    if (typeof dialog.uxpShowModal === "function") {
      shown = dialog.uxpShowModal({ title: "ADD ASSET", resize: "none", size: { width: 360, height: message ? 460 : 390 } });
    } else if (typeof dialog.showModal === "function") {
      shown = dialog.showModal();
    } else {
      throw new Error("Add asset dialog API is not available.");
    }
    (hasFolder ? ui.addAssetCategorySelect || ui.addAssetSelectBtn : ui.addAssetFolderBtn).focus?.();
    if (shown && typeof shown.then === "function") await shown;
    else await closePromise;
    return { action: chosenAction, category: ui.addAssetCategorySelect?.value || category };
  } finally {
    dialog.hidden = true;
    for (const remove of cleanup) remove();
  }
}

async function handleAddAssetLibrary() {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  toast.dismiss();

  try {
    let uxp = null;
    try { uxp = require("uxp"); } catch (_) {}
    let photoshop = null;
    try { photoshop = require("photoshop"); } catch (_) {}

    const localFileSystem = uxp?.storage?.localFileSystem || null;
    const storage = typeof localStorage !== "undefined" ? localStorage : null;

    const { runAddAssetLibrary, buildAddAssetToast } = require("./src/tools/addAssetLibraryItem");
    const report = result => {
      const summary = buildAddAssetToast(result);
      if (summary?.message) toast.show(summary.message, summary.type);
    };

    const result = await runAddAssetLibrary({
      showAddAssetDialog: promptForAddAssetDialog,
      onResult: report,
      photoshop,
      localFileSystem,
      storage
    });
    report(result);
    return result;
  } catch (error) {
    console.error("[ADD ASSET]", error);
    const message = `Could not add asset. ${error?.message || "Please try again."}`;
    toast.show(message, "error");
    return { outcome: "error", success: false, error, message };
  } finally {
    running = false;
    setButtonsDisabled(false);
  }
}

async function promptForSaveAssetDialog({ folder = null, folderPath = "", category = "PNG ASSET", message = "" } = {}) {
  const dialog = ui.saveAssetDialog;
  if (!dialog) return { action: "cancel" };
  const hasFolder = Boolean(folder);
  ui.saveAssetFolderPath.textContent = hasFolder ? folderPath || folder.nativePath || folder.name : "No asset library folder selected";
  ui.saveAssetFolderPath.setAttribute("title", hasFolder ? ui.saveAssetFolderPath.textContent : "");
  if (ui.saveAssetCategorySelect) ui.saveAssetCategorySelect.value = category;
  ui.saveAssetMessage.textContent = message;
  ui.saveAssetMessage.hidden = !message;
  ui.saveAssetFolderBtn.textContent = hasFolder ? "CHANGE FOLDER" : "SET FOLDER";
  ui.saveAssetSaveBtn.disabled = !hasFolder;
  ui.saveAssetSaveBtn.setAttribute("aria-disabled", String(!hasFolder));
  const cleanup = [];
  let closed = false, chosenAction = "cancel", resolveClose;
  const closePromise = new Promise(resolve => { resolveClose = resolve; });
  function listen(element, event, handler) {
    if (!element) return;
    element.addEventListener(event, handler);
    cleanup.push(() => element.removeEventListener(event, handler));
  }
  function close(action) {
    if (closed) return;
    closed = true; chosenAction = action;
    try { dialog.close(action); } finally { resolveClose(); }
  }
  function bindButton(element, action) {
    const activate = () => { if (!element?.disabled) close(action); };
    listen(element, "click", activate);
    listen(element, "keydown", event => {
      if (["Enter", " ", "Spacebar"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); activate();
      }
    });
  }
  bindButton(ui.saveAssetFolderBtn, hasFolder ? "change-folder" : "set-folder");
  bindButton(ui.saveAssetSaveBtn, "save");
  bindButton(ui.saveAssetCancelBtn, "cancel");
  listen(dialog, "keydown", event => { if (event.key === "Escape") { event.preventDefault(); close("cancel"); } });
  listen(dialog, "cancel", event => { event.preventDefault(); close("cancel"); });
  listen(dialog, "close", () => {
    if (dialog.open === true) return;
    closed = true; resolveClose();
  });
  try {
    dialog.hidden = false;
    let shown;
    if (typeof dialog.uxpShowModal === "function") {
      shown = dialog.uxpShowModal({ title: "SAVE ASSET", resize: "none", size: { width: 360, height: message ? 460 : 390 } });
    } else if (typeof dialog.showModal === "function") {
      shown = dialog.showModal();
    } else {
      throw new Error("Save asset dialog API is not available.");
    }
    (hasFolder ? ui.saveAssetCategorySelect || ui.saveAssetSaveBtn : ui.saveAssetFolderBtn).focus?.();
    if (shown && typeof shown.then === "function") await shown;
    else await closePromise;
    return { action: chosenAction, category: ui.saveAssetCategorySelect?.value || category };
  } finally {
    dialog.hidden = true;
    for (const remove of cleanup) remove();
  }
}

async function handleSaveAsset() {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  toast.dismiss();

  try {
    let uxp = null;
    try { uxp = require("uxp"); } catch (_) {}
    let photoshop = null;
    try { photoshop = require("photoshop"); } catch (_) {}

    const localFileSystem = uxp?.storage?.localFileSystem || null;
    const storage = typeof localStorage !== "undefined" ? localStorage : null;

    const { runSaveAsset, buildSaveAssetToast } = require("./src/tools/saveAsset");
    const report = result => {
      const summary = buildSaveAssetToast(result);
      if (summary?.message) toast.show(summary.message, summary.type);
    };

    const result = await runSaveAsset({
      showSaveAssetDialog: promptForSaveAssetDialog,
      onResult: report,
      photoshop,
      localFileSystem,
      storage
    });
    report(result);
    return result;
  } catch (error) {
    console.error("[SAVE ASSET]", error);
    const message = `Could not save asset PNG. ${error?.message || "Please try again."}`;
    toast.show(message, "error");
    return { outcome: "error", success: false, error, message };
  } finally {
    running = false;
    setButtonsDisabled(false);
  }
}

async function promptForChangeBackgroundDialog({ folder = null, folderPath = "", message = "" } = {}) {
  const dialog = ui.changeBackgroundDialog;
  if (!dialog) return { action: "cancel" };
  const hasFolder = Boolean(folder);

  ui.changeBackgroundFolderPath.textContent = hasFolder ? folderPath || folder.nativePath || folder.name : "No background folder selected";
  ui.changeBackgroundFolderPath.setAttribute("title", hasFolder ? ui.changeBackgroundFolderPath.textContent : "");
  ui.changeBackgroundMessage.textContent = message;
  ui.changeBackgroundMessage.hidden = !message;
  ui.changeBackgroundFolderBtn.textContent = hasFolder ? "CHANGE FOLDER" : "SET FOLDER";
  ui.changeBackgroundSelectBtn.disabled = !hasFolder;
  ui.changeBackgroundSelectBtn.setAttribute("aria-disabled", String(!hasFolder));

  const cleanup = [];
  let closed = false, chosenAction = "cancel", resolveClose;
  const closePromise = new Promise(resolve => { resolveClose = resolve; });

  function listen(element, event, handler) {
    element.addEventListener(event, handler);
    cleanup.push(() => element.removeEventListener(event, handler));
  }

  function close(action) {
    if (closed) return;
    closed = true;
    chosenAction = action;
    try { dialog.close(action); } finally { resolveClose(); }
  }

  function bindButton(element, action) {
    const activate = () => { if (!element.disabled) close(action); };
    listen(element, "click", activate);
    listen(element, "keydown", event => {
      if (["Enter", " ", "Spacebar"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        activate();
      }
    });
  }

  bindButton(ui.changeBackgroundFolderBtn, hasFolder ? "change-folder" : "set-folder");
  bindButton(ui.changeBackgroundSelectBtn, "select");
  bindButton(ui.changeBackgroundCancelBtn, "cancel");

  listen(dialog, "keydown", event => { if (event.key === "Escape") { event.preventDefault(); close("cancel"); } });
  listen(dialog, "cancel", event => { event.preventDefault(); close("cancel"); });
  listen(dialog, "close", () => { closed = true; resolveClose(); });

  try {
    dialog.hidden = false;
    let shown;
    if (typeof dialog.uxpShowModal === "function") {
      shown = dialog.uxpShowModal({
        title: "Change Background",
        resize: "none",
        size: { width: 360, height: message ? 350 : 300 }
      });
    } else if (typeof dialog.showModal === "function") {
      shown = dialog.showModal();
    } else {
      throw new Error("Change Background dialog API is not available.");
    }
    (hasFolder ? ui.changeBackgroundSelectBtn : ui.changeBackgroundFolderBtn).focus?.();
    if (shown && typeof shown.then === "function") await shown;
    else await closePromise;
    return { action: chosenAction };
  } finally {
    dialog.hidden = true;
    for (const remove of cleanup) remove();
  }
}

async function handleChangeBackground() {
  if (running) return;
  running = true;
  setButtonsDisabled(true);
  toast.dismiss();

  try {
    let uxp = null;
    try { uxp = require("uxp"); } catch (_) {}

    let photoshop = null;
    try { photoshop = require("photoshop"); } catch (_) {}

    const localFileSystem = uxp?.storage?.localFileSystem || null;
    const storage = typeof localStorage !== "undefined" ? localStorage : null;

    const { runChangeBackground, buildChangeBackgroundToast } = require("./src/tools/changeBackground");
    const report = result => {
      const summary = buildChangeBackgroundToast(result);
      if (summary?.message) toast.show(summary.message, summary.type);
    };

    const result = await runChangeBackground({
      promptForFolder: async () => {
        if (!localFileSystem || typeof localFileSystem.getFolder !== "function") {
          throw new Error("Folder selection API is not available.");
        }
        return localFileSystem.getFolder();
      },
      showChangeBackgroundDialog: promptForChangeBackgroundDialog,
      onResult: report,
      photoshop,
      localFileSystem,
      storage
    });

    if (result && result.outcome !== "cancelled") {
      report(result);
    }
    return result;
  } catch (error) {
    console.error("Change Background error:", error);
    const message = error?.message || "Change Background failed";
    toast.show(message, "error");
    return { outcome: "error", success: false, error, message };
  } finally {
    running = false;
    setButtonsDisabled(false);
  }
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

function getSaveResultErrorMessage(result) {
  const error = result?.error;
  const raw = String(
    error?.message ||
    error?.description ||
    error ||
    ""
  ).trim();

  if (/2\s*gb|2\s*gigabyte/i.test(raw)) {
    return "PSD exceeds Photoshop's 2 GB PSD file-size limit.";
  }

  return raw || "";
}

function buildCenteredSaveResult(result) {
  if (!result || result.outcome === "cancelled") return null;

  const reason = getSaveResultErrorMessage(result);

  switch (result.outcome) {
    case "success":
      return {
        type: "success",
        icon: "✓",
        title: "SAVED SUCCESSFULLY",
        format:
          result.outputMode === "psd"
            ? "PSD ONLY"
            : result.outputMode === "jpeg"
              ? "JPG ONLY"
              : "JPG + PSD",
        reason: "",
        duration: 2000
      };

    case "jpeg-failed":
      if (result.outputMode === "both") {
        return {
          type: "warning",
          icon: "!",
          title: "PARTIALLY SAVED",
          format: "PSD saved • JPG failed",
          reason: reason || "JPEG could not be saved.",
          duration: 5000
        };
      }

      return {
        type: "error",
        icon: "×",
        title: "SAVE FAILED",
        format: "JPG could not be saved",
        reason: reason || "JPEG save failed.",
        duration: 5000
      };

    case "psd-failed":
      return {
        type: "error",
        icon: "×",
        title: "SAVE FAILED",
        format: "PSD could not be saved",
        reason: reason || "PSD save failed.",
        duration: 5000
      };

    case "no-document":
      return {
        type: "error",
        icon: "×",
        title: "SAVE FAILED",
        format: "No document is open",
        reason: "",
        duration: 4000
      };

    case "document-closed":
      return {
        type: "error",
        icon: "×",
        title: "SAVE FAILED",
        format: "Document is no longer open",
        reason: reason,
        duration: 5000
      };

    case "invalid-prefix":
      return {
        type: "error",
        icon: "×",
        title: "SAVE FAILED",
        format: "Invalid prefix",
        reason: reason,
        duration: 4000
      };

    case "error":
    default:
      return {
        type: "error",
        icon: "×",
        title: "SAVE FAILED",
        format: "Page could not be saved",
        reason: reason || "An unexpected save error occurred.",
        duration: 5000
      };
  }
}

async function getSaveEntryNativePath(entry) {
  if (!entry) return "";

  try {
    if (entry.nativePath) {
      return String(entry.nativePath);
    }
  } catch (_) {}

  try {
    const fs = require("uxp")?.storage?.localFileSystem;
    if (fs && typeof fs.getNativePath === "function") {
      const path = await fs.getNativePath(entry);
      if (path) return String(path);
    }
  } catch (_) {}

  return "";
}

function getParentPath(path) {
  const value = String(path || "").trim();
  if (!value) return "";

  const lastBackslash = value.lastIndexOf("\\");
  const lastSlash = value.lastIndexOf("/");
  const lastSeparator = Math.max(lastBackslash, lastSlash);

  return lastSeparator > 0
    ? value.slice(0, lastSeparator)
    : value;
}

async function buildSaveResultPathText(result) {
  if (!result) return "";

  const psdPath = getParentPath(
    await getSaveEntryNativePath(result.psdEntry)
  );

  const jpegPath = getParentPath(
    await getSaveEntryNativePath(result.jpegEntry)
  );

  if (result.outcome === "success") {
    if (result.outputMode === "psd" && psdPath) {
      return `Saved to:\n${psdPath}`;
    }

    if (result.outputMode === "jpeg" && jpegPath) {
      return `Saved to:\n${jpegPath}`;
    }

    if (result.outputMode === "both") {
      const lines = [];

      if (psdPath) lines.push(`PSD: ${psdPath}`);
      if (jpegPath) lines.push(`JPG: ${jpegPath}`);

      return lines.length
        ? `Saved to:\n${lines.join("\n")}`
        : "";
    }
  }

  if (result.outcome === "jpeg-failed" && psdPath) {
    return `PSD saved to:\n${psdPath}`;
  }

  return "";
}

async function showSaveResultPopup(result) {
  const popup = buildCenteredSaveResult(result);
  const dialog = ui.saveResultDialog;

  if (!popup || !dialog) return;

  const pathText = await buildSaveResultPathText(result);

  dialog.classList.remove("is-warning", "is-error");

  if (popup.type === "warning") {
    dialog.classList.add("is-warning");
  } else if (popup.type === "error") {
    dialog.classList.add("is-error");
  }

  if (ui.saveResultIcon) {
    ui.saveResultIcon.textContent = popup.icon;
  }

  if (ui.saveResultTitle) {
    ui.saveResultTitle.textContent = popup.title;
  }

  if (ui.saveResultFormat) {
    ui.saveResultFormat.textContent = popup.format || "";
  }

  if (ui.saveResultPath) {
    ui.saveResultPath.textContent = pathText || "";
    ui.saveResultPath.hidden = !pathText;
  }

  if (ui.saveResultReason) {
    ui.saveResultReason.textContent = popup.reason || "";
    ui.saveResultReason.hidden = !popup.reason;
  }

  let timer = null;

  try {
    timer = setTimeout(() => {
      try {
        if (dialog.open && typeof dialog.close === "function") {
          dialog.close("timeout");
        }
      } catch (_) {}
    }, popup.duration);

    if (typeof dialog.uxpShowModal === "function") {
      await dialog.uxpShowModal({
        title: "Frame Mitra",
        resize: "none",
        size: { width: 320, height: popup.reason ? 245 : pathText ? 225 : 165 }
      });
    } else if (typeof dialog.showModal === "function") {
      const shown = dialog.showModal();
      if (shown && typeof shown.then === "function") {
        await shown;
      }
    }
  } catch (error) {
    console.error("[SAVE RESULT POPUP]", error);
  } finally {
    if (timer) clearTimeout(timer);

    try {
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close();
      }
    } catch (_) {}
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

    await showSaveResultPopup(result);
    return result;
  } catch (error) {
    console.error("Save Page error:", error);
    const result = { outcome: "error", error };
    await showSaveResultPopup(result);
    return result;
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

// -------------------------------------------------------------
// Licensing Gating & UI Management
// -------------------------------------------------------------
function setLicenseManager(manager) {
  licenseManager = manager;
  if (typeof updateBottomLicenseStatusUI === "function") {
    updateBottomLicenseStatusUI();
  }
  return licenseManager;
}

function getLicenseManagerInstance() {
  return licenseManager;
}

async function ensureLicenseOperational() {
  if (!licenseManager) {
    console.error("[FM License] Licensing runtime unavailable.");
    return false;
  }

  try {
    await licenseManager.initialize();
  } catch (error) {
    console.error(
      "[FM License] Initialization failed:",
      error?.message || error
    );
    return false;
  }

  if (typeof licenseManager.isOperational !== "function") {
    return false;
  }

  const operational = licenseManager.isOperational() === true;
  if (typeof updateBottomLicenseStatusUI === "function") {
    updateBottomLicenseStatusUI();
  }
  return operational;
}

function getTrialDaysRemaining(expiresAt, nowMs = Date.now()) {
  if (!expiresAt || typeof expiresAt !== "number") return 0;
  const msRemaining = (expiresAt * 1000) - nowMs;
  const days = Math.ceil(msRemaining / 86400000);
  return Math.max(0, Math.min(30, days));
}

function setElementStatusClass(el, newClass) {
  if (!el) return;
  const knownStatusClasses = [
    "status-activated",
    "status-start-trial",
    "status-trial-active",
    "status-license-warning",
    "loading"
  ];
  if (el.classList && typeof el.classList.remove === "function") {
    el.classList.remove(...knownStatusClasses);
    if (newClass) {
      el.classList.add(newClass);
    }
  } else if (typeof el.className === "string") {
    let classes = el.className.split(/\s+/).filter(c => c && !knownStatusClasses.includes(c));
    if (newClass) {
      classes.push(newClass);
    }
    el.className = classes.join(" ");
  }
}

function updateBottomLicenseStatusUI() {
  const el = ui.bottomLicenseStatus;
  if (!el) return;

  if (!licenseManager) {
    el.textContent = "Please Add License";
    setElementStatusClass(el, "status-license-warning");
    if (typeof el.setAttribute === "function") {
      el.setAttribute("aria-label", "Please Add License");
    }
    return;
  }

  const snapshot = typeof licenseManager.getSnapshot === "function"
    ? licenseManager.getSnapshot()
    : { state: "ERROR" };

  const state = snapshot.state || "UNACTIVATED";

  if (state === "ACTIVE" || state === "GRACE") {
    el.textContent = "Activated License";
    setElementStatusClass(el, "status-activated");
    if (typeof el.setAttribute === "function") {
      el.setAttribute("aria-label", "Activated License");
    }
  } else if (state === "TRIAL") {
    const daysLeft = getTrialDaysRemaining(snapshot.expiresAt);
    el.textContent = `Trial Active • ${daysLeft} Days Left`;
    setElementStatusClass(el, "status-trial-active");
    if (typeof el.setAttribute === "function") {
      el.setAttribute("aria-label", `Trial Active, ${daysLeft} days left`);
    }
  } else if (state === "UNACTIVATED") {
    el.textContent = "Start Trial";
    setElementStatusClass(el, "status-start-trial");
    if (typeof el.setAttribute === "function") {
      el.setAttribute("aria-label", "Start Trial");
    }
  } else {
    // TRIAL_EXPIRED, EXPIRED, INVALID, REVOKED, SUSPENDED, ERROR
    el.textContent = "Please Add License";
    setElementStatusClass(el, "status-license-warning");
    if (typeof el.setAttribute === "function") {
      el.setAttribute("aria-label", "Please Add License");
    }
  }
}

let isStartingTrial = false;

async function handleStartTrialFlow() {
  if (isStartingTrial) return;
  if (!licenseManager || typeof licenseManager.startTrial !== "function") return;

  isStartingTrial = true;

  const bottomEl = ui.bottomLicenseStatus;
  const startTrialBtn = ui.licenseStartTrialBtn;

  if (bottomEl) {
    bottomEl.textContent = "Starting Trial...";
    if (bottomEl.classList && typeof bottomEl.classList.add === "function") {
      bottomEl.classList.add("loading");
    } else if (typeof bottomEl.className === "string") {
      bottomEl.className = `${bottomEl.className} loading`.trim();
    }
  }
  if (startTrialBtn) {
    startTrialBtn.disabled = true;
    startTrialBtn.textContent = "STARTING TRIAL...";
  }
  if (ui.licenseStatusMessage) {
    ui.licenseStatusMessage.textContent = "Connecting to licensing server...";
  }

  try {
    const result = await licenseManager.startTrial();
    if (result.ok) {
      toast.show("30-day free trial started.", "success");
    } else {
      const msg = result.message || result.error || "Failed to start trial.";
      if (ui.licenseStatusMessage) {
        ui.licenseStatusMessage.textContent = msg;
      }
      toast.show(msg, "error");
    }
  } catch (err) {
    console.error("[FM License] Start trial error:", err);
    if (ui.licenseStatusMessage) {
      ui.licenseStatusMessage.textContent = "Failed to start trial. Please check network connection.";
    }
    toast.show("Failed to start trial. Check connection.", "error");
  } finally {
    isStartingTrial = false;
    if (startTrialBtn) {
      startTrialBtn.disabled = false;
      startTrialBtn.textContent = "START 30-DAY FREE TRIAL";
    }
    updateLicenseDialogUI();
    updateBottomLicenseStatusUI();
  }
}

function handleBottomLicenseClick() {
  const snapshot = licenseManager && typeof licenseManager.getSnapshot === "function"
    ? licenseManager.getSnapshot()
    : { state: "ERROR" };

  if (snapshot.state === "UNACTIVATED") {
    handleStartTrialFlow();
  } else {
    showLicenseDialog();
  }
}

function updateLicenseDialogUI() {
  if (!licenseManager) {
    if (ui.licenseStateLabel) ui.licenseStateLabel.textContent = "LICENSE ERROR";
    if (ui.licenseStatusMessage) {
      ui.licenseStatusMessage.textContent = "License service is unavailable. Please restart Photoshop or reinstall the plugin.";
    }
    if (ui.licenseDeviceLabel) ui.licenseDeviceLabel.textContent = "Unavailable";
    if (ui.licensePlanRow) ui.licensePlanRow.hidden = true;
    if (ui.licenseNextRefreshRow) ui.licenseNextRefreshRow.hidden = true;
    if (ui.licenseTrialEndsRow) ui.licenseTrialEndsRow.hidden = true;
    if (ui.licenseDaysRemainingRow) ui.licenseDaysRemainingRow.hidden = true;

    if (ui.licenseBuyArea) ui.licenseBuyArea.hidden = true;
    if (ui.licenseContactAdminArea) ui.licenseContactAdminArea.hidden = true;
    if (ui.licenseAlreadyHaveKeySection) ui.licenseAlreadyHaveKeySection.hidden = true;

    const formGroup = $("licenseActivationForm") || (ui.licenseKeyInput ? ui.licenseKeyInput.parentElement : null);
    if (formGroup) formGroup.hidden = true;
    if (ui.licenseActivateBtn) ui.licenseActivateBtn.hidden = true;
    if (ui.licenseOrDivider) ui.licenseOrDivider.hidden = true;
    if (ui.licenseStartTrialBtn) ui.licenseStartTrialBtn.hidden = true;
    if (ui.licenseDeactivateBtn) ui.licenseDeactivateBtn.hidden = true;
    return;
  }

  const snapshot = typeof licenseManager.getSnapshot === "function"
    ? licenseManager.getSnapshot()
    : { state: "ERROR", userMessage: "Licensing runtime error." };

  const state = snapshot.state || "UNACTIVATED";
  const isPaidActive = state === "ACTIVE" || state === "GRACE";
  const isTrial = state === "TRIAL";
  const isUnactivated = state === "UNACTIVATED";
  const isExpiredOrBlocked = state === "TRIAL_EXPIRED" || state === "EXPIRED" || state === "INVALID" || state === "REVOKED" || state === "SUSPENDED" || state === "ERROR";

  // Toggle state classes for flexbox layout ordering
  const dialogContent = ui.licenseDialog?.querySelector?.(".license-dialog") || ui.licenseDialog;
  if (dialogContent?.classList && typeof dialogContent.classList.toggle === "function") {
    dialogContent.classList.toggle("state-unactivated", isUnactivated);
    dialogContent.classList.toggle("state-trial", isTrial);
    dialogContent.classList.toggle("state-expired", state === "TRIAL_EXPIRED" || state === "EXPIRED");
  }
  if (ui.licenseDialog?.classList && typeof ui.licenseDialog.classList.toggle === "function") {
    ui.licenseDialog.classList.toggle("state-unactivated", isUnactivated);
    ui.licenseDialog.classList.toggle("state-trial", isTrial);
    ui.licenseDialog.classList.toggle("state-expired", state === "TRIAL_EXPIRED" || state === "EXPIRED");
  }

  if (ui.licenseStateLabel) {
    if (state === "TRIAL_EXPIRED") {
      ui.licenseStateLabel.textContent = "TRIAL EXPIRED";
    } else if (state === "EXPIRED") {
      ui.licenseStateLabel.textContent = "LICENSE EXPIRED";
    } else {
      ui.licenseStateLabel.textContent = state;
    }
  }
  if (ui.licenseStatusMessage) {
    if (state === "TRIAL_EXPIRED") {
      ui.licenseStatusMessage.textContent = "Your 30-day free trial has ended. Activate a license to continue.";
    } else if (state === "EXPIRED") {
      ui.licenseStatusMessage.textContent = "Your license has expired. Please renew or activate a valid license to continue.";
    } else if (state === "UNACTIVATED") {
      ui.licenseStatusMessage.textContent = snapshot.userMessage || "Unactivated";
    } else {
      ui.licenseStatusMessage.textContent = snapshot.userMessage || state;
    }
  }
  if (ui.licenseDeviceLabel) {
    ui.licenseDeviceLabel.textContent = snapshot.deviceId ? "Bound (This Computer)" : "Not bound";
  }

  // Always keep phone display populated with ADMIN_CONTACT_DISPLAY
  if (ui.licenseAdminPhoneDisplay) {
    ui.licenseAdminPhoneDisplay.textContent = ADMIN_CONTACT_DISPLAY;
  }
  if (ui.licenseBuyPhoneDisplay) {
    ui.licenseBuyPhoneDisplay.textContent = ADMIN_CONTACT_DISPLAY;
  }

  // Buy Area Visibility & Content (UNACTIVATED & ACTIVE TRIAL)
  if (ui.licenseBuyArea) {
    if (isUnactivated) {
      ui.licenseBuyArea.hidden = false;
      if (ui.licenseBuyTitle) ui.licenseBuyTitle.textContent = "Buy a License";
      if (ui.licenseBuyText) ui.licenseBuyText.textContent = "Contact Administrator:";
      if (ui.licenseBuyBtn) {
        ui.licenseBuyBtn.textContent = "BUY LICENSE";
        if (typeof ui.licenseBuyBtn.setAttribute === "function") {
          ui.licenseBuyBtn.setAttribute("aria-label", "Buy FM Album Designing Tools license via WhatsApp");
        }
      }
      if (ui.licenseBuyContactError) ui.licenseBuyContactError.hidden = true;
    } else if (isTrial) {
      ui.licenseBuyArea.hidden = false;
      if (ui.licenseBuyTitle) ui.licenseBuyTitle.textContent = "Want to Buy a License?";
      if (ui.licenseBuyText) ui.licenseBuyText.textContent = "Contact Administrator:";
      if (ui.licenseBuyBtn) {
        ui.licenseBuyBtn.textContent = "BUY LICENSE";
        if (typeof ui.licenseBuyBtn.setAttribute === "function") {
          ui.licenseBuyBtn.setAttribute("aria-label", "Buy FM Album Designing Tools license via WhatsApp");
        }
      }
      if (ui.licenseBuyContactError) ui.licenseBuyContactError.hidden = true;
    } else {
      // ACTIVE, GRACE, TRIAL_EXPIRED, EXPIRED, REVOKED, SUSPENDED, ERROR -> hidden
      ui.licenseBuyArea.hidden = true;
      if (ui.licenseBuyContactError) ui.licenseBuyContactError.hidden = true;
    }
  }

  // Contact Admin / Purchase Area Visibility & Content (TRIAL_EXPIRED, EXPIRED, BLOCKED)
  if (ui.licenseContactAdminArea) {
    if (state === "TRIAL_EXPIRED") {
      ui.licenseContactAdminArea.hidden = false;
      if (ui.licenseContactAdminTitle) ui.licenseContactAdminTitle.textContent = "Need a License?";
      if (ui.licenseContactAdminText) ui.licenseContactAdminText.textContent = "Contact Administrator:";
      if (ui.licenseAdminPhoneDisplay) ui.licenseAdminPhoneDisplay.textContent = ADMIN_CONTACT_DISPLAY;
      if (ui.licenseContactAdminBtn) {
        ui.licenseContactAdminBtn.textContent = "CONTACT ADMIN";
        if (typeof ui.licenseContactAdminBtn.setAttribute === "function") {
          ui.licenseContactAdminBtn.setAttribute("aria-label", "Contact administrator on WhatsApp to buy or renew a license");
        }
      }
      if (ui.licenseContactError) ui.licenseContactError.hidden = true;
    } else if (state === "EXPIRED") {
      ui.licenseContactAdminArea.hidden = false;
      if (ui.licenseContactAdminTitle) ui.licenseContactAdminTitle.textContent = "Buy or Renew License";
      if (ui.licenseContactAdminText) ui.licenseContactAdminText.textContent = "Contact Administrator:";
      if (ui.licenseAdminPhoneDisplay) ui.licenseAdminPhoneDisplay.textContent = ADMIN_CONTACT_DISPLAY;
      if (ui.licenseContactAdminBtn) {
        ui.licenseContactAdminBtn.textContent = "CONTACT ADMIN";
        if (typeof ui.licenseContactAdminBtn.setAttribute === "function") {
          ui.licenseContactAdminBtn.setAttribute("aria-label", "Contact administrator on WhatsApp to buy or renew a license");
        }
      }
      if (ui.licenseContactError) ui.licenseContactError.hidden = true;
    } else if (isExpiredOrBlocked) {
      ui.licenseContactAdminArea.hidden = false;
      if (ui.licenseContactAdminTitle) ui.licenseContactAdminTitle.textContent = "Need a License?";
      if (ui.licenseContactAdminText) ui.licenseContactAdminText.textContent = "Contact Administrator:";
      if (ui.licenseAdminPhoneDisplay) ui.licenseAdminPhoneDisplay.textContent = ADMIN_CONTACT_DISPLAY;
      if (ui.licenseContactAdminBtn) {
        ui.licenseContactAdminBtn.textContent = "CONTACT ADMIN";
        if (typeof ui.licenseContactAdminBtn.setAttribute === "function") {
          ui.licenseContactAdminBtn.setAttribute("aria-label", "Contact administrator on WhatsApp to buy or renew a license");
        }
      }
      if (ui.licenseContactError) ui.licenseContactError.hidden = true;
    } else {
      // ACTIVE, GRACE, TRIAL, UNACTIVATED -> hidden
      ui.licenseContactAdminArea.hidden = true;
      if (ui.licenseContactError) ui.licenseContactError.hidden = true;
    }
  }

  if (ui.licensePlanRow && ui.licensePlanLabel) {
    if (isTrial) {
      ui.licensePlanLabel.textContent = "30-Day Full Trial";
      ui.licensePlanRow.hidden = false;
    } else if (isPaidActive && snapshot.plan) {
      ui.licensePlanLabel.textContent = String(snapshot.plan).toUpperCase();
      ui.licensePlanRow.hidden = false;
    } else {
      ui.licensePlanRow.hidden = true;
    }
  }

  if (ui.licenseNextRefreshRow && ui.licenseNextRefreshLabel) {
    if (isPaidActive && snapshot.refreshAfter) {
      const dateStr = new Date(snapshot.refreshAfter * 1000).toLocaleDateString();
      ui.licenseNextRefreshLabel.textContent = dateStr;
      ui.licenseNextRefreshRow.hidden = false;
    } else {
      ui.licenseNextRefreshRow.hidden = true;
    }
  }

  if (ui.licenseTrialEndsRow && ui.licenseTrialEndsLabel) {
    if (isTrial && snapshot.expiresAt) {
      const dateStr = new Date(snapshot.expiresAt * 1000).toLocaleDateString();
      ui.licenseTrialEndsLabel.textContent = dateStr;
      ui.licenseTrialEndsRow.hidden = false;
    } else {
      ui.licenseTrialEndsRow.hidden = true;
    }
  }

  if (ui.licenseDaysRemainingRow && ui.licenseDaysRemainingLabel) {
    if (isTrial && snapshot.expiresAt) {
      const days = getTrialDaysRemaining(snapshot.expiresAt);
      ui.licenseDaysRemainingLabel.textContent = String(days);
      ui.licenseDaysRemainingRow.hidden = false;
    } else {
      ui.licenseDaysRemainingRow.hidden = true;
    }
  }

  if (ui.licenseAlreadyHaveKeySection) {
    ui.licenseAlreadyHaveKeySection.hidden = isPaidActive;
  }

  const formGroup = ui.licenseActivationForm || $("licenseActivationForm") || (ui.licenseKeyInput ? ui.licenseKeyInput.parentElement : null);
  if (formGroup) {
    formGroup.hidden = isPaidActive;
  }

  if (ui.licenseActivateBtn) {
    ui.licenseActivateBtn.hidden = isPaidActive;
  }
  if (ui.licenseOrDivider) {
    ui.licenseOrDivider.hidden = !isUnactivated;
  }
  if (ui.licenseStartTrialBtn) {
    ui.licenseStartTrialBtn.hidden = !isUnactivated;
  }
  if (ui.licenseDeactivateBtn) {
    ui.licenseDeactivateBtn.hidden = !isPaidActive;
  }
}

/**
 * Safely opens an external URL using Adobe UXP shell.openExternal.
 * Does not spawn processes or invoke shell commands.
 * Falls back gracefully without throwing.
 *
 * @param {string} url
 * @returns {Promise<boolean>} true if opened successfully, false otherwise.
 */
async function openExternalUrl(url) {
  try {
    let uxp = null;
    try {
      uxp = require("uxp");
    } catch {}

    if (uxp?.shell && typeof uxp.shell.openExternal === "function") {
      await uxp.shell.openExternal(url);
      return true;
    }

    if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(url, "_blank");
      return true;
    }

    return false;
  } catch (err) {
    return false;
  }
}

async function showLicenseDialog() {
  const dialog = ui.licenseDialog;
  if (!dialog) return;

  updateLicenseDialogUI();

  if (typeof dialog.uxpShowModal === "function") {
    try {
      await dialog.uxpShowModal({
        title: "License Management",
        resize: "none",
        size: {
          width: 380,
          height: 520
        },
        minSize: {
          width: 360,
          height: 460
        }
      });
    } catch {
      // Dialog modal error or dismissed
    }
  } else if (typeof dialog.showModal === "function") {
    try {
      await dialog.showModal();
    } catch {
      // Dialog dismissed
    }
  } else {
    dialog.hidden = false;
  }
}

function closeLicenseDialog() {
  const dialog = ui.licenseDialog;
  if (!dialog) return;
  if (typeof dialog.close === "function") {
    try {
      dialog.close();
    } catch {
      // Dialog close error
    }
  }
}

// License Activation Button Handler
ui.licenseActivateBtn?.addEventListener("click", async () => {
  if (!licenseManager || !ui.licenseKeyInput) return;
  const key = ui.licenseKeyInput.value.trim();
  if (!key) {
    if (ui.licenseStatusMessage) {
      ui.licenseStatusMessage.textContent = "Please enter a license key.";
    }
    return;
  }

  ui.licenseActivateBtn.disabled = true;
  ui.licenseActivateBtn.textContent = "ACTIVATING...";
  if (ui.licenseStatusMessage) {
    ui.licenseStatusMessage.textContent = "Connecting to licensing server...";
  }

  try {
    const result = await licenseManager.activate(key);
    if (result.ok) {
      ui.licenseKeyInput.value = "";
      updateLicenseDialogUI();
      updateBottomLicenseStatusUI();
      toast.show("License activated successfully!", "success");
    } else {
      if (ui.licenseStatusMessage) {
        ui.licenseStatusMessage.textContent = result.message || result.error || "Activation failed.";
      }
    }
  } catch (err) {
    if (ui.licenseStatusMessage) {
      ui.licenseStatusMessage.textContent = "Activation failed. Please check network connection.";
    }
  } finally {
    ui.licenseActivateBtn.disabled = false;
    ui.licenseActivateBtn.textContent = "ACTIVATE LICENSE";
  }
});

// Start Trial Button Handler in Dialog
ui.licenseStartTrialBtn?.addEventListener("click", () => {
  handleStartTrialFlow();
});

// License Deactivation Button Handler
ui.licenseDeactivateBtn?.addEventListener("click", async () => {
  if (!licenseManager) return;

  ui.licenseDeactivateBtn.disabled = true;
  ui.licenseDeactivateBtn.textContent = "DEACTIVATING...";
  if (ui.licenseStatusMessage) {
    ui.licenseStatusMessage.textContent = "Deactivating license on server...";
  }

  try {
    const result = await licenseManager.deactivate();
    if (result.ok) {
      updateLicenseDialogUI();
      updateBottomLicenseStatusUI();
      toast.show("Computer deactivated successfully.", "info");
    } else {
      if (ui.licenseStatusMessage) {
        ui.licenseStatusMessage.textContent = result.message || result.error || "Deactivation failed.";
      }
    }
  } catch (err) {
    if (ui.licenseStatusMessage) {
      ui.licenseStatusMessage.textContent = "Deactivation error. Please try again.";
    }
  } finally {
    ui.licenseDeactivateBtn.disabled = false;
    ui.licenseDeactivateBtn.textContent = "DEACTIVATE THIS COMPUTER";
  }
});

ui.licenseDialogCloseBtn?.addEventListener("click", () => {
  closeLicenseDialog();
});

// Contact Admin (WhatsApp) Handler
async function handleContactAdminAction() {
  if (ui.licenseContactError) {
    ui.licenseContactError.hidden = true;
  }
  const url = getAdminWhatsAppUrl();
  const success = await openExternalUrl(url);
  if (!success) {
    if (ui.licenseContactError) {
      ui.licenseContactError.hidden = false;
      ui.licenseContactError.textContent = `Unable to open WhatsApp. Please contact ${ADMIN_CONTACT_DISPLAY} manually.`;
    }
  }
  return success;
}

ui.licenseContactAdminBtn?.addEventListener("click", () => {
  handleContactAdminAction();
});

ui.licenseContactAdminBtn?.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" || e.key === " " || e.code === "Space") {
    e.preventDefault();
    await handleContactAdminAction();
  }
});

// Buy License (WhatsApp) Handler during Active Trial
async function handleBuyLicenseAction() {
  if (ui.licenseBuyContactError) {
    ui.licenseBuyContactError.hidden = true;
  }
  const url = getAdminWhatsAppUrl();
  const success = await openExternalUrl(url);
  if (!success) {
    if (ui.licenseBuyContactError) {
      ui.licenseBuyContactError.hidden = false;
      ui.licenseBuyContactError.textContent = `Unable to open WhatsApp. Please contact ${ADMIN_CONTACT_DISPLAY} manually.`;
    }
  }
  return success;
}

ui.licenseBuyBtn?.addEventListener("click", () => {
  handleBuyLicenseAction();
});

ui.licenseBuyBtn?.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" || e.key === " " || e.code === "Space") {
    e.preventDefault();
    await handleBuyLicenseAction();
  }
});

ui.manageLicenseBtn?.addEventListener("click", () => {
  showLicenseDialog();
});

ui.bottomLicenseStatus?.addEventListener("click", () => {
  handleBottomLicenseClick();
});

ui.bottomLicenseStatus?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " " || e.code === "Space") {
    e.preventDefault();
    handleBottomLicenseClick();
  }
});

function wrapProtectedAction(handler) {
  return async function protectedAction(...args) {
    const operational = await ensureLicenseOperational();
    if (!operational) {
      await showLicenseDialog();
      return { outcome: "license-required" };
    }
    return handler(...args);
  };
}

// Attach action handlers (click + Enter/Space) with central license gating
attachActionHandler(ui.createPageBtn, wrapProtectedAction(toggleCreatePagePanel));
attachActionHandler(ui.createAlbum12x36Btn, wrapProtectedAction(() => handleCreatePagePreset("album-12x36")));
attachActionHandler(ui.createAlbum12x18Btn, wrapProtectedAction(() => handleCreatePagePreset("album-12x18")));
attachActionHandler(ui.createInstagramBtn, wrapProtectedAction(() => handleCreatePagePreset("instagram-post")));
attachActionHandler(ui.createFacebookBtn, wrapProtectedAction(() => handleCreatePagePreset("facebook-post")));
attachActionHandler(ui.createYouTubeBtn, wrapProtectedAction(() => handleCreatePagePreset("youtube-thumbnail")));
attachActionHandler(ui.createCustomBtn, wrapProtectedAction(() => handleCreatePagePreset("custom")));
attachActionHandler(ui.openPsdBtn, wrapProtectedAction(handleOpenPsd));
attachActionHandler(ui.autoPhotoFillBtn, wrapProtectedAction(handleAutoPhotoFill));
attachActionHandler(ui.swapPhotosBtn, wrapProtectedAction(handleSwapPhotos));
attachActionHandler(ui.flipPhotoBtn, wrapProtectedAction(handleFlipPhoto));
attachActionHandler(ui.savePageBtn, wrapProtectedAction(handleSavePage));
attachActionHandler(ui.saveEditedPhotosBtn, wrapProtectedAction(handleSaveEditedPhotos));
attachActionHandler(ui.savePsdCategoryBtn, wrapProtectedAction(handleSavePsdCategory));
attachActionHandler(ui.removePhotosBtn, wrapProtectedAction(handleRemovePhotos));
attachActionHandler(ui.addFrameBtn, wrapProtectedAction(handleAddFrame));
attachActionHandler(ui.saveFrameBtn, wrapProtectedAction(handleSaveFrame));
attachActionHandler(ui.addAssetBtn, wrapProtectedAction(handleAddAssetLibrary));
attachActionHandler(ui.saveAssetBtn, wrapProtectedAction(handleSaveAsset));
attachActionHandler(ui.pngMaskBtn, wrapProtectedAction(() => handleAddAsset("png-mask")));
attachActionHandler(ui.pngTextBtn, wrapProtectedAction(() => handleAddAsset("png-text")));
attachActionHandler(ui.clipArtBtn, wrapProtectedAction(() => handleAddAsset("clip-art")));
attachActionHandler(ui.changeBackgroundBtn, wrapProtectedAction(handleChangeBackground));

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    toggleCreatePagePanel,
    promptForCustomPageOptions,
    handleCreatePagePreset,
    handleAddFrame,
    promptForAddFrameDialog,
    handleAddAssetLibrary,
    promptForAddAssetDialog,
    handleSaveAsset,
    promptForSaveAssetDialog,
    handleChangeBackground,
    promptForChangeBackgroundDialog,
    promptForAssetDialog,
    handleAddAsset,
    promptForSaveFrameDialog,
    handleSaveFrame,
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
    ensureLicenseOperational,
    showLicenseDialog,
    closeLicenseDialog,
    wrapProtectedAction,
    setLicenseManager,
    getLicenseManagerInstance,
    updateLicenseDialogUI,
    updateBottomLicenseStatusUI,
    handleStartTrialFlow,
    handleBottomLicenseClick,
    getTrialDaysRemaining,
    toast,
    ui,
    openExternalUrl,
    getAdminWhatsAppUrl,
    ADMIN_CONTACT_DISPLAY,
    ADMIN_CONTACT_E164,
    ADMIN_WHATSAPP_MESSAGE,
    handleBuyLicenseAction,
    handleContactAdminAction,
    get licenseManager() {
      return licenseManager;
    }
  };
}
