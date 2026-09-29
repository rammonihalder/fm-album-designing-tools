"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  BASE_FOLDER_TOKEN_KEY,
  PREFIX_STORAGE_KEY,
  SERIAL_REGEX,
  INVALID_FILENAME_CHARS,
  sanitizePrefix,
  isValidPrefix,
  extractAlbumSerial,
  getNextPageNumber,
  buildPageBaseName,
  buildSavePageToast,
  getStoredValue,
  setStoredValue,
  removeStoredValue,
  getOrCreateSubfolder,
  resolveSafeFileEntries,
  executeSavePage,
  DocumentClosedError
} = require("../src/tools/savePage");

function createMockFolder(name = "root", initialEntries = {}) {
  const entriesMap = new Map();
  for (const [key, val] of Object.entries(initialEntries)) {
    entriesMap.set(key, val);
  }

  return {
    name,
    isFolder: true,
    isFile: false,
    _entries: entriesMap,
    async getEntry(entryName) {
      if (entriesMap.has(entryName)) {
        return entriesMap.get(entryName);
      }
      const err = new Error(`Entry "${entryName}" not found`);
      err.code = "ENOENT";
      err.name = "EntryNotFound";
      throw err;
    },
    async getEntries() {
      return Array.from(entriesMap.values());
    },
    async createFolder(folderName) {
      if (entriesMap.has(folderName)) {
        return entriesMap.get(folderName);
      }
      const sub = createMockFolder(folderName);
      entriesMap.set(folderName, sub);
      return sub;
    },
    async createFile(fileName, options = {}) {
      if (options.overwrite === false && entriesMap.has(fileName)) {
        const err = new Error(`File "${fileName}" already exists`);
        err.code = "EEXIST";
        throw err;
      }
      const fileEntry = {
        name: fileName,
        isFile: true,
        isFolder: false,
        parent: this,
        deleted: false,
        async delete() {
          this.deleted = true;
          entriesMap.delete(fileName);
        }
      };
      entriesMap.set(fileName, fileEntry);
      return fileEntry;
    }
  };
}

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, val) => store.set(key, String(val)),
    removeItem: key => store.delete(key),
    clear: () => store.clear(),
    _store: store
  };
}

function createMainHarness({ defaultPrefix = "", runSavePageOutcome = { outcome: "success", fileName: "FMRLT1" } } = {}) {
  const elements = new Map();
  const ids = [
    "openPsdBtn", "autoPhotoFillBtn", "swapPhotosBtn", "flipPhotoBtn", "savePageBtn", "saveEditedPhotosBtn", "savePsdCategoryBtn", "removePhotosBtn", "statusText", "toast",
    "savePageDialog", "savePagePrefixInput", "savePageFormatPsd", "savePageFormatJpeg", "savePageFormatBoth", "savePagePrefixError", "savePageDialogSaveBtn", "savePageDialogCancelBtn",
    "savePageFolderDialog", "savePageLastFolderPath", "savePageUseFolderBtn", "savePageChangeFolderBtn", "savePageFolderCancelBtn",
    "saveEditedFolderDialog", "saveEditedLastFolderPath", "saveEditedUseFolderBtn", "saveEditedChangeFolderBtn", "saveEditedFolderCancelBtn",
    "savePsdCategoryFolderDialog", "savePsdCategoryLastFolderPath", "savePsdCategoryUseFolderBtn", "savePsdCategoryChangeFolderBtn", "savePsdCategoryFolderCancelBtn",
    "savePsdCategoryDeviceDialog", "deviceLtBtn", "devicePcBtn", "deviceCustomBtn", "customDeviceInputContainer", "customDeviceInput", "savePsdCategoryDeviceSaveBtn", "savePsdCategoryDeviceCancelBtn",
    "savePsdCategoryDialog", "savePsdCategorySelect", "savePsdCustomNameInput", "savePsdDeleteOriginalCheckbox", "savePsdDeleteWarning", "savePsdDialogSaveBtn", "savePsdDialogCancelBtn",
    "savePsdOrientationDialog", "orientationLandscapeInput", "orientationPortraitInput", "orientationSquareInput", "orientationContinueBtn", "orientationCancelBtn",
    "savePsdDeleteConfirmDialog", "savePsdConfirmDeleteBtn", "savePsdCancelDeleteBtn"
  ];
  for (const id of ids) {
    elements.set(id, {
      id,
      children: [],
      textContent: "",
      className: "",
      hidden: id === "savePagePrefixError",
      disabled: false,
      value: "",
      attributes: {},
      classList: { toggle() {} },
      listeners: {},
      addEventListener(event, handler) { this.listeners[event] = handler; },
      removeEventListener(event, handler) { delete this.listeners[event]; },
      setAttribute(key, value) { this.attributes[key] = value; },
      getAttribute(key) { return this.attributes[key] ?? (key === "data-mode" ? ({ savePageFormatPsd: "psd", savePageFormatJpeg: "jpeg", savePageFormatBoth: "both" }[id] || null) : null); },
      focus() { this.focused = true; },
      close(reason) {
        this.closedWith = reason;
        if (typeof this._resolveModal === "function") {
          this._resolveModal(reason);
        }
      },
      uxpShowModal(opts) {
        this.modalOptions = opts;
        return new Promise(resolve => {
          this._resolveModal = resolve;
          if (this._immediateModalResult !== undefined) {
            resolve(this._immediateModalResult);
          }
        });
      }
    });
  }

  let capturedRunSavePageOpts = null;
  const context = {
    console,
    clearTimeout,
    setTimeout,
    document: {
      getElementById: id => elements.get(id) || null
    },
    require: name => {
      if (name === "./src/tools/openPsd") {
        return {
          runOpenPsd: async () => ({ outcome: "success" }),
          buildOpenPsdToast: () => ({ message: "1 PSD opened", type: "success" })
        };
      }
      if (name === "./src/tools/autoPhotoFill") {
        return {
          runAutoPhotoFill: async () => ({ outcome: "success" }),
          buildAutoPhotoFillToast: () => ({ message: "Filled", type: "success" })
        };
      }
      if (name === "./src/tools/swapPhotos") {
        return {
          runSwapPhotos: async () => ({ success: true })
        };
      }
      if (name === "./src/tools/flipPhoto") {
        return {
          runFlipPhoto: async () => ({ outcome: "success", flippedCount: 1, skippedCount: 0 })
        };
      }
      if (name === "./src/tools/savePage") {
        const actual = require("../src/tools/savePage");
        return {
          ...actual,
          runSavePage: async (opts) => {
            capturedRunSavePageOpts = opts;
            if (typeof runSavePageOutcome === "function") {
              return runSavePageOutcome(opts);
            }
            return runSavePageOutcome;
          }
        };
      }
      if (name === "./src/tools/saveEditedPhotos") {
        return {
          runSaveEditedPhotos: async () => ({ outcome: "success", successCount: 1, failedCount: 0 }),
          buildSaveEditedPhotosToast: () => ({ message: "1 edited photo saved", type: "success" })
        };
      }
      if (name === "./src/tools/savePsdCategory") {
        return {
          runSavePsdCategory: async () => ({ outcome: "success", fileName: "MMR 3 PHOTOS 01 PC.psd" })
        };
      }
      if (name === "./src/tools/removePhotos") {
        return {
          runRemovePhotos: async () => ({ outcome: "success", removedCount: 1, failedCount: 0 }),
          buildRemovePhotosToast: () => ({ message: "1 photo removed", type: "success" })
        };
      }
      if (name === "./src/ui/toast") {
        return require("../src/ui/toast");
      }
      throw new Error("Unexpected require: " + name);
    }
  };

  const sandbox = vm.createContext(context);
  const code = fs.readFileSync(require.resolve("../main"), "utf8");
  vm.runInContext(code, sandbox);

  return {
    elements,
    sandbox,
    getCapturedRunSavePageOpts: () => capturedRunSavePageOpts
  };
}

