"use strict";

function readableFolderPath(folder) {
  try { if (folder?.nativePath) return String(folder.nativePath); } catch (_) {}
  return folder?.name || "Folder";
}

// Confirmation-only controller. It intentionally never enumerates children or
// owns persistent-token state; folderMemory remains the persistence boundary.
function createFolderBrowser({ initialFolder, pickOtherLocation, onChange = () => {},
  tool = "Save", logger = console }) {
  let currentFolder = initialFolder;
  let busy = false;
  let ready = Boolean(initialFolder?.isFolder === true);
  let cancelled = false;
  let changed = false;

  function getState() {
    return { currentFolder, currentFolderName: currentFolder?.name || "Folder",
      currentFolderPath: readableFolderPath(currentFolder), busy, error: "",
      canSelect: ready && !busy && !cancelled };
  }
  function emit() { if (!cancelled) onChange(getState()); }
  function log(action) {
    const state = getState();
    logger.log("[FOLDER CONFIRMATION]", { tool, action,
      currentFolderName: state.currentFolderName, currentFolderPath: state.currentFolderPath });
  }

  return {
    getState,
    async start() { if (!cancelled) { ready = Boolean(currentFolder?.isFolder === true); log("open"); emit(); } },
    async chooseOtherLocation() {
      if (busy || cancelled) return null;
      busy = true; emit();
      try {
        const chosen = await pickOtherLocation();
        if (cancelled) return null;
        if (!chosen) { log("other-location-cancelled"); return null; }
        if (chosen.isFolder !== true) throw new Error("Selected entry is not a folder.");
        currentFolder = chosen; changed = true; ready = true; log("other-location"); return chosen;
      } catch (error) {
        logger.error("[FOLDER CONFIRMATION]", { tool, stage: "pick-other-location",
          errorName: error?.name || "Error", errorMessage: error?.message || String(error), stack: error?.stack });
        return null;
      } finally { busy = false; emit(); }
    },
    select() {
      if (!getState().canSelect) return null;
      log("select"); return { cancelled: false, folder: currentFolder, changed };
    },
    cancel() { if (!cancelled) log("cancel"); cancelled = true; return { cancelled: true }; }
  };
}

module.exports = { createFolderBrowser, readableFolderPath };
