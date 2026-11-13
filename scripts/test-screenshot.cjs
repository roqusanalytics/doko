const assert = require('node:assert/strict');
const { test } = require('node:test');
const { captureScreens, desktopBounds } = require('../electron/screenshot.cjs');
const displays = [
  { id: 1, bounds: { x: -400, y: -100, width: 400, height: 600 }, size: { width: 400, height: 600 }, scaleFactor: 1 },
  { id: 2, bounds: { x: 0, y: 0, width: 800, height: 600 }, size: { width: 800, height: 600 }, scaleFactor: 2 },
];
const thumbnail = { getSize: () => ({ width: 1234, height: 987 }), isEmpty: () => false, toDataURL: () => 'data:image/png;base64,fixture' };
function dependencies(sources) {
  return { platform: 'linux', screen: { getAllDisplays: () => displays, getPrimaryDisplay: () => displays[1] }, desktopCapturer: { getSources: async options => {
    assert.deepEqual(options, { types: ['screen'], thumbnailSize: { width: 1600, height: 1200 } }); return sources;
  } } };
}
test('negative desktop coordinates and mixed display scales stay in DIP coordinates', async () => {
  const result = await captureScreens(dependencies(displays.map(d => ({ display_id: String(d.id), thumbnail }))));
  assert.deepEqual(result.bounds, { x: -400, y: -100, width: 1200, height: 700 });
  assert.deepEqual(result.screens.map(s => s.bounds), displays.map(d => d.bounds));
  assert.deepEqual(result.screens.map(s => s.scaleFactor), [1, 2]);
  assert.equal(result.singleScreen, false);
  assert.deepEqual(desktopBounds([{ bounds: displays[1].bounds }]), displays[1].bounds);
});
test('PipeWire anonymous source fits a real DIP viewport without cropping its image', async () => {
  const result = await captureScreens(dependencies([{ display_id: '', thumbnail }]));
  assert.equal(result.singleScreen, true);
  assert.ok(result.bounds.width <= 800 && result.bounds.height <= 600);
  assert.ok(result.bounds.x >= 0 && result.bounds.y >= 0);
  assert.ok(Math.abs(result.bounds.width / result.bounds.height - 1234 / 987) < 0.003);
  assert.equal(result.screens[0].url, 'data:image/png;base64,fixture');
});
test('permission denial never starts desktop capture', async () => {
  let calls = 0;
  await assert.rejects(captureScreens({ platform: 'darwin', systemPreferences: { getMediaAccessStatus: type => { assert.equal(type, 'screen'); return 'denied'; } }, desktopCapturer: { getSources: () => { calls++; } } }), /System Settings/);
  assert.equal(calls, 0);
});
test('cancelled, empty, ambiguous, and timed-out captures fail clearly', async () => {
  await assert.rejects(captureScreens(dependencies([])), /cancelled or unavailable/);
  await assert.rejects(captureScreens(dependencies([{ display_id: '1', thumbnail: { ...thumbnail, isEmpty: () => true } }])), /permission/);
  await assert.rejects(captureScreens(dependencies([{ display_id: '', thumbnail }, { display_id: '', thumbnail }])), /permission/);
  const deps = dependencies([]); deps.desktopCapturer.getSources = () => new Promise(() => {});
  await assert.rejects(captureScreens(deps, 10), /timed out/);
});

test('macOS permission refused during the picker cannot return a redacted screenshot', async () => {
  let calls = 0;
  const deps = dependencies([{ display_id: '1', thumbnail }]);
  deps.platform = 'darwin';
  deps.systemPreferences = { getMediaAccessStatus: () => ++calls === 1 ? 'not-determined' : 'denied' };
  await assert.rejects(captureScreens(deps), /System Settings/);
});
