const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];
const browserPath = chromeCandidates.find(candidate => fs.existsSync(candidate));

function buildProbePage(runDirectory, width, height) {
  const source = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
  const styleUrl = pathToFileURL(path.join(projectRoot, "style.css")).href;
  const mainUrl = pathToFileURL(path.join(projectRoot, "main.js")).href;

  const requireStub = `
    <script>
      const probeState = {
        selectedLayerIds: [],
        selectedPhotos: [],
        running: false
      };
      window.require = name => {
        if (name === "photoshop") return { app: { documents: [] } };
        if (name === "./src/tools/openPsd") return { runOpenPsd: async () => ({ outcome: "success", successCount: 1, failureCount: 0 }) };
        if (name === "./src/tools/autoPhotoFill") return { runAutoPhotoFill: async () => ({ outcome: "complete", placedCount: 2 }) };
        if (name === "./src/tools/swapPhotos") return { runSwapPhotos: async () => ({ success: true, count: 2, message: "2 photos swapped" }) };
        if (name === "./src/tools/flipPhoto") return { runFlipPhoto: async () => ({ outcome: "success", flippedCount: 1, skippedCount: 0 }) };
        if (name === "./src/tools/savePage") return {
          runSavePage: async () => ({ outcome: "success", fileName: "MMRLT1" }),
          buildSavePageToast: () => ({ message: "Saved: MMRLT1", type: "success" }),
          isValidPrefix: () => true
        };
        if (name === "./src/tools/saveEditedPhotos") return {
          runSaveEditedPhotos: async () => ({ outcome: "success", successCount: 1, failedCount: 0 }),
          buildSaveEditedPhotosToast: () => ({ message: "1 edited photo saved", type: "success" })
        };
        if (name === "./src/tools/savePsdCategory") return {
          runSavePsdCategory: async () => ({ outcome: "success", fileName: "MMR 3 PHOTOS 01 PC.psd" })
        };
        if (name === "./src/tools/removePhotos") return {
          runRemovePhotos: async () => ({ outcome: "success", removedCount: 1, failedCount: 0 }),
          buildRemovePhotosToast: () => ({ message: "1 photo removed", type: "success" })
        };
        if (name === "./src/ui/toast") return {
          createToastManager: el => ({
            show: (msg, type) => {
              if (!el) return;
              el.textContent = msg;
              el.className = "toast " + (type || "info");
              el.hidden = false;
            },
            dismiss: () => {
              if (!el) return;
              el.hidden = true;
              el.textContent = "";
            }
          })
        };
        if (name === "./src/state") return probeState;
        if (name === "./src/layers") {
          return { getSelectedLayersTopToBottom: () => [], resolveLayersByIds: () => [] };
        }
        if (name === "./src/files") {
          return { selectImageFiles: async () => [], moveUsedFiles: async () => {} };
        }
        if (name === "./src/photoshop") return { runPlacement: async () => {}, fitCover: async () => {}, runSwapExecution: async () => {} };
        throw new Error("Unexpected module: " + name);
      };
    </script>`;

  const probeScript = `
    <script>
      const rect = element => {
        if (!element) return null;
        const value = element.getBoundingClientRect();
        return {
          top: value.top,
          right: value.right,
          bottom: value.bottom,
          left: value.left,
          width: value.width,
          height: value.height
        };
      };
      const overlaps = (first, second) => Boolean(first && second &&
        first.left < second.right && first.right > second.left &&
        first.top < second.bottom && first.bottom > second.top);
      const panel = document.querySelector(".panel");
      const toolButtonsSection = document.querySelector(".tool-section") || document.querySelector(".tool-buttons") || document.querySelector(".tools-section");
      const toolButtonsSectionRect = rect(toolButtonsSection);
      const toolRows = Array.from(document.querySelectorAll(".tool-row"));
      const toolActions = Array.from(document.querySelectorAll(".tool-action"));
      const actionDetails = toolActions.map(el => {
        const img = el.querySelector("img.tool-icon");
        const iconSlot = el.querySelector(".tool-icon-slot");
        const label = el.querySelector(".tool-label");
        const balanceSlot = el.querySelector(".tool-balance-slot");
        return {
          id: el.id,
          tagName: el.tagName,
          role: el.getAttribute("role"),
          tabIndex: el.getAttribute("tabindex"),
          className: el.className,
          bgColor: getComputedStyle(el).backgroundColor,
          borderColor: getComputedStyle(el).borderColor,
          iconSrc: img ? img.getAttribute("src") : null,
          hasImg: !!img,
          hasIconSlot: !!iconSlot,
          hasLabel: !!label,
          hasBalanceSlot: !!balanceSlot,
          iconSlotCount: el.querySelectorAll(".tool-icon-slot").length,
          labelCount: el.querySelectorAll(".tool-label").length,
          balanceSlotCount: el.querySelectorAll(".tool-balance-slot").length,
          iconWidth: img ? getComputedStyle(img).width : null,
          iconHeight: img ? getComputedStyle(img).height : null,
          iconSlotWidth: iconSlot ? getComputedStyle(iconSlot).width : null,
          balanceSlotWidth: balanceSlot ? getComputedStyle(balanceSlot).width : null,
          labelText: label ? label.textContent.trim() : "",
          labelFlex: label ? getComputedStyle(label).flex : null,
          labelTextAlign: label ? getComputedStyle(label).textAlign : null,
          imgPointerEvents: img ? getComputedStyle(img).pointerEvents : null,
          iconSlotPointerEvents: iconSlot ? getComputedStyle(iconSlot).pointerEvents : null,
          labelPointerEvents: label ? getComputedStyle(label).pointerEvents : null,
          balanceSlotPointerEvents: balanceSlot ? getComputedStyle(balanceSlot).pointerEvents : null
        };
      });
      const rowCounts = toolRows.map(r => r.querySelectorAll(".tool-action").length);

      const openBtn = document.getElementById("openPsdBtn");
      const autoBtn = document.getElementById("autoPhotoFillBtn");
      const swapBtn = document.getElementById("swapPhotosBtn");
      const flipBtn = document.getElementById("flipPhotoBtn");
      const saveBtn = document.getElementById("savePageBtn");
      const saveEditedBtn = document.getElementById("saveEditedPhotosBtn");
      const savePsdCategoryBtn = document.getElementById("savePsdCategoryBtn");
      const removeBtn = document.getElementById("removePhotosBtn");

      const openBtnRect = rect(openBtn);
      const autoBtnRect = rect(autoBtn);
      const swapBtnRect = rect(swapBtn);
      const flipBtnRect = rect(flipBtn);
      const saveBtnRect = rect(saveBtn);
      const saveEditedBtnRect = rect(saveEditedBtn);
      const savePsdCategoryBtnRect = rect(savePsdCategoryBtn);
      const removeBtnRect = rect(removeBtn);

      const toastEl = document.getElementById("toast");
      toastEl.textContent = "2 photos swapped";
      toastEl.className = "toast success";
      toastEl.hidden = false;
      const toastRect = rect(toastEl);
      const panelRect = rect(panel);

      const allBtns = [
        openBtnRect, autoBtnRect, swapBtnRect, flipBtnRect,
        saveBtnRect, saveEditedBtnRect, savePsdCategoryBtnRect, removeBtnRect
      ];
      let anyBtnOverlap = false;
      for (let i = 0; i < allBtns.length; i++) {
        for (let j = i + 1; j < allBtns.length; j++) {
          if (overlaps(allBtns[i], allBtns[j])) {
            anyBtnOverlap = true;
          }
        }
      }

      const svgCountInButtons = document.querySelectorAll(".tool-section svg, .tool-row svg, .tool-action svg, .tool-buttons svg, .tools-section svg").length;
      const wrapperDisplay = toolButtonsSection ? getComputedStyle(toolButtonsSection).display : null;
      const wrapperPosition = toolButtonsSection ? getComputedStyle(toolButtonsSection).position : null;

      const result = {
        viewport: { width: innerWidth, height: innerHeight },
        panel: {
          clientWidth: panel.clientWidth,
          scrollWidth: panel.scrollWidth,
          clientHeight: panel.clientHeight,
          scrollHeight: panel.scrollHeight,
          overflowX: getComputedStyle(panel).overflowX,
          overflowY: getComputedStyle(panel).overflowY
        },
        panelRect,
        toolButtonsSection: toolButtonsSectionRect,
        toolRowsCount: toolRows.length,
        rowCounts,
        actionDetails,
        wrapperPosition,
        wrapperDisplay,
        svgCountInButtons,
        toolButtons: document.querySelectorAll("[data-tool]").length,
        openBtn: openBtnRect,
        autoBtn: autoBtnRect,
        swapBtn: swapBtnRect,
        flipBtn: flipBtnRect,
        saveBtn: saveBtnRect,
        saveEditedBtn: saveEditedBtnRect,
        savePsdCategoryBtn: savePsdCategoryBtnRect,
        removeBtn: removeBtnRect,
        buttonsOverlap: anyBtnOverlap,
        toastRect,
        toastVisible: !toastEl.hidden,
        toastPosition: getComputedStyle(toastEl).position,
        toastOverlapsButtons: allBtns.some(b => overlaps(b, toastRect)),
        popupCount: document.querySelectorAll("dialog[open]:not([hidden])").length,
        brandPrefix: document.querySelector(".header-brand-prefix")?.textContent?.trim() || "",
        title: document.querySelector("h1")?.textContent?.trim() || "",
        version: document.querySelector(".version")?.textContent?.trim() || "",
        footerText: document.querySelector(".footer-credit")?.textContent?.trim() || document.querySelector(".footer-text")?.textContent?.trim() || "",
        removeBtnClass: removeBtn ? removeBtn.className : "",
        openBtnClass: openBtn ? openBtn.className : "",
        documentScrollWidth: document.documentElement.scrollWidth
      };

      window.__layoutProbe = result;
    </script>`;

  const instrumented = source
    .replace('href="style.css"', `href="${styleUrl}"`)
    .replace('<script src="main.js"></script>', `${requireStub}<script src="${mainUrl}"></script>${probeScript}`);

  const panelPath = path.join(runDirectory, "panel.html");
  fs.writeFileSync(panelPath, instrumented, "utf8");

  const wrapper = `<!doctype html>
    <html>
      <head><meta charset="utf-8"><title>WAITING_FOR_LAYOUT_PROBE</title></head>
      <body style="margin:0;overflow:hidden">
        <iframe id="panelFrame" src="${pathToFileURL(panelPath).href}"
          style="display:block;width:${width}px;height:${height}px;border:0"></iframe>
        <script>
          const frame = document.getElementById("panelFrame");
          const publishResult = () => {
            const result = frame.contentWindow && frame.contentWindow.__layoutProbe;
            if (!result) {
              setTimeout(publishResult, 10);
              return;
            }
            document.title = "LAYOUT_PROBE:" + btoa(JSON.stringify(result));
          };
          frame.addEventListener("load", publishResult);
        </script>
      </body>
    </html>`;
  const wrapperPath = path.join(runDirectory, "layout-probe.html");
  fs.writeFileSync(wrapperPath, wrapper, "utf8");
  return wrapperPath;
}

