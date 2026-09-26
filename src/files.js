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

function nativePathToFileUrl(nativePath) {
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
  const prefix = windows ? "file:/" + path.slice(0, 3) : "file:/";
  return prefix + segments.map(segment => encodeURIComponent(segment)).join("/");
}

async function getOriginalSource(fileEntry) {
  // Picker Entry.url can be blob:/ and is deliberately never read here.
  const nativePath = await fs.getNativePath(fileEntry);
  nativePathToFileUrl(nativePath); // Validate before any filesystem lookup.
  const path = nativePath.replace(/\\/g, "/");
  const slash = path.lastIndexOf("/");
  const fileName = path.slice(slash + 1);
  if (!fileName) throw new Error("Source path does not name a file.");
  const parentPath = slash === 2 && /^[A-Za-z]:/.test(path)
    ? path.slice(0, 3)
    : path.slice(0, slash) || "/";
  const parentEntry = await fs.getEntryWithUrl(nativePathToFileUrl(parentPath));
  if (!parentEntry || !parentEntry.isFolder) {
    throw new Error("Could not access the source folder for " + fileEntry.name + ".");
  }
  const source = await parentEntry.getEntry(fileName);
  if (!source || !source.isFile) throw new Error("Could not reacquire source file " + fileName + ".");
  return { parentEntry, source };
}

async function ensureAlbumUsedFolder(parentEntry) {
  let existing = null;
  try {
    existing = await parentEntry.getEntry("Album Used");
  } catch (error) {
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
  for (let i = 0; i < fileEntries.length; i++) {
    const selectedEntry = fileEntries[i];
    try {
      const { parentEntry, source: freshEntry } = await getOriginalSource(selectedEntry);
      const destinationFolder = await ensureAlbumUsedFolder(parentEntry);
      const newName = await uniqueMovedName(freshEntry, destinationFolder);
      await freshEntry.moveTo(destinationFolder, { newName, overwrite: false });
      moved.push(selectedEntry);
    } catch (error) {
      failed.push({ file: selectedEntry, error });
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
