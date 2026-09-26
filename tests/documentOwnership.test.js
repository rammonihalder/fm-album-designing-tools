"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  snapshotDocumentIds,
  classifyOpenedDocument
} = require("../src/documentOwnership");

test("snapshotDocumentIds records each open document ID", () => {
  assert.deepEqual(snapshotDocumentIds([{ id: 3 }, { id: 8 }]), new Set([3, 8]));
});

test("the album document is never owned or closed by inspection", () => {
  assert.deepEqual(classifyOpenedDocument({ id: 3 }, new Set([3, 8]), 3), {
    isAlbum: true,
    wasAlreadyOpen: true,
    shouldClose: false
  });
});

test("an already-open source document is inspected without being closed", () => {
  assert.deepEqual(classifyOpenedDocument({ id: 8 }, new Set([3, 8]), 3), {
    isAlbum: false,
    wasAlreadyOpen: true,
    shouldClose: false
  });
});

test("a newly opened source document is owned and closed by inspection", () => {
  assert.deepEqual(classifyOpenedDocument({ id: 13 }, new Set([3, 8]), 3), {
    isAlbum: false,
    wasAlreadyOpen: false,
    shouldClose: true
  });
});
