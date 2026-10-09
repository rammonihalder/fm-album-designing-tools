const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AUTO_FILL_OPTIONS,
  buildCompletionSummary,
  executeAutoPhotoFill
} = require("../src/tools/autoPhotoFill");

function layer(id, width, height) {
  return { id, bounds: { left: 0, top: 0, right: width, bottom: height } };
}

function file(name, width, height) {
  return { name, nativePath: `C:\\photos\\${name}`, width, height };
}

function makeHarness(overrides) {
  const calls = {
    dialogs: [],
    statuses: [],
    picked: 0,
    inspected: 0,
    placed: 0,
    movedFiles: []
  };

  const dependencies = {
    getSelectedLayersTopToBottom: () => [],
    readBounds: selectedLayer => selectedLayer.bounds,
    selectImageFiles: async () => {
      calls.picked++;
      return [];
    },
    inspectImageFiles: async selectedFiles => {
      calls.inspected++;
      return {
        photos: selectedFiles.map(item => ({ file: item, width: item.width, height: item.height })),
        errors: []
      };
    },
    runPlacement: async items => {
      calls.placed++;
      return { placedItems: items, failedItems: [] };
    },
    moveUsedFiles: async selectedFiles => {
      calls.movedFiles.push(...selectedFiles);
      return { moved: selectedFiles, failed: [] };
    },
    ...(overrides || {})
  };

  const ui = {
    setStatus: (message, type) => calls.statuses.push({ message, type }),
    showDialog: async (title, lines) => calls.dialogs.push({ title, lines })
  };

  return { calls, dependencies, ui };
}

test("does not open the file picker when no placeholders are selected", async () => {
  const harness = makeHarness();
  const result = await executeAutoPhotoFill(harness.ui, harness.dependencies);
  assert.equal(result.outcome, "no-placeholders");
  assert.equal(harness.calls.picked, 0);
  assert.equal(harness.calls.inspected, 0);
  assert.equal(harness.calls.dialogs.length, 1);
  assert.deepEqual(harness.calls.dialogs[0].lines, ["Select one or more placeholder layers first."]);
});

test("cancelling the picker makes no Photoshop or file changes", async () => {
  const harness = makeHarness({
    getSelectedLayersTopToBottom: () => [layer(1, 80, 120)]
  });
  const result = await executeAutoPhotoFill(harness.ui, harness.dependencies);
  assert.equal(result.outcome, "cancelled");
  assert.equal(harness.calls.picked, 1);
  assert.equal(harness.calls.inspected, 0);
  assert.equal(harness.calls.placed, 0);
  assert.equal(harness.calls.movedFiles.length, 0);
  assert.equal(harness.calls.statuses.at(-1).message, "Cancelled.");
});

test("moves only source files whose complete placement succeeded", async () => {
  const portraitFile = file("portrait.jpg", 800, 1200);
  const landscapeFile = file("landscape.jpg", 1200, 800);
  const harness = makeHarness({
    getSelectedLayersTopToBottom: () => [layer(1, 800, 1200), layer(2, 1200, 800)],
    selectImageFiles: async () => {
      harness.calls.picked++;
      return [portraitFile, landscapeFile];
    },
    runPlacement: async items => {
      harness.calls.placed++;
      return {
        placedItems: [items[0]],
        failedItems: [{ item: items[1], error: new Error("place failed") }]
      };
    }
  });

  const result = await executeAutoPhotoFill(harness.ui, harness.dependencies);
  assert.equal(result.placedCount, 1);
  assert.equal(result.movedCount, 1);
  assert.deepEqual(harness.calls.movedFiles.map(item => item.name), ["portrait.jpg"]);
  assert.ok(harness.calls.dialogs[0].lines.includes("1 photo placed successfully."));
  assert.ok(harness.calls.dialogs[0].lines.includes("1 photo failed."));
  assert.ok(harness.calls.dialogs[0].lines.includes("1 placeholder skipped."));
});

