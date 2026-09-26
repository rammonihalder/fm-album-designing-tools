"use strict";

function snapshotDocumentIds(documents) {
  return new Set(Array.from(documents || [], document => document.id));
}

function classifyOpenedDocument(document, preExistingIds, albumDocumentId) {
  const isAlbum = Boolean(document) && document.id === albumDocumentId;
  const wasAlreadyOpen = Boolean(document) && preExistingIds.has(document.id);

  return {
    isAlbum,
    wasAlreadyOpen,
    shouldClose: Boolean(document) && !isAlbum && !wasAlreadyOpen
  };
}

module.exports = {
  snapshotDocumentIds,
  classifyOpenedDocument
};
