"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test.beforeEach(t => { t.mock.method(console, "warn", () => {}); });

function loadFilesModule(fs) {
  const originalLoad = Module._load;
  const modulePath = require.resolve("../src/files");
  Module._load = function(request, parent, isMain) {
    if (request === "uxp") return { storage: { localFileSystem: fs } };
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[modulePath];
  try { return require(modulePath); }
  finally { Module._load = originalLoad; delete require.cache[modulePath]; }
}

function missing() { return Object.assign(new Error("Could not find an entry"), { code: "ENOENT" }); }

// Model the reported UXP boundary: file:/ path text is encoded by the host.
// Known native folders are registered independently; an encoded lookup cannot
// invent a folder and pass. Only the provider knows the picker native path.
function diskHarness(paths, existing = []) {
  const calls = { urls: [], resolvedUrls: [], native: [], created: [], moved: [], reacquired: [], folderLookups: 0 };
  const folders = new Map();
  const remaining = new Set(paths);
  const nativePaths = new Map();
  const sources = paths.map(nativePath => {
    const entry = {
      name: path.win32.basename(nativePath),
      get url() { throw new Error("Picker Entry.url must never be read"); },
      moveTo() { throw new Error("Picker entries are read-only"); }
    };
    nativePaths.set(entry, nativePath);
    return entry;
  });
  for (const nativePath of paths) {
    const parentPath = path.win32.dirname(nativePath);
    if (folders.has(parentPath)) continue;
    let used = existing.includes(parentPath);
    const names = new Set();
    const folder = { isFolder: true };
    const destination = { isFolder: true, names, getEntry: async name => {
      if (folder.collisionError) throw folder.collisionError;
      if (!names.has(name)) throw missing();
      return { name, isFile: true };
    } };
    folder.destination = destination;
    folder.getEntry = async name => {
      if (name === "Album Used") {
        calls.folderLookups++;
        if (folder.lookupError) throw folder.lookupError;
        if (!used) throw missing();
        return folder.usedIsFile ? { isFile: true } : destination;
      }
      const sourcePath = path.win32.join(parentPath, name);
      if (!remaining.has(sourcePath)) throw missing();
      calls.reacquired.push(sourcePath);
      return { name, isFile: true, moveTo: async (target, options) => {
        assert.equal(target, destination);
        assert.equal(options.overwrite, false);
        if (folder.moveError) throw folder.moveError;
        if (names.has(options.newName)) throw Object.assign(new Error("already exists"), { name: "EntryExists" });
        names.add(options.newName);
        remaining.delete(sourcePath);
        calls.moved.push(path.win32.join(parentPath, "Album Used", options.newName));
      } };
    };
    folder.createFolder = async name => {
      assert.equal(name, "Album Used");
      if (folder.createError) throw folder.createError;
      assert.equal(used, false);
      calls.created.push(path.win32.join(parentPath, name));
      used = true;
      return destination;
    };
    folders.set(parentPath, folder);
  }
  const fs = {
    getNativePath: entry => { calls.native.push(entry); return nativePaths.get(entry); },
    getEntryWithUrl: async url => {
      calls.urls.push(url);
      assert.match(url, /^file:\//);
      const nativeParent = url.replace(/^file:\/+/, "").replace(/\//g, "\\");
      const resolved = pathToFileURL(nativeParent).href;
      calls.resolvedUrls.push(resolved);
      const folder = folders.get(nativeParent);
      if (!folder) throw Object.assign(new Error("Could not find an entry of: " + resolved), { code: "ENOENT" });
      return folder;
    }
  };
  return { ...loadFilesModule(fs), calls, sources, folders, remaining, fs };
}

test("picker keeps JPG/JPEG/PNG and multiple selection", async () => {
  let options;
  const api = loadFilesModule({ getFileForOpening: async value => { options = value; return []; } });
  assert.deepEqual(await api.selectImageFiles(), []);
  assert.deepEqual(options, { allowMultiple: true, types: ["jpg", "jpeg", "png"] });
});

for (const [nativePath, expected] of [
  ["G:\\Album Test", "file:///G:/Album%20Test"],
  ["G:\\Bride #1", "file:///G:/Bride%20%231"],
  ["G:\\100% Selected", "file:///G:/100%25%20Selected"],
  ["G:\\Literal%20Name", "file:///G:/Literal%2520Name"],
  ["G:\\ছবি", "file:///G:/%E0%A6%9B%E0%A6%AC%E0%A6%BF"],
  ["G:\\", "file:///G:/"],
  ["g:/Photos", "file:///g:/Photos"],
  ["/Users/photos #1", "file:///Users/photos%20%231"]
]) {
  test("canonical diagnostic URL from raw native path: " + nativePath, () => {
    const { nativePathToFileUrl } = loadFilesModule({});
    assert.equal(nativePathToFileUrl(nativePath), expected);
  });
}

test("real G drive regression: raw picker native path reaches Album Used without %2520", async () => {
  const sourcePath = "G:\\WORKING ALBUM\\SAVE EDITED PHOTOS\\ANAMIKA\\Memory Maker 1 DT.jpg";
  const h = diskHarness([sourcePath]);
  const result = await h.moveUsedFiles(h.sources);
  assert.equal(result.failed.length, 0);
  assert.deepEqual(h.calls.native, h.sources);
  assert.deepEqual(h.calls.urls, ["file:/G:/WORKING ALBUM/SAVE EDITED PHOTOS/ANAMIKA"]);
  const resolved = h.calls.resolvedUrls[0];
  assert.equal(resolved, "file:///G:/WORKING%20ALBUM/SAVE%20EDITED%20PHOTOS/ANAMIKA");
  assert.ok(resolved.includes("WORKING%20ALBUM"));
  assert.ok(resolved.includes("SAVE%20EDITED%20PHOTOS"));
  assert.ok(!resolved.includes("%2520"));
  assert.deepEqual(h.calls.created, ["G:\\WORKING ALBUM\\SAVE EDITED PHOTOS\\ANAMIKA\\Album Used"]);
  assert.deepEqual(h.calls.reacquired, [sourcePath]);
  assert.deepEqual(h.calls.moved, ["G:\\WORKING ALBUM\\SAVE EDITED PHOTOS\\ANAMIKA\\Album Used\\Memory Maker 1 DT.jpg"]);
  assert.ok(!h.remaining.has(sourcePath));
});

for (const sourcePath of [
  "G:\\Bride #1\\photo #1.jpg", "G:\\100% Selected\\100%.jpg",
  "G:\\Literal%20Name\\literal%20photo.jpg", "G:\\A & B (final)\\photo.final.JPG",
  "G:\\অনামিকা\\ছবি.jpg", "G:\\root.jpg"
]) {
  test("movement preserves native characters: " + sourcePath, async () => {
    const h = diskHarness([sourcePath]);
    assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 0);
    assert.deepEqual(h.calls.reacquired, [sourcePath]);
    assert.deepEqual(h.calls.moved, [path.win32.join(path.win32.dirname(sourcePath), "Album Used", path.win32.basename(sourcePath))]);
  });
}

test("Album Used is created once and cached for the next source", async () => {
  const h = diskHarness(["F:\\Photos\\one.jpg", "F:\\Photos\\two.jpg"]);
  assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 0);
  assert.deepEqual(h.calls.created, ["F:\\Photos\\Album Used"]);
  assert.equal(h.calls.folderLookups, 1);
  assert.equal(h.calls.moved.length, 2);
});

test("existing folder and collision names preserve basename, extension, and old files", async () => {
  const h = diskHarness(["F:\\Photos\\photo.final.JPG"], ["F:\\Photos"]);
  const names = h.folders.get("F:\\Photos").destination.names;
  names.add("photo.final.JPG"); names.add("photo.final_2.JPG");
  assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 0);
  assert.deepEqual(h.calls.created, []);
  assert.deepEqual(h.calls.moved, ["F:\\Photos\\Album Used\\photo.final_3.JPG"]);
  assert.ok(names.has("photo.final.JPG"));
  assert.ok(names.has("photo.final_2.JPG"));
});

