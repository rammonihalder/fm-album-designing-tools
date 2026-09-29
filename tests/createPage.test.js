"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RESOLUTION,
  getPageSpec,
  buildAlbumGuidePlan,
  buildCustomSpec
} = require("../src/tools/createPage");

test("12x36 album preset is 10800x3600 at 300 DPI", () => {
  const spec = getPageSpec("album-12x36");
  assert.equal(RESOLUTION, 300);
  assert.equal(spec.widthPx, 10800);
  assert.equal(spec.heightPx, 3600);
  assert.equal(spec.album, true);
});

test("12x18 album preset is 5400x3600", () => {
  const spec = getPageSpec("album-12x18");
  assert.equal(spec.widthPx, 5400);
  assert.equal(spec.heightPx, 3600);
});

test("12x36 guides include outer safe margins and center safe zone", () => {
  const guides = buildAlbumGuidePlan(10800, 3600, 300);
  assert.deepEqual(guides.map(g => [g.direction, g.coordinate]), [
    ["vertical", 75],
    ["vertical", 10725],
    ["horizontal", 75],
    ["horizontal", 3525],
    ["vertical", 5325],
    ["vertical", 5400],
    ["vertical", 5475]
  ]);
});

test("12x18 guides center at 9 inches", () => {
  const guides = buildAlbumGuidePlan(5400, 3600, 300);
  const fold = guides.find(g => g.role === "center-fold");
  assert.equal(fold.coordinate, 2700);
});

test("social presets use requested pixel dimensions", () => {
  assert.deepEqual(
    [getPageSpec("instagram-post").widthPx, getPageSpec("instagram-post").heightPx],
    [1080, 1080]
  );
  assert.deepEqual(
    [getPageSpec("facebook-post").widthPx, getPageSpec("facebook-post").heightPx],
    [1200, 1500]
  );
  assert.deepEqual(
    [getPageSpec("youtube-thumbnail").widthPx, getPageSpec("youtube-thumbnail").heightPx],
    [1280, 720]
  );
});

test("custom inch dimensions are converted at 300 DPI", () => {
  const spec = buildCustomSpec({ width: 10, height: 8, unit: "in", background: "transparent" });
  assert.equal(spec.widthPx, 3000);
  assert.equal(spec.heightPx, 2400);
  assert.equal(spec.background, "transparent");
});
