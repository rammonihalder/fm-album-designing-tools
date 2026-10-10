"use strict";

// The adjustment payloads below come from the existing Photoshop-recorded
// commands. Host support and visible results still require Photoshop testing.
const CORRECTIONS = {
  light: {
    name: "FM Adjust Light",
    kindKey: "BRIGHTNESSCONTRAST",
    type: { _obj: "brightnessEvent", useLegacy: false },
    settings: { _obj: "brightnessEvent", brightness: 0, contrast: 0, useLegacy: false }
  },
  brightness: {
    name: "FM Auto Brightness/Contrast",
    kindKey: "BRIGHTNESSCONTRAST",
    type: { _obj: "brightnessEvent", useLegacy: false },
    settings: { _obj: "brightnessEvent", auto: true, useLegacy: false }
  },
  levels: {
    name: "FM Auto Levels",
    kindKey: "LEVELS",
    color: "orange",
    type: {
      _obj: "levels",
      presetKind: { _enum: "presetKindType", _value: "presetKindDefault" }
    },
    settings: {
      _obj: "levels",
      adjustment: [{
        _obj: "levelsAdjustment",
        autoFaces: true,
        autoMachineLearning: true,
        channel: { _enum: "channel", _ref: "channel", _value: "composite" }
      }]
    }
  },
  curves: {
    name: "FM Auto Curves",
    kindKey: "CURVES",
    color: "blue",
    type: {
      _obj: "curves",
      presetKind: { _enum: "presetKindType", _value: "presetKindDefault" },
      transferFunction: 0
    },
    settings: {
      _obj: "curves",
      adjustment: [{
        _obj: "curvesAdjustment",
        autoFaces: true,
        autoMachineLearning: true,
        channel: { _enum: "channel", _ref: "channel", _value: "composite" }
      }],
      presetKind: { _enum: "presetKindType", _value: "presetKindCustom" }
    }
  }
};

function validateManualBrightness(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < -100 || value > 100) {
    throw new Error("Adjust Light requires a whole-number Brightness value from -100 to +100.");
  }
  return value;
}

function getCorrectionSpec(key, brightness) {
  const spec = CORRECTIONS[key];
  if (!spec) throw new Error("Unknown Quick Edit correction.");
  if (key !== "light") return spec;
  // New descriptor each time: never mutate the shared automatic correction specs.
  return { ...spec, settings: { ...spec.settings, brightness: validateManualBrightness(brightness) } };
}

function makeDescriptor(spec) {
  const using = { _obj: "adjustmentLayer", type: spec.type };
  if (spec.color) using.color = { _enum: "color", _value: spec.color };
  return {
    _obj: "make",
    _target: [{ _ref: "adjustmentLayer" }],
    using,
    _options: { dialogOptions: "silent" }
  };
}

function setDescriptor(spec) {
  return {
    _obj: "set",
    _target: [{ _ref: "adjustmentLayer", _enum: "ordinal", _value: "targetEnum" }],
    to: spec.settings,
    _options: { dialogOptions: "silent" }
  };
}

function checkResult(results, operation) {
  if (!Array.isArray(results) || results.length !== 1) {
    throw new Error(`Photoshop did not confirm ${operation}.`);
  }
  const result = results[0];
  if (!result || result._obj === "error" ||
      (typeof result.result === "number" && result.result < 0) ||
      (result.executionStatus !== undefined && result.executionStatus !== "success" && result.executionStatus !== 0)) {
    throw new Error(result?.message || `Photoshop rejected ${operation}.`);
  }
}

async function play(action, descriptor, operation) {
  checkResult(await action.batchPlay([descriptor], {}), operation);
}