test("multiple source directories create separate Album Used folders", async () => {
  const h = diskHarness(["D:\\Shoot A\\1.jpg", "E:\\Shoot B\\2.jpg"]);
  assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 0);
  assert.deepEqual(h.calls.created, ["D:\\Shoot A\\Album Used", "E:\\Shoot B\\Album Used"]);
  assert.deepEqual(h.calls.moved, ["D:\\Shoot A\\Album Used\\1.jpg", "E:\\Shoot B\\Album Used\\2.jpg"]);
});

for (const [error, category] of [
  [Object.assign(new Error("missing source"), { code: "ENOENT" }), "PATH / NOT FOUND"],
  [Object.assign(new Error("blocked"), { name: "EntryNotFound" }), "PATH / NOT FOUND"],
  [new Error("Could not find an entry of file:///G:/Photos"), "PATH / NOT FOUND"],
  [Object.assign(new Error("blocked"), { code: "EACCES" }), "PERMISSION"],
  [Object.assign(new Error("blocked"), { code: "EPERM" }), "PERMISSION"],
  [Object.assign(new Error("blocked"), { name: "PermissionDenied" }), "PERMISSION"],
  [new Error("Access denied"), "PERMISSION"],
  [Object.assign(new Error("resource busy"), { code: "EBUSY" }), "LOCK / IN USE"],
  [new Error("File is in use by another process"), "LOCK / IN USE"],
  [Object.assign(new Error("unrecognized failure"), { code: "EIO" }), "FILESYSTEM"]
]) {
  test("move error preserves source, continues, and diagnoses " + (error.code || error.name) + ": " + error.message, async () => {
    const h = diskHarness(["F:\\A\\1.jpg", "G:\\B\\2.jpg"]);
    h.folders.get("F:\\A").moveError = error;
    const progress = [];
    const result = await h.moveUsedFiles(h.sources, (done, total) => progress.push([done, total]));
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].error, error);
    assert.equal(result.failed[0].diagnostic.category, category);
    assert.equal(result.failed[0].diagnostic.operation, "move source");
    assert.equal(result.failed[0].diagnostic.sourceNativePath, "F:\\A\\1.jpg");
    assert.equal(result.failed[0].diagnostic.parentNativePath, "F:\\A");
    assert.equal(result.failed[0].diagnostic.destinationNativePath, "F:\\A\\Album Used\\1.jpg");
    assert.equal(console.warn.mock.calls[0].arguments[1], result.failed[0].diagnostic);
    assert.ok(h.remaining.has("F:\\A\\1.jpg"));
    assert.deepEqual(result.moved, [h.sources[1]]);
    assert.deepEqual(progress, [[1, 2], [2, 2]]);
  });
}

