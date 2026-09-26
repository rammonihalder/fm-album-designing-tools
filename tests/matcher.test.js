const test = require("node:test");
const assert = require("node:assert/strict");

const { ORIENTATIONS } = require("../src/orientation");
const { matchPhotosToPlaceholders } = require("../src/matcher");

const P = ORIENTATIONS.PORTRAIT;
const L = ORIENTATIONS.LANDSCAPE;
const F = ORIENTATIONS.FLEXIBLE;

function placeholder(id, orientation, order) {
  return { id, orientation, order, width: 100, height: 100 };
}

function photo(id, orientation, order) {
  return { id, orientation, order, width: 100, height: 100, file: { name: `${id}.jpg` } };
}

function ids(result) {
  return result.matches.map(match => `${match.photo.id}->${match.placeholder.id}`);
}

test("matches four portrait photos with four portrait placeholders", () => {
  const placeholders = [0, 1, 2, 3].map(i => placeholder(`p${i}`, P, i));
  const photos = [0, 1, 2, 3].map(i => photo(`a${i}`, P, i));
  const result = matchPhotosToPlaceholders(placeholders, photos);
  assert.deepEqual(ids(result), ["a0->p0", "a1->p1", "a2->p2", "a3->p3"]);
  assert.equal(result.unmatchedPlaceholders.length, 0);
  assert.equal(result.unmatchedPhotos.length, 0);
});

test("matches four landscape photos with four landscape placeholders", () => {
  const placeholders = [0, 1, 2, 3].map(i => placeholder(`l${i}`, L, i));
  const photos = [0, 1, 2, 3].map(i => photo(`b${i}`, L, i));
  const result = matchPhotosToPlaceholders(placeholders, photos);
  assert.deepEqual(ids(result), ["b0->l0", "b1->l1", "b2->l2", "b3->l3"]);
});

test("force-fills a portrait photo into a remaining landscape placeholder", () => {
  const result = matchPhotosToPlaceholders([placeholder("l0", L, 0)], [photo("p0", P, 0)]);
  assert.deepEqual(ids(result), ["p0->l0"]);
  assert.equal(result.unmatchedPlaceholders.length, 0);
  assert.equal(result.unmatchedPhotos.length, 0);
});

test("force-fills a landscape photo into a remaining portrait placeholder", () => {
  const result = matchPhotosToPlaceholders([placeholder("p0", P, 0)], [photo("l0", L, 0)]);
  assert.deepEqual(ids(result), ["l0->p0"]);
  assert.equal(result.unmatchedPlaceholders.length, 0);
  assert.equal(result.unmatchedPhotos.length, 0);
});

test("flexible placeholders accept portrait photos", () => {
  assert.deepEqual(ids(matchPhotosToPlaceholders([placeholder("f0", F, 0)], [photo("p0", P, 0)])), ["p0->f0"]);
});

test("flexible placeholders accept landscape photos", () => {
  assert.deepEqual(ids(matchPhotosToPlaceholders([placeholder("f0", F, 0)], [photo("l0", L, 0)])), ["l0->f0"]);
});

test("flexible placeholders accept square photos", () => {
  assert.deepEqual(ids(matchPhotosToPlaceholders([placeholder("f0", F, 0)], [photo("s0", F, 0)])), ["s0->f0"]);
});

test("reports one unmatched placeholder for four slots and three compatible photos", () => {
  const placeholders = [0, 1, 2, 3].map(i => placeholder(`p${i}`, P, i));
  const photos = [0, 1, 2].map(i => photo(`a${i}`, P, i));
  const result = matchPhotosToPlaceholders(placeholders, photos);
  assert.equal(result.matches.length, 3);
  assert.deepEqual(result.unmatchedPlaceholders.map(item => item.id), ["p3"]);
  assert.equal(result.unmatchedPhotos.length, 0);
});

test("reports two unmatched photos for four slots and six compatible photos", () => {
  const placeholders = [0, 1, 2, 3].map(i => placeholder(`p${i}`, P, i));
  const photos = [0, 1, 2, 3, 4, 5].map(i => photo(`a${i}`, P, i));
  const result = matchPhotosToPlaceholders(placeholders, photos);
  assert.equal(result.matches.length, 4);
  assert.deepEqual(result.unmatchedPhotos.map(item => item.id), ["a4", "a5"]);
});

test("equal counts fill every placeholder regardless of orientation mix", () => {
  const placeholders = [0, 1, 2, 3].map(i => placeholder(`p${i}`, P, i));
  const photos = [photo("p0", P, 0), photo("p1", P, 1), photo("l0", L, 2), photo("l1", L, 3)];
  const result = matchPhotosToPlaceholders(placeholders, photos);
  assert.deepEqual(ids(result), ["p0->p0", "p1->p1", "l0->p2", "l1->p3"]);
  assert.equal(result.unmatchedPlaceholders.length, 0);
  assert.equal(result.unmatchedPhotos.length, 0);
});

