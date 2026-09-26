const state = {
  selectedLayerIds: [],
  selectedPhotos: [],
  running: false,
  options: {
    coverFit: true,
    clipToPlaceholder: true,
    renameLayer: true,
    moveUsedFiles: true,
    orderMode: "stack"
  }
};

module.exports = state;