for (const stage of ["lookupError", "collisionError", "createError"]) {
  test(stage + " permission failure never becomes missing or triggers a move", async () => {
    const h = diskHarness(["F:\\A\\1.jpg"]);
    const error = Object.assign(new Error("denied"), { code: "EACCES" });
    h.folders.get("F:\\A")[stage] = error;
    const result = await h.moveUsedFiles(h.sources);
    assert.equal(result.failed[0].error, error);
    assert.equal(result.failed[0].diagnostic.category, "PERMISSION");
    assert.deepEqual(h.calls.moved, []);
    assert.ok(h.remaining.has("F:\\A\\1.jpg"));
    if (stage === "lookupError") assert.deepEqual(h.calls.created, []);
  });
}

test("Album Used that is a file is rejected without replacement", async () => {
  const h = diskHarness(["F:\\A\\1.jpg"], ["F:\\A"]);
  h.folders.get("F:\\A").usedIsFile = true;
  const result = await h.moveUsedFiles(h.sources);
  assert.equal(result.failed.length, 1);
  assert.deepEqual(h.calls.created, []);
  assert.deepEqual(h.calls.moved, []);
});

test("workflow moves only successful forced-fallback placements; failed and extra photos stay", async () => {
  const { executeAutoPhotoFill } = require("../src/tools/autoPhotoFill");
  const h = diskHarness(["F:\\Photos\\used.jpg", "F:\\Photos\\failed.jpg", "F:\\Photos\\extra.jpg"]);
  const result = await executeAutoPhotoFill({}, {
    getSelectedLayersTopToBottom: () => [{ id: 1 }, { id: 2 }],
    readBounds: () => ({ left: 0, top: 0, right: 1200, bottom: 800 }),
    selectImageFiles: async () => h.sources,
    inspectImageFiles: async files => ({ photos: files.map(file => ({ file, width: 800, height: 1200 })), errors: [] }),
    runPlacement: async items => ({ placedItems: [items[0]], failedItems: [{ item: items[1], error: new Error("placement failed") }] }),
    moveUsedFiles: h.moveUsedFiles
  });
  assert.equal(result.placedCount, 1);
  assert.equal(result.unmatchedPhotos.length, 1);
  assert.deepEqual(h.calls.native, [h.sources[0]]);
  assert.deepEqual(h.calls.moved, ["F:\\Photos\\Album Used\\used.jpg"]);
  assert.deepEqual([...h.remaining], ["F:\\Photos\\failed.jpg", "F:\\Photos\\extra.jpg"]);
});

