const photoshop = require("photoshop");
const { app, action, core, constants } = photoshop;
const { localFileSystem } = require("uxp").storage;
const {
  snapshotDocumentIds,
  classifyOpenedDocument
} = require("./documentOwnership");

function px(value) {
  if (typeof value === "number") return value;
  if (value && typeof value.value === "number") return value.value;
  if (value && typeof value.as === "function") return value.as("px");
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readBounds(layer) {
  const b = layer.boundsNoEffects || layer.bounds;
  return {
    left: px(b.left),
    top: px(b.top),
    right: px(b.right),
    bottom: px(b.bottom)
  };
}

async function placeEmbedded(fileEntry) {
  const token = await localFileSystem.createSessionToken(fileEntry);

  await action.batchPlay([
    {
      _obj: "placeEvent",
      ID: 6,
      null: {
        _path: token,
        _kind: "local"
      },
      freeTransformCenterState: {
        _enum: "quadCenterState",
        _value: "QCSAverage"
      },
      offset: {
        _obj: "offset",
        horizontal: { _unit: "pixelsUnit", _value: 0 },
        vertical: { _unit: "pixelsUnit", _value: 0 }
      },
      _options: { dialogOptions: "dontDisplay" }
    }
  ], {});

  return app.activeDocument.activeLayers[0];
}

async function fitCover(placedLayer, targetLayer) {
  const p = readBounds(placedLayer);
  const t = readBounds(targetLayer);

  const pW = p.right - p.left;
  const pH = p.bottom - p.top;
  const tW = t.right - t.left;
  const tH = t.bottom - t.top;

  if (pW <= 0 || pH <= 0 || tW <= 0 || tH <= 0) return;

  const scale = Math.max(tW / pW, tH / pH) * 100;
  await placedLayer.scale(scale, scale, constants.AnchorPosition.MIDDLECENTER);

  const n = readBounds(placedLayer);
  const targetCenterX = (t.left + t.right) / 2;
  const targetCenterY = (t.top + t.bottom) / 2;
  const placedCenterX = (n.left + n.right) / 2;
  const placedCenterY = (n.top + n.bottom) / 2;

  await placedLayer.translate(targetCenterX - placedCenterX, targetCenterY - placedCenterY);
}

async function placePhotoOnPlaceholder(fileEntry, placeholder, options) {
  let placed = null;

  try {
    placed = await placeEmbedded(fileEntry);

    await placed.move(placeholder, constants.ElementPlacement.PLACEBEFORE);

    if (options.coverFit) {
      await fitCover(placed, placeholder);
    }

    if (options.clipToPlaceholder) {
      placed.isClippingMask = true;
    }

    if (options.renameLayer) {
      placed.name = `Memory Maker ${fileEntry.name}`;
    }

    return placed;
  } catch (error) {
    if (placed) {
      try {
        await placed.delete();
      } catch (cleanupError) {
        error.cleanupError = cleanupError;
        console.warn(`Could not remove partial placement for ${fileEntry.name}:`, cleanupError);
      }
    }
    throw error;
  }
}

/*
 * Photoshop 23.3 does not expose a reliable file-metadata API for every
 * supported image format. Open each source as a temporary document inside a
 * modal scope, read its native document dimensions, close without saving, and
 * explicitly restore the album document before placement begins.
 */
async function inspectImageFiles(fileEntries, onProgress) {
  const albumDocument = app.activeDocument;
  const photos = [];
  const errors = [];

  await core.executeAsModal(async executionContext => {
    for (let i = 0; i < fileEntries.length; i++) {
      const file = fileEntries[i];
      const preExistingDocumentIds = snapshotDocumentIds(app.documents);
      let openedDocument = null;
      let openedDocumentId = null;
      let ownership = null;
      let closed = false;

      try {
        openedDocument = await app.open(file);
        openedDocumentId = openedDocument.id;
        ownership = classifyOpenedDocument(
          openedDocument,
          preExistingDocumentIds,
          albumDocument && albumDocument.id
        );

        if (ownership.isAlbum) {
          throw new Error("The active album document cannot be used as a source photo.");
        }

        if (ownership.shouldClose) {
          await executionContext.hostControl.registerAutoCloseDocument(openedDocumentId);
        }

        photos.push({
          file,
          width: px(openedDocument.width),
          height: px(openedDocument.height)
        });
      } catch (error) {
        if (executionContext.isCancelled) throw error;
        errors.push({ file, error });
      } finally {
        if (openedDocument && ownership && ownership.shouldClose) {
          try {
            openedDocument.closeWithoutSaving();
            closed = true;
          } catch (closeError) {
            console.warn(`Could not close temporary document ${file.name}:`, closeError);
          }
        }
        if (closed && openedDocumentId !== null) {
          try {
            await executionContext.hostControl.unregisterAutoCloseDocument(openedDocumentId);
          } catch (unregisterError) {
            console.warn(`Could not unregister temporary document ${file.name}:`, unregisterError);
          }
        }
        if (albumDocument) app.activeDocument = albumDocument;
        if (onProgress) onProgress(i + 1, fileEntries.length);
      }
    }
  }, { commandName: "MM Album Design Tools - Analyze Photos" });

  return { photos, errors };
}

async function runPlacement(items, options, onProgress) {
  return core.executeAsModal(async executionContext => {
    const suspension = await executionContext.hostControl.suspendHistory({
      documentID: app.activeDocument.id,
      name: "MM Album Design Tools - Auto Photo Fill"
    });
    const placedItems = [];
    const failedItems = [];

    try {
      for (let i = 0; i < items.length; i++) {
        try {
          await placePhotoOnPlaceholder(items[i].file, items[i].layer, options);
          placedItems.push(items[i]);
        } catch (error) {
          failedItems.push({ item: items[i], error });
        }
        if (onProgress) onProgress(i + 1, items.length);
      }
    } finally {
      await executionContext.hostControl.resumeHistory(suspension);
    }

    return { placedItems, failedItems };
  }, { commandName: "MM Album Design Tools - Auto Photo Fill" });
}

async function selectLayerById(layerId) {
  if (!layerId) return;
  return action.batchPlay([
    {
      _obj: "select",
      _target: [
        {
          _ref: "layer",
          _id: layerId
        }
      ],
      makeVisible: false,
      _options: { dialogOptions: "dontDisplay" }
    }
  ], {});
}

async function exportSmartObjectContents(layer, tempFile) {
  if (!layer || !layer.id) {
    throw new Error("Invalid layer provided for Smart Object export.");
  }
  if (!tempFile) {
    throw new Error(`No temporary file provided for layer "${layer.name || layer.id}".`);
  }

  const token = tempFile.token || (localFileSystem && localFileSystem.createSessionToken ? await localFileSystem.createSessionToken(tempFile) : String(tempFile.name || tempFile));

  await selectLayerById(layer.id);

  const result = await action.batchPlay([
    {
      _obj: "placedLayerExportContents",
      _target: [
        {
          _ref: "layer",
          _id: layer.id
        }
      ],
      null: {
        _path: token,
        _kind: "local"
      },
      _options: { dialogOptions: "dontDisplay" }
    }
  ], {});

  if (Array.isArray(result) && result.length > 0) {
    const first = result[0];
    if (first && (first._obj === "error" || (first.executionStatus && first.executionStatus !== "success" && first.executionStatus !== 0))) {
      throw new Error(first.message || `Export Smart Object contents failed for "${layer.name || layer.id}"`);
    }
  }

  return result;
}

async function replaceSmartObjectContents(layer, tempFile) {
  if (!layer || !layer.id) {
    throw new Error("Invalid layer provided for Smart Object replacement.");
  }
  if (!tempFile) {
    throw new Error(`No temporary file provided for layer "${layer.name || layer.id}".`);
  }

  const token = tempFile.token || (localFileSystem && localFileSystem.createSessionToken ? await localFileSystem.createSessionToken(tempFile) : String(tempFile.name || tempFile));

  await selectLayerById(layer.id);

  const result = await action.batchPlay([
    {
      _obj: "placedLayerReplaceContents",
      _target: [
        {
          _ref: "layer",
          _id: layer.id
        }
      ],
      null: {
        _path: token,
        _kind: "local"
      },
      _isCommand: true,
      _options: { dialogOptions: "dontDisplay" }
    }
  ], {});

  if (Array.isArray(result) && result.length > 0) {
    const first = result[0];
    if (first && (first._obj === "error" || (first.executionStatus && first.executionStatus !== "success" && first.executionStatus !== 0))) {
      throw new Error(first.message || `Replace Smart Object contents failed for "${layer.name || layer.id}"`);
    }
  }

  return result;
}

async function executeSwapModal(operationFn) {
  return core.executeAsModal(async executionContext => {
    return operationFn(executionContext);
  }, { commandName: "MM Swap Photos" });
}

module.exports = {
  inspectImageFiles,
  runPlacement,
  readBounds,
  placePhotoOnPlaceholder,
  fitCover,
  selectLayerById,
  exportSmartObjectContents,
  replaceSmartObjectContents,
  executeSwapModal
};


