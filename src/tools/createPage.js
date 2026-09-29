"use strict";

const RESOLUTION = 300;
const ALBUM_SAFE_MARGIN_IN = 0.25;
const CENTER_SAFE_HALF_IN = 0.25;
const MAX_PHOTOSHOP_DIMENSION_PX = 300000;

const PRESETS = Object.freeze({
  "album-12x36": Object.freeze({
    id: "album-12x36",
    label: "12 × 36",
    name: "MM Album 12x36",
    widthPx: 36 * RESOLUTION,
    heightPx: 12 * RESOLUTION,
    background: "white",
    album: true
  }),
  "album-12x18": Object.freeze({
    id: "album-12x18",
    label: "12 × 18",
    name: "MM Album 12x18",
    widthPx: 18 * RESOLUTION,
    heightPx: 12 * RESOLUTION,
    background: "white",
    album: true
  }),
  "instagram-post": Object.freeze({
    id: "instagram-post",
    label: "Instagram Post",
    name: "MM Instagram Post",
    widthPx: 1080,
    heightPx: 1080,
    background: "white",
    album: false
  }),
  "facebook-post": Object.freeze({
    id: "facebook-post",
    label: "Facebook Post",
    name: "MM Facebook Post",
    widthPx: 1200,
    heightPx: 1500,
    background: "white",
    album: false
  }),
  "youtube-thumbnail": Object.freeze({
    id: "youtube-thumbnail",
    label: "YouTube Thumbnail",
    name: "MM YouTube Thumbnail",
    widthPx: 1280,
    heightPx: 720,
    background: "white",
    album: false
  })
});

function inchesToPixels(inches, resolution = RESOLUTION) {
  return Number(inches) * Number(resolution);
}

function buildAlbumGuidePlan(widthPx, heightPx, resolution = RESOLUTION) {
  const margin = inchesToPixels(ALBUM_SAFE_MARGIN_IN, resolution);
  const centerHalf = inchesToPixels(CENTER_SAFE_HALF_IN, resolution);
  const centerX = widthPx / 2;

  return [
    { direction: "vertical", coordinate: margin, role: "safe-left" },
    { direction: "vertical", coordinate: widthPx - margin, role: "safe-right" },
    { direction: "horizontal", coordinate: margin, role: "safe-top" },
    { direction: "horizontal", coordinate: heightPx - margin, role: "safe-bottom" },
    { direction: "vertical", coordinate: centerX - centerHalf, role: "center-safe-left" },
    { direction: "vertical", coordinate: centerX, role: "center-fold" },
    { direction: "vertical", coordinate: centerX + centerHalf, role: "center-safe-right" }
  ];
}

function normalizeBackground(value) {
  return value === "transparent" || value === "black" ? value : "white";
}

function buildCustomSpec(options = {}) {
  const unit = options.unit === "px" ? "px" : "in";
  const width = Number(options.width);
  const height = Number(options.height);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("Enter a valid width and height.");
  }

  const widthPx = unit === "in" ? Math.round(inchesToPixels(width)) : Math.round(width);
  const heightPx = unit === "in" ? Math.round(inchesToPixels(height)) : Math.round(height);
  if (widthPx < 1 || heightPx < 1) {
    throw new Error("Custom page size is too small.");
  }
  if (widthPx > MAX_PHOTOSHOP_DIMENSION_PX || heightPx > MAX_PHOTOSHOP_DIMENSION_PX) {
    throw new Error("Custom page size exceeds Photoshop's supported pixel dimensions.");
  }

  return {
    id: "custom",
    label: "Custom",
    name: "MM Custom Page",
    widthPx,
    heightPx,
    background: normalizeBackground(options.background),
    album: false
  };
}

function getPageSpec(presetId, customOptions) {
  if (presetId === "custom") return buildCustomSpec(customOptions);
  const preset = PRESETS[presetId];
  if (!preset) throw new Error("Unknown page preset.");
  return { ...preset };
}