test("invalid native paths never reach resolver, with no picker URL fallback", async () => {
  for (const value of ["blob:/image", "file:/F:/Photos/image.jpg", "relative/image.jpg", "F:image.jpg", "", "F:\\Photos\\..\\image.jpg"]) {
    const h = diskHarness(["F:\\Photos\\image.jpg"]);
    h.fs.getNativePath = () => value;
    const result = await h.moveUsedFiles(h.sources);
    assert.equal(result.failed.length, 1, value);
    assert.deepEqual(h.calls.urls, [], value);
  }
});

test("EntryNotFound code permits creating the missing Album Used folder", async () => {
  const h = diskHarness(["F:\\A\\1.jpg"]);
  h.folders.get("F:\\A").lookupError = Object.assign(new Error("missing"), { code: "EntryNotFound" });
  assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 0);
  assert.deepEqual(h.calls.created, ["F:\\A\\Album Used"]);
});

test("an unrecognized lookup error is preserved without attempting folder creation", async () => {
  const h = diskHarness(["F:\\A\\1.jpg"]);
  const error = new Error("provider unavailable");
  h.folders.get("F:\\A").lookupError = error;
  const result = await h.moveUsedFiles(h.sources);
  assert.equal(result.failed[0].error, error);
  assert.deepEqual(h.calls.created, []);
});

test("parent resolution failure reports native paths and the exact failing operation", async () => {
  const h = diskHarness(["G:\\WORKING ALBUM\\SAVE EDITED PHOTOS\\ANAMIKA\\Memory Maker 1 DT.jpg"]);
  h.fs.getEntryWithUrl = async () => { throw missing(); };
  const result = await h.moveUsedFiles(h.sources);
  const diagnostic = result.failed[0].diagnostic;
  assert.equal(diagnostic.operation, "resolve parent");
  assert.equal(diagnostic.category, "PATH / NOT FOUND");
  assert.equal(diagnostic.parentNativePath, "G:\\WORKING ALBUM\\SAVE EDITED PHOTOS\\ANAMIKA");
  assert.equal(diagnostic.albumUsedNativePath, "G:\\WORKING ALBUM\\SAVE EDITED PHOTOS\\ANAMIKA\\Album Used");
  assert.equal(diagnostic.parentFileUrl, "file:///G:/WORKING%20ALBUM/SAVE%20EDITED%20PHOTOS/ANAMIKA");
  assert.equal(h.remaining.size, 1);
});

test("provider path overrides misleading entry path properties", async () => {
  const h = diskHarness(["G:\\Real Folder\\image.jpg"]);
  h.sources[0].nativePath = "F:\\Wrong\\image.jpg";
  assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 0);
  assert.deepEqual(h.calls.moved, ["G:\\Real Folder\\Album Used\\image.jpg"]);
});

test("non-folder parent and missing reacquired source cannot create or move anything", async () => {
  for (const parent of [{ isFile: true }, { isFolder: true, getEntry: async () => { throw missing(); } }]) {
    const h = diskHarness(["F:\\A\\1.jpg"]);
    h.fs.getEntryWithUrl = async () => parent;
    assert.equal((await h.moveUsedFiles(h.sources)).failed.length, 1);
    assert.deepEqual(h.calls.created, []);
    assert.deepEqual(h.calls.moved, []);
  }
});
