const { classifyDimensions } = require("../orientation");
const { matchPhotosToPlaceholders } = require("../matcher");
const {
  TOKEN_KEYS,
  restoreFolderFromToken,
  saveFolderToken,
  getParentFolder
} = require("../folderMemory");

const AUTO_FILL_OPTIONS = Object.freeze({
  coverFit: true,
  clipToPlaceholder: true,
  renameLayer: true,
  moveUsedFiles: true
});

function quantity(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildCompletionSummary(result) {
  const placeholderSkipped = Math.max(0, result.placeholderCount - result.placedCount);
  const failedCount = result.failedPhotos.length;
  const photoSkipped = result.unmatchedPhotos.length;
  const lines = [
    `${quantity(result.placedCount, "photo", "photos")} placed successfully.`
  ];

  if (failedCount) lines.push(`${quantity(failedCount, "photo", "photos")} failed.`);
  if (placeholderSkipped) {
    lines.push(`${quantity(placeholderSkipped, "placeholder", "placeholders")} skipped.`);
  } else if (result.placeholderCount > 0) {
    lines.push("All selected placeholders were filled.");
  }
  if (photoSkipped) lines.push(`${quantity(photoSkipped, "photo", "photos")} skipped.`);
  if (result.moveFailures.length) {
    lines.push(`${quantity(result.moveFailures.length, "source photo", "source photos")} could not be moved to Album Used.`);
  }

  return lines;
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error || "Unknown error");
}

function isBenignDialogDismissal(error) {
  const code = error && error.code ? String(error.code) : "";
  return /reasonCanceled/i.test(code) || /reasonCanceled/i.test(errorMessage(error));
}

function getDefaultDependencies() {
  const { getSelectedLayersTopToBottom } = require("../layers");
  const { selectImageFiles, moveUsedFiles } = require("../files");
  const { inspectImageFiles, readBounds, runPlacement } = require("../photoshop");
  let storage = null;
  let localFileSystem = null;
  try {
    const uxp = require("uxp");
    localFileSystem = uxp?.storage?.localFileSystem;
  } catch (_) {}
  try {
    storage = typeof localStorage !== "undefined" ? localStorage : null;
  } catch (_) {}
  return {
    getSelectedLayersTopToBottom,
    inspectImageFiles,
    moveUsedFiles,
    readBounds,
    runPlacement,
    selectImageFiles,
    storage,
    localFileSystem
  };
}

