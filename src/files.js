const { storage } = require("uxp");
const fs = storage.localFileSystem;
const SUPPORTED_IMAGE_TYPES = Object.freeze(["jpg", "jpeg", "png"]);

async function selectImageFiles() {
  const result = await fs.getFileForOpening({
    allowMultiple: true,
    types: Array.from(SUPPORTED_IMAGE_TYPES)
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

function splitName(name) {
  const pos = name.lastIndexOf(".");
  if (pos <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, pos), ext: name.slice(pos) };
}

function normalizedNativePath(nativePath) {
  if (typeof nativePath !== "string" || !nativePath || nativePath.includes("\0")) {
    throw new Error("Source has no valid native filesystem path.");
  }
  const path = nativePath.replace(/\\/g, "/");
  // Accept absolute disk paths only. Never reinterpret resource URLs as paths.
  const windows = /^[A-Za-z]:\//.test(path);
  const posix = path.startsWith("/") && !path.startsWith("//");
  if (!windows && !posix) {
    throw new Error("Source must have an absolute local disk path (for example F:\\Photos\\image.jpg).");
  }
  const segments = (windows ? path.slice(3) : path.slice(1)).split("/");
  if (segments.some(segment => segment === "." || segment === "..")) {
    throw new Error("Source path contains an unresolved relative segment.");
  }
  return path;
}

// Canonical URL for diagnostics only. UXP's file:/ resolver accepts raw path
// text and encodes it internally; feeding this encoded URL back double-encodes %.
function nativePathToFileUrl(nativePath) {
  const path = normalizedNativePath(nativePath);
  const windows = /^[A-Za-z]:\//.test(path);
  const segments = (windows ? path.slice(3) : path.slice(1)).split("/");
  const prefix = windows ? "file:///" + path.slice(0, 3) : "file:///";
  return prefix + segments.map(segment => encodeURIComponent(segment)).join("/");
}

function filesystemErrorCategory(error) {
  const identifiers = [error && error.code, error && error.name].join(" ");
  if (/\b(EBUSY|ETXTBSY|ERROR_SHARING_VIOLATION)\b/i.test(identifiers)) return "LOCK / IN USE";
  if (/\b(EACCES|EPERM|EROFS|PermissionDenied|FileIsReadOnly)\b/i.test(identifiers)) return "PERMISSION";
  if (/\b(ENOENT|ENOTDIR|EntryNotFound)\b/i.test(identifiers)) return "PATH / NOT FOUND";
  const details = [error && error.code, error && error.name, error && error.message, String(error || "")].join(" ");
  if (/sharing.?violation|\blocked\b|in use|used by another process|resource busy/i.test(details)) return "LOCK / IN USE";
  if (/EACCES|EPERM|EROFS|PermissionDenied|FileIsReadOnly|access denied|permission|read.only/i.test(details)) return "PERMISSION";
  if (/ENOENT|ENOTDIR|EntryNotFound|not found|could not find (an )?entry|no such file/i.test(details)) return "PATH / NOT FOUND";
  return "FILESYSTEM";
}

function isMissingEntry(error) {
  // ENOTDIR is a path failure, but does not mean an entry is safe to create.
  if (filesystemErrorCategory(error) !== "PATH / NOT FOUND") return false;
  const code = error && error.code;
  if (code) return code === "ENOENT" || code === "EntryNotFound";
  return !/ENOTDIR/i.test(String(error));
}

function joinNativePath(parent, name) {
  const separator = parent.includes("\\") ? "\\" : "/";
  return parent + (/[\\/]$/.test(parent) ? "" : separator) + name;
}

async function getOriginalSource(fileEntry, diagnostic) {
  // Picker Entry.url can be blob:/ and is deliberately never read here.
  diagnostic.operation = "get native source path";
  const nativePath = await fs.getNativePath(fileEntry);
  diagnostic.sourceNativePath = nativePath;
  diagnostic.operation = "derive native parent";
  const path = normalizedNativePath(nativePath);
  const slash = path.lastIndexOf("/");
  const fileName = path.slice(slash + 1);
  if (!fileName) throw new Error("Source path does not name a file.");
  const parentPath = slash === 2 && /^[A-Za-z]:/.test(path)
    ? nativePath.slice(0, 3)
    : nativePath.slice(0, slash) || "/";
  diagnostic.parentNativePath = parentPath;
  diagnostic.albumUsedNativePath = joinNativePath(parentPath, "Album Used");
  diagnostic.parentFileUrl = nativePathToFileUrl(parentPath);
  const rawParent = normalizedNativePath(parentPath);
  diagnostic.resolverInput = "file:" + (rawParent.startsWith("/") ? "" : "/") + rawParent;
  diagnostic.operation = "resolve parent";
  // This is a UXP path-scheme string, not an encoded browser URL. Do not
  // encode or decode it: literal %20 folder names must remain literal too.
  const parentEntry = await fs.getEntryWithUrl(diagnostic.resolverInput);
  if (!parentEntry || !parentEntry.isFolder) {
    throw new Error("Could not access the source folder for " + fileEntry.name + ".");
  }
  diagnostic.operation = "reacquire source";
  const source = await parentEntry.getEntry(fileName);
  if (!source || !source.isFile) throw new Error("Could not reacquire source file " + fileName + ".");
  return { parentEntry, source };
}

async function ensureAlbumUsedFolder(parentEntry, diagnostic) {
  let existing = null;
  diagnostic.operation = "find Album Used";
  try {
    existing = await parentEntry.getEntry("Album Used");
  } catch (error) {
    if (!isMissingEntry(error)) throw error;
    diagnostic.operation = "create Album Used";
    return parentEntry.createFolder("Album Used");
  }

  if (!existing || !existing.isFolder) {
    throw new Error("An item named Album Used already exists and is not a folder.");
  }

  return existing;
}

async function uniqueMovedName(fileEntry, destinationFolder) {
  const { base, ext } = splitName(fileEntry.name);
  let candidate = fileEntry.name;
  let counter = 2;
  while (counter < 100000) {
    try {
      await destinationFolder.getEntry(candidate);
    } catch (e) {
      if (!isMissingEntry(e)) throw e;
      return candidate;
    }
    candidate = `${base}_${counter}${ext}`;
    counter++;
  }
  throw new Error(`Could not create a unique name for ${fileEntry.name}`);
}

async function moveUsedFiles(fileEntries, onProgress) {
  const moved = [];
  const failed = [];
  const destinations = new Map();
  for (let i = 0; i < fileEntries.length; i++) {
    const selectedEntry = fileEntries[i];
    const diagnostic = {};
    try {
      const { parentEntry, source: freshEntry } = await getOriginalSource(selectedEntry, diagnostic);
      const key = diagnostic.parentNativePath;
      let destinationFolder = destinations.get(key);
      if (!destinationFolder) {
        destinationFolder = await ensureAlbumUsedFolder(parentEntry, diagnostic);
        destinations.set(key, destinationFolder);
      }
      diagnostic.operation = "choose destination name";
      const newName = await uniqueMovedName(freshEntry, destinationFolder);
      diagnostic.destinationNativePath = joinNativePath(diagnostic.albumUsedNativePath, newName);
      diagnostic.operation = "move source";
      await freshEntry.moveTo(destinationFolder, { newName, overwrite: false });
      moved.push(selectedEntry);
    } catch (error) {
      Object.assign(diagnostic, {
        category: filesystemErrorCategory(error),
        errorName: error && error.name,
        errorCode: error && error.code,
        errorMessage: error && error.message ? error.message : String(error)
      });
      failed.push({ file: selectedEntry, error, diagnostic });
      console.warn("Album Used movement failed", diagnostic);
    }
    if (onProgress) onProgress(i + 1, fileEntries.length);
  }
  return { moved, failed };
}

module.exports = {
  SUPPORTED_IMAGE_TYPES,
  selectImageFiles,
  moveUsedFiles,
  nativePathToFileUrl
};
