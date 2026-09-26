"use strict";

function isSmartObjectLayer(layer) {
  if (!layer) return false;
  if (layer.isBackgroundLayer) return false;
  if (layer.layers && layer.layers.length > 0) return false;
  if (layer.typename === "LayerSet") return false;

  const kind = layer.kind;
  const kindStr = String(kind || "").toLowerCase();

  if (kindStr === "text" || kindStr === "adjustment" || kindStr === "normal" || kindStr === "solidcolor" || kindStr === "vector" || kindStr === "background") {
    return false;
  }

  if (kindStr === "smartobject" || kind === 5) {
    return true;
  }

  try {
    const photoshop = require("photoshop");
    const smartObjectEnum = photoshop?.constants?.LayerKind?.SMARTOBJECT;
    if (smartObjectEnum !== undefined && (kind === smartObjectEnum || String(smartObjectEnum).toLowerCase() === kindStr)) {
      return true;
    }
  } catch {
    // Non-photoshop runtime fallback
  }

  if (layer.smartObject && typeof layer.smartObject === "object") {
    return true;
  }

  return false;
}

function isDisallowedLayer(layer) {
  return !isSmartObjectLayer(layer);
}

function sortLayersTopToBottom(layers, allDocumentLayers) {
  if (!layers || layers.length <= 1) return layers ? [...layers] : [];
  if (!allDocumentLayers || !allDocumentLayers.length) return [...layers];

  const orderMap = new Map(allDocumentLayers.map((l, idx) => [l.id, idx]));
  return [...layers].sort((a, b) => {
    const idxA = orderMap.has(a.id) ? orderMap.get(a.id) : 0;
    const idxB = orderMap.has(b.id) ? orderMap.get(b.id) : 0;
    return idxA - idxB;
  });
}

function buildSwapMapping(layers) {
  const n = layers ? layers.length : 0;
  if (n < 2) return [];

  return layers.map((layer, i) => {
    const sourceIndex = (i - 1 + n) % n;
    return {
      targetLayer: layer,
      targetIndex: i + 1,
      sourceLayer: layers[sourceIndex],
      sourceIndex: sourceIndex + 1
    };
  });
}

function planSwap(selectedLayers, allLayers) {
  const count = selectedLayers ? selectedLayers.length : 0;

  if (count !== 2 && count !== 3) {
    console.warn(`[MM Swap Photos] [validate-selection] Invalid selection count: ${count}. Expected 2 or 3.`);
    return {
      success: false,
      outcome: "invalid-selection",
      stage: "validate-selection",
      count,
      message: "Select 2 or 3 Smart Object photos"
    };
  }

  for (let i = 0; i < selectedLayers.length; i++) {
    const layer = selectedLayers[i];
    if (!isSmartObjectLayer(layer)) {
      console.warn(`[MM Swap Photos] [validate-selection] Selected layer "${layer.name}" (id:${layer.id}, kind:${layer.kind}) is not a supported Smart Object.`);
      return {
        success: false,
        outcome: "invalid-selection",
        stage: "validate-selection",
        count,
        message: "Select 2 or 3 Smart Object photos",
        invalidLayer: layer
      };
    }
  }

  const orderedLayers = sortLayersTopToBottom(selectedLayers, allLayers);
  const mapping = buildSwapMapping(orderedLayers);

  return {
    success: true,
    outcome: "ready",
    stage: "validate-selection",
    count: orderedLayers.length,
    orderedLayers,
    mapping
  };
}

async function createTempFiles(count, deps) {
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let tempFolder = null;

  if (deps && deps.getTempFolder) {
    tempFolder = await deps.getTempFolder();
  } else if (deps && deps.storage && deps.storage.localFileSystem) {
    tempFolder = await deps.storage.localFileSystem.getTemporaryFolder();
  } else {
    try {
      const { localFileSystem } = require("uxp").storage;
      tempFolder = await localFileSystem.getTemporaryFolder();
    } catch {
      tempFolder = {
        createFile: async (name) => ({
          name,
          delete: async () => {}
        })
      };
    }
  }

  const tempFiles = [];
  for (let i = 0; i < count; i++) {
    const fileName = `mm-swap-${uniqueId}-${i + 1}.psb`;
    const tempFile = await tempFolder.createFile(fileName, { overwrite: true });
    tempFiles.push(tempFile);
  }
  return tempFiles;
}