test("preserves selected photo order within an orientation", () => {
  const placeholders = [placeholder("p1", P, 0), placeholder("p2", P, 1)];
  const photos = [photo("second-name", P, 0), photo("first-name", P, 1)];
  assert.deepEqual(ids(matchPhotosToPlaceholders(placeholders, photos)), ["second-name->p1", "first-name->p2"]);
});

test("preserves placeholder order within an orientation", () => {
  const placeholders = [placeholder("top", L, 0), placeholder("bottom", L, 1)];
  const photos = [photo("a", L, 0), photo("b", L, 1)];
  assert.deepEqual(ids(matchPhotosToPlaceholders(placeholders, photos)), ["a->top", "b->bottom"]);
});

test("exact orientation matches take priority over flexible slots", () => {
  const placeholders = [placeholder("flex", F, 0), placeholder("portrait", P, 1)];
  const photos = [photo("portrait-photo", P, 0), photo("square-photo", F, 1)];
  assert.deepEqual(ids(matchPhotosToPlaceholders(placeholders, photos)), ["square-photo->flex", "portrait-photo->portrait"]);
});

test("a square photo does not steal a native slot needed by an exact match", () => {
  const placeholders = [placeholder("flex", F, 0), placeholder("landscape", L, 1)];
  const photos = [photo("square-photo", F, 0), photo("landscape-photo", L, 1)];
  assert.deepEqual(ids(matchPhotosToPlaceholders(placeholders, photos)), ["square-photo->flex", "landscape-photo->landscape"]);
});

test("square photos fall back to an unmatched native placeholder", () => {
  const result = matchPhotosToPlaceholders([placeholder("portrait", P, 0)], [photo("square", F, 0)]);
  assert.deepEqual(ids(result), ["square->portrait"]);
});

test("remaining flexible placeholders consume remaining photos in original order", () => {
  const placeholders = [placeholder("f0", F, 0), placeholder("f1", F, 1)];
  const photos = [photo("landscape-first", L, 0), photo("portrait-second", P, 1)];
  assert.deepEqual(ids(matchPhotosToPlaceholders(placeholders, photos)), ["landscape-first->f0", "portrait-second->f1"]);
});

test("a flexible placeholder is used before a forced native-orientation mismatch", () => {
  const placeholders = [placeholder("portrait", P, 0), placeholder("flex", F, 1)];
  const photos = [photo("landscape", L, 0), photo("portrait", P, 1)];
  assert.deepEqual(ids(matchPhotosToPlaceholders(placeholders, photos)), [
    "portrait->portrait",
    "landscape->flex"
  ]);
});

test("two portrait photos fill two landscape placeholders in stable order", () => {
  const placeholders = [placeholder("l0", L, 0), placeholder("l1", L, 1)];
  const photos = [photo("p0", P, 0), photo("p1", P, 1)];
  const result = matchPhotosToPlaceholders(placeholders, photos);
  assert.deepEqual(ids(result), ["p0->l0", "p1->l1"]);
  assert.equal(result.unmatchedPhotos.length, 0);
  assert.equal(result.unmatchedPlaceholders.length, 0);
});

test("exact matches are protected before forced fallback", () => {
  const placeholders = [
    placeholder("landscape-top", L, 0),
    placeholder("portrait-bottom", P, 1)
  ];
  const photos = [photo("portrait-first", P, 0), photo("portrait-second", P, 1)];
  assert.deepEqual(ids(matchPhotosToPlaceholders(placeholders, photos)), [
    "portrait-second->landscape-top",
    "portrait-first->portrait-bottom"
  ]);
});

test("three portrait and one landscape photo fill two portrait and two landscape placeholders", () => {
  const placeholders = [
    placeholder("p0", P, 0),
    placeholder("p1", P, 1),
    placeholder("l0", L, 2),
    placeholder("l1", L, 3)
  ];
  const photos = [
    photo("p0", P, 0),
    photo("p1", P, 1),
    photo("p2", P, 2),
    photo("l0", L, 3)
  ];
  const result = matchPhotosToPlaceholders(placeholders, photos);
  assert.deepEqual(ids(result), ["p0->p0", "p1->p1", "l0->l0", "p2->l1"]);
  assert.equal(result.unmatchedPhotos.length, 0);
  assert.equal(result.unmatchedPlaceholders.length, 0);
});

test("forced fallback preserves the original remaining photo and placeholder order", () => {
  const placeholders = [
    placeholder("top", L, 10),
    placeholder("bottom", L, 20)
  ];
  const photos = [
    photo("first", P, 10),
    photo("second", P, 20)
  ];
  assert.deepEqual(ids(matchPhotosToPlaceholders(placeholders, photos)), [
    "first->top",
    "second->bottom"
  ]);
});

test("does not mutate the input arrays or items", () => {
  const placeholders = [placeholder("p0", P, 0), placeholder("f0", F, 1)];
  const photos = [photo("a0", P, 0), photo("s0", F, 1)];
  const beforePlaceholders = JSON.parse(JSON.stringify(placeholders));
  const beforePhotos = JSON.parse(JSON.stringify(photos));
  matchPhotosToPlaceholders(placeholders, photos);
  assert.deepEqual(placeholders, beforePlaceholders);
  assert.deepEqual(photos, beforePhotos);
});