function validateTarget(ps, expectedDocumentId, expectedLayerId) {
  const doc = ps.app?.activeDocument;
  if (!doc || !Number.isInteger(doc.id)) throw new Error("Open a photo Smart Object PSB first.");
  if (expectedDocumentId !== undefined && doc.id !== expectedDocumentId) {
    throw new Error("The active document changed before Quick Edit could run.");
  }
  if (!/\.psb$/i.test(String(doc.name || doc.title || ""))) {
    throw new Error("Open the embedded photo Smart Object PSB first.");
  }
  const selected = Array.from(doc.activeLayers || []);
  if (selected.length !== 1 || !Number.isInteger(selected[0]?.id)) {
    throw new Error("Select exactly one photo layer in the PSB.");
  }
  const photo = selected[0];
  if (expectedLayerId !== undefined && photo.id !== expectedLayerId) {
    throw new Error("The selected photo layer changed before Quick Edit could run.");
  }
  const kind = ps.constants?.LayerKind;
  const photoKinds = [kind?.NORMAL, kind?.SMARTOBJECT, "normal", "pixel", "smartObject", 1, 5]
    .filter(value => value !== undefined);
  if (!photoKinds.includes(photo.kind) && !photo.isBackgroundLayer) {
    throw new Error("Select one pixel or Smart Object photo layer.");
  }
  if (photo.isClippingMask) {
    throw new Error("Quick Edit cannot target a clipped photo; select an unclipped photo layer in the PSB.");
  }
  if (!Array.from(doc.layers || []).some(layer => layer.id === photo.id)) {
    throw new Error("Select a top-level photo layer in the PSB.");
  }
  const bounds = doc.selection?.bounds;
  if (bounds === undefined || typeof bounds?.then === "function") {
    throw new Error("Photoshop selection state is unavailable; Quick Edit cannot safely create an adjustment layer.");
  }
  if (bounds !== null) {
    throw new Error("Deselect the active pixel selection before using Quick Edit.");
  }
  return { doc, photo };
}

function findExistingCorrection(doc, photoId, spec, expectedKind) {
  const managedName = `${spec.name} [FMQE]`;
  const layers = Array.from(doc.layers || []);
  const photoIndex = layers.findIndex(layer => layer.id === photoId);
  const managed = layers.filter(layer => layer.name === managedName);
  if (managed.length > 1 || managed.some(layer => layer.kind !== expectedKind ||
      !layer.isClippingMask || layers.indexOf(layer) >= photoIndex)) {
    throw new Error(`An ambiguous existing layer blocks ${spec.name}; inspect the clipped photo stack first.`);
  }
  let existing = null;
  for (let index = photoIndex - 1; index >= 0 && layers[index].isClippingMask; index--) {
    const nameMatches = layers[index].name === managedName;
    const legacyNameMatches = layers[index].name === spec.name;
    const kindMatches = layers[index].kind === expectedKind;
    if (nameMatches && kindMatches) {
      existing = layers[index];
      continue;
    }
    if (nameMatches || legacyNameMatches || kindMatches) {
      throw new Error(`An ambiguous existing layer blocks ${spec.name}; inspect the clipped photo stack first.`);
    }
  }
  if (managed.length && existing !== managed[0]) {
    throw new Error(`An ambiguous existing layer blocks ${spec.name}; inspect the clipped photo stack first.`);
  }
  return existing;
}

function assertCreatedAbovePhoto(doc, photoId, previousIds, expectedKind) {
  const layers = Array.from(doc.layers || []);
  const added = layers.filter(layer => !previousIds.has(layer.id));
  const photoIndex = layers.findIndex(layer => layer.id === photoId);
  if (added.length !== 1 || !Number.isInteger(added[0].id) || added[0].kind !== expectedKind ||
      photoIndex < 1 || layers[photoIndex - 1].id !== added[0].id ||
      doc.activeLayers?.length !== 1 || doc.activeLayers[0].id !== added[0].id) {
    throw new Error("Photoshop did not create one adjustment layer directly above the selected photo.");
  }
  return added[0];
}