function renderAt(width, height) {
  assert.ok(browserPath, "Chrome or Edge is required for layout regression tests");

  const testsRoot = path.resolve(__dirname);
  const runDirectory = fs.mkdtempSync(path.join(testsRoot, ".layout-run-"));
  assert.ok(runDirectory.startsWith(testsRoot + path.sep), "temporary layout directory must stay inside tests");

  try {
    const pagePath = buildProbePage(runDirectory, width, height);
    const userDataDirectory = path.join(runDirectory, "browser-profile");
    const result = spawnSync(browserPath, [
      "--headless=new",
      "--disable-gpu",
      "--allow-file-access-from-files",
      `--user-data-dir=${userDataDirectory}`,
      "--window-size=1000,1000",
      "--virtual-time-budget=1000",
      "--dump-dom",
      pathToFileURL(pagePath).href
    ], { encoding: "utf8", timeout: 30000 });

    assert.equal(result.status, 0, result.stderr || "headless browser failed");
    const match = result.stdout.match(/<title>LAYOUT_PROBE:([^<]+)<\/title>/);
    assert.ok(match, `layout probe did not complete:\n${result.stderr}\n${result.stdout.slice(0, 500)}`);
    return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
  } finally {
    fs.rmSync(runDirectory, { recursive: true, force: true });
  }
}

