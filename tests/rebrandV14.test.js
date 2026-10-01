"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

test("v1.4 manifest uses the Frame Mitra product name and version without changing plugin ID", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.name, "FM Album Designing Tools");
  assert.equal(manifest.version, "1.4.1");
  assert.equal(manifest.id, "in.memorymaker.albumplacer");
  assert.equal(manifest.entrypoints[0].label.default, "FM Album Designing Tools");
});

test("v1.4 panel exposes exact Frame Mitra brand, product, version, footer, and accessible purchase copy", () => {
  const html = read("index.html");
  assert.match(html, />FRAME MITRA</);
  assert.match(html, />FM Album Designing Tools</);
  assert.match(html, />v1\.4\.1</);
  assert.match(html, />Developed by Hridita Innovations</);
  assert.match(html, /aria-label="Buy FM Album Designing Tools license via WhatsApp"/);
});

test("v1.4 licensing constants use exact purchase copy and preserve WhatsApp contact", () => {
  const constants = require("../src/licensing/constants");
  assert.equal(constants.PLUGIN_VERSION, "1.4.1");
  assert.equal(constants.ADMIN_CONTACT_DISPLAY, "7001514367");
  assert.equal(constants.ADMIN_CONTACT_E164, "917001514367");
  assert.equal(constants.ADMIN_WHATSAPP_MESSAGE, "I want to buy a license for FM Album Designing Tools.");
  assert.equal(
    constants.getAdminWhatsAppUrl(),
    "https://wa.me/917001514367?text=" + encodeURIComponent("I want to buy a license for FM Album Designing Tools.")
  );
});

test("v1.4 license user messages identify Frame Mitra", () => {
  const { SAFE_USER_MESSAGES } = require("../src/licensing/licenseManager");
  assert.equal(SAFE_USER_MESSAGES.UNACTIVATED, "Activate FM Album Designing Tools to continue.");
  assert.equal(SAFE_USER_MESSAGES.SUSPENDED, "This license is temporarily unavailable. Please contact Frame Mitra.");
});

test("v1.4 current source uses FM product log prefixes and removes old current UI product copy", () => {
  const sources = [
    read("main.js"),
    read("src/licensing/constants.js"),
    read("src/tools/autoPhotoFill.js"),
    read("src/tools/openPsd.js"),
    read("src/tools/swapPhotos.js"),
    read("src/photoshop.js")
  ].join("\n");
  assert.match(sources, /\[FM UI\]/);
  assert.match(sources, /\[FM License\]/);
  assert.match(sources, /\[FM Swap Photos\]/);
  assert.doesNotMatch(sources, /MM Album Design Tools/);
  assert.doesNotMatch(sources, /Memory Maker - Save PSD/);
});

test("v1.4 secureStorage keys and compatibility identifiers remain unchanged", () => {
  const { STORAGE_KEYS } = require("../src/licensing/constants");
  assert.equal(STORAGE_KEYS.SIGNED_TOKEN, "mm_license_signed_token_v1");
  assert.equal(STORAGE_KEYS.LICENSE_METADATA, "mm_license_metadata_v1");
  assert.equal(STORAGE_KEYS.DEVICE_ID, "mm_license_device_id_v1");
});

test("v1.4 page naming uses FMRLT with correct serial extraction and ignores legacy MMRLT", () => {
  const { extractAlbumSerial, buildPageBaseName, getNextPageNumber } = require("../src/tools/savePage");
  assert.equal(extractAlbumSerial("FMRLT1.psd"), 1);
  assert.equal(extractAlbumSerial("Riya_FMRLT8.psd"), 8);
  assert.equal(extractAlbumSerial("ABC_FMRLT15.jpg"), 15);
  assert.equal(extractAlbumSerial("MMRLT1.psd"), null, "legacy MMRLT must be ignored");

  assert.equal(buildPageBaseName("", 1), "FMRLT1");
  assert.equal(buildPageBaseName("Riya", 8), "Riya_FMRLT8");
  assert.equal(getNextPageNumber(["FMRLT8.psd"], ["Riya_FMRLT10.jpg"]), 11);
});

test("v1.4 edited photo naming uses FM<n> LT/DT and ignores legacy Memory Maker names", () => {
  const {
    buildEditedPhotoFileName,
    extractEditedPhotoNumber,
    findNextEditedPhotoNumber
  } = require("../src/tools/saveEditedPhotos");

  assert.equal(buildEditedPhotoFileName(1, "LT"), "FM1 LT.jpg");
  assert.equal(buildEditedPhotoFileName(2, "DT"), "FM2 DT.jpg");

  assert.equal(extractEditedPhotoNumber("FM1 LT.jpg"), 1);
  assert.equal(extractEditedPhotoNumber("FM2 DT.jpg"), 2);
  assert.equal(extractEditedPhotoNumber("Memory Maker 1 LT.jpg"), null, "legacy name ignored");

  assert.equal(findNextEditedPhotoNumber(["FM1 LT.jpg", "FM3 DT.jpg"]), 2);
  assert.equal(findNextEditedPhotoNumber(["FM1 LT.jpg", "FM4 DT.jpg"]), 2);
  assert.equal(findNextEditedPhotoNumber(["FM1 LT.jpg", "FM2 LT.jpg"]), 3);
});

