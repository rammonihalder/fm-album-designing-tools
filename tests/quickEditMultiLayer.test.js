'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runAlbumQuickEdit } = require('../src/tools/albumQuickEdit');

function createHost({ albumMode = false, failOnSet = false } = {}) {
  let next = 70;
  const makeLayer = (name, kind, visible = true) => ({
    id: next++, name, kind, visible, isClippingMask: false, isBackgroundLayer: false, layers: []
  });
  const photo = makeLayer('Original photo', 'normal');
  const retouch = makeLayer('Retouched pixels', 'normal');
  const colorGrade = makeLayer('Existing color grading', 'CURVES');
  const inner = {
    id: 123, name: 'Photo Contents.psb',
    layers: [retouch, colorGrade, photo], activeLayers: [photo],
    selection: { bounds: null }, saves: 0, closes: 0,
    async save() { this.saves++; },
    async close() {
      this.closes++;
      ps.app.documents = ps.app.documents.filter(doc => doc.id !== this.id);
      ps.app.activeDocument = album;
    }
  };
  const smart = makeLayer('Album Photo Smart Object', 'smartObject');
  const album = {
    id: 124, name: 'Album.psd', layers: [smart], activeLayers: [smart]
  };
  const calls = { descriptors: [], modal: 0, registered: [], resumed: [] };
  const controls = {
    async suspendHistory({documentID}) { return { documentID, historySuspensionID: 22 }; },
    async resumeHistory(id, commit) { calls.resumed.push(commit); },
    async registerAutoCloseDocument(id) { calls.registered.push(id); },
    async unregisterAutoCloseDocument(id) { calls.registered = calls.registered.filter(x => x !== id); }
  };
  const ps = {
    constants: { LayerKind: { NORMAL: 'normal', SMARTOBJECT: 'smartObject', BRIGHTNESSCONTRAST: 'BRIGHTNESSCONTRAST', LEVELS: 'LEVELS', CURVES: 'CURVES' },
      SaveOptions: { DONOTSAVECHANGES: 'no' } },
    app: { documents: albumMode ? [album] : [inner], activeDocument: albumMode ? album : inner },
    core: { async executeAsModal(fn) { calls.modal++; return fn({hostControl: controls,isCancelled: false}); } },
    action: { async batchPlay([cmd]) {
      calls.descriptors.push(cmd);
      const doc = ps.app.activeDocument;
      if (cmd._obj === 'get') {
        const property=cmd._target[0]._property;
        return property === 'smartObject' ? [{smartObject:{linked:false}}] : [{smartObjectMore:{ID:'unique-1'}}];
      }
      if (cmd._obj === 'select') {
        const layerId = cmd._target[0]._id;
        const layer = (doc.layers || []).find(x => x.id === layerId);
        assert.ok(layer, 'selected layer must exist');
        if (cmd.selectionModifier) doc.activeLayers = [...doc.activeLayers,layer];
        else doc.activeLayers = [layer];
      }
      if (cmd._obj === 'placedLayerEditContents') {
        ps.app.documents.push(inner);
        ps.app.activeDocument = inner;
      }
      if (cmd._obj === 'make') {
        const typ=cmd.using.type._obj;
        const kinds={brightnessEvent:'BRIGHTNESSCONTRAST',levels:'LEVELS',curves:'CURVES'};
        const layer=makeLayer('Adjustment Layer', kinds[typ]);
        inner.layers.unshift(layer);
        inner.activeLayers=[layer];
      }
      if (cmd._obj === 'set' && failOnSet) return [{_obj:'error',message:'Simulated host failure'}];
      return [{}];
    } }
  };
  return { ps, calls, album, inner, photo, smart, retouch, colorGrade };
}

test('direct multi-layer PSB adds UNCLIPPED composite correction without flattening or saving', async () => {
  const f=createHost();
  const result=await runAlbumQuickEdit('brightness',{photoshop:f.ps});
  assert.equal(result.success, true);
  assert.equal(result.successCount,1);
  assert.equal(f.inner.layers.length,4);
  assert.match(f.inner.layers[0].name,/FM Auto Brightness\/Contrast \[FMQE\]/);
  assert.equal(f.inner.layers[0].isClippingMask,false);
  assert.equal(f.photo.name,'Original photo');
  assert.equal(f.colorGrade.name,'Existing color grading');
  assert.equal(f.inner.saves,0);
  assert.equal(f.inner.closes,0);
  assert.equal(f.calls.modal,1);
  assert.equal(f.calls.resumed.at(-1),true);
});

test('repeat correction updates existing layer; another correction remains independent',async () => {
  const f=createHost();
  await runAlbumQuickEdit('brightness',{photoshop:f.ps});
  await runAlbumQuickEdit('levels',{photoshop:f.ps});
  const result=await runAlbumQuickEdit('brightness',{photoshop:f.ps});
  assert.equal(result.items[0].outcome,'updated');
  assert.equal(f.inner.layers.length,5);
  assert.equal(f.inner.layers.filter(l=>/FM Auto Brightness/.test(l.name)).length,1);
  assert.equal(f.inner.layers.filter(l=>/FM Auto Levels/.test(l.name)).length,1);
});

test('auto edit from album opens inner PSB once, uses one modal, saves and closes owned PSB only',async ()=>{
  const f=createHost({albumMode:true});
  const result=await runAlbumQuickEdit('curves',{photoshop:f.ps});
  assert.equal(result.success,true);
  assert.equal(f.inner.saves,1);
  assert.equal(f.inner.closes,1);
  assert.equal(f.ps.app.activeDocument.id,f.album.id);
  assert.deepEqual(f.album.activeLayers.map(l=>l.id),[f.smart.id]);
  assert.equal(f.calls.modal,2); // album editing and restoration, no nested correction modal
  assert.equal(f.inner.layers[0].isClippingMask,false);
});

test('failed Photoshop adjustment requests history rollback and does not save a user-opened PSB',async ()=>{
  const f=createHost({failOnSet:true});
  await assert.rejects(runAlbumQuickEdit('brightness',{photoshop:f.ps}), /Simulated host failure/);
  assert.equal(f.calls.resumed.at(-1),false);
  assert.equal(f.inner.saves,0);
  assert.equal(f.inner.closes,0);
});

test('failed album correction does not save the inner PSB and cleans up the opened document',async ()=>{
  const f=createHost({albumMode:true, failOnSet:true});
  const result=await runAlbumQuickEdit('brightness',{photoshop:f.ps});
  assert.equal(result.outcome,'failed');
  assert.equal(result.failedCount,1);
  assert.equal(f.inner.saves,0);
  assert.equal(f.inner.closes,1);
  assert.equal(f.ps.app.activeDocument.id,f.album.id);
  assert.equal(f.calls.resumed.at(-1),false);
});

test('composite correction fails before changes if pixel selection is active',async ()=>{
  const f=createHost();
  f.inner.selection.bounds={left:0,top:0,right:10,bottom:10};
  await assert.rejects(runAlbumQuickEdit('levels',{photoshop:f.ps}),/Deselect the active pixel selection/);
  assert.equal(f.calls.descriptors.length,0);
  assert.equal(f.inner.saves,0);
});