function assertCommonLayout(layout) {
  assert.ok(["auto", "scroll"].includes(layout.panel.overflowY), "the panel must own vertical scrolling");
  assert.equal(layout.panel.overflowX, "hidden", "the panel must suppress horizontal overflow");
  assert.ok(layout.panel.scrollWidth <= layout.panel.clientWidth, "panel content must not overflow horizontally");
  assert.ok(layout.documentScrollWidth <= layout.viewport.width, "document must not create a horizontal scrollbar");
  assert.equal(layout.wrapperPosition, "static", "tools section must remain in normal document flow");
  assert.equal(layout.wrapperDisplay, "flex", "tool buttons wrapper must use flexbox, not grid");
  assert.equal(layout.svgCountInButtons, 0, "no inline SVG icons allowed inside main buttons");
  assert.equal(layout.buttonsOverlap, false, "tool buttons must not overlap each other");

  assert.equal(layout.toastOverlapsButtons, false, "toast must not overlap tool buttons");
  assert.ok(layout.openBtn.left >= layout.panelRect.left && layout.openBtn.right <= layout.panelRect.right,
    "the Open PSD button must stay inside the panel width");
  assert.ok(layout.autoBtn.left >= layout.panelRect.left && layout.autoBtn.right <= layout.panelRect.right,
    "the Auto Photo Fill button must stay inside the panel width");
  assert.ok(layout.swapBtn.left >= layout.panelRect.left && layout.swapBtn.right <= layout.panelRect.right,
    "the Swap Photos button must stay inside the panel width");
  assert.ok(layout.flipBtn.left >= layout.panelRect.left && layout.flipBtn.right <= layout.panelRect.right,
    "the Flip Photo button must stay inside the panel width");
  assert.ok(layout.saveBtn.left >= layout.panelRect.left && layout.saveBtn.right <= layout.panelRect.right,
    "the Save Page button must stay inside the panel width");
  assert.ok(layout.saveEditedBtn.left >= layout.panelRect.left && layout.saveEditedBtn.right <= layout.panelRect.right,
    "the Save Edited Photos button must stay inside the panel width");
  assert.ok(layout.savePsdCategoryBtn.left >= layout.panelRect.left && layout.savePsdCategoryBtn.right <= layout.panelRect.right,
    "the Save PSD Category button must stay inside the panel width");
  assert.ok(layout.removeBtn.left >= layout.panelRect.left && layout.removeBtn.right <= layout.panelRect.right,
    "the Remove Photos button must stay inside the panel width");

  // 1. exactly 8 main actions
  assert.equal(layout.actionDetails.length, 8, "Exactly 8 main actions must be rendered");

  // 2. all 8 IDs unchanged
  const expectedIds = [
    "openPsdBtn",
    "autoPhotoFillBtn",
    "swapPhotosBtn",
    "flipPhotoBtn",
    "savePageBtn",
    "saveEditedPhotosBtn",
    "savePsdCategoryBtn",
    "removePhotosBtn"
  ];
  assert.deepEqual(layout.actionDetails.map(a => a.id), expectedIds, "All 8 action IDs must match exactly");

  // 3. main actions are not native <button>
  for (const a of layout.actionDetails) {
    assert.notEqual(a.tagName, "BUTTON", `Action ${a.id} must not be a native <button>`);
  }

  // 4. each main action has role="button"
  for (const a of layout.actionDetails) {
    assert.equal(a.role, "button", `Action ${a.id} must have role="button"`);
  }

  // 5. each main action has tabindex="0"
  for (const a of layout.actionDetails) {
    assert.equal(a.tabIndex, "0", `Action ${a.id} must have tabindex="0"`);
  }

  // 6. exactly 4 .tool-row elements
  assert.equal(layout.toolRowsCount, 4, "Must have exactly 4 .tool-row elements");

  // 7. each row has exactly 2 actions
  assert.deepEqual(layout.rowCounts, [2, 2, 2, 2], "Each of the 4 rows must contain exactly 2 actions");

  // 8. no inline SVG
  assert.equal(layout.svgCountInButtons, 0, "No inline SVG icons in tool actions");

  // Icon checks on all actions
  const expectedActions = {
    openPsdBtn: { src: "assets/icons/open-psd.png", label: "OPEN PSD" },
    autoPhotoFillBtn: { src: "assets/icons/auto-photo-fill.png", label: "AUTO PHOTO FILL" },
    swapPhotosBtn: { src: "assets/icons/swap-photos.png", label: "SWAP PHOTOS" },
    flipPhotoBtn: { src: "assets/icons/flip-photo.png", label: "FLIP PHOTO" },
    savePageBtn: { src: "assets/icons/save-page.png", label: "SAVE PAGE" },
    saveEditedPhotosBtn: { src: "assets/icons/save-edited-photos.png", label: "SAVE EDITED PHOTOS" },
    savePsdCategoryBtn: { src: "assets/icons/save-psd-category.png", label: "SAVE PSD CATEGORY" },
    removePhotosBtn: { src: "assets/icons/remove-photos.png", label: "REMOVE PHOTOS" }
  };
  for (const a of layout.actionDetails) {
    const expected = expectedActions[a.id];
    assert.ok(expected, `Action ${a.id} should have expected metadata`);
    assert.equal(a.hasImg, true, `Action ${a.id} must have an icon`);
    assert.equal(a.iconSrc, expected.src, `Action ${a.id} icon src must be ${expected.src}`);
    assert.ok(a.iconSrc.startsWith("assets/icons/"), `Action ${a.id} icon path must start with assets/icons/`);
    assert.ok(a.iconSrc.endsWith(".png"), `Action ${a.id} icon path must end with .png`);
    assert.equal(a.iconWidth, "22px", `Action ${a.id} icon width must be 22px`);
    assert.equal(a.iconHeight, "22px", `Action ${a.id} icon height must be 22px`);
    assert.equal(a.hasIconSlot, true, `Action ${a.id} must have .tool-icon-slot`);
    assert.equal(a.hasLabel, true, `Action ${a.id} must have .tool-label`);
    assert.equal(a.hasBalanceSlot, true, `Action ${a.id} must have .tool-balance-slot`);
    assert.equal(a.iconSlotCount, 1, `Action ${a.id} must have exactly one .tool-icon-slot`);
    assert.equal(a.labelCount, 1, `Action ${a.id} must have exactly one .tool-label`);
    assert.equal(a.balanceSlotCount, 1, `Action ${a.id} must have exactly one .tool-balance-slot`);
    assert.equal(a.iconSlotWidth, "42px", `Action ${a.id} icon slot width must be 42px`);
    assert.equal(a.balanceSlotWidth, "42px", `Action ${a.id} balance slot width must be 42px`);
    assert.equal(a.iconSlotWidth, a.balanceSlotWidth, `Action ${a.id} icon slot width must equal balance slot width`);
    assert.equal(a.labelTextAlign, "center", `Action ${a.id} label text-align must be center`);
    assert.equal(a.labelText, expected.label, `Action ${a.id} label text must match ${expected.label}`);
    assert.equal(a.imgPointerEvents, "none", `Action ${a.id} icon must have pointer-events: none`);
    assert.equal(a.iconSlotPointerEvents, "none", `Action ${a.id} icon slot must have pointer-events: none`);
    assert.equal(a.labelPointerEvents, "none", `Action ${a.id} label must have pointer-events: none`);
    assert.equal(a.balanceSlotPointerEvents, "none", `Action ${a.id} balance slot must have pointer-events: none`);
  }

  // 9. no CSS Grid for main actions
  assert.notEqual(layout.wrapperDisplay, "grid", "Section must not use CSS Grid");

  // 10. custom green action class exists
  assert.ok(layout.openBtnClass.includes("tool-action"), "Primary action must have tool-action styling");
  // 11. destructive red class exists
  assert.ok(layout.removeBtnClass.includes("tool-action-destructive"), "Remove action must have tool-action-destructive styling");

  // 12. footer contains: Developed by Rammoni Halder
  assert.equal(layout.footerText, "Developed by Rammoni Halder", "Footer credit must be present");

  assert.equal(layout.brandPrefix, "MEMORY MAKER", "Branded prefix must be MEMORY MAKER");
  assert.equal(layout.title, "Album Design Tools", "Title must be Album Design Tools");
  assert.equal(layout.version, "v1.1.0", "Version must be v1.1.0");
  assert.equal(layout.popupCount, 0, "no workflow dialog should be open while idle");
  assert.equal(layout.toastVisible, true, "toast must be readable");
  assert.equal(layout.toastPosition, "static");
}