async function runCorrection(key, { photoshop, mode, modalContext, brightness } = {}) {
  const spec = getCorrectionSpec(key, brightness);
  const ps = photoshop || require("photoshop");
  if (mode === "composite") return runCompositeCorrection(spec, ps, modalContext);
  if (mode !== undefined && mode !== "photo") throw new Error("Unknown QUICK EDIT mode.");
  const expectedKind = ps.constants?.LayerKind?.[spec.kindKey];
  if (expectedKind === undefined) throw new Error("Photoshop adjustment-layer type verification is unavailable.");
  if (typeof ps.core?.executeAsModal !== "function" ||
      typeof ps.action?.batchPlay !== "function") {
    throw new Error("Photoshop modal execution or batchPlay is unavailable.");
  }
  const { doc, photo } = validateTarget(ps);
  const originalName = photo.name;
  const originalKind = photo.kind;

  return ps.core.executeAsModal(async executionContext => {
    validateTarget(ps, doc.id, photo.id);
    const existing = findExistingCorrection(doc, photo.id, spec, expectedKind);
    const hostControl = executionContext?.hostControl;
    if (typeof hostControl?.suspendHistory !== "function" ||
        typeof hostControl?.resumeHistory !== "function") {
      throw new Error("Photoshop history rollback is unavailable; no correction was applied.");
    }
    const suspension = await hostControl.suspendHistory({ documentID: doc.id, name: spec.name });
    if (suspension == null || suspension === 0xFFFFFFFF) {
      throw new Error("Photoshop did not grant a rollback-capable history suspension.");
    }
    const previousIds = new Set(Array.from(doc.layers || [], layer => layer.id));
    try {
      let correction;
      if (existing) {
        await play(ps.action, {
          _obj: "select",
          _target: [{ _ref: "layer", _id: existing.id }],
          makeVisible: false,
          _options: { dialogOptions: "silent" }
        }, "existing correction selection");
        if (doc.activeLayers?.length !== 1 || doc.activeLayers[0].id !== existing.id) {
          throw new Error("Could not isolate the existing plugin correction layer.");
        }
        correction = existing;
      } else {
        await play(ps.action, makeDescriptor(spec), "adjustment-layer creation");
        correction = assertCreatedAbovePhoto(doc, photo.id, previousIds, expectedKind);
      }
      await play(ps.action, setDescriptor(spec), "automatic adjustment");
      if (doc.activeLayers?.[0]?.id !== correction.id || ps.app.activeDocument?.id !== doc.id) {
        throw new Error("Photoshop changed the adjustment target during Quick Edit.");
      }

      const managedName = `${spec.name} [FMQE]`;
      correction.name = managedName;
      correction.isClippingMask = true; // The verified layer immediately below is the intended photo.
      const current = Array.from(doc.layers || []);
      const photoIndex = current.findIndex(layer => layer.id === photo.id);
      const correctionIndex = current.findIndex(layer => layer.id === correction.id);
      if (correction.name !== managedName || correction.kind !== expectedKind || correction.isClippingMask !== true ||
          correctionIndex < 0 || correctionIndex >= photoIndex ||
          current.slice(correctionIndex + 1, photoIndex).some(layer => !layer.isClippingMask) ||
          photo.name !== originalName || photo.kind !== originalKind) {
        throw new Error("Could not verify the clipped correction and original photo layer.");
      }

      await play(ps.action, {
        _obj: "select",
        _target: [{ _ref: "layer", _id: photo.id }],
        makeVisible: false,
        _options: { dialogOptions: "silent" }
      }, "photo-layer selection restore");
      validateTarget(ps, doc.id, photo.id);
      await hostControl.resumeHistory(suspension, true);
      return {
        success: true,
        outcome: existing ? "updated" : "applied",
        documentId: doc.id,
        photoLayerId: photo.id,
        layerId: correction.id,
        name: managedName
      };
    } catch (error) {
      try {
        await hostControl.resumeHistory(suspension, false);
      } catch (rollbackError) {
        const combined = new Error(`${error.message}; Photoshop rollback also failed: ${rollbackError.message}`);
        combined.cause = error;
        throw combined;
      }
      throw error;
    }
  }, { commandName: spec.name });
}

