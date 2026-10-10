"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const main = require("../main");

function element(value = "") {
  const listeners = new Map();
  return {
    value, textContent: "", disabled: false,
    setAttribute() {}, getAttribute() { return null; },
    addEventListener(name, callback) { const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list); },
    removeEventListener(name, callback) { listeners.set(name, (listeners.get(name) || []).filter(f => f !== callback)); },
    dispatch(name, e = {}) { for (const f of listeners.get(name) || []) f(e); },
    countListeners() { return Array.from(listeners.values()).reduce((sum, l) => sum + l.length, 0); }
  };
}

function withDialog(action) {
  const ids = ["adjustLightDialog", "adjustLightSlider", "adjustLightValue", "adjustLightResetBtn", "adjustLightApplyBtn", "adjustLightCancelBtn"];
  const previous = Object.fromEntries(ids.map(id => [id, main.ui[id]]));
  for (const id of ids) main.ui[id] = element();
  main.ui.adjustLightDialog.close = function (reason) { this.returnValue = reason; };
  main.ui.adjustLightDialog.uxpShowModal = async () => {
    action(main.ui);
    return main.ui.adjustLightDialog.returnValue || "reasonCanceled";
  };
  return () => { for (const id of ids) main.ui[id] = previous[id]; };
}

test('Adjust Light UI is a separate dialog, replacing the inactive White Balance tile', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const inside = html.match(/<main[^>]*class="panel"[^>]*>([\s\S]*?)<\/main>/)?.[1] || '';
  assert.ok(inside.includes('id="adjustLightBtn"'));
  assert.ok(!inside.includes('id="quickWhiteBalanceBtn"'));
  assert.equal(/<input/i.test(inside), false);
  const dialog = html.match(/<dialog id="adjustLightDialog"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(dialog);
  assert.match(dialog, /type="range" min="-100" max="100" step="1" value="0"/);
  for (const id of ['adjustLightApplyBtn', 'adjustLightResetBtn', 'adjustLightCancelBtn']) {
    assert.ok(dialog.includes(`id="${id}"`));
  }
});

test('Apply returns the user-selected brightness and cleans up event listeners', async () => {
  const restore = withDialog(ui => {
    ui.adjustLightSlider.value = '-47';
    ui.adjustLightSlider.dispatch('input');
    assert.equal(ui.adjustLightValue.textContent, '-47');
    ui.adjustLightApplyBtn.dispatch('click');
  });
  try {
    const result = await main.promptForLightAdjustment();
    assert.deepEqual(result, { cancelled: false, brightness: -47 });
    assert.equal(main.ui.adjustLightSlider.countListeners(), 0);
    assert.equal(main.ui.adjustLightApplyBtn.countListeners(), 0);
  } finally { restore(); }
});

test('Reset restores zero but Cancel does not apply anything', async () => {
  const restore = withDialog(ui => {
    ui.adjustLightSlider.value = '67';
    ui.adjustLightSlider.dispatch('input');
    assert.equal(ui.adjustLightValue.textContent, '+67');
    ui.adjustLightResetBtn.dispatch('click');
    assert.equal(ui.adjustLightSlider.value, '0');
    assert.equal(ui.adjustLightValue.textContent, '0');
    ui.adjustLightCancelBtn.dispatch('click');
  });
  try {
    const result = await main.promptForLightAdjustment();
    assert.deepEqual(result, { cancelled: true });
    assert.equal(main.ui.adjustLightCancelBtn.countListeners(), 0);
  } finally { restore(); }
});

test('closing the dialog without pressing Apply cancels', async () => {
  const restore = withDialog(() => {});
  try {
    assert.deepEqual(await main.promptForLightAdjustment(), { cancelled: true });
  } finally { restore(); }
});