function buildGuideDescriptor(documentId, guide) {
  return {
    _obj: "make",
    new: {
      _obj: "good",
      position: {
        _unit: "pixelsUnit",
        _value: guide.coordinate
      },
      orientation: {
        _enum: "orientation",
        _value: guide.direction
      },
      kind: {
        _enum: "kind",
        _value: "document"
      },
      _target: [
        { _ref: "document", _id: documentId },
        { _ref: "good", _index: 1 }
      ]
    },
    _target: [{ _ref: "good" }],
    guideTarget: {
      _enum: "guideTarget",
      _value: "guideTargetCanvas"
    },
    _isCommand: true,
    _options: {
      dialogOptions: "dontDisplay"
    }
  };
}

async function addGuides(document, guides, photoshop) {
  if (!document || !guides.length) return;
  const descriptors = guides.map(guide => buildGuideDescriptor(document.id, guide));
  try {
    await photoshop.action.batchPlay(descriptors, { synchronousExecution: false });
    return;
  } catch (batchError) {
    // DOM fallback is useful on hosts where action descriptors change.
    // Photoshop 24+ has the corrected 300-PPI guide coordinate behavior.
    const constants = photoshop.constants;
    if (!document.guides || !constants?.Direction) throw batchError;
    for (const guide of guides) {
      const direction = guide.direction === "vertical"
        ? constants.Direction.VERTICAL
        : constants.Direction.HORIZONTAL;
      document.guides.add(direction, guide.coordinate);
    }
  }
}

async function runCreatePage({ presetId, customOptions } = {}) {
  let spec;
  try {
    spec = getPageSpec(presetId, customOptions);
  } catch (error) {
    return { outcome: "invalid", success: false, error, message: error.message || "Invalid page settings." };
  }

  const photoshop = require("photoshop");
  const { app, core } = photoshop;
  let createdDocument = null;

  try {
    await core.executeAsModal(async executionContext => {
      createdDocument = await app.documents.add({
        width: spec.widthPx,
        height: spec.heightPx,
        resolution: RESOLUTION,
        mode: "RGBColorMode",
        fill: spec.background,
        name: spec.name
      });

      if (spec.album) {
        const guides = buildAlbumGuidePlan(spec.widthPx, spec.heightPx, RESOLUTION);
        await addGuides(createdDocument, guides, photoshop);
      }

      // If the user cancels a long host operation, do not deliberately close a
      // page that Photoshop has already created. Creation is intentionally quick.
      if (executionContext?.isCancelled) return;
    }, { commandName: `Create ${spec.label} Page` });

    return {
      outcome: "success",
      success: true,
      presetId: spec.id,
      label: spec.label,
      widthPx: spec.widthPx,
      heightPx: spec.heightPx,
      resolution: RESOLUTION,
      guidesAdded: spec.album ? 7 : 0,
      documentId: createdDocument?.id ?? null,
      message: `${spec.label} page created at ${RESOLUTION} DPI${spec.album ? " with album guides" : ""}.`
    };
  } catch (error) {
    console.error("[CREATE PAGE]", error);
    return {
      outcome: "error",
      success: false,
      error,
      message: error?.message || "Could not create the page."
    };
  }
}

function buildCreatePageToast(result) {
  if (!result) return { message: "Create Page finished.", type: "info" };
  if (result.outcome === "success") return { message: result.message, type: "success" };
  if (result.outcome === "invalid") return { message: result.message, type: "warning" };
  return { message: result.message || "Create Page failed", type: "error" };
}

module.exports = {
  RESOLUTION,
  ALBUM_SAFE_MARGIN_IN,
  CENTER_SAFE_HALF_IN,
  PRESETS,
  inchesToPixels,
  buildAlbumGuidePlan,
  buildCustomSpec,
  getPageSpec,
  buildGuideDescriptor,
  buildCreatePageToast,
  runCreatePage
};