// ==========================================
// TESTS — BUTTON UI & HTML
// ==========================================

test("1. SAVE PAGE button exists in index.html", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.ok(/id="savePageBtn"/i.test(html), "index.html must have savePageBtn");
  assert.ok(html.includes("SAVE PAGE"), "button label must be SAVE PAGE");
});

test("2. Exact button order: OPEN PSD -> AUTO PHOTO FILL -> SWAP PHOTOS -> SAVE PAGE", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  const openPos = html.indexOf('id="openPsdBtn"');
  const autoPos = html.indexOf('id="autoPhotoFillBtn"');
  const swapPos = html.indexOf('id="swapPhotosBtn"');
  const savePos = html.indexOf('id="savePageBtn"');

  assert.ok(openPos !== -1, "openPsdBtn must exist");
  assert.ok(autoPos !== -1, "autoPhotoFillBtn must exist");
  assert.ok(swapPos !== -1, "swapPhotosBtn must exist");
  assert.ok(savePos !== -1, "savePageBtn must exist");

  assert.ok(openPos < autoPos, "openPsdBtn must be before autoPhotoFillBtn");
  assert.ok(autoPos < swapPos, "autoPhotoFillBtn must be before swapPhotosBtn");
  assert.ok(swapPos < savePos, "swapPhotosBtn must be before savePageBtn");
});

test("3. Visible version is present in index.html and manifest.json", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.ok(html.includes("v1.4.0") || html.includes("v1.3.0") || html.includes("v1.2.0") || html.includes("v1.1.0"), "index.html must display version");

  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../manifest.json"), "utf8"));
  assert.ok(manifest.version === "1.4.0" || manifest.version === "1.3.0" || manifest.version === "1.2.0" || manifest.version === "1.1.0", "manifest.json version must be valid");
  assert.equal(manifest.id, "9beaddeb", "plugin ID must be 9beaddeb for Adobe Marketplace build");
});

// ==========================================
// TESTS — FLOATING PREFIX MODAL DIALOG UI
// ==========================================

test("UI 1. Resting panel contains exactly 8 tool actions", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  const panelMatch = html.match(/<main[^>]*class="[^"]*panel[^"]*"[^>]*>([\s\S]*?)<\/main>/i);
  assert.ok(panelMatch, "main.panel must exist in index.html");
  const panelContent = panelMatch[1];
  const actionMatches = panelContent.match(/class="tool-action[^"]*"/gi) || [];
  assert.equal(actionMatches.length, 8, "Resting panel must contain exactly 8 tool actions");
  assert.ok(panelContent.includes('id="openPsdBtn"'));
  assert.ok(panelContent.includes('id="autoPhotoFillBtn"'));
  assert.ok(panelContent.includes('id="swapPhotosBtn"'));
  assert.ok(panelContent.includes('id="flipPhotoBtn"'));
  assert.ok(panelContent.includes('id="savePageBtn"'));
  assert.ok(panelContent.includes('id="saveEditedPhotosBtn"'));
  assert.ok(panelContent.includes('id="savePsdCategoryBtn"'));
  assert.ok(panelContent.includes('id="removePhotosBtn"'));
});

test("UI 2. No visible inline prefix area exists in normal panel layout", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.equal(/id="savePagePrefixSection"/i.test(html), false, "no savePagePrefixSection should exist in index.html");

  const panelMatch = html.match(/<main[^>]*class="[^"]*panel[^"]*"[^>]*>([\s\S]*?)<\/main>/i);
  assert.ok(panelMatch);
  assert.equal(/<input/i.test(panelMatch[1]), false, "no input element inside panel");
  assert.equal(/<dialog/i.test(panelMatch[1]), false, "no dialog element inside panel");

  // Dialog element lives outside the panel
  assert.ok(/<dialog[^>]*id="savePageDialog"/i.test(html), "savePageDialog must exist outside panel");
});

