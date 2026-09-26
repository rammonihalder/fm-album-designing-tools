"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

function loadFilesModule(fs) {
  const originalLoad = Module._load;
  const modulePath = require.resolve("../src/files");
  Module._load = function(request, parent, isMain) {
    if (request === "uxp") return { storage: { localFileSystem: fs, fileTypes: { images: ["png"] } } };
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[modulePath];
  try { return require(modulePath); }
  finally { Module._load = originalLoad; delete require.cache[modulePath]; }
}

// Picker entries cannot move; only reacquired disk entries can.
function diskHarness(paths, existing = []) {
  const calls = { urls: [], native: [], created: [], moved: [], reacquired: [] };
  const folders = new Map();
  const sources = paths.map(nativePath => ({
    name: nativePath.split(/[\\/]/).pop(), nativePath,
    url: { toString: () => "blob:/picker-resource" },
    moveTo() { throw new Error("Picker entries are read-only"); }
  }));
  function parent(url) {
    if (folders.has(url)) return folders.get(url);
    let used = existing.includes(url);
    const names = new Set();
    const destination = { isFolder: true, names, getEntry: async name => {
      if (!names.has(name)) throw new Error("not found");
      return { name, isFile: true };
    } };
    const folder = {
      isFolder: true, destination,
      getEntry: async name => {
        if (name === "Album Used") {
          if (!used) throw new Error("not found");
          return destination;
        }
        calls.reacquired.push({ url, name });
        return { name, isFile: true, moveTo: async (target, options) => {
          assert.equal(target, destination);
          assert.equal(options.overwrite, false);
          if (names.has(options.newName)) throw new Error("EntryExists");
          if (folder.failMove) throw new Error("permission denied");
          names.add(options.newName);
          calls.moved.push({ url, name: options.newName });
        } };
      },
      createFolder: async name => {
        assert.equal(name, "Album Used");
        assert.equal(used, false);
        calls.created.push(url); used = true; return destination;
      }
    };
    folders.set(url, folder);
    return folder;
  }
  const fs = {
    getNativePath: entry => { calls.native.push(entry); return entry.nativePath; },
    getEntryWithUrl: async url => {
      calls.urls.push(url);
      assert.match(url, /^file:\//, "Only a filesystem URL may reach the provider");
      return parent(url);
    }
  };
  return { ...loadFilesModule(fs), calls, sources, parent, fs };
}

test("picker keeps JPG/JPEG/PNG and multiple selection", async () => {
  let options;
  const api = loadFilesModule({ getFileForOpening: async value => { options = value; return []; } });
  assert.deepEqual(await api.selectImageFiles(), []);
  assert.deepEqual(options, { allowMultiple: true, types: ["jpg", "jpeg", "png"] });
});

for (const [nativePath, expected] of [
  ["F:\\Wedding Photos", "file:/F:/Wedding%20Photos"],
  ["F:\\Shoot #1\\100%", "file:/F:/Shoot%20%231/100%25"],
  ["F:\\ছবি", "file:/F:/%E0%A6%9B%E0%A6%AC%E0%A6%BF"],
  ["F:\\", "file:/F:/"],
  ["g:/Photos", "file:/g:/Photos"],
  ["/Users/photos #1", "file:/Users/photos%20%231"]
]) {
  test("native path conversion: " + nativePath, () => {
    const { nativePathToFileUrl } = loadFilesModule({});
    assert.equal(typeof nativePathToFileUrl, "function");
    assert.equal(nativePathToFileUrl(nativePath), expected);
  });
}

test("blob picker URLs are ignored; getNativePath resolves the writable parent", async () => {
  const h = diskHarness(["F:\\Photos\\image.jpg"]);
  const result = await h.moveUsedFiles(h.sources);
  assert.equal(result.failed.length, 0);
  assert.deepEqual(h.calls.native, h.sources);
  assert.deepEqual(h.calls.urls, ["file:/F:/Photos"]);
  assert.deepEqual(h.calls.reacquired, [{ url: "file:/F:/Photos", name: "image.jpg" }]);
  assert.deepEqual(h.calls.moved, [{ url: "file:/F:/Photos", name: "image.jpg" }]);
});

test("disk movement never reads Entry.url, even to string-coerce it", async () => {
  const h = diskHarness(["F:\\Photos\\image.jpg"]);
  Object.defineProperty(h.sources[0], "url", { get() { throw new Error("Entry.url must not be read"); } });
  const result = await h.moveUsedFiles(h.sources);
  assert.equal(result.failed.length, 0);
  assert.equal(result.moved.length, 1);
});

test("provider native path is authoritative over an entry property", async () => {
  const h = diskHarness(["F:\\Wrong\\image.jpg"]);
  h.fs.getNativePath = () => "G:\\Real Folder\\image.jpg";
  assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 0);
  assert.deepEqual(h.calls.urls, ["file:/G:/Real%20Folder"]);
});

test("Unicode filename is reacquired unencoded under an encoded native parent", async () => {
  const h = diskHarness(["F:\\Photos # 100%\\ছবি.jpg"]);
  assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 0);
  assert.deepEqual(h.calls.reacquired, [{ url: "file:/F:/Photos%20%23%20100%25", name: "ছবি.jpg" }]);
});