test("wide launcher displays 2-column layout without overlap", () => {
  const layout = renderAt(900, 800);
  assertCommonLayout(layout);
  // Row 1: OPEN PSD (col 1) and AUTO PHOTO FILL (col 2)
  assert.ok(layout.openBtn.left < layout.autoBtn.left, "OPEN PSD must be to the left of AUTO PHOTO FILL in 2-col");
  assert.equal(Math.round(layout.openBtn.top), Math.round(layout.autoBtn.top), "OPEN PSD and AUTO PHOTO FILL should share row 1");
  assert.equal(Math.round(layout.autoBtn.left - layout.openBtn.right), 10, "Horizontal gap between row 1 actions must be 10px");

  // Row 2: SWAP PHOTOS and FLIP PHOTO
  assert.ok(layout.openBtn.bottom <= layout.swapBtn.top, "Row 2 must be below Row 1");
  assert.equal(Math.round(layout.swapBtn.top - layout.openBtn.bottom), 10, "Vertical gap between row 1 and row 2 must be 10px");
  assert.ok(layout.swapBtn.left < layout.flipBtn.left, "SWAP PHOTOS must be to the left of FLIP PHOTO in 2-col");
  assert.equal(Math.round(layout.flipBtn.left - layout.swapBtn.right), 10, "Horizontal gap between row 2 actions must be 10px");

  // Row 3: SAVE PAGE and SAVE EDITED PHOTOS
  assert.ok(layout.swapBtn.bottom <= layout.saveBtn.top, "Row 3 must be below Row 2");
  assert.equal(Math.round(layout.saveBtn.top - layout.swapBtn.bottom), 10, "Vertical gap between row 2 and row 3 must be 10px");
  assert.ok(layout.saveBtn.left < layout.saveEditedBtn.left, "SAVE PAGE must be to the left of SAVE EDITED PHOTOS in 2-col");
  assert.equal(Math.round(layout.saveEditedBtn.left - layout.saveBtn.right), 10, "Horizontal gap between row 3 actions must be 10px");

  // Row 4: SAVE PSD CATEGORY and REMOVE PHOTOS
  assert.ok(layout.saveBtn.bottom <= layout.savePsdCategoryBtn.top, "Row 4 must be below Row 3");
  assert.equal(Math.round(layout.savePsdCategoryBtn.top - layout.saveBtn.bottom), 10, "Vertical gap between row 3 and row 4 must be 10px");
  assert.ok(layout.savePsdCategoryBtn.left < layout.removeBtn.left, "SAVE PSD CATEGORY must be to the left of REMOVE PHOTOS in 2-col");
  assert.equal(Math.round(layout.removeBtn.left - layout.savePsdCategoryBtn.right), 10, "Horizontal gap between row 4 actions must be 10px");
});