async function executeAutoPhotoFill(ui, dependencies) {
  const setStatus = ui && ui.setStatus ? ui.setStatus : () => {};
  const showDialog = ui && ui.showDialog ? ui.showDialog : async () => {};
  const presentDialog = async (title, lines) => {
    try {
      await showDialog(title, lines);
    } catch (dialogError) {
      if (!isBenignDialogDismissal(dialogError)) {
        const message = errorMessage(dialogError);
        console.warn(`Dialog dismissed or unavailable: ${message}`);
      }
    }
  };

  try {
    setStatus("Reading placeholders...");
    const selectedLayers = dependencies.getSelectedLayersTopToBottom();
    if (!selectedLayers.length) {
      setStatus("Select one or more placeholder layers first.", "error");
      await presentDialog("Auto Photo Fill", ["Select one or more placeholder layers first."]);
      return { outcome: "no-placeholders" };
    }

    const placeholders = [];
    const placeholderFailures = [];
    for (let order = 0; order < selectedLayers.length; order++) {
      const layer = selectedLayers[order];
      try {
        const bounds = dependencies.readBounds(layer);
        const width = bounds.right - bounds.left;
        const height = bounds.bottom - bounds.top;
        placeholders.push({
          id: layer.id,
          order,
          width,
          height,
          orientation: classifyDimensions(width, height),
          layer
        });
      } catch (error) {
        placeholderFailures.push({ layer, error });
        console.warn(`Skipping placeholder ${layer.name || layer.id}: ${errorMessage(error)}`);
      }
    }

    if (!placeholders.length) {
      const lines = ["None of the selected placeholder layers could be read."];
      placeholderFailures.forEach(entry => {
        lines.push(`Could not use placeholder ${entry.layer.name || entry.layer.id}: ${errorMessage(entry.error)}`);
      });
      setStatus("Could not read the selected placeholder layers.", "error");
      await presentDialog("Auto Photo Fill", lines);
      return { outcome: "invalid-placeholders", placeholderFailures };
    }

    const storage = dependencies.storage !== undefined
      ? dependencies.storage
      : (typeof localStorage !== "undefined" ? localStorage : null);
    let localFileSystem = dependencies.localFileSystem !== undefined
      ? dependencies.localFileSystem
      : null;
    if (!localFileSystem) {
      try {
        const uxp = require("uxp");
        localFileSystem = uxp?.storage?.localFileSystem || null;
      } catch (_) {}
    }

    let restoredFolder = null;
    if (localFileSystem && storage) {
      try {
        const restore = dependencies.restoreFolderFromToken || restoreFolderFromToken;
        restoredFolder = await restore(TOKEN_KEYS.AUTO_PHOTO_FILL, localFileSystem, storage);
      } catch (_) {}
    }

    const pickerOptions = {};
    if (restoredFolder) {
      pickerOptions.initialLocation = restoredFolder;
    }

    const selectedFiles = await dependencies.selectImageFiles(pickerOptions);
    if (!selectedFiles || !selectedFiles.length) {
      setStatus("Cancelled.");
      return { outcome: "cancelled" };
    }

    if (selectedFiles.length > 0 && localFileSystem && storage) {
      try {
        const firstPhoto = selectedFiles[0];
        let parentFolder = null;
        if (firstPhoto && firstPhoto.parent && (firstPhoto.parent.isFolder || !firstPhoto.parent.isFile)) {
          parentFolder = firstPhoto.parent;
        } else if (firstPhoto) {
          const getParent = dependencies.getParentFolder || getParentFolder;
          parentFolder = await getParent(firstPhoto, localFileSystem);
        }
        if (parentFolder) {
          const save = dependencies.saveFolderToken || saveFolderToken;
          await save(TOKEN_KEYS.AUTO_PHOTO_FILL, parentFolder, localFileSystem, storage);
        }
      } catch (saveErr) {
        console.warn("[FM Auto Photo Fill] Could not save folder token:", saveErr);
      }
    }

    setStatus(`Analyzing ${selectedFiles.length} ${selectedFiles.length === 1 ? "photo" : "photos"}...`);
    const inspection = await dependencies.inspectImageFiles(selectedFiles, (done, total) => {
      setStatus(`Analyzing ${done} of ${total} photos...`);
    });
    const fileOrder = new Map(selectedFiles.map((file, index) => [file, index]));
    const inspectionErrors = Array.from(inspection.errors || []);
    const photos = [];
    inspection.photos.forEach(item => {
      try {
        photos.push({
          id: item.file.nativePath || item.file.name,
          order: fileOrder.get(item.file),
          width: item.width,
          height: item.height,
          orientation: classifyDimensions(item.width, item.height),
          file: item.file
        });
      } catch (error) {
        inspectionErrors.push({ file: item.file, error });
      }
    });

    setStatus("Matching photos...");
    const matchResult = matchPhotosToPlaceholders(placeholders, photos);
    const placementItems = matchResult.matches.map(match => ({
      layer: match.placeholder.layer,
      file: match.photo.file,
      placeholder: match.placeholder,
      photo: match.photo
    }));

    let placementResult = { placedItems: [], failedItems: [] };
    if (placementItems.length) {
      setStatus(`Placing 0 of ${placementItems.length}...`);
      placementResult = await dependencies.runPlacement(
        placementItems,
        AUTO_FILL_OPTIONS,
        (done, total) => setStatus(`Placing ${done} of ${total}...`)
      );
    }

    let moveResult = { moved: [], failed: [] };
    if (placementResult.placedItems.length && AUTO_FILL_OPTIONS.moveUsedFiles) {
      setStatus("Moving used photos...");
      moveResult = await dependencies.moveUsedFiles(
        placementResult.placedItems.map(item => item.file),
        (done, total) => setStatus(`Moving ${done} of ${total} used photos...`)
      );
    }

    const failedPhotos = [
      ...inspectionErrors.map(entry => ({ ...entry, stage: "read" })),
      ...placementResult.failedItems.map(entry => ({
        file: entry.item.file,
        error: entry.error,
        stage: "place"
      }))
    ];
    const summary = {
      placeholderCount: selectedLayers.length,
      photoCount: selectedFiles.length,
      placedCount: placementResult.placedItems.length,
      failedPhotos,
      unmatchedPhotos: matchResult.unmatchedPhotos,
      moveFailures: moveResult.failed
    };
    const lines = buildCompletionSummary(summary);

    failedPhotos.forEach(entry => {
      const verb = entry.stage === "read" ? "read" : "place";
      const cleanupDetail = entry.error && entry.error.cleanupError
        ? ` Cleanup also failed: ${errorMessage(entry.error.cleanupError)}`
        : "";
      lines.push(`Could not ${verb} ${entry.file.name}: ${errorMessage(entry.error)}${cleanupDetail}`);
    });
    placeholderFailures.forEach(entry => {
      lines.push(`Could not use placeholder ${entry.layer.name || entry.layer.id}: ${errorMessage(entry.error)}`);
    });
    moveResult.failed.slice(0, 3).forEach(entry => {
      const category = entry.diagnostic ? `[${entry.diagnostic.category}] ` : "";
      const code = entry.error && entry.error.code ? `${entry.error.code}: ` : "";
      const detail = (code + errorMessage(entry.error)).replace(/\s+/g, " ");
      const concise = detail.length > 240 ? detail.slice(0, 237) + "..." : detail;
      lines.push(`Could not move ${entry.file.name}: ${category}${concise}`);
    });
    if (moveResult.failed.length > 3) {
      lines.push(`${moveResult.failed.length - 3} more move failures; details are in the developer console.`);
    }

    const hasFailures = failedPhotos.length > 0 ||
      placeholderFailures.length > 0 ||
      moveResult.failed.length > 0;
    setStatus("Complete.", hasFailures ? "error" : "success");
    await presentDialog("Auto Photo Fill Complete", lines);
    return {
      outcome: hasFailures ? "completed-with-errors" : "complete",
      placedCount: summary.placedCount,
      movedCount: moveResult.moved.length,
      failedPhotos,
      placeholderFailures,
      unmatchedPlaceholders: matchResult.unmatchedPlaceholders,
      unmatchedPhotos: matchResult.unmatchedPhotos,
      moveFailures: moveResult.failed
    };
  } catch (error) {
    console.error(error);
    const message = `Auto Photo Fill failed: ${errorMessage(error)}`;
    setStatus(message, "error");
    await presentDialog("Auto Photo Fill Failed", [message]);
    return { outcome: "error", error };
  }
}

async function runAutoPhotoFill(ui) {
  return executeAutoPhotoFill(ui, getDefaultDependencies());
}

module.exports = {
  AUTO_FILL_OPTIONS,
  buildCompletionSummary,
  executeAutoPhotoFill,
  runAutoPhotoFill
};