test("drive-root source preserves the parent root slash", async () => {
  const h = diskHarness(["F:\\image.jpg"]);
  assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 0);
  assert.deepEqual(h.calls.urls, ["file:/F:/"]);
});

test("Album Used is created when missing and reused for the next source", async () => {
  const h = diskHarness(["F:\\Photos\\one.jpg", "F:\\Photos\\two.jpg"]);
  assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 0);
  assert.deepEqual(h.calls.created, ["file:/F:/Photos"]);
  assert.equal(h.calls.moved.length, 2);
});

test("existing Album Used is reused and collisions increment without overwriting", async () => {
  const h = diskHarness(["F:\\Photos\\photo.jpg"], ["file:/F:/Photos"]);
  const names = h.parent("file:/F:/Photos").destination.names;
  names.add("photo.jpg");
  assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 0);
  assert.deepEqual(h.calls.created, []);
  assert.deepEqual(h.calls.moved, [{ url: "file:/F:/Photos", name: "photo_2.jpg" }]);
  assert.ok(names.has("photo.jpg"));
  assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 0);
  assert.equal(h.calls.moved[1].name, "photo_3.jpg");
});

test("different source folders have separate Album Used destinations", async () => {
  const h = diskHarness(["F:\\A\\1.jpg", "G:\\B\\2.jpg"]);
  assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 0);
  assert.deepEqual(h.calls.created, ["file:/F:/A", "file:/G:/B"]);
  assert.deepEqual(h.calls.moved, [{ url: "file:/F:/A", name: "1.jpg" }, { url: "file:/G:/B", name: "2.jpg" }]);
});

test("move failure preserves the source record and continues with the next file", async () => {
  const h = diskHarness(["F:\\A\\1.jpg", "G:\\B\\2.jpg"]);
  h.parent("file:/F:/A").failMove = true;
  const result = await h.moveUsedFiles(h.sources);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].file, h.sources[0]);
  assert.match(result.failed[0].error.message, /permission denied/);
  assert.deepEqual(result.moved, [h.sources[1]]);
});

test("non-folder parent is rejected before any source move", async () => {
  const h = diskHarness(["F:\\Photos\\photo.jpg"]);
  h.fs.getEntryWithUrl = async () => ({ isFile: true, isFolder: false });
  const result = await h.moveUsedFiles(h.sources);
  assert.equal(result.failed.length, 1);
  assert.deepEqual(h.calls.moved, []);
});

test("workflow sends only successful placements through native path resolution and movement", async () => {
  const { executeAutoPhotoFill } = require("../src/tools/autoPhotoFill");
  const h = diskHarness(["F:\\Photos\\used.jpg", "F:\\Photos\\failed.jpg", "F:\\Photos\\extra.jpg"]);
  const result = await executeAutoPhotoFill({}, {
    getSelectedLayersTopToBottom: () => [{ id: 1 }, { id: 2 }],
    readBounds: () => ({ left: 0, top: 0, right: 1200, bottom: 800 }),
    selectImageFiles: async () => h.sources,
    inspectImageFiles: async files => ({ photos: files.map(file => ({ file, width: 800, height: 1200 })), errors: [] }),
    runPlacement: async items => ({
      placedItems: [items[0]],
      failedItems: [{ item: items[1], error: new Error("placement failed") }]
    }),
    moveUsedFiles: h.moveUsedFiles
  });
  assert.equal(result.placedCount, 1);
  assert.equal(result.unmatchedPhotos.length, 1);
  assert.deepEqual(h.calls.native, [h.sources[0]]);
  assert.deepEqual(h.calls.reacquired, [{ url: "file:/F:/Photos", name: "used.jpg" }]);
  assert.deepEqual(h.calls.moved, [{ url: "file:/F:/Photos", name: "used.jpg" }]);
});

test("invalid native paths never reach getEntryWithUrl, with no blob URL fallback", async () => {
  for (const value of ["blob:/image", "file:/F:/Photos/image.jpg", "relative/image.jpg", "F:image.jpg", ""]) {
    const h = diskHarness(["F:\\Photos\\image.jpg"]);
    h.fs.getNativePath = () => value;
    const result = await h.moveUsedFiles(h.sources);
    assert.equal(result.failed.length, 1, value);
    assert.deepEqual(h.calls.urls, [], value);
  }
});
