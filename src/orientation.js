const ORIENTATION_CONFIG = Object.freeze({
  portraitMaxRatio: 0.9,
  landscapeMinRatio: 1.1
});

const ORIENTATIONS = Object.freeze({
  PORTRAIT: "portrait",
  LANDSCAPE: "landscape",
  FLEXIBLE: "flexible"
});

function classifyDimensions(width, height, config) {
  const activeConfig = config || ORIENTATION_CONFIG;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Image dimensions must be positive finite numbers.");
  }

  const ratio = width / height;
  if (ratio < activeConfig.portraitMaxRatio) return ORIENTATIONS.PORTRAIT;
  if (ratio > activeConfig.landscapeMinRatio) return ORIENTATIONS.LANDSCAPE;
  return ORIENTATIONS.FLEXIBLE;
}

module.exports = {
  ORIENTATION_CONFIG,
  ORIENTATIONS,
  classifyDimensions
};