test("unreadable photos are reported as failures and never moved", async () => {
  const readable = file("readable.jpg", 800, 1200);
  const unreadable = file("broken.jpg", 0, 0);
  const harness = makeHarness({
    getSelectedLayersTopToBottom: () => [layer(1, 800, 1200), layer(2, 800, 1200)],
    selectImageFiles: async () => [readable, unreadable],
    inspectImageFiles: async () => ({
      photos: [{ file: readable, width: 800, height: 1200 }],
      errors: [{ file: unreadable, error: new Error("unsupported format") }]
    })
  });

  const result = await executeAutoPhotoFill(harness.ui, harness.dependencies);
  assert.equal(result.placedCount, 1);
  assert.deepEqual(harness.calls.movedFiles.map(item => item.name), ["readable.jpg"]);
  assert.ok(harness.calls.dialogs[0].lines.some(line => line.includes("broken.jpg")));
});

test("invalid dimensions fail only the affected source photo", async () => {
  const readable = file("readable.jpg", 800, 1200);
  const invalid = file("invalid.jpg", 0, 0);
  const harness = makeHarness({
    getSelectedLayersTopToBottom: () => [layer(1, 800, 1200), layer(2, 800, 1200)],
    selectImageFiles: async () => [readable, invalid],
    inspectImageFiles: async () => ({
      photos: [
        { file: readable, width: 800, height: 1200 },
        { file: invalid, width: 0, height: 0 }
      ],
      errors: []
    })
  });

  const result = await executeAutoPhotoFill(harness.ui, harness.dependencies);
  assert.equal(result.outcome, "completed-with-errors");
  assert.equal(result.placedCount, 1);
  assert.deepEqual(harness.calls.movedFiles.map(item => item.name), ["readable.jpg"]);
  assert.ok(harness.calls.dialogs[0].lines.some(line => line.includes("invalid.jpg")));
});

test("an unreadable placeholder is identified while valid placeholders still fill", async () => {
  const source = file("portrait.jpg", 800, 1200);
  const validLayer = { ...layer(1, 800, 1200), name: "Portrait Frame" };
  const invalidLayer = { ...layer(2, 0, 0), name: "Broken Frame" };
  const harness = makeHarness({
    getSelectedLayersTopToBottom: () => [validLayer, invalidLayer],
    readBounds: selectedLayer => {
      if (selectedLayer.id === 2) throw new Error("bounds unavailable");
      return selectedLayer.bounds;
    },
    selectImageFiles: async () => [source]
  });

  const originalWarn = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = await executeAutoPhotoFill(harness.ui, harness.dependencies);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(result.outcome, "completed-with-errors");
  assert.equal(result.placedCount, 1);
  assert.ok(harness.calls.dialogs[0].lines.some(line =>
    line.includes("Broken Frame") && line.includes("bounds unavailable")
  ));
});

test("a failed rollback is reported with the placement failure", async () => {
  const source = file("portrait.jpg", 800, 1200);
  const placementError = new Error("scale failed");
  placementError.cleanupError = new Error("delete failed");
  const harness = makeHarness({
    getSelectedLayersTopToBottom: () => [layer(1, 800, 1200)],
    selectImageFiles: async () => [source],
    runPlacement: async items => ({
      placedItems: [],
      failedItems: [{ item: items[0], error: placementError }]
    })
  });

  const result = await executeAutoPhotoFill(harness.ui, harness.dependencies);
  assert.equal(result.outcome, "completed-with-errors");
  assert.ok(harness.calls.dialogs[0].lines.some(line =>
    line.includes("scale failed") && line.includes("Cleanup also failed: delete failed")
  ));
});

test("completion summaries use correct mismatch counts and singular wording", () => {
  const lines = buildCompletionSummary({
    placeholderCount: 4,
    photoCount: 4,
    placedCount: 2,
    failedPhotos: [],
    unmatchedPhotos: [{}, {}],
    moveFailures: []
  });
  assert.deepEqual(lines, [
    "2 photos placed successfully.",
    "2 placeholders skipped.",
    "2 photos skipped."
  ]);

  assert.deepEqual(buildCompletionSummary({
    placeholderCount: 1,
    photoCount: 1,
    placedCount: 1,
    failedPhotos: [],
    unmatchedPhotos: [],
    moveFailures: []
  }), [
    "1 photo placed successfully.",
    "All selected placeholders were filled."
  ]);
});

