const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ORIENTATION_CONFIG,
  ORIENTATIONS,
  classifyDimensions
} = require("../src/orientation");

test("classifies ratios below the portrait threshold as portrait", () => {
  assert.equal(classifyDimensions(89, 100), ORIENTATIONS.PORTRAIT);
});

test("classifies ratios above the landscape threshold as landscape", () => {
  assert.equal(classifyDimensions(111, 100), ORIENTATIONS.LANDSCAPE);
});

test("treats both orientation thresholds as flexible", () => {
  assert.equal(classifyDimensions(90, 100), ORIENTATIONS.FLEXIBLE);
  assert.equal(classifyDimensions(110, 100), ORIENTATIONS.FLEXIBLE);
  assert.deepEqual(ORIENTATION_CONFIG, {
    portraitMaxRatio: 0.9,
    landscapeMinRatio: 1.1
  });
});

test("rejects invalid dimensions instead of silently misclassifying them", () => {
  assert.throws(() => classifyDimensions(0, 100), /positive/);
  assert.throws(() => classifyDimensions(100, Number.NaN), /positive/);
});
