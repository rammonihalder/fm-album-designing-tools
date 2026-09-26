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
        running: false,
        options: {
          coverFit: true,
          clipToPlaceholder: true,
          renameLayer: true,
          moveUsedFiles: true,
          orderMode: "stack"
        }
      };
      window.require = name => {
        if (name === "photoshop") return { app: { documents: [] } };
        if (name === "./src/tools/autoPhotoFill") return { runAutoPhotoFill: async () => {} };
        if (name === "./src/state") return probeState;
        if (name === "./src/layers") {
          return { getSelectedLayersTopToBottom: () => [], resolveLayersByIds: () => [] };
        }
        if (name === "./src/files") {
          return { selectImageFiles: async () => [], moveUsedFiles: async () => {} };
        }
        if (name === "./src/photoshop") return { runPlacement: async () => {} };
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
      const toolCard = document.querySelector(".tool-card");
      const toolCardRect = rect(toolCard);
      const toolButtonRect = rect(document.getElementById("autoPhotoFillBtn"));
      const statusPanel = document.querySelector(".status-panel");
      const statusPanelRect = rect(statusPanel);
      const statusRect = rect(document.getElementById("statusText"));
      const panelRect = rect(panel);
      const resultPanel = document.getElementById("resultPanel");
      const resultPanelTitle = document.getElementById("resultPanelTitle");
      const resultPanelMessage = document.getElementById("resultPanelMessage");
      // Exercise the real presenter with long text; no dialog APIs are involved.
      showResult("Auto Photo Fill Complete", Array.from({length: 40}, (_, i) =>
        "Could not move sample-photo-" + i + ".jpg: permission denied."));
      const resultRect = rect(resultPanel);
      const lastLine = resultPanelMessage.lastElementChild;
      lastLine.scrollIntoView();

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
        toolCard: toolCardRect,
        toolCardPosition: toolCard ? getComputedStyle(toolCard).position : null,
        toolCards: document.querySelectorAll(".tool-card").length,
        toolButtons: document.querySelectorAll("[data-tool]").length,
        toolButton: toolButtonRect,
        statusPanel: statusPanelRect,
        status: statusRect,
        popupCount: document.querySelectorAll("dialog").length,
        resultVisible: !resultPanel.hidden && resultPanelMessage.children.length === 40,
        resultHeight: resultRect.height,
        resultWidth: resultRect.width,
        lastLineVisible: rect(lastLine).bottom <= innerHeight && rect(lastLine).top >= 0,
        resultPanelPosition: getComputedStyle(resultPanel).position,
        toolOverlapsStatus: overlaps(toolCardRect, statusPanelRect),
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
  assert.equal(layout.toolCardPosition, "static", "tool cards must remain in normal document flow");
  assert.equal(layout.toolOverlapsStatus, false, "the tool card must not overlap global status");
  assert.ok(layout.statusPanel.top >= layout.toolCard.bottom, "global status must follow the tool card");
  assert.ok(layout.toolButton.left >= layout.panelRect.left && layout.toolButton.right <= layout.panelRect.right,
    "the Auto Photo Fill button must stay inside the panel width");
  assert.equal(layout.toolCards, 1, "only the implemented Auto Photo Fill tool should be shown");
  assert.equal(layout.toolButtons, 1, "no fake future-tool buttons should be rendered");
  assert.equal(layout.title.trim(), "MM Album Design Tools");
  assert.equal(layout.version.trim(), "v0.2.3");
  assert.equal(layout.popupCount, 0, "no result modal should exist");
  assert.equal(layout.resultVisible, true, "panel result must be readable");
  assert.ok(layout.resultHeight > 100, "long result must not collapse");
  assert.ok(layout.resultWidth <= layout.panel.clientWidth, "result must fit panel width");
  assert.ok(layout.lastLineVisible, "last result detail must be reachable by scrolling");
  assert.equal(layout.resultPanelPosition, "static");

}

test("wide launcher remains compact and uses the available width without overlap", () => {
  const layout = renderAt(900, 800);
  assertCommonLayout(layout);
  assert.ok(layout.toolCard.width > 800, "the tool card should use wide panel space");
});

test("normal launcher keeps the tool and status in normal flow", () => {
  const layout = renderAt(460, 700);
  assertCommonLayout(layout);
});

test("narrow launcher remains contained and vertically scrollable when short", () => {
  const layout = renderAt(300, 220);
  assertCommonLayout(layout);
  assert.ok(layout.panel.scrollHeight > layout.panel.clientHeight, "short docked panels must scroll to lower controls");

});
