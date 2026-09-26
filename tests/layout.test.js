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
        if (name === "./src/tools/savePage") return {
          runSavePage: async () => ({ outcome: "success", fileName: "MMRLT1" }),
          buildSavePageToast: () => ({ message: "Saved: MMRLT1", type: "success" }),
          isValidPrefix: () => true
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
      const toolsSection = document.querySelector(".tools-section");
      const toolsSectionRect = rect(toolsSection);
      const openBtn = document.getElementById("openPsdBtn");
      const autoBtn = document.getElementById("autoPhotoFillBtn");
      const swapBtn = document.getElementById("swapPhotosBtn");
      const saveBtn = document.getElementById("savePageBtn");
      const saveEditedBtn = document.getElementById("saveEditedPhotosBtn");
      const openBtnRect = rect(openBtn);
      const autoBtnRect = rect(autoBtn);
      const swapBtnRect = rect(swapBtn);
      const saveBtnRect = rect(saveBtn);
      const saveEditedBtnRect = rect(saveEditedBtn);
      const toastEl = document.getElementById("toast");
      toastEl.textContent = "2 photos swapped";
      toastEl.className = "toast success";
      toastEl.hidden = false;
      const toastRect = rect(toastEl);
      const panelRect = rect(panel);

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
        toolsSection: toolsSectionRect,
        toolsSectionPosition: toolsSection ? getComputedStyle(toolsSection).position : null,
        toolButtons: document.querySelectorAll("[data-tool]").length,
        openBtn: openBtnRect,
        autoBtn: autoBtnRect,
        swapBtn: swapBtnRect,
        saveBtn: saveBtnRect,
        saveEditedBtn: saveEditedBtnRect,
        openBeforeAuto: Boolean(openBtnRect && autoBtnRect && openBtnRect.bottom <= autoBtnRect.top),
        autoBeforeSwap: Boolean(autoBtnRect && swapBtnRect && autoBtnRect.bottom <= swapBtnRect.top),
        swapBeforeSave: Boolean(swapBtnRect && saveBtnRect && swapBtnRect.bottom <= saveBtnRect.top),
        saveBeforeSaveEdited: Boolean(saveBtnRect && saveEditedBtnRect && saveBtnRect.bottom <= saveEditedBtnRect.top),
        buttonsOverlap: overlaps(openBtnRect, autoBtnRect) || overlaps(autoBtnRect, swapBtnRect) || overlaps(openBtnRect, swapBtnRect) || overlaps(swapBtnRect, saveBtnRect) || overlaps(openBtnRect, saveBtnRect) || overlaps(autoBtnRect, saveBtnRect) || overlaps(saveBtnRect, saveEditedBtnRect) || overlaps(openBtnRect, saveEditedBtnRect),
        toastRect,
        toastVisible: !toastEl.hidden,
        toastPosition: getComputedStyle(toastEl).position,
        toastOverlapsButtons: overlaps(saveEditedBtnRect, toastRect) || overlaps(saveBtnRect, toastRect) || overlaps(swapBtnRect, toastRect) || overlaps(openBtnRect, toastRect),
        popupCount: document.querySelectorAll("dialog#resultDialog, dialog[open]").length,
        title: document.querySelector("h1")?.textContent || "",
        version: document.querySelector(".version")?.textContent || "",
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
  assert.equal(layout.toolsSectionPosition, "static", "tools section must remain in normal document flow");
  assert.equal(layout.buttonsOverlap, false, "tool buttons must not overlap each other");
  assert.equal(layout.openBeforeAuto, true, "OPEN PSD must appear before AUTO PHOTO FILL");
  assert.equal(layout.autoBeforeSwap, true, "AUTO PHOTO FILL must appear before SWAP PHOTOS");
  assert.equal(layout.swapBeforeSave, true, "SWAP PHOTOS must appear before SAVE PAGE");
  assert.equal(layout.saveBeforeSaveEdited, true, "SAVE PAGE must appear before SAVE EDITED PHOTOS");
  assert.equal(layout.toastOverlapsButtons, false, "toast must not overlap tool buttons");
  assert.ok(layout.openBtn.left >= layout.panelRect.left && layout.openBtn.right <= layout.panelRect.right,
    "the Open PSD button must stay inside the panel width");
  assert.ok(layout.autoBtn.left >= layout.panelRect.left && layout.autoBtn.right <= layout.panelRect.right,
    "the Auto Photo Fill button must stay inside the panel width");
  assert.ok(layout.swapBtn.left >= layout.panelRect.left && layout.swapBtn.right <= layout.panelRect.right,
    "the Swap Photos button must stay inside the panel width");
  assert.ok(layout.saveBtn.left >= layout.panelRect.left && layout.saveBtn.right <= layout.panelRect.right,
    "the Save Page button must stay inside the panel width");
  assert.ok(layout.saveEditedBtn.left >= layout.panelRect.left && layout.saveEditedBtn.right <= layout.panelRect.right,
    "the Save Edited Photos button must stay inside the panel width");
  assert.equal(layout.toolButtons, 5, "Open PSD, Auto Photo Fill, Swap Photos, Save Page, and Save Edited Photos buttons must all be rendered");
  assert.equal(layout.title.trim(), "MM Album Design Tools");
  assert.equal(layout.version.trim(), "v0.6.0");
  assert.equal(layout.popupCount, 0, "no result modal dialog should exist");
  assert.equal(layout.toastVisible, true, "toast must be readable");
  assert.equal(layout.toastPosition, "static");
}

test("wide launcher remains compact and uses the available width without overlap", () => {
  const layout = renderAt(900, 800);
  assertCommonLayout(layout);
  assert.ok(layout.openBtn.width > 800, "the tool buttons should use wide panel space");
  assert.ok(layout.autoBtn.width > 800, "the tool buttons should use wide panel space");
  assert.ok(layout.swapBtn.width > 800, "the tool buttons should use wide panel space");
  assert.ok(layout.saveBtn.width > 800, "the tool buttons should use wide panel space");
  assert.ok(layout.saveEditedBtn.width > 800, "the tool buttons should use wide panel space");
});

test("normal launcher keeps the tool and status in normal flow", () => {
  const layout = renderAt(460, 700);
  assertCommonLayout(layout);
});

test("narrow launcher remains contained and vertically scrollable when short", () => {
  const layout = renderAt(300, 220);
  assertCommonLayout(layout);
  assert.ok(layout.panel.scrollHeight >= layout.panel.clientHeight, "short docked panels must fit or scroll cleanly");
});