test("normal launcher keeps the tool and status in normal flow", () => {
  const layout = renderAt(460, 700);
  assertCommonLayout(layout);
  assert.equal(Math.round(layout.autoBtn.left - layout.openBtn.right), 10, "Horizontal gap between row 1 actions must be 10px in normal launcher");
  assert.equal(Math.round(layout.swapBtn.top - layout.openBtn.bottom), 10, "Vertical gap between row 1 and row 2 must be 10px in normal launcher");
});

test("narrow launcher switches to 1-column layout without horizontal overflow", () => {
  const layout = renderAt(260, 600);
  assertCommonLayout(layout);
  // In narrow 1-column, each row contains 1 button, so OPEN PSD is above AUTO PHOTO FILL, etc.
  assert.ok(layout.openBtn.bottom <= layout.autoBtn.top, "In 1-col narrow view, OPEN PSD must appear above AUTO PHOTO FILL");
  assert.equal(Math.round(layout.autoBtn.top - layout.openBtn.bottom), 10, "In 1-col narrow view, gap between OPEN PSD and AUTO PHOTO FILL must be 10px");
  assert.ok(layout.autoBtn.bottom <= layout.swapBtn.top, "In 1-col narrow view, AUTO PHOTO FILL must appear above SWAP PHOTOS");
  assert.equal(Math.round(layout.swapBtn.top - layout.autoBtn.bottom), 10, "In 1-col narrow view, gap between row 1 and row 2 must be 10px");
  assert.ok(layout.swapBtn.bottom <= layout.flipBtn.top, "In 1-col narrow view, SWAP PHOTOS must appear above FLIP PHOTO");
  assert.ok(layout.flipBtn.bottom <= layout.saveBtn.top, "In 1-col narrow view, FLIP PHOTO must appear above SAVE PAGE");
  assert.ok(layout.saveBtn.bottom <= layout.saveEditedBtn.top, "In 1-col narrow view, SAVE PAGE must appear above SAVE EDITED PHOTOS");
  assert.ok(layout.saveEditedBtn.bottom <= layout.savePsdCategoryBtn.top, "In 1-col narrow view, SAVE EDITED PHOTOS must appear above SAVE PSD CATEGORY");
  assert.ok(layout.savePsdCategoryBtn.bottom <= layout.removeBtn.top, "In 1-col narrow view, SAVE PSD CATEGORY must appear above REMOVE PHOTOS");
});

