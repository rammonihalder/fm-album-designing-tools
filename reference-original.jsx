#target photoshop
app.bringToFront();
app.preferences.rulerUnits = Units.PIXELS;

function main() {
    if (!app.documents.length) {
        alert("Open a PSD document first.");
        return;
    }
    var doc = app.activeDocument;

    // --- Selected Layers নেবো ---
    var selectedLayers = getSelectedLayers(doc);
    if (!selectedLayers.length) {
        alert("Please select one or more placeholder layers.");
        return;
    }

    // --- Multiple Images Select ---
    var filesToPlace = File.openDialog("Select image files to place", undefined, true);
    if (!filesToPlace || !filesToPlace.length) {
        alert("No files selected. Script cancelled.");
        return;
    }

    // --- Album Used Folder ---
    var srcFolder = filesToPlace[0].parent;
    var albumUsedFolder = new Folder(srcFolder + "/Album Used");
    if (!albumUsedFolder.exists) albumUsedFolder.create();

    // --- Loop Layer & Image ---
    var count = Math.min(selectedLayers.length, filesToPlace.length);
    for (var i = 0; i < count; i++) {
        var placeholder = selectedLayers[i];
        var fileToPlace = filesToPlace[i];

        var placedLayer = placeFileAsSmartObject(fileToPlace);
        placedLayer.move(placeholder, ElementPlacement.PLACEBEFORE);

        fitPlacedLayerToBounds(placedLayer, placeholder.bounds);

        try { placedLayer.grouped = true; } catch (e) {}
        try { placedLayer.name = "Memory Maker " + fileToPlace.name; } catch (e) {}

        moveUsedFile(fileToPlace, albumUsedFolder);
    }

    alert("✅ Done.\n" + count + " image(s) placed on selected layers.\nExtra layers/images skipped.");
}

// -------------------- helpers --------------------

// Multiple layer selection
function getSelectedLayers(doc) {
    var selLayers = [];
    var idGrp = stringIDToTypeID("groupLayersEvent");
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    desc.putReference(charIDToTypeID("null"), ref);

    try {
        executeAction(idGrp, desc, DialogModes.NO);
    } catch (e) {}

    // selection টাকে group বানিয়ে নিলাম
    var group = doc.activeLayer;
    if (group.typename == "LayerSet") {
        for (var i = 0; i < group.layers.length; i++) {
            selLayers.push(group.layers[i]);
        }
        // group undo করা
        doc.activeLayer = group;
        executeAction(app.charIDToTypeID('undo'), undefined, DialogModes.NO);
    }

    return selLayers.reverse(); // যাতে উপরের layer আগে আসে
}

// -------------------- File move with rename --------------------
function moveUsedFile(srcFile, albumUsedFolder) {
    var ext = srcFile.name.substring(srcFile.name.lastIndexOf("."));  
    var base = srcFile.name.substring(0, srcFile.name.lastIndexOf(".")); 

    var counter = 1;
    var destFile;

    // Duplicate হলে শুধু number change হবে
    do {
        var newName = "Memory Maker_" + base + "_" + counter + ext;
        destFile = new File(albumUsedFolder + "/" + newName);
        counter++;
    } while (destFile.exists);

    try {
        srcFile.copy(destFile);   // Quality safe থাকবে
        srcFile.remove();         // আসল ফোল্ডার থেকে সরানো হবে
    } catch (e) {
        alert("⚠️ File move করতে সমস্যা হলো: " + e);
    }
}

// -------------------- Place file as Smart Object --------------------
function placeFileAsSmartObject(file) {
    var tempDoc = app.open(file);
    tempDoc.selection.selectAll();
    tempDoc.selection.copy();
    tempDoc.close(SaveOptions.DONOTSAVECHANGES);

    app.activeDocument.paste();
    convertToSmartObject();
    return app.activeDocument.activeLayer;
}

function convertToSmartObject() {
    var idnewPlacedLayer = stringIDToTypeID("newPlacedLayer");
    executeAction(idnewPlacedLayer, undefined, DialogModes.NO);
}

// -------------------- Fit image to placeholder --------------------
function fitPlacedLayerToBounds(placedLayer, tBounds) {
    var pBounds = toBounds(placedLayer.bounds);

    var pW = pBounds.right - pBounds.left;
    var pH = pBounds.bottom - pBounds.top;
    var tW = tBounds[2].as("px") - tBounds[0].as("px");
    var tH = tBounds[3].as("px") - tBounds[1].as("px");

    if (pW <= 0 || pH <= 0) return;

    var scale = Math.max(tW / pW, tH / pH);
    var scalePercent = scale * 100;

    placedLayer.resize(scalePercent, scalePercent, AnchorPosition.MIDDLECENTER);

    var newPB = toBounds(placedLayer.bounds);
    var targetCenterX = (tBounds[0].as("px") + tBounds[2].as("px")) / 2;
    var targetCenterY = (tBounds[1].as("px") + tBounds[3].as("px")) / 2;
    var placedCenterX = (newPB.left + newPB.right) / 2;
    var placedCenterY = (newPB.top + newPB.bottom) / 2;

    placedLayer.translate(targetCenterX - placedCenterX, targetCenterY - placedCenterY);
}

function toBounds(bounds) {
    return {
        left: bounds[0].as("px"),
        top: bounds[1].as("px"),
        right: bounds[2].as("px"),
        bottom: bounds[3].as("px")
    };
}

main();
