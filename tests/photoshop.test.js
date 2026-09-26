"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function loadPhotoshopModule(placedLayer) {
  const originalLoad = Module._load;
  const modulePath = require.resolve("../src/photoshop");

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "photoshop") {
      return {
        app: { activeDocument: { activeLayers: [placedLayer] } },
        action: { batchPlay: async () => [] },
        core: {},
        constants: {
          ElementPlacement: { PLACEBEFORE: "placeBefore" },
          AnchorPosition: { MIDDLECENTER: "middleCenter" }
        }
      };
    }

    if (request === "uxp") {
      return {
        storage: {
          localFileSystem: { createSessionToken: async () => "session-token" }
        }
      };
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[modulePath];
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  }
}

test("a placed Smart Object is deleted when a later placement step fails", async () => {
  let deleteCalls = 0;
  const placedLayer = {
    move: async () => {
      throw new Error("move failed");
    },
    delete: async () => {
      deleteCalls += 1;
    }
  };
  const { placePhotoOnPlaceholder } = loadPhotoshopModule(placedLayer);

  assert.equal(typeof placePhotoOnPlaceholder, "function");
  await assert.rejects(
    placePhotoOnPlaceholder(
      { name: "photo.jpg" },
      { id: 44 },
      { coverFit: false, clipToPlaceholder: false, renameLayer: false }
    ),
    /move failed/
  );
  assert.equal(deleteCalls, 1);
});

test("a successful placement keeps its Smart Object", async () => {
  let deleteCalls = 0;
  const placedLayer = {
    move: async () => {},
    delete: async () => {
      deleteCalls += 1;
    }
  };
  const { placePhotoOnPlaceholder } = loadPhotoshopModule(placedLayer);

  const result = await placePhotoOnPlaceholder(
    { name: "photo.jpg" },
    { id: 44 },
    { coverFit: false, clipToPlaceholder: false, renameLayer: false }
  );

  assert.equal(result, placedLayer);
  assert.equal(deleteCalls, 0);
});

test("a rollback failure is attached to the original placement error", async () => {
  const placementError = new Error("move failed");
  const cleanupError = new Error("delete failed");
  const placedLayer = {
    move: async () => {
      throw placementError;
    },
    delete: async () => {
      throw cleanupError;
    }
  };
  const { placePhotoOnPlaceholder } = loadPhotoshopModule(placedLayer);
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    await assert.rejects(
      placePhotoOnPlaceholder(
        { name: "photo.jpg" },
        { id: 44 },
        { coverFit: false, clipToPlaceholder: false, renameLayer: false }
      ),
      error => error === placementError && error.cleanupError === cleanupError
    );
  } finally {
    console.warn = originalWarn;
  }
});