// A composite correction affects the already-visible PSB result. Unlike the
// single-photo mode above, it is never clipped to an arbitrary source layer.
// No stamp/flatten/merge is needed: all existing editable layers remain intact.
function validateCompositeTarget(ps, expectedDocumentId) {
  const doc = ps.app?.activeDocument;
  if (!doc || !Number.isInteger(doc.id) ||
      !/\.psb$/i.test(String(doc.name || doc.title || ""))) {
    throw new Error("Open the photo Smart Object PSB first.");
  }
  if (expectedDocumentId !== undefined && doc.id !== expectedDocumentId) {
    throw new Error("The active photo PSB changed during QUICK EDIT.");
  }
  const layers = Array.from(doc.layers || []);
  if (!layers.length || layers.some(layer => !Number.isInteger(layer?.id))) {
    throw new Error("The PSB has no verifiable layers.");
  }
  const pixels = ps.constants?.LayerKind;
  const eligible = [pixels?.NORMAL, pixels?.SMARTOBJECT, "normal", "pixel", "smartObject", 1, 5]
    .filter(value => value !== undefined);
  const hasVisiblePhoto = (nodes, ancestorsVisible = true) => Array.from(nodes || []).some(layer => {
    if (!ancestorsVisible || layer.visible === false) return false;
    if (layer.isBackgroundLayer || eligible.includes(layer.kind)) return true;
    return hasVisiblePhoto(layer.layers, true);
  });
  if (!hasVisiblePhoto(layers)) throw new Error("No visible photo pixels were found in this PSB.");

  const bounds = doc.selection?.bounds;
  if (bounds === undefined || typeof bounds?.then === "function") {
    throw new Error("Photoshop selection state is unavailable; QUICK EDIT cannot safely continue.");
  }
  if (bounds !== null) throw new Error("Deselect the active pixel selection before QUICK EDIT.");
  return doc;
}

function findCompositeCorrection(doc, spec, expectedKind) {
  const layers = Array.from(doc.layers || []);
  const knownNames = new Set(Object.values(CORRECTIONS).map(item => `${item.name} [FMQE]`));
  const named = `${spec.name} [FMQE]`;
  const matches = layers.filter(layer => layer.name === named);
  if (matches.length > 1) throw new Error(`Duplicate FM-managed ${spec.name} layers; no changes made.`);

  // FM composite layers must be consecutive at the TOP of the PSB. Never
  // select or alter an ambiguous user-created adjustment lower in the stack.
  let prefixLength = 0;
  while (prefixLength < layers.length && knownNames.has(layers[prefixLength].name)) {
    if (layers[prefixLength].isClippingMask) {
      throw new Error("A clipped FM layer blocks composite editing; inspect the PSB first.");
    }
    prefixLength++;
  }
  if (layers.slice(prefixLength).some(layer => knownNames.has(layer.name))) {
    throw new Error("An FM correction is not above the full PSB composite; inspect the layer stack first.");
  }
  if (matches.length && (matches[0].kind !== expectedKind || matches[0].isClippingMask)) {
    throw new Error("The matching FM correction layer has an unexpected type or clipping state.");
  }
  return matches[0] || null;
}

async function selectLayerById(ps, id, add = false) {
  const command = {
    _obj: "select",
    _target: [{ _ref: "layer", _id: id }],
    makeVisible: false,
    _options: { dialogOptions: "silent" }
  };
  if (add) command.selectionModifier = {
    _enum: "selectionModifierType", _value: "addToSelection"
  };
  await play(ps.action, command, "layer selection");
}

