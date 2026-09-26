const { ORIENTATIONS } = require("./orientation");

function stableByOrder(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aOrder = Number.isFinite(a.item.order) ? a.item.order : a.index;
      const bOrder = Number.isFinite(b.item.order) ? b.item.order : b.index;
      return aOrder - bOrder || a.index - b.index;
    })
    .map(entry => entry.item);
}

function matchPhotosToPlaceholders(placeholders, photos) {
  const orderedPlaceholders = stableByOrder(Array.from(placeholders || []));
  const orderedPhotos = stableByOrder(Array.from(photos || []));
  const availablePlaceholders = new Set(orderedPlaceholders);
  const availablePhotos = new Set(orderedPhotos);
  const matches = [];

  function addMatch(photo, placeholder) {
    matches.push({ photo, placeholder });
    availablePhotos.delete(photo);
    availablePlaceholders.delete(placeholder);
  }

  function matchOrientation(photoOrientation, placeholderOrientation) {
    const candidates = orderedPhotos.filter(photo =>
      availablePhotos.has(photo) && photo.orientation === photoOrientation
    );
    const slots = orderedPlaceholders.filter(placeholder =>
      availablePlaceholders.has(placeholder) && placeholder.orientation === placeholderOrientation
    );
    const count = Math.min(candidates.length, slots.length);
    for (let i = 0; i < count; i++) addMatch(candidates[i], slots[i]);
  }

  matchOrientation(ORIENTATIONS.PORTRAIT, ORIENTATIONS.PORTRAIT);
  matchOrientation(ORIENTATIONS.LANDSCAPE, ORIENTATIONS.LANDSCAPE);
  matchOrientation(ORIENTATIONS.FLEXIBLE, ORIENTATIONS.FLEXIBLE);

  const remainingFlexibleSlots = orderedPlaceholders.filter(placeholder =>
    availablePlaceholders.has(placeholder) && placeholder.orientation === ORIENTATIONS.FLEXIBLE
  );
  const remainingPhotos = orderedPhotos.filter(photo => availablePhotos.has(photo));
  const flexibleCount = Math.min(remainingFlexibleSlots.length, remainingPhotos.length);
  for (let i = 0; i < flexibleCount; i++) addMatch(remainingPhotos[i], remainingFlexibleSlots[i]);

  const fallbackPhotos = orderedPhotos.filter(photo => availablePhotos.has(photo));
  const fallbackPlaceholders = orderedPlaceholders.filter(placeholder =>
    availablePlaceholders.has(placeholder)
  );
  const fallbackCount = Math.min(fallbackPhotos.length, fallbackPlaceholders.length);
  for (let i = 0; i < fallbackCount; i++) {
    addMatch(fallbackPhotos[i], fallbackPlaceholders[i]);
  }

  const placeholderIndex = new Map(orderedPlaceholders.map((placeholder, index) => [placeholder, index]));
  matches.sort((a, b) => placeholderIndex.get(a.placeholder) - placeholderIndex.get(b.placeholder));

  return {
    matches,
    unmatchedPlaceholders: orderedPlaceholders.filter(item => availablePlaceholders.has(item)),
    unmatchedPhotos: orderedPhotos.filter(item => availablePhotos.has(item))
  };
}

module.exports = {
  matchPhotosToPlaceholders
};
