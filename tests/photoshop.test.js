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

test("exportSmartObjectContents invokes batchPlay placedLayerExportContents with session token", async () => {
  const batchPlayCalls = [];
  const originalLoad = Module._load;
  const modulePath = require.resolve("../src/photoshop");

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "photoshop") {
      return {
        app: { activeDocument: { activeLayers: [] } },
        action: {
          batchPlay: async (descriptors, options) => {
            batchPlayCalls.push({ descriptors, options });
            return [{ _obj: "success", executionStatus: "success" }];
          }
        },
        core: { executeAsModal: async fn => fn({}) },
        constants: {
          ElementPlacement: { PLACEBEFORE: "placeBefore" },
          AnchorPosition: { MIDDLECENTER: "middleCenter" }
        }
      };
    }

    if (request === "uxp") {
      return {
        storage: {
          localFileSystem: { createSessionToken: async entry => `token-${entry.name}` }
        }
      };
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[modulePath];
  try {
    const { exportSmartObjectContents } = require(modulePath);
    const mockLayer = { id: 42, name: "Smart 42" };
    const mockFile = { name: "test-export.psb" };

    await exportSmartObjectContents(mockLayer, mockFile);

    assert.equal(batchPlayCalls.length, 2); // 1 select + 1 placedLayerExportContents
    const exportCall = batchPlayCalls[1].descriptors[0];
    assert.equal(exportCall._obj, "placedLayerExportContents");
    assert.equal(exportCall._target[0]._id, 42);
    assert.equal(exportCall.null._path, "token-test-export.psb");
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  }
});

test("replaceSmartObjectContents invokes batchPlay placedLayerReplaceContents with session token", async () => {
  const batchPlayCalls = [];
  const originalLoad = Module._load;
  const modulePath = require.resolve("../src/photoshop");

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "photoshop") {
      return {
        app: { activeDocument: { activeLayers: [] } },
        action: {
          batchPlay: async (descriptors, options) => {
            batchPlayCalls.push({ descriptors, options });
            return [{ _obj: "success", executionStatus: "success" }];
          }
        },
        core: { executeAsModal: async fn => fn({}) },
        constants: {
          ElementPlacement: { PLACEBEFORE: "placeBefore" },
          AnchorPosition: { MIDDLECENTER: "middleCenter" }
        }
      };
    }

    if (request === "uxp") {
      return {
        storage: {
          localFileSystem: { createSessionToken: async entry => `token-${entry.name}` }
        }
      };
    }

    return originalLoad(request, parent, isMain);
  };

  delete require.cache[modulePath];
  try {
    const { replaceSmartObjectContents } = require(modulePath);
    const mockLayer = { id: 99, name: "Smart 99" };
    const mockFile = { name: "test-replace.psb" };

    await replaceSmartObjectContents(mockLayer, mockFile);

    assert.equal(batchPlayCalls.length, 2); // 1 select + 1 placedLayerReplaceContents
    const replaceCall = batchPlayCalls[1].descriptors[0];
    assert.equal(replaceCall._obj, "placedLayerReplaceContents");
    assert.equal(replaceCall._target[0]._id, 99);
    assert.equal(replaceCall.null._path, "token-test-replace.psb");
    assert.equal(replaceCall._isCommand, true);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  }
});

test("exportSmartObjectContents throws if batchPlay reports failure", async () => {
  const originalLoad = Module._load;
  const modulePath = require.resolve("../src/photoshop");

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "photoshop") {
      return {
        app: { activeDocument: { activeLayers: [] } },
        action: {
          batchPlay: async (descriptors) => {
            if (descriptors[0]._obj === "placedLayerExportContents") {
              return [{ _obj: "error", message: "Smart Object data unavailable" }];
            }
            return [];
          }
        },
        core: {},
        constants: {}
      };
    }
    if (request === "uxp") {
      return { storage: { localFileSystem: { createSessionToken: async () => "token" } } };
    }
    return originalLoad(request, parent, isMain);
  };

  delete require.cache[modulePath];
  try {
    const { exportSmartObjectContents } = require(modulePath);
    await assert.rejects(
      exportSmartObjectContents({ id: 10, name: "Bad SO" }, { name: "test.psb" }),
      /Smart Object data unavailable/
    );
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  }
});

