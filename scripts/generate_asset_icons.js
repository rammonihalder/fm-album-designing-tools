"use strict";
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (-(c & 1) & 0xedb88320);
  }
  return ~c >>> 0;
}

function makePng(drawFn) {
  const width = 64, height = 64;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const alpha = drawFn(x, y);
      if (alpha > 0) {
        raw[pxOffset] = 255;
        raw[pxOffset + 1] = 255;
        raw[pxOffset + 2] = 255;
        raw[pxOffset + 3] = Math.min(255, Math.max(0, Math.round(alpha)));
      }
    }
  }
  const idatData = zlib.deflateSync(raw);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// 1. ADD ASSET icon: A layered asset square (stacked cards/shapes) with a plus sign
const addAssetPng = makePng((x, y) => {
  // Main asset card: x: 12..44, y: 12..48
  // Back card corner: x: 18..52, y: 8..14 and x: 44..52, y: 8..40
  const inBackCard = (x >= 44 && x <= 50 && y >= 10 && y <= 42) ||
                     (x >= 20 && x <= 50 && y >= 10 && y <= 15);
  // Main card border (outline 3px)
  const inMainCard = x >= 12 && x <= 44 && y >= 16 && y <= 48;
  const inMainInner = x >= 15 && x <= 41 && y >= 19 && y <= 45;
  const isMainBorder = inMainCard && !inMainInner;

  // Star / diamond shape inside main card (x: 20..36, y: 24..40)
  const dx = Math.abs(x - 28), dy = Math.abs(y - 32);
  const inDiamond = (dx + dy <= 8);

  // Plus badge at bottom-right (center: 44, 44, radius ~9)
  const plusDist = Math.hypot(x - 45, y - 45);
  const inPlusBadge = plusDist <= 10;
  const isPlusHoriz = x >= 39 && x <= 51 && y >= 43 && y <= 47;
  const isPlusVert = x >= 43 && x <= 47 && y >= 39 && y <= 51;
  const isPlus = isPlusHoriz || isPlusVert;

  if (isPlus) return 255;
  if (inPlusBadge) return 0; // Cutout for badge
  if (isMainBorder || inBackCard || inDiamond) return 255;
  return 0;
});

// 2. SAVE ASSET icon: An asset card with a downward save arrow and tray
const saveAssetPng = makePng((x, y) => {
  // Tray / folder at bottom: y: 44..52, x: 12..52
  const inTray = (y >= 46 && y <= 50 && x >= 12 && x <= 52) ||
                 (x >= 12 && x <= 16 && y >= 36 && y <= 50) ||
                 (x >= 48 && x <= 52 && y >= 36 && y <= 50);

  // Arrow pointing down: stem x: 30..34, y: 12..32
  const isStem = x >= 29 && x <= 35 && y >= 12 && y <= 32;
  // Arrow head: triangle pointing down from y: 30 to y: 42
  const arrowDist = (y >= 30 && y <= 42 && Math.abs(x - 32) <= (42 - y));

  // Side decorative brackets / card lines
  const leftBracket = x >= 14 && x <= 17 && y >= 18 && y <= 30;
  const rightBracket = x >= 47 && x <= 50 && y >= 18 && y <= 30;

  if (inTray || isStem || arrowDist || leftBracket || rightBracket) return 255;
  return 0;
});

const iconsDir = path.join(__dirname, "..", "assets", "icons");
fs.writeFileSync(path.join(iconsDir, "add-asset.png"), addAssetPng);
fs.writeFileSync(path.join(iconsDir, "save-asset.png"), saveAssetPng);
console.log("Successfully generated add-asset.png and save-asset.png");