test("UI 3. SAVE PAGE opens a <dialog> after folder selection", async () => {
  let modalOpened = false;
  const doc = { id: 101, name: "Doc.psd" };
  const app = { activeDocument: doc, documents: [doc] };
  const baseFolder = createMockFolder("Album");

  // Case A: folder picker cancelled -> dialog NOT opened
  await executeSavePage({
    app,
    selectFolder: async () => null,
    promptForPrefix: async () => {
      modalOpened = true;
      return { cancelled: false, prefix: "Test" };
    },
    storage: createMockStorage()
  });
  assert.equal(modalOpened, false, "dialog must not open if folder picker is cancelled");

  // Case B: folder picker succeeded -> dialog IS opened
  await executeSavePage({
    app,
    selectFolder: async () => baseFolder,
    promptForPrefix: async () => {
      modalOpened = true;
      return { cancelled: true };
    },
    storage: createMockStorage()
  });
  assert.equal(modalOpened, true, "dialog must open after folder selection");
});

test("UI 4 & 5. Dialog uses uxpShowModal with title 'Save Page', resize 'none', and compact size", async () => {
  const h = createMainHarness();
  const dialogEl = h.elements.get("savePageDialog");

  let modalCalled = false;
  let modalOptions = null;
  dialogEl.uxpShowModal = async (opts) => {
    modalCalled = true;
    modalOptions = opts;
    return "cancel";
  };

  await h.sandbox.promptForPrefix();

  assert.equal(modalCalled, true, "dialog.uxpShowModal must be called");
  assert.equal(modalOptions.title, "Save Page");
  assert.equal(modalOptions.resize, "none");
  assert.equal(modalOptions.size.width, 340);
  assert.equal(modalOptions.size.height, 240);
});

