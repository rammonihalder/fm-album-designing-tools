const { runAutoPhotoFill } = require("./src/tools/autoPhotoFill");

const $ = id => document.getElementById(id);

const ui = {
  autoPhotoFillBtn: $("autoPhotoFillBtn"),
  statusText: $("statusText"),
  resultPanel: $("resultPanel"),
  resultPanelTitle: $("resultPanelTitle"),
  resultPanelMessage: $("resultPanelMessage")
};

let running = false;

function setStatus(message, type) {
  ui.statusText.textContent = message;
  ui.statusText.className = "status-text" + (type ? ` ${type}` : "");
}

function replaceLines(container, lines) {
  while (container.firstChild) container.removeChild(container.firstChild);
  lines.forEach(line => {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    container.appendChild(paragraph);
  });
}

function populateResult(title, lines) {
  const requiredElements = [
    ui.resultPanel,
    ui.resultPanelTitle,
    ui.resultPanelMessage
  ];
  if (requiredElements.some(element => !element)) {
    throw new Error("Result panel UI is incomplete.");
  }

  ui.resultPanelTitle.textContent = title;
  replaceLines(ui.resultPanelMessage, lines);
  ui.resultPanel.hidden = false;
}

async function showResult(title, lines) {
  populateResult(title, lines);
  // Navigation is optional; the result is already visible if UXP lacks these APIs.
  try {
    if (typeof ui.resultPanel.scrollIntoView === "function") ui.resultPanel.scrollIntoView(true);
    if (typeof ui.resultPanel.focus === "function") ui.resultPanel.focus();
  } catch (error) { /* Host navigation must not change a completed result. */ }
}

async function handleAutoPhotoFill() {
  if (running) return;
  running = true;
  ui.autoPhotoFillBtn.disabled = true;
  ui.resultPanel.hidden = true;
  try {
    // Preserve the workflow callback contract; presentation is panel-only.
    await runAutoPhotoFill({ setStatus, showDialog: showResult });
  } finally {
    running = false;
    ui.autoPhotoFillBtn.disabled = false;
  }
}

ui.autoPhotoFillBtn.addEventListener("click", handleAutoPhotoFill);

setStatus("Ready.");