test("automatic placement options keep cover-fit, clipping, renaming, and moving enabled", () => {
  assert.deepEqual(AUTO_FILL_OPTIONS, {
    coverFit: true,
    clipToPlaceholder: true,
    renameLayer: true,
    moveUsedFiles: true
  });
});

test("dismissing the completion dialog cannot relabel successful Photoshop work as failed", async () => {
  const source = file("portrait.jpg", 800, 1200);
  const harness = makeHarness({
    getSelectedLayersTopToBottom: () => [layer(1, 800, 1200)],
    selectImageFiles: async () => [source]
  });
  harness.ui.showDialog = async () => {
    throw new Error("reasonCanceled");
  };

  const result = await executeAutoPhotoFill(harness.ui, harness.dependencies);
  assert.equal(result.outcome, "complete");
  assert.equal(result.placedCount, 1);
  assert.equal(harness.calls.statuses.at(-1).message, "Complete.");
});

test("a source move failure keeps the Photoshop placement successful and reports the move", async () => {
  const source = file("portrait.jpg", 800, 1200);
  const harness = makeHarness({
    getSelectedLayersTopToBottom: () => [layer(1, 800, 1200)],
    selectImageFiles: async () => [source],
    moveUsedFiles: async () => ({
      moved: [],
      failed: [{ file: source, error: new Error("permission denied") }]
    })
  });

  const result = await executeAutoPhotoFill(harness.ui, harness.dependencies);

  assert.equal(result.outcome, "completed-with-errors");
  assert.equal(result.placedCount, 1);
  assert.equal(harness.calls.statuses.at(-1).message, "Complete.");
  assert.ok(harness.calls.dialogs[0].lines.includes(
    "1 source photo could not be moved to Album Used."
  ));
});

for (const dismissal of [
  { name: "OK", showDialog: async () => "ok" },
  { name: "Escape", showDialog: async () => { throw new Error("reasonCanceled"); } },
  { name: "close X", showDialog: async () => { throw Object.assign(new Error("closed"), { code: "reasonCanceled" }); } }
]) {
  test(`successful processing stays Complete after ${dismissal.name} dismissal`, async () => {
    const source = file("portrait.jpg", 800, 1200);
    const harness = makeHarness({
      getSelectedLayersTopToBottom: () => [layer(1, 800, 1200)],
      selectImageFiles: async () => [source]
    });
    harness.ui.showDialog = dismissal.showDialog;
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);

    let result;
    try {
      result = await executeAutoPhotoFill(harness.ui, harness.dependencies);
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(result.outcome, "complete");
    assert.equal(harness.calls.statuses.at(-1).message, "Complete.");
    assert.deepEqual(warnings, []);
  });
}

test("move diagnostics are concise, categorized, and capped in the panel", async () => {
  const sources = Array.from({ length: 6 }, (_, i) => file(`photo-${i}.jpg`, 800, 1200));
  const harness = makeHarness({
    getSelectedLayersTopToBottom: () => sources.map((_, i) => layer(i, 800, 1200)),
    selectImageFiles: async () => sources,
    moveUsedFiles: async () => ({ moved: [], failed: sources.map(source => ({
      file: source,
      error: Object.assign(new Error("Access denied " + "detail ".repeat(100)), { code: "EACCES" }),
      diagnostic: { category: "PERMISSION", operation: "move source" }
    })) })
  });
  const result = await executeAutoPhotoFill(harness.ui, harness.dependencies);
  assert.equal(result.placedCount, 6);
  const lines = harness.calls.dialogs[0].lines;
  assert.ok(lines.includes("6 source photos could not be moved to Album Used."));
  const details = lines.filter(line => line.startsWith("Could not move"));
  assert.equal(details.length, 3);
  assert.ok(details.every(line => line.includes("PERMISSION") && line.includes("EACCES") && line.length < 350));
  assert.ok(lines.some(line => line.includes("3 more") && line.includes("console")));
});