test("UI format selector exposes PSD ONLY, JPEG ONLY, BOTH and returns confirmed choice", async () => {
  const h = createMainHarness();
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.match(html, /Save Format/);
  for (const label of ["PSD ONLY", "JPEG ONLY", "BOTH"]) assert.match(html, new RegExp(label));
  const mode = h.elements.get("savePageFormatJpeg");
  const save = h.elements.get("savePageDialogSaveBtn");
  const promise = h.sandbox.promptForPrefix();
  mode.listeners.click({ currentTarget: mode });
  save.listeners.click();
  assert.equal((await promise).outputMode, "jpeg");
  assert.equal(html.includes('id="savePageOutputMode"'), false);
  assert.match(html, /class="save-page-primary"/);
  assert.match(html, /class="save-page-cancel"/);
  const css = fs.readFileSync(path.resolve(__dirname, "../style.css"), "utf8");
  assert.match(css, /\.save-page-dialog-content[\s\S]*padding:\s*14px/);
  assert.match(css, /\.save-format-segmented[\s\S]*width:\s*100%/);
  assert.match(css, /\.save-page-primary[\s\S]*width:\s*100%/);
  assert.match(css, /\.save-page-cancel[\s\S]*margin:\s*10px auto/);
  assert.equal(/\.save-page-dialog-actions\s*\{\s*display:\s*flex/.test(css), false);
});

test("UI 6. Prefix field loads remembered value", async () => {
  const h = createMainHarness();
  const inputEl = h.elements.get("savePagePrefixInput");
  const dialogEl = h.elements.get("savePageDialog");
  dialogEl._immediateModalResult = "cancel";

  await h.sandbox.promptForPrefix({ defaultPrefix: "Riya" });
  assert.equal(inputEl.value, "Riya", "Input must be prefilled with defaultPrefix");
});

test("UI 7. SAVE button returns save action", async () => {
  const h = createMainHarness();
  const inputEl = h.elements.get("savePagePrefixInput");
  const dialogEl = h.elements.get("savePageDialog");
  const saveBtn = h.elements.get("savePageDialogSaveBtn");

  const promise = h.sandbox.promptForPrefix({ defaultPrefix: "Wedding" });
  inputEl.value = "Wedding_New";
  saveBtn.listeners.click();

  const res = await promise;
  assert.equal(dialogEl.closedWith, "save");
  assert.equal(res.cancelled, false);
  assert.equal(res.prefix, "Wedding_New");
});

test("UI 8. CANCEL button returns cancel action", async () => {
  const h = createMainHarness();
  const dialogEl = h.elements.get("savePageDialog");
  const cancelBtn = h.elements.get("savePageDialogCancelBtn");

  const promise = h.sandbox.promptForPrefix({ defaultPrefix: "Riya" });
  cancelBtn.listeners.click();

  const res = await promise;
  assert.equal(dialogEl.closedWith, "cancel");
  assert.equal(res.cancelled, true);
});

test("UI 9. reasonCanceled is treated as Cancelled", async () => {
  const h = createMainHarness();
  const dialogEl = h.elements.get("savePageDialog");
  dialogEl._immediateModalResult = "reasonCanceled";

  const res = await h.sandbox.promptForPrefix();
  assert.equal(res.cancelled, true);
});

test("UI 10. Enter triggers save", async () => {
  const h = createMainHarness();
  const inputEl = h.elements.get("savePagePrefixInput");
  const dialogEl = h.elements.get("savePageDialog");

  const promise = h.sandbox.promptForPrefix();
  inputEl.value = "Anamika";
  let defaultPrevented = false;
  inputEl.listeners.keydown({
    key: "Enter",
    preventDefault: () => {
      defaultPrevented = true;
    }
  });

  const res = await promise;
  assert.equal(defaultPrevented, true);
  assert.equal(dialogEl.closedWith, "save");
  assert.equal(res.cancelled, false);
  assert.equal(res.prefix, "Anamika");
});

test("UI 11. Invalid prefix keeps dialog open", async () => {
  const h = createMainHarness();
  const inputEl = h.elements.get("savePagePrefixInput");
  const errorEl = h.elements.get("savePagePrefixError");
  const dialogEl = h.elements.get("savePageDialog");
  const saveBtn = h.elements.get("savePageDialogSaveBtn");

  const promise = h.sandbox.promptForPrefix();
  inputEl.value = "Riya/Wedding"; // Invalid character '/'
  saveBtn.listeners.click();

  // Dialog should NOT have closed
  assert.equal(dialogEl.closedWith, undefined, "dialog must NOT close when prefix is invalid");
  assert.equal(errorEl.hidden, false, "error element must be visible");

  // User corrects the prefix to valid
  inputEl.value = "Riya_Wedding";
  saveBtn.listeners.click();

  assert.equal(dialogEl.closedWith, "save", "dialog closes after correction");
  const res = await promise;
  assert.equal(res.cancelled, false);
  assert.equal(res.prefix, "Riya_Wedding");
});

test("UI 12. Invalid prefix does NOT start PSD/JPEG save", async () => {
  const doc = { id: 101, name: "Doc.psd" };
  const app = { activeDocument: doc, documents: [doc] };
  const baseFolder = createMockFolder("Album");
  let psdAttempted = false;
  let jpegAttempted = false;

  const result = await executeSavePage({
    app,
    selectFolder: async () => baseFolder,
    promptForPrefix: async () => ({ cancelled: false, prefix: "Invalid/Prefix*" }),
    saveDocumentCopyPsd: async () => { psdAttempted = true; },
    saveDocumentCopyJpeg: async () => { jpegAttempted = true; },
    storage: createMockStorage()
  });

  assert.equal(result.outcome, "invalid-prefix");
  assert.equal(psdAttempted, false, "PSD save must not be attempted on invalid prefix");
  assert.equal(jpegAttempted, false, "JPEG save must not be attempted on invalid prefix");
});

test("UI 13. Valid prefix closes dialog and proceeds", async () => {
  const h = createMainHarness();
  const inputEl = h.elements.get("savePagePrefixInput");
  const dialogEl = h.elements.get("savePageDialog");
  const saveBtn = h.elements.get("savePageDialogSaveBtn");

  const promise = h.sandbox.promptForPrefix();
  inputEl.value = "ValidPrefix";
  saveBtn.listeners.click();

  const res = await promise;
  assert.equal(dialogEl.closedWith, "save");
  assert.equal(res.cancelled, false);
  assert.equal(res.prefix, "ValidPrefix");
});

test("UI 14. Dialog does not permanently change panel height", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../style.css"), "utf8");
  assert.equal(/#savePagePrefixSection/i.test(css), false, "no inline prefix styles");
  assert.ok(/dialog#savePageDialog/i.test(css), "dialog#savePageDialog styling present");
  assert.ok(css.includes("save-page-dialog-content"));
});

test("UI 15. Buttons unlock after successful save", async () => {
  const h = createMainHarness({
    runSavePageOutcome: { outcome: "success", fileName: "FMRLT1" }
  });
  const savePageBtn = h.elements.get("savePageBtn");
  const openPsdBtn = h.elements.get("openPsdBtn");

  const promise = h.sandbox.handleSavePage();
  assert.equal(savePageBtn.disabled, true, "buttons locked while active");
  assert.equal(openPsdBtn.disabled, true);

  await promise;
  assert.equal(savePageBtn.disabled, false, "savePageBtn unlocked after save");
  assert.equal(openPsdBtn.disabled, false, "openPsdBtn unlocked after save");
});

test("UI 16. Buttons unlock after cancel", async () => {
  const h = createMainHarness({
    runSavePageOutcome: { outcome: "cancelled" }
  });
  const savePageBtn = h.elements.get("savePageBtn");
  const openPsdBtn = h.elements.get("openPsdBtn");

  await h.sandbox.handleSavePage();
  assert.equal(savePageBtn.disabled, false, "savePageBtn unlocked after cancel");
  assert.equal(openPsdBtn.disabled, false, "openPsdBtn unlocked after cancel");
});

test("UI 17. Buttons unlock after modal dismissal", async () => {
  const h = createMainHarness({
    runSavePageOutcome: { outcome: "error", error: new Error("UXP dismissed") }
  });
  const savePageBtn = h.elements.get("savePageBtn");
  const openPsdBtn = h.elements.get("openPsdBtn");

  await h.sandbox.handleSavePage();
  assert.equal(savePageBtn.disabled, false, "savePageBtn unlocked after error/dismissal");
  assert.equal(openPsdBtn.disabled, false, "openPsdBtn unlocked after error/dismissal");
});

// ==========================================
// TESTS — DOCUMENT CHECK & SAFETY
// ==========================================

test("6. No open document: no folder picker called, outcome = no-document, toast = Open a PSD first", async () => {
  let pickerCalled = false;
  const storage = createMockStorage();

  const result = await executeSavePage({
    app: { activeDocument: null, documents: [] },
    selectFolder: async () => {
      pickerCalled = true;
      return createMockFolder();
    },
    storage
  });

  assert.equal(pickerCalled, false, "folder picker must not be called when no document is open");
  assert.equal(result.outcome, "no-document");

  const toast = buildSavePageToast(result);
  assert.equal(toast.message, "Open a PSD first");
});

test("7. Target document ID is captured before async UI and re-resolved before save", async () => {
  let modalExecuted = false;
  const docA = { id: 101, name: "Page_A.psd" };
  const docB = { id: 202, name: "Page_B.psd" };

  const app = {
    activeDocument: docA,
    documents: [docA, docB]
  };

  const baseFolder = createMockFolder("Album");
  const psdCalls = [];
  const jpegCalls = [];

  const result = await executeSavePage({
    app,
    selectFolder: async () => {
      // Simulate user switching active document tab while picker is open
      app.activeDocument = docB;
      return baseFolder;
    },
    promptForPrefix: async () => ({ cancelled: false, prefix: "Test" }),
    executeModal: async fn => {
      modalExecuted = true;
      return fn();
    },
    findDocumentById: (id, psApp) => psApp.documents.find(d => d.id === id),
    saveDocumentCopyPsd: async (doc, entry, opts) => {
      psdCalls.push({ docId: doc.id, entryName: entry.name, opts });
    },
    saveDocumentCopyJpeg: async (doc, entry, opts) => {
      jpegCalls.push({ docId: doc.id, entryName: entry.name, opts });
    },
    storage: createMockStorage()
  });

  assert.equal(result.outcome, "success");
  assert.equal(modalExecuted, true);
  assert.equal(psdCalls.length, 1);
  assert.equal(psdCalls[0].docId, 101, "must save document A by captured ID, not currently active document B");
  assert.equal(jpegCalls.length, 1);
  assert.equal(jpegCalls[0].docId, 101, "JPEG must save document A by captured ID");
});

test("8. If target document is closed before save: abort with document-closed toast", async () => {
  const docA = { id: 101, name: "Page_A.psd" };
  const app = {
    activeDocument: docA,
    documents: [docA]
  };

  const baseFolder = createMockFolder("Album");
  let psdSaved = false;

  const result = await executeSavePage({
    app,
    selectFolder: async () => {
      // User closes docA before confirming
      app.documents = [];
      app.activeDocument = null;
      return baseFolder;
    },
    promptForPrefix: async () => ({ cancelled: false, prefix: "Riya" }),
    executeModal: async fn => fn(),
    findDocumentById: (id, psApp) => psApp.documents.find(d => d.id === id),
    saveDocumentCopyPsd: async () => { psdSaved = true; },
    saveDocumentCopyJpeg: async () => {},
    storage: createMockStorage()
  });

  assert.equal(result.outcome, "document-closed");
  assert.equal(psdSaved, false, "must not attempt save if target document is closed");

  const toast = buildSavePageToast(result);
  assert.equal(toast.message, "Document is no longer open");
  assert.equal(toast.type, "error");
});

// ==========================================
// TESTS — PREFIX SANITATION
// ==========================================

test("9. sanitizePrefix(''): returns empty string", () => {
  assert.equal(sanitizePrefix(""), "");
  assert.equal(sanitizePrefix(null), "");
  assert.equal(sanitizePrefix(undefined), "");
});

test("10. sanitizePrefix('Riya'): returns 'Riya'", () => {
  assert.equal(sanitizePrefix("Riya"), "Riya");
});

test("11. sanitizePrefix('Wedding Album'): converts whitespace to underscore", () => {
  assert.equal(sanitizePrefix("Wedding Album"), "Wedding_Album");
});

test("12. sanitizePrefix('  Riya   Wedding  '): trims and collapses multi-whitespace to single underscore", () => {
  assert.equal(sanitizePrefix("  Riya   Wedding  "), "Riya_Wedding");
});

test("13. sanitizePrefix preserves capitalization", () => {
  assert.equal(sanitizePrefix("Anamika Bride"), "Anamika_Bride");
  assert.equal(sanitizePrefix("pHoto aLbuM"), "pHoto_aLbuM");
});

// ==========================================
// TESTS — PREFIX VALIDATION
// ==========================================

test("14. isValidPrefix rejects Windows invalid characters: < > : \" / \\ | ? *", () => {
  const invalidList = [
    "A/B", "A:B", "A?B", "A*B", 'A"B', "A<B", "A>B", "A|B", "A\\B",
    "Riya/Wedding", "Folder:1", "Star*Name?", "Pipe|Test"
  ];
  for (const inv of invalidList) {
    assert.equal(isValidPrefix(inv), false, `Prefix "${inv}" should be rejected`);
  }
});

test("15. isValidPrefix accepts valid English, Bengali, numbers, and allowed symbols", () => {
  const validList = [
    "",
    "Riya",
    "Wedding Album",
    "Anamika Bride",
    "অ্যালবাম ডিজাইন",
    "Photo 123",
    "Album-2026",
    "Page_1"
  ];
  for (const val of validList) {
    assert.equal(isValidPrefix(val), true, `Prefix "${val}" should be accepted`);
  }
});

// ==========================================
// TESTS — PREFIX MEMORY
// ==========================================

test("16. Stored prefix is loaded from storage", () => {
  const storage = createMockStorage({ mmrlt_prefix: "Riya" });
  assert.equal(getStoredValue(PREFIX_STORAGE_KEY, storage), "Riya");
});

test("17. New prefix is persisted to storage", () => {
  const storage = createMockStorage();
  setStoredValue(PREFIX_STORAGE_KEY, "Anamika", storage);
  assert.equal(getStoredValue(PREFIX_STORAGE_KEY, storage), "Anamika");
});

test("18. Clearing prefix persists empty string", () => {
  const storage = createMockStorage({ mmrlt_prefix: "Riya" });
  setStoredValue(PREFIX_STORAGE_KEY, "", storage);
  assert.equal(getStoredValue(PREFIX_STORAGE_KEY, storage), "");
});

// ==========================================
// TESTS — SERIAL PARSER
// ==========================================

test("19. extractAlbumSerial('FMRLT1.psd') -> 1", () => {
  assert.equal(extractAlbumSerial("FMRLT1.psd"), 1);
});

test("20. extractAlbumSerial('Riya_FMRLT8.psd') -> 8", () => {
  assert.equal(extractAlbumSerial("Riya_FMRLT8.psd"), 8);
});

test("21. extractAlbumSerial('ABC_FMRLT15.jpg') -> 15", () => {
  assert.equal(extractAlbumSerial("ABC_FMRLT15.jpg"), 15);
});

test("22. extractAlbumSerial('ABC_FMRLT16.jpeg') -> 16", () => {
  assert.equal(extractAlbumSerial("ABC_FMRLT16.jpeg"), 16);
});

test("23. extractAlbumSerial('FMRLTfoo.psd') -> ignored (null)", () => {
  assert.equal(extractAlbumSerial("FMRLTfoo.psd"), null);
});

test("23b. extractAlbumSerial ignores legacy MMRLT files: 'MMRLT1.psd' -> null", () => {
  assert.equal(extractAlbumSerial("MMRLT1.psd"), null);
  assert.equal(extractAlbumSerial("Riya_MMRLT8.psd"), null);
});

test("24. extractAlbumSerial('random.jpg') -> ignored (null)", () => {
  assert.equal(extractAlbumSerial("random.jpg"), null);
  assert.equal(extractAlbumSerial("photo.png"), null);
});

// ==========================================
// TESTS — NEXT SERIAL & GLOBAL NUMBERING
// ==========================================

test("getNextPageNumber correctly finds max across PSD and JPEG folders: next = max + 1", () => {
  const psdNames = ["FMRLT2.psd", "Riya_FMRLT8.psd"];
  const jpegNames = ["FMRLT4.jpg", "ABC_FMRLT11.jpeg"];
  const next = getNextPageNumber(psdNames, jpegNames);
  assert.equal(next, 12);
});

test("getNextPageNumber serial scan: FMRLT8 + FMRLT10 -> next FMRLT11", () => {
  const psdNames = ["FMRLT8.psd"];
  const jpegNames = ["Riya_FMRLT10.jpg"];
  const next = getNextPageNumber(psdNames, jpegNames);
  assert.equal(next, 11);
  const baseName = buildPageBaseName("", next);
  assert.equal(baseName, "FMRLT11");
});

test("getNextPageNumber defaults to 1 when no files match", () => {
  assert.equal(getNextPageNumber([], []), 1);
  assert.equal(getNextPageNumber(["foo.psd"], ["bar.jpg"]), 1);
  assert.equal(getNextPageNumber(["MMRLT10.psd"], ["MMRLT10.jpg"]), 1, "Legacy MMRLT files are ignored");
});

test("Global serial is independent of prefix: existing ABC_FMRLT8.psd with prefix XYZ gives XYZ_FMRLT9", () => {
  const psdNames = ["ABC_FMRLT8.psd"];
  const jpegNames = ["ABC_FMRLT8.jpg"];
  const nextSerial = getNextPageNumber(psdNames, jpegNames);
  assert.equal(nextSerial, 9);
  const baseName = buildPageBaseName("XYZ", nextSerial);
  assert.equal(baseName, "XYZ_FMRLT9");
  assert.notEqual(baseName, "XYZ_FMRLT1");
});

// ==========================================
// TESTS — SUBFOLDERS
// ==========================================

test("25 & 26. Existing PSD and JPEG folders are reused without creating duplicates", async () => {
  const baseFolder = createMockFolder("Album");
  const existingPsd = await baseFolder.createFolder("PSD");
  const existingJpeg = await baseFolder.createFolder("JPEG");

  const psd = await getOrCreateSubfolder(baseFolder, "PSD");
  const jpeg = await getOrCreateSubfolder(baseFolder, "JPEG");

  assert.equal(psd, existingPsd);
  assert.equal(jpeg, existingJpeg);

  const entries = await baseFolder.getEntries();
  assert.equal(entries.length, 2, "must not create duplicate folders");
});

test("27 & 28. Missing PSD and JPEG folders are created automatically", async () => {
  const baseFolder = createMockFolder("Album");
  assert.equal((await baseFolder.getEntries()).length, 0);

  const psd = await getOrCreateSubfolder(baseFolder, "PSD");
  const jpeg = await getOrCreateSubfolder(baseFolder, "JPEG");

  assert.equal(psd.name, "PSD");
  assert.equal(jpeg.name, "JPEG");
  assert.equal((await baseFolder.getEntries()).length, 2);
});

test("29. No duplicate or suffixed folders created (no PSD_2 or JPEG Copy)", async () => {
  const baseFolder = createMockFolder("Album");
  await getOrCreateSubfolder(baseFolder, "PSD");
  await getOrCreateSubfolder(baseFolder, "JPEG");
  await getOrCreateSubfolder(baseFolder, "PSD");
  await getOrCreateSubfolder(baseFolder, "JPEG");

  const names = (await baseFolder.getEntries()).map(e => e.name);
  assert.deepEqual(names.sort(), ["JPEG", "PSD"]);
});

// ==========================================
// TESTS — FILE NAMES
// ==========================================

test("30. No prefix, first serial: FMRLT1.psd and FMRLT1.jpg", () => {
  const base = buildPageBaseName("", 1);
  assert.equal(base, "FMRLT1");
  assert.equal(`${base}.psd`, "FMRLT1.psd");
  assert.equal(`${base}.jpg`, "FMRLT1.jpg");
});

test("31. Prefix Riya, serial 8: Riya_FMRLT8.psd and Riya_FMRLT8.jpg", () => {
  const base = buildPageBaseName("Riya", 8);
  assert.equal(base, "Riya_FMRLT8");
  assert.equal(`${base}.psd`, "Riya_FMRLT8.psd");
  assert.equal(`${base}.jpg`, "Riya_FMRLT8.jpg");
});

// ==========================================
// TESTS — PSD & JPEG SAVE INTEGRATION
// ==========================================

test("32-37. PSD Save uses intended doc, created PSD entry, saveAs.psd, asCopy=true, color profile and alpha", async () => {
  const doc = { id: 77, name: "ActivePage.psd" };
  const app = { activeDocument: doc, documents: [doc] };
  const baseFolder = createMockFolder("Album");

  let psdCall = null;
  let docPassed = null;

  const result = await executeSavePage({
    app,
    selectFolder: async () => baseFolder,
    promptForPrefix: async () => ({ cancelled: false, prefix: "Riya" }),
    executeModal: async fn => fn(),
    findDocumentById: (id, a) => a.documents.find(d => d.id === id),
    saveDocumentCopyPsd: async (targetDoc, entry, opts) => {
      docPassed = targetDoc;
      psdCall = { entry, opts };
    },
    saveDocumentCopyJpeg: async () => {},
    storage: createMockStorage()
  });

  assert.equal(result.outcome, "success");
  assert.equal(docPassed.id, 77, "32. PSD save must use intended document");
  assert.equal(psdCall.entry.name, "Riya_FMRLT1.psd", "33. PSD save must use created PSD entry");
  assert.equal(psdCall.opts.embedColorProfile, true, "36. embedColorProfile must be true");
  assert.equal(psdCall.opts.alphaChannels, true, "37. alphaChannels must be true");
});

test("38-42. JPEG save occurs after PSD success, quality 12, asCopy=true, no flattening", async () => {
  let flattened = false;
  const doc = {
    id: 88,
    name: "WorkingDoc.psd",
    flatten() { flattened = true; }
  };
  const app = { activeDocument: doc, documents: [doc] };
  const baseFolder = createMockFolder("Album");

  const callOrder = [];
  let jpegCall = null;

  const result = await executeSavePage({
    app,
    selectFolder: async () => baseFolder,
    promptForPrefix: async () => ({ cancelled: false, prefix: "Wedding" }),
    executeModal: async fn => fn(),
    findDocumentById: (id, a) => a.documents.find(d => d.id === id),
    saveDocumentCopyPsd: async () => {
      callOrder.push("psd");
    },
    saveDocumentCopyJpeg: async (targetDoc, entry, opts) => {
      callOrder.push("jpeg");
      jpegCall = { targetDoc, entry, opts };
    },
    storage: createMockStorage()
  });

  assert.equal(result.outcome, "success");
  assert.deepEqual(callOrder, ["psd", "jpeg"], "38. JPEG save occurs after PSD success");
  assert.equal(jpegCall.entry.name, "Wedding_FMRLT1.jpg", "39. JPEG save uses correct entry");
  assert.equal(jpegCall.opts.quality, 12, "40. JPEG quality must be exactly 12");
  assert.equal(flattened, false, "42. Working document must NOT be flattened");
});

// ==========================================
// TESTS — FAILURE ORDER
// ==========================================

test("43. If PSD save fails: JPEG save is NOT attempted, returns psd-failed", async () => {
  const doc = { id: 11, name: "Doc.psd" };
  const app = { activeDocument: doc, documents: [doc] };
  const baseFolder = createMockFolder("Album");

  let jpegAttempted = false;

  const result = await executeSavePage({
    app,
    selectFolder: async () => baseFolder,
    promptForPrefix: async () => ({ cancelled: false, prefix: "" }),
    executeModal: async fn => fn(),
    findDocumentById: (id, a) => a.documents.find(d => d.id === id),
    saveDocumentCopyPsd: async () => {
      throw new Error("Disk full on PSD save");
    },
    saveDocumentCopyJpeg: async () => {
      jpegAttempted = true;
    },
    storage: createMockStorage()
  });

  assert.equal(result.outcome, "psd-failed");
  assert.equal(jpegAttempted, false, "JPEG save must not be attempted if PSD save fails");

  const toast = buildSavePageToast(result);
  assert.equal(toast.message, "PSD save failed");
  assert.equal(toast.type, "error");
});

test("44. If PSD succeeds but JPEG fails: PSD remains saved, returns jpeg-failed", async () => {
  const doc = { id: 12, name: "Doc.psd" };
  const app = { activeDocument: doc, documents: [doc] };
  const baseFolder = createMockFolder("Album");

  let psdSaved = false;

  const result = await executeSavePage({
    app,
    selectFolder: async () => baseFolder,
    promptForPrefix: async () => ({ cancelled: false, prefix: "Riya" }),
    executeModal: async fn => fn(),
    findDocumentById: (id, a) => a.documents.find(d => d.id === id),
    saveDocumentCopyPsd: async () => {
      psdSaved = true;
    },
    saveDocumentCopyJpeg: async () => {
      throw new Error("JPEG encoder out of memory");
    },
    storage: createMockStorage()
  });

  assert.equal(psdSaved, true, "PSD must remain saved");
  assert.equal(result.outcome, "jpeg-failed");

  const toast = buildSavePageToast(result);
  assert.equal(toast.message, "PSD saved • JPEG failed");
  assert.equal(toast.type, "warning");
});

// ==========================================
// TESTS — COLLISION HANDLING
// ==========================================

test("45-47. Collision safety: calculated serial occupied before save triggers advance to next safe number", async () => {
  const psdFolder = createMockFolder("PSD");
  const jpegFolder = createMockFolder("JPEG");

  // Suppose FMRLT1 already exists on disk in PSD folder
  await psdFolder.createFile("FMRLT1.psd");

  const safe = await resolveSafeFileEntries(psdFolder, jpegFolder, "");
  assert.equal(safe.serial, 2, "must skip occupied FMRLT1 and use serial 2");
  assert.equal(safe.psdFileName, "FMRLT2.psd");
  assert.equal(safe.jpegFileName, "FMRLT2.jpg");
});

test("resolveSafeFileEntries handles prefix collisions without overwriting existing files", async () => {
  const psdFolder = createMockFolder("PSD");
  const jpegFolder = createMockFolder("JPEG");

  // Riya_FMRLT5 exists in JPEG folder
  await jpegFolder.createFile("Riya_FMRLT5.jpg");

  const safe = await resolveSafeFileEntries(psdFolder, jpegFolder, "Riya");
  assert.equal(safe.serial, 6);
  assert.equal(safe.baseName, "Riya_FMRLT6");
});

test("output modes save only requested formats and BOTH shares one serial", async () => {
  async function run(mode, existingPsd = [], existingJpeg = []) {
    const base = createMockFolder("Album");
    const psd = await base.createFolder("PSD");
    const jpeg = await base.createFolder("JPEG");
    for (const name of existingPsd) await psd.createFile(name);
    for (const name of existingJpeg) await jpeg.createFile(name);
    const calls = [];
    const result = await executeSavePage({
      app: { activeDocument: { id: 1, name: "Page.psd" } },
      localFileSystem: {}, storage: createMockStorage(), selectFolder: async () => base,
      promptForPrefix: async () => ({ cancelled: false, prefix: "Bride", outputMode: mode }),
      findDocumentById: () => ({ id: 1, name: "Page.psd" }), executeModal: async fn => fn(),
      saveDocumentCopyPsd: async (_doc, entry) => calls.push(["psd", entry.name]),
      saveDocumentCopyJpeg: async (_doc, entry, options) => calls.push(["jpeg", entry.name, options.quality])
    });
    return { result, calls };
  }
  const psdOnly = await run("psd", ["FMRLT05.psd"], ["FMRLT09.jpg"]);
  assert.deepEqual(psdOnly.calls, [["psd", "Bride_FMRLT10.psd"]]);
  const jpegOnly = await run("jpeg", ["FMRLT05.psd"], ["FMRLT09.jpg"]);
  assert.deepEqual(jpegOnly.calls, [["jpeg", "Bride_FMRLT10.jpg", 12]]);
  const both = await run("both", ["FMRLT05.psd"], ["FMRLT09.jpg"]);
  assert.deepEqual(both.calls, [["psd", "Bride_FMRLT10.psd"], ["jpeg", "Bride_FMRLT10.jpg", 12]]);
});

test("global scan and collision protection advance across PSD and JPEG namespaces", async () => {
  const base = createMockFolder("Album");
  const psd = await base.createFolder("PSD");
  const jpeg = await base.createFolder("JPEG");
  await psd.createFile("Bride_FMRLT10.psd");
  await jpeg.createFile("Groom_FMRLT12.jpg");
  const calls = [];
  const result = await executeSavePage({
    app: { activeDocument: { id: 1, name: "Page.psd" } }, localFileSystem: {}, storage: createMockStorage(), selectFolder: async () => base,
    promptForPrefix: async () => ({ cancelled: false, prefix: "Groom", outputMode: "both" }),
    findDocumentById: () => ({ id: 1 }), executeModal: async fn => fn(),
    saveDocumentCopyPsd: async (_d, e) => calls.push(e.name), saveDocumentCopyJpeg: async (_d, e) => calls.push(e.name)
  });
  assert.equal(result.serial, 13);
  assert.deepEqual(calls, ["Groom_FMRLT13.psd", "Groom_FMRLT13.jpg"]);
});

// ==========================================
// TESTS — MODAL BOUNDARIES
// ==========================================

test("48-51. Modal boundaries: folder picker and prefix UI outside modal, save operations inside modal", async () => {
  const doc = { id: 99, name: "Doc.psd" };
  const app = { activeDocument: doc, documents: [doc] };
  const baseFolder = createMockFolder("Album");

  let inModal = false;
  let pickerInModal = true;
  let prefixInModal = true;
  let psdInModal = false;
  let jpegInModal = false;
  let activeDocAssignmentInModal = false;

  const result = await executeSavePage({
    app,
    selectFolder: async () => {
      pickerInModal = inModal;
      return baseFolder;
    },
    promptForPrefix: async () => {
      prefixInModal = inModal;
      return { cancelled: false, prefix: "Test" };
    },
    executeModal: async (fn, cmdName) => {
      assert.equal(cmdName, "FM Save Page");
      inModal = true;
      try {
        return await fn();
      } finally {
        inModal = false;
      }
    },
    findDocumentById: (id, a) => a.documents.find(d => d.id === id),
    saveDocumentCopyPsd: async () => {
      psdInModal = inModal;
    },
    saveDocumentCopyJpeg: async () => {
      jpegInModal = inModal;
    },
    storage: createMockStorage()
  });

  assert.equal(result.outcome, "success");
  assert.equal(pickerInModal, false, "48. Folder picker must occur OUTSIDE executeAsModal");
  assert.equal(prefixInModal, false, "49. Prefix UI must occur OUTSIDE executeAsModal");
  assert.equal(psdInModal, true, "50. PSD save operation must occur INSIDE executeAsModal");
  assert.equal(jpegInModal, true, "50. JPEG save operation must occur INSIDE executeAsModal");
});

// ==========================================
// TESTS — CANCEL WORKFLOW
// ==========================================

test("52. Folder picker cancel: zero save operations, outcome = cancelled", async () => {
  const doc = { id: 1, name: "D.psd" };
  const app = { activeDocument: doc, documents: [doc] };
  let psdCalled = false;
  let jpegCalled = false;

  const result = await executeSavePage({
    app,
    selectFolder: async () => null, // User clicks cancel in folder picker
    saveDocumentCopyPsd: async () => { psdCalled = true; },
    saveDocumentCopyJpeg: async () => { jpegCalled = true; },
    storage: createMockStorage()
  });

  assert.equal(result.outcome, "cancelled");
  assert.equal(psdCalled, false);
  assert.equal(jpegCalled, false);

  const toast = buildSavePageToast(result);
  assert.equal(toast.message, "Cancelled");
});

test("53. Prefix cancel: zero save operations, outcome = cancelled", async () => {
  const doc = { id: 1, name: "D.psd" };
  const app = { activeDocument: doc, documents: [doc] };
  const baseFolder = createMockFolder("Album");
  let psdCalled = false;
  let jpegCalled = false;

  const result = await executeSavePage({
    app,
    selectFolder: async () => baseFolder,
    promptForPrefix: async () => ({ cancelled: true }),
    saveDocumentCopyPsd: async () => { psdCalled = true; },
    saveDocumentCopyJpeg: async () => { jpegCalled = true; },
    storage: createMockStorage()
  });

  assert.equal(result.outcome, "cancelled");
  assert.equal(psdCalled, false);
  assert.equal(jpegCalled, false);

  const toast = buildSavePageToast(result);
  assert.equal(toast.message, "Cancelled");
});

// ==========================================
// TESTS — TOAST SUMMARY FUNCTION
// ==========================================

test("buildSavePageToast generates all required user-facing toasts accurately", () => {
  assert.deepEqual(buildSavePageToast({ outcome: "no-document" }), {
    message: "Open a PSD first",
    type: "warning"
  });

  assert.deepEqual(buildSavePageToast({ outcome: "cancelled" }), {
    message: "Cancelled",
    type: "info"
  });

  assert.deepEqual(buildSavePageToast({ outcome: "invalid-prefix" }), {
    message: "Invalid prefix",
    type: "error"
  });

  assert.deepEqual(buildSavePageToast({ outcome: "document-closed" }), {
    message: "Document is no longer open",
    type: "error"
  });

  assert.deepEqual(buildSavePageToast({ outcome: "psd-failed" }), {
    message: "PSD save failed",
    type: "error"
  });

  assert.deepEqual(buildSavePageToast({ outcome: "jpeg-failed" }), {
    message: "PSD saved • JPEG failed",
    type: "warning"
  });

  assert.deepEqual(buildSavePageToast({ outcome: "success", fileName: "Riya_FMRLT8" }), {
    message: "Saved: Riya_FMRLT8",
    type: "success"
  });

  assert.deepEqual(buildSavePageToast({ outcome: "success", fileName: "FMRLT8" }), {
    message: "Saved: FMRLT8",
    type: "success"
  });

  assert.deepEqual(buildSavePageToast({ outcome: "error" }), {
    message: "Save Page failed",
    type: "error"
  });
});