test("panel contract: satisfies all 14 layout and interaction specifications", () => {
  const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(projectRoot, "style.css"), "utf8");
  const main = require("../main");

  // 1. exactly 8 main actions & 2. all 8 IDs unchanged
  const expectedIds = [
    "openPsdBtn",
    "autoPhotoFillBtn",
    "swapPhotosBtn",
    "flipPhotoBtn",
    "savePageBtn",
    "saveEditedPhotosBtn",
    "savePsdCategoryBtn",
    "removePhotosBtn"
  ];
  for (const id of expectedIds) {
    assert.ok(html.includes(`id="${id}"`), `index.html must include id="${id}"`);
  }

  // 3. main actions are not native <button>
  for (const id of expectedIds) {
    const match = html.match(new RegExp(`<([a-zA-Z0-9]+)[^>]*id="${id}"[^>]*>`));
    assert.ok(match, `Must find element with id="${id}"`);
    assert.notEqual(match[1].toLowerCase(), "button", `${id} must not be a native <button>`);
  }

  // 4. each main action has role="button" & 5. each main action has tabindex="0"
  for (const id of expectedIds) {
    const match = html.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`));
    assert.ok(match, `Element ${id} must be a <div>`);
    assert.ok(match[0].includes('role="button"'), `Element ${id} must have role="button"`);
    assert.ok(match[0].includes('tabindex="0"'), `Element ${id} must have tabindex="0"`);
  }

  // 6. exactly 4 .tool-row elements
  const rowMatches = html.match(/class="tool-row"/g);
  assert.equal(rowMatches?.length, 4, "Must have exactly 4 .tool-row elements");

  // 7. each row has exactly 2 actions
  const rowBlocks = html.split('<div class="tool-row">').slice(1);
  assert.equal(rowBlocks.length, 4);
  for (let i = 0; i < 4; i++) {
    const block = rowBlocks[i].split(/<\/div>\s*(?:<!--|<\/section>)/)[0];
    const actionCount = (block.match(/class="tool-action/g) || []).length;
    assert.equal(actionCount, 2, `Row ${i + 1} must contain exactly 2 actions`);
  }

  // 8. no inline SVG in tool actions or tool section
  const toolSectionHtml = html.split('<section class="tool-section"')[1]?.split('</section>')[0] || "";
  assert.equal(toolSectionHtml.includes("<svg"), false, "Tool section must not contain inline SVG");

  // 9. no CSS Grid for main actions
  assert.equal(css.includes(".tool-section {\n  display: grid"), false, ".tool-section must not use grid");
  assert.equal(css.includes(".tool-row {\n  display: grid"), false, ".tool-row must not use grid");
  assert.ok(css.includes(".tool-row {\n  display: flex") || css.includes(".tool-row {\r\n  display: flex"), ".tool-row must use flex");

  // 10. custom green action class exists
  assert.ok(css.includes(".tool-action {"), "CSS must define .tool-action");
  assert.ok(css.includes("#1e7e34"), "CSS must use #1e7e34 background");

  // 11. destructive red class exists
  assert.ok(css.includes(".tool-action-destructive"), "CSS must define .tool-action-destructive");
  assert.ok(css.includes("#a83a3a"), "CSS must use #a83a3a background");

  // 12. footer contains: Developed by Rammoni Halder
  assert.ok(html.includes("Developed by Rammoni Halder"), "HTML must contain Developed by Rammoni Halder");

  // 13. keyboard activation helper exists
  assert.equal(typeof main.attachActionHandler, "function", "main.attachActionHandler must be exported");
  let triggered = 0;
  const mockAction = {
    addEventListener: (event, fn) => { mockAction.listeners[event] = fn; },
    listeners: {},
    getAttribute: attr => mockAction.attributes[attr],
    attributes: { "aria-disabled": "false" },
    classList: { contains: () => false },
    disabled: false
  };
  main.attachActionHandler(mockAction, () => { triggered++; });
  assert.ok(mockAction.listeners.click, "Click listener attached");
  assert.ok(mockAction.listeners.keydown, "Keydown listener attached");

  // Test Enter activates
  let prevented = false;
  mockAction.listeners.keydown({ key: "Enter", preventDefault: () => { prevented = true; } });
  assert.equal(triggered, 1, "Enter must trigger action");
  assert.equal(prevented, true, "Enter must call preventDefault()");

  // Test Space activates
  prevented = false;
  mockAction.listeners.keydown({ key: " ", preventDefault: () => { prevented = true; } });
  assert.equal(triggered, 2, "Space must trigger action");
  assert.equal(prevented, true, "Space must call preventDefault()");

  // Test disabled ignores
  mockAction.attributes["aria-disabled"] = "true";
  mockAction.listeners.click({ preventDefault: () => {} });
  assert.equal(triggered, 2, "Click ignored when aria-disabled");
  mockAction.listeners.keydown({ key: "Enter", preventDefault: () => {} });
  assert.equal(triggered, 2, "Enter ignored when aria-disabled");
  mockAction.listeners.keydown({ key: " ", preventDefault: () => {} });
  assert.equal(triggered, 2, "Space ignored when aria-disabled");

  // 14. custom disabled state exists
  assert.ok(css.includes(".tool-action.is-disabled"), "CSS must define .tool-action.is-disabled");
  assert.equal(typeof main.setButtonsDisabled, "function", "main.setButtonsDisabled must be exported");
});

test("icon integration: satisfies all PNG icon asset, markup, and styling requirements", () => {
  const html = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(projectRoot, "style.css"), "utf8").replace(/\r\n/g, "\n");

  // 1. all 8 icon files exist
  const expectedIconMap = {
    openPsdBtn: { file: "open-psd.png", label: "OPEN PSD" },
    autoPhotoFillBtn: { file: "auto-photo-fill.png", label: "AUTO PHOTO FILL" },
    swapPhotosBtn: { file: "swap-photos.png", label: "SWAP PHOTOS" },
    flipPhotoBtn: { file: "flip-photo.png", label: "FLIP PHOTO" },
    savePageBtn: { file: "save-page.png", label: "SAVE PAGE" },
    saveEditedPhotosBtn: { file: "save-edited-photos.png", label: "SAVE EDITED PHOTOS" },
    savePsdCategoryBtn: { file: "save-psd-category.png", label: "SAVE PSD CATEGORY" },
    removePhotosBtn: { file: "remove-photos.png", label: "REMOVE PHOTOS" }
  };

  for (const [id, meta] of Object.entries(expectedIconMap)) {
    const iconPath = path.join(projectRoot, "assets", "icons", meta.file);
    assert.ok(fs.existsSync(iconPath), `Icon file must exist: assets/icons/${meta.file}`);

    // 1. all 8 normalized PNGs are 64x64 & 2. all 8 PNGs have alpha/transparency
    const buf = fs.readFileSync(iconPath);
    const pngWidth = buf.readUInt32BE(16);
    const pngHeight = buf.readUInt32BE(20);
    const colorType = buf[25];
    assert.equal(pngWidth, 64, `Icon ${meta.file} width must be 64 (got ${pngWidth})`);
    assert.equal(pngHeight, 64, `Icon ${meta.file} height must be 64 (got ${pngHeight})`);
    assert.ok(colorType === 6 || colorType === 4 || buf.includes(Buffer.from("tRNS")), `Icon ${meta.file} must have alpha channel (colorType=${colorType})`);

    // 2. all 8 main actions still exist & 3. all IDs unchanged
    assert.ok(html.includes(`id="${id}"`), `Action id="${id}" must exist in index.html`);

    // 4. every action has exactly one local PNG icon
    // 5. all icon paths start with assets/icons/
    const expectedSrc = `assets/icons/${meta.file}`;
    assert.ok(html.includes(`src="${expectedSrc}"`), `Action ${id} must reference ${expectedSrc}`);

    // 5b. 3-zone structure inside every action:
    // 1. every action has one .tool-icon-slot
    // 2. every action has one .tool-label
    // 3. every action has one .tool-balance-slot
    const actionSnippet = html.split(`id="${id}"`)[1]?.split('</div>')[0] || "";
    assert.equal((actionSnippet.match(/class="tool-icon-slot"/g) || []).length, 1, `Action ${id} must have exactly one .tool-icon-slot`);
    assert.equal((actionSnippet.match(/class="tool-label"/g) || []).length, 1, `Action ${id} must have exactly one .tool-label`);
    assert.equal((actionSnippet.match(/class="tool-balance-slot"/g) || []).length, 1, `Action ${id} must have exactly one .tool-balance-slot`);
    assert.ok(actionSnippet.includes('aria-hidden="true"'), `Action ${id} balance slot must have aria-hidden="true"`);

    // 6. labels remain correct / unchanged
    assert.ok(html.includes(`<span class="tool-label">${meta.label}</span>`), `Action ${id} must contain label ${meta.label}`);
  }

  // 3. icon display size is 22x22 in CSS
  assert.ok(css.includes(".tool-icon {") && css.includes("width: 22px;") && css.includes("height: 22px;"),
    "Icon display size must be 22x22 in CSS");

  // 4. icon slot and balance slot width is fixed at 42px in CSS (slot width = balance slot width)
  assert.ok(css.includes(".tool-icon-slot {") && css.includes("width: 42px;") && css.includes("min-width: 42px;"),
    "Icon slot width must be fixed at 42px in CSS");
  assert.ok(css.includes(".tool-balance-slot {") && css.includes("width: 42px;") && css.includes("min-width: 42px;"),
    "Balance slot width must be fixed at 42px in CSS");

  // 5. label uses flex: 1 and text-align: center
  assert.ok(css.includes(".tool-label {") && css.includes("flex: 1;") && css.includes("text-align: center;"),
    "Label must use flex: 1 and text-align: center in CSS");

  // 8. no inline SVG
  const toolSectionHtml = html.split('<section class="tool-section"')[1]?.split('</section>')[0] || "";
  assert.equal(toolSectionHtml.includes("<svg"), false, "Tool section must not contain inline SVG");

  // 9. no external assets
  assert.equal(toolSectionHtml.includes("http://"), false, "Tool section must not contain remote http:// URLs");
  assert.equal(toolSectionHtml.includes("https://"), false, "Tool section must not contain remote https:// URLs");

  // parent remains role="button"
  for (const id of Object.keys(expectedIconMap)) {
    const match = html.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`));
    assert.ok(match, `Element ${id} must be a <div>`);
    assert.ok(match[0].includes('role="button"'), `Element ${id} must have role="button"`);
  }

  // 10. icon and slot child elements have pointer-events disabled
  assert.ok(css.includes(".tool-icon {") && css.includes("pointer-events: none;"), ".tool-icon must disable pointer events");
  assert.ok(css.includes(".tool-icon-slot {") && css.includes("pointer-events: none;"), ".tool-icon-slot must disable pointer events");
  assert.ok(css.includes(".tool-label {") && css.includes("pointer-events: none;"), ".tool-label must disable pointer events");
  assert.ok(css.includes(".tool-balance-slot {") && css.includes("pointer-events: none;"), ".tool-balance-slot must disable pointer events");

  // 7. button spacing remains unchanged (10px explicit margins)
  assert.ok(css.includes(".tool-row {") && css.includes("margin-bottom: 10px;"),
    ".tool-row must maintain explicit margin-based spacing");
  assert.ok(css.includes(".tool-row .tool-action:first-child {\n  margin-right: 10px;\n}"),
    "First child action in .tool-row must have margin-right: 10px");
});


