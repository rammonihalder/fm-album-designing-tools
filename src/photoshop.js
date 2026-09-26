let photoshop = null;
let app = null;
let action = null;
let core = null;
let constants = null;
let localFileSystem = null;

try {
  photoshop = require("photoshop");
  app = photoshop?.app;
  action = photoshop?.action;
  core = photoshop?.core;
  constants = photoshop?.constants;
} catch (_) {}

try {
  const uxp = require("uxp");
  localFileSystem = uxp?.storage?.localFileSystem;
} catch (_) {}
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
  if (!action || typeof action.batchPlay !== "function") return;
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

async function executeOpenPsdModal(operationFn, commandName = "MM Open PSD") {
  return core.executeAsModal(async executionContext => {
    return operationFn(executionContext);
  }, { commandName });
}

function extractPixels(val, resolution = 300) {
  if (typeof val === "number") return val;
  if (!val) return 0;

  const res = Number(resolution) > 0 ? Number(resolution) : 300;

  // DOM UnitValue object with .as("px")
  if (typeof val.as === "function") {
    try {
      const pxVal = val.as("px");
      if (typeof pxVal === "number" && !isNaN(pxVal)) return pxVal;
    } catch (_) {}
  }

  // batchPlay descriptor object with _unit and _value
  if (typeof val._value === "number") {
    const unit = val._unit;
    if (unit === "pixelsUnit" || unit === "pixel") {
      return val._value;
    }
    if (unit === "distanceUnit" || unit === "pointsUnit" || unit === "point") {
      // 1 distanceUnit in Photoshop document descriptor is 1 pt (1/72 inch)
      const inches = val._value / 72;
      return Math.round(inches * res);
    }
    if (unit === "inchesUnit" || unit === "inch") {
      return Math.round(val._value * res);
    }
    if (unit === "millimetersUnit" || unit === "mm") {
      return Math.round((val._value / 25.4) * res);
    }
    if (unit === "centimetersUnit" || unit === "cm") {
      return Math.round((val._value / 2.54) * res);
    }
    console.warn(`[OPEN PSD] Unknown distance/pixel unit encountered: "${unit}".`);
    return val._value;
  }

  // Object with unit and value properties
  if (typeof val.value === "number") {
    const unit = String(val.unit || "").toLowerCase();
    if (unit === "px" || unit === "pixels" || unit === "pixel" || unit === "pixelsunit") {
      return val.value;
    }
    if (unit === "in" || unit === "inch" || unit === "inches" || unit === "inchesunit") {
      return Math.round(val.value * res);
    }
    if (unit === "pt" || unit === "point" || unit === "points" || unit === "distanceunit" || unit === "pointsunit") {
      const inches = val.value / 72;
      return Math.round(inches * res);
    }
    if (unit === "mm" || unit === "millimeters") {
      return Math.round((val.value / 25.4) * res);
    }
    if (unit === "cm" || unit === "centimeters") {
      return Math.round((val.value / 2.54) * res);
    }
    return val.value;
  }

  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractResolution(val) {
  if (typeof val === "number") return val;
  if (!val) return 300;
  if (typeof val._value === "number") return val._value;
  if (typeof val.value === "number") return val.value;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : 300;
}

async function getDocumentMetrics(doc) {
  let resolution = 0;
  let pixelWidth = 0;
  let pixelHeight = 0;
  let rawDescriptor = null;

  // 1. Check DOM properties first if direct numbers
  if (doc) {
    if (typeof doc.resolution === "number" && doc.resolution > 0) {
      resolution = doc.resolution;
    }
    if (typeof doc.width === "number" && doc.width > 0) {
      pixelWidth = doc.width;
    }
    if (typeof doc.height === "number" && doc.height > 0) {
      pixelHeight = doc.height;
    }
  }

  // 2. Fetch descriptor from batchPlay
  if (action && typeof action.batchPlay === "function") {
    try {
      const res = await action.batchPlay([
        {
          _obj: "get",
          _target: [
            { _ref: "document", _enum: "ordinal", _value: "targetEnum" }
          ],
          _options: { dialogOptions: "dontDisplay" }
        }
      ], {});

      if (Array.isArray(res) && res[0]) {
        rawDescriptor = res[0];

        // Resolution from descriptor if not available from DOM
        const descRes = rawDescriptor.resolution !== undefined ? extractResolution(rawDescriptor.resolution) : 0;
        if (!resolution || resolution <= 0) {
          resolution = descRes;
        }

        const effectiveRes = resolution > 0 ? resolution : (descRes > 0 ? descRes : 300);

        // If DOM did not provide numeric width/height, extract from descriptor
        if (!pixelWidth || pixelWidth <= 0) {
          if (rawDescriptor.width !== undefined) {
            pixelWidth = extractPixels(rawDescriptor.width, effectiveRes);
          }
        }
        if (!pixelHeight || pixelHeight <= 0) {
          if (rawDescriptor.height !== undefined) {
            pixelHeight = extractPixels(rawDescriptor.height, effectiveRes);
          }
        }
      }
    } catch (_) {}
  }

  // 3. Fallback extraction from doc object properties (e.g. UnitValue or getters)
  if (!resolution || resolution <= 0) {
    if (doc && doc.resolution !== undefined) {
      resolution = extractResolution(doc.resolution);
    }
  }
  if (!resolution || resolution <= 0) {
    resolution = 300;
  }

  if (!pixelWidth || pixelWidth <= 0) {
    if (doc && doc.width !== undefined) {
      pixelWidth = extractPixels(doc.width, resolution);
    }
  }
  if (!pixelHeight || pixelHeight <= 0) {
    if (doc && doc.height !== undefined) {
      pixelHeight = extractPixels(doc.height, resolution);
    }
  }

  const widthInches = resolution > 0 ? pixelWidth / resolution : 0;
  const heightInches = resolution > 0 ? pixelHeight / resolution : 0;

  return {
    name: doc?.name || "document",
    pixelWidth: Math.round(pixelWidth),
    pixelHeight: Math.round(pixelHeight),
    resolution: Math.round(resolution * 100) / 100,
    widthInches: Math.round(widthInches * 1000) / 1000,
    heightInches: Math.round(heightInches * 1000) / 1000,
    rawDescriptor
  };
}

async function normalizeDocumentToPixels(doc, targetWidth, targetHeight, targetDpi = 300) {
  if (action && typeof action.batchPlay === "function") {
    const result = await action.batchPlay([
      {
        _obj: "imageSize",
        width: {
          _unit: "pixelsUnit",
          _value: targetWidth
        },
        height: {
          _unit: "pixelsUnit",
          _value: targetHeight
        },
        resolution: {
          _unit: "densityUnit",
          _value: targetDpi
        },
        scaleStyles: true,
        constrainProportions: false,
        interfaceIconFrameDimmed: {
          _enum: "interpolationType",
          _value: "bicubicSharper"
        },
        _options: { dialogOptions: "dontDisplay" }
      }
    ], {});

    if (Array.isArray(result) && result.length > 0) {
      const first = result[0];
      if (first && (first._obj === "error" || (first.executionStatus && first.executionStatus !== "success" && first.executionStatus !== 0))) {
        throw new Error(first.message || `batchPlay imageSize failed: ${JSON.stringify(first)}`);
      }
    }
    return;
  }

  if (doc && typeof doc.resizeImage === "function") {
    const bicubicSharper = (constants && constants.ResampleMethod && constants.ResampleMethod.BICUBICSHARPER) || "bicubicSharper";
    await doc.resizeImage(targetWidth, targetHeight, targetDpi, bicubicSharper);
    if (typeof doc.width === "number") doc.width = targetWidth;
    if (typeof doc.height === "number") doc.height = targetHeight;
    if (typeof doc.resolution === "number") doc.resolution = targetDpi;
  }
}

async function normalizeAlbumSize(doc, classification) {
  const is18x12 = classification === "18x12" || classification === "native-18x12";
  const targetW = is18x12 ? 5400 : 10800;
  const targetH = 3600;
  return normalizeDocumentToPixels(doc, targetW, targetH, 300);
}

async function clearAllGuides(doc) {
  if (doc && doc.guides) {
    if (typeof doc.guides.removeAll === "function") {
      try {
        doc.guides.removeAll();
        return;
      } catch (_) {}
    }
    if (typeof doc.guides.length === "number" && doc.guides.length > 0) {
      try {
        for (let i = doc.guides.length - 1; i >= 0; i--) {
          doc.guides[i].delete();
        }
        return;
      } catch (_) {}
    }
  }

  if (action && typeof action.batchPlay === "function") {
    try {
      await action.batchPlay([
        {
          _obj: "clear",
          _target: [
            {
              _ref: "guide",
              _enum: "ordinal",
              _value: "all"
            }
          ],
          _options: { dialogOptions: "dontDisplay" }
        }
      ], {});
    } catch (_) {}
  }
}

async function addAlbumGuides(doc, { verticalGuides = [], horizontalGuides = [] } = {}) {
  const canUseDom = doc && doc.guides && typeof doc.guides.add === "function";

  if (canUseDom) {
    const vDir = (constants && constants.Direction && constants.Direction.VERTICAL) || "vertical";
    const hDir = (constants && constants.Direction && constants.Direction.HORIZONTAL) || "horizontal";

    for (const pos of verticalGuides) {
      await doc.guides.add(vDir, pos);
    }
    for (const pos of horizontalGuides) {
      await doc.guides.add(hDir, pos);
    }
    return;
  }

  if (action && typeof action.batchPlay === "function") {
    const descriptors = [];
    for (const pos of verticalGuides) {
      descriptors.push({
        _obj: "make",
        _target: [{ _ref: "guide" }],
        new: {
          _obj: "guide",
          position: { _unit: "pixelsUnit", _value: pos },
          orientation: { _enum: "orientation", _value: "vertical" }
        },
        _options: { dialogOptions: "dontDisplay" }
      });
    }
    for (const pos of horizontalGuides) {
      descriptors.push({
        _obj: "make",
        _target: [{ _ref: "guide" }],
        new: {
          _obj: "guide",
          position: { _unit: "pixelsUnit", _value: pos },
          orientation: { _enum: "orientation", _value: "horizontal" }
        },
        _options: { dialogOptions: "dontDisplay" }
      });
    }

    if (descriptors.length > 0) {
      await action.batchPlay(descriptors, {});
    }
  }
}

function findDocumentById(id, appRef = app) {
  if (!appRef || !appRef.documents || id === undefined || id === null) return null;
  const docs = appRef.documents;
  for (let i = 0; i < docs.length; i++) {
    if (docs[i] && docs[i].id === id) {
      return docs[i];
    }
  }
  return null;
}

async function saveDocumentCopyPsd(doc, fileEntry, options = {}) {
  const saveOptions = {
    embedColorProfile: options.embedColorProfile !== false,
    alphaChannels: options.alphaChannels !== false,
    ...options
  };

  if (doc && doc.saveAs && typeof doc.saveAs.psd === "function") {
    return doc.saveAs.psd(fileEntry, saveOptions, true);
  }
  throw new Error("Photoshop saveAs.psd API is not available on this document.");
}

async function saveDocumentCopyJpeg(doc, fileEntry, options = {}) {
  const saveOptions = {
    quality: typeof options.quality === "number" ? options.quality : 12,
    ...options
  };

  if (doc && doc.saveAs && typeof doc.saveAs.jpg === "function") {
    return doc.saveAs.jpg(fileEntry, saveOptions, true);
  }
  throw new Error("Photoshop saveAs.jpg API is not available on this document.");
}

async function executeSavePageModal(operationFn, commandName = "MM Save Page") {
  if (core && typeof core.executeAsModal === "function") {
    return core.executeAsModal(async executionContext => {
      return operationFn(executionContext);
    }, { commandName });
  }
  return operationFn();
}

async function openSmartObjectContents(layer) {
  if (layer && layer.id) {
    await selectLayerById(layer.id);
  }
  if (action && typeof action.batchPlay === "function") {
    const descriptors = [
      {
        _obj: "placedLayerEditContents",
        _options: { dialogOptions: "dontDisplay" }
      }
    ];
    return action.batchPlay(descriptors, {});
  }
}

async function closeDocumentWithoutSaving(doc) {
  if (!doc) return;
  try {
    if (typeof doc.closeWithoutSaving === "function") {
      await doc.closeWithoutSaving();
      return;
    }
  } catch (_) {}

  try {
    const saveOption = constants?.SaveOptions?.DONOTSAVECHANGES;
    if (typeof doc.close === "function") {
      await doc.close(saveOption);
      return;
    }
  } catch (_) {}

  if (action && typeof action.batchPlay === "function") {
    const docTarget = doc.id ? [{ _ref: "document", _id: doc.id }] : undefined;
    await action.batchPlay([
      {
        _obj: "close",
        _target: docTarget,
        saving: {
          _enum: "yesNo",
          _value: "no"
        },
        _options: { dialogOptions: "dontDisplay" }
      }
    ], {});
  }
}

async function selectLayersByIds(layerIds) {
  if (!layerIds || !layerIds.length) return;
  if (action && typeof action.batchPlay === "function") {
    const descriptors = layerIds.map((id, index) => {
      if (index === 0) {
        return {
          _obj: "select",
          _target: [{ _ref: "layer", _id: id }],
          makeVisible: false,
          _options: { dialogOptions: "dontDisplay" }
        };
      }
      return {
        _obj: "select",
        _target: [{ _ref: "layer", _id: id }],
        selectionModifier: { _enum: "selectionModifierType", _value: "addToSelection" },
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" }
      };
    });
    return action.batchPlay(descriptors, {});
  }
}

async function executeSaveEditedPhotosModal(operationFn, commandName = "MM Save Edited Photos") {
  if (core && typeof core.executeAsModal === "function") {
    return core.executeAsModal(async executionContext => {
      return operationFn(executionContext);
    }, { commandName });
  }
  return operationFn();
}

module.exports = {
  inspectImageFiles,
  runPlacement,
  readBounds,
  placePhotoOnPlaceholder,
  fitCover,
  selectLayerById,
  selectLayersByIds,
  exportSmartObjectContents,
  replaceSmartObjectContents,
  openSmartObjectContents,
  closeDocumentWithoutSaving,
  executeSwapModal,
  executeOpenPsdModal,
  executeSavePageModal,
  executeSaveEditedPhotosModal,
  getDocumentMetrics,
  normalizeDocumentToPixels,
  normalizeAlbumSize,
  clearAllGuides,
  addAlbumGuides,
  extractPixels,
  extractResolution,
  findDocumentById,
  saveDocumentCopyPsd,
  saveDocumentCopyJpeg,
  px
};



