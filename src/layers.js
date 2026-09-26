const { app } = require("photoshop");

function flattenLayers(layers, output) {
  output = output || [];
  for (const layer of layers) {
    output.push(layer);
    if (layer.layers && layer.layers.length) {
      flattenLayers(layer.layers, output);
    }
  }
  return output;
}

function getSelectedLayersTopToBottom() {
  if (!app.documents.length) return [];

  const doc = app.activeDocument;
  const selectedIds = new Set(Array.from(doc.activeLayers || []).map(layer => layer.id));
  if (!selectedIds.size) return [];

  const ordered = flattenLayers(doc.layers, []);
  return ordered.filter(layer => selectedIds.has(layer.id));
}

function resolveLayersByIds(ids) {
  if (!app.documents.length || !ids || !ids.length) return [];
  const idSet = new Set(ids);
  return flattenLayers(app.activeDocument.layers, []).filter(layer => idSet.has(layer.id));
}

module.exports = {
  flattenLayers,
  getSelectedLayersTopToBottom,
  resolveLayersByIds
};