async function runCompositeCorrection(spec, ps, providedContext) {
  const expectedKind = ps.constants?.LayerKind?.[spec.kindKey];
  if (expectedKind === undefined) {
    throw new Error("Photoshop adjustment-layer type verification is unavailable.");
  }
  if (typeof ps.action?.batchPlay !== "function") {
    throw new Error("Photoshop batchPlay is unavailable.");
  }
  const doc = validateCompositeTarget(ps);
  const selectedIds = Array.from(doc.activeLayers || [], layer => layer.id);
  const initial = Array.from(doc.layers || []);
  const initialIds = new Set(initial.map(layer => layer.id));
  const originalDetails = new Map(initial.map(layer => [layer.id, { name: layer.name, kind: layer.kind }]));

  const doEdit = async context => {
    validateCompositeTarget(ps, doc.id);
    if (context?.isCancelled) throw new Error("QUICK EDIT was cancelled.");
    const host = context?.hostControl;
    if (typeof host?.suspendHistory !== "function" || typeof host?.resumeHistory !== "function") {
      throw new Error("Photoshop history rollback is unavailable; nothing was changed.");
    }
    const existing = findCompositeCorrection(doc, spec, expectedKind);
    const suspension = await host.suspendHistory({ documentID: doc.id, name: spec.name });
    if (suspension == null || suspension === 0xFFFFFFFF) {
      throw new Error("Photoshop did not grant history suspension.");
    }
    try {
      let correction = existing;
      if (correction) {
        await selectLayerById(ps, correction.id);
      } else {
        const previousTop = Array.from(doc.layers || [])[0];
        if (!previousTop || !Number.isInteger(previousTop.id)) {
          throw new Error("No top-level PSB layer to place the correction above.");
        }
        await selectLayerById(ps, previousTop.id);
        await play(ps.action, makeDescriptor(spec), "composite adjustment-layer creation");
        const afterMake = Array.from(doc.layers || []);
        const created = afterMake.filter(layer => !initialIds.has(layer.id));
        if (created.length !== 1 || afterMake[0]?.id !== created[0]?.id ||
            afterMake[1]?.id !== previousTop.id || created[0].kind !== expectedKind ||
            doc.activeLayers?.length !== 1 || doc.activeLayers[0].id !== created[0].id) {
          throw new Error("Could not verify the correction layer above the entire photo composite.");
        }
        correction = created[0];
      }
      await play(ps.action, setDescriptor(spec), "composite automatic adjustment");
      const name = `${spec.name} [FMQE]`;
      correction.name = name;
      // Composite correction is deliberately UNCLIPPED. Clipping to a single
      // photo layer would miss other retouching/background layers in this PSB.
      if (correction.isClippingMask !== false) {
        throw new Error("The PSB composite correction unexpectedly became clipped.");
      }
      const current = Array.from(doc.layers || []);
      if (ps.app?.activeDocument?.id !== doc.id ||
          current.filter(layer => layer.id === correction.id).length !== 1 ||
          (!existing && current[0]?.id !== correction.id) ||
          current.length !== initial.length + (existing ? 0 : 1) ||
          initial.some(layer => {
            const unchanged = current.find(item => item.id === layer.id);
            const before = originalDetails.get(layer.id);
            return !unchanged || unchanged.name !== before.name || unchanged.kind !== before.kind;
          })) {
        throw new Error("QUICK EDIT could not verify preservation of the original editing layers.");
      }
      for (let i = 0; i < selectedIds.length; i++) await selectLayerById(ps, selectedIds[i], i > 0);
      if (context?.isCancelled) throw new Error("QUICK EDIT was cancelled.");
      await host.resumeHistory(suspension, true);
      return {
        success: true, outcome: existing ? "updated" : "applied",
        documentId: doc.id, photoLayerId: null, layerId: correction.id, name
      };
    } catch (error) {
      try { await host.resumeHistory(suspension, false); }
      catch (rollbackError) {
        throw new Error(`${error.message}; PSB rollback also failed: ${rollbackError.message}`);
      }
      throw error;
    }
  };
  if (providedContext) return doEdit(providedContext);
  if (typeof ps.core?.executeAsModal !== "function") {
    throw new Error("Photoshop executeAsModal is unavailable.");
  }
  return ps.core.executeAsModal(doEdit, { commandName: spec.name });
}

function autoBrightness(options) { return runCorrection("brightness", options); }
function autoLevels(options) { return runCorrection("levels", options); }
function autoCurves(options) { return runCorrection("curves", options); }
function manualLight(options) { return runCorrection("light", options); }

module.exports = { autoBrightness, autoLevels, autoCurves, manualLight, validateManualBrightness };