function getDefaultDependencies() {
  const photoshop = require("photoshop");
  const { storage } = require("uxp");
  const { getSelectedLayersTopToBottom, flattenLayers } = require("../layers");
  const {
    exportSmartObjectContents,
    replaceSmartObjectContents,
    executeSwapModal
  } = require("../photoshop");

  return {
    app: photoshop.app,
    storage,
    getSelectedLayersTopToBottom,
    getAllDocumentLayers: () => {
      if (!photoshop.app.documents.length) return [];
      return flattenLayers(photoshop.app.activeDocument.layers, []);
    },
    exportSmartObjectContents,
    replaceSmartObjectContents,
    executeSwapModal
  };
}

async function executeSwapPhotos(dependencies) {
  const deps = dependencies || getDefaultDependencies();
  let currentStage = "validate-selection";
  let activeContext = {};

  const setStage = (stage, ctx = {}) => {
    currentStage = stage;
    activeContext = { ...activeContext, ...ctx };
  };

  try {
    setStage("validate-selection");
    const selectedLayers = deps.getSelectedLayersTopToBottom ? deps.getSelectedLayersTopToBottom() : [];
    const allLayers = deps.getAllDocumentLayers ? deps.getAllDocumentLayers() : [];

    const plan = planSwap(selectedLayers, allLayers);
    if (!plan.success) {
      return plan;
    }

    const { orderedLayers, mapping, count } = plan;
    activeContext.selectedLayerIds = orderedLayers.map(l => l.id);
    activeContext.selectedLayerNames = orderedLayers.map(l => l.name);

    // Create unique temporary PSB files for snapshotting
    setStage("create-temp-files");
    const tempFiles = deps.createTempFiles
      ? await deps.createTempFiles(count, deps)
      : await createTempFiles(count, deps);

    let executionError = null;
    const executeModalFn = deps.executeSwapModal || (async (fn) => fn({ hostControl: {} }));

    try {
      await executeModalFn(async (executionContext) => {
        // EXPORT PHASE: Export EVERY selected layer before any replacement
        for (let i = 0; i < count; i++) {
          const exportStage = `export-${i + 1}`;
          setStage(exportStage, {
            layerId: orderedLayers[i].id,
            layerName: orderedLayers[i].name,
            tempFileName: tempFiles[i] ? tempFiles[i].name : null
          });

          console.log(`[MM Swap Photos] [${exportStage}] Exporting Smart Object contents for layer "${orderedLayers[i].name}" (id:${orderedLayers[i].id})`);
          try {
            await deps.exportSmartObjectContents(orderedLayers[i], tempFiles[i]);
          } catch (exportErr) {
            exportErr.stage = exportStage;
            exportErr.layerId = orderedLayers[i].id;
            exportErr.layerName = orderedLayers[i].name;
            throw exportErr;
          }
        }

        // REPLACEMENT PHASE: Only executed if ALL exports succeed
        const doc = deps.app ? deps.app.activeDocument : null;
        let initialHistoryState = doc ? doc.activeHistoryState : null;
        let suspension = null;

        if (executionContext && executionContext.hostControl && executionContext.hostControl.suspendHistory && doc) {
          try {
            suspension = await executionContext.hostControl.suspendHistory({
              documentID: doc.id,
              name: "MM Swap Photos"
            });
          } catch (suspendError) {
            console.warn("[MM Swap Photos] suspendHistory warning:", suspendError);
          }
        }

        try {
          for (let i = 0; i < count; i++) {
            const replaceStage = `replace-${i + 1}`;
            const mapItem = mapping[i];
            const targetLayer = mapItem.targetLayer;
            const sourceTempFile = tempFiles[mapItem.sourceIndex - 1];

            setStage(replaceStage, {
              targetLayerId: targetLayer.id,
              targetLayerName: targetLayer.name,
              sourceTempFileName: sourceTempFile ? sourceTempFile.name : null
            });

            console.log(`[MM Swap Photos] [${replaceStage}] Replacing Smart Object contents of "${targetLayer.name}" (id:${targetLayer.id}) with exported file "${sourceTempFile && sourceTempFile.name}"`);
            try {
              await deps.replaceSmartObjectContents(targetLayer, sourceTempFile);
            } catch (replaceErr) {
              replaceErr.stage = replaceStage;
              replaceErr.layerId = targetLayer.id;
              replaceErr.layerName = targetLayer.name;
              throw replaceErr;
            }
          }

          // Restore selection to the swapped layers
          if (doc) {
            try {
              doc.activeLayers = orderedLayers;
            } catch {
              // non-fatal
            }
          }
        } catch (replacePhaseError) {
          setStage("rollback");
          console.error(`[MM Swap Photos] [${currentStage}] Replacement error encountered. Attempting rollback:`, replacePhaseError);
          if (doc && initialHistoryState) {
            try {
              doc.activeHistoryState = initialHistoryState;
              console.log("[MM Swap Photos] [rollback] Restored initial history state.");
            } catch (rollbackError) {
              console.error("[MM Swap Photos] [rollback] Failed to restore history state:", rollbackError);
            }
          }
          throw replacePhaseError;
        } finally {
          if (suspension && executionContext && executionContext.hostControl && executionContext.hostControl.resumeHistory) {
            try {
              await executionContext.hostControl.resumeHistory(suspension);
            } catch (resumeErr) {
              console.warn("[MM Swap Photos] Could not resume history suspension:", resumeErr);
            }
          }
        }
      });
    } catch (err) {
      executionError = err;
    } finally {
      // CLEANUP PHASE: Best-effort cleanup of temporary files
      setStage("cleanup");
      for (const tempFile of tempFiles) {
        try {
          if (tempFile && typeof tempFile.delete === "function") {
            await tempFile.delete();
          }
        } catch (cleanupError) {
          console.warn(`[MM Swap Photos] [cleanup] Warning: could not delete temp file ${tempFile && tempFile.name}:`, cleanupError);
        }
      }
    }

    if (executionError) {
      const failingStage = executionError.stage || currentStage;
      console.error("[MM Swap Photos]", {
        stage: failingStage,
        errorName: executionError.name,
        errorMessage: executionError.message,
        stack: executionError.stack,
        selectedLayerIds: activeContext.selectedLayerIds,
        selectedLayerNames: activeContext.selectedLayerNames
      });

      return {
        success: false,
        outcome: "error",
        stage: failingStage,
        error: executionError,
        message: "Swap failed"
      };
    }

    return {
      success: true,
      outcome: "success",
      count,
      message: `${count} photos swapped`
    };
  } catch (outerError) {
    const failingStage = outerError.stage || currentStage;
    console.error("[MM Swap Photos]", {
      stage: failingStage,
      errorName: outerError.name,
      errorMessage: outerError.message,
      stack: outerError.stack,
      selectedLayerIds: activeContext.selectedLayerIds,
      selectedLayerNames: activeContext.selectedLayerNames
    });

    return {
      success: false,
      outcome: "error",
      stage: failingStage,
      error: outerError,
      message: "Swap failed"
    };
  }
}

async function runSwapPhotos() {
  return executeSwapPhotos(getDefaultDependencies());
}

module.exports = {
  isSmartObjectLayer,
  isDisallowedLayer,
  sortLayersTopToBottom,
  buildSwapMapping,
  planSwap,
  createTempFiles,
  executeSwapPhotos,
  runSwapPhotos
};
