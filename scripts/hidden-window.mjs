import assert from "node:assert/strict";

// Windows/Linux render hidden tests off-screen; isVisible alone does not mean the user can see them.
export async function assertHidden(app) {
  const visible = await app.evaluate(({ BrowserWindow, app, screen }) => {
    const displays = screen.getAllDisplays().map(display => display.bounds);
    const onDisplay = bounds => displays.some(display => bounds.x < display.x + display.width
      && bounds.x + bounds.width > display.x && bounds.y < display.y + display.height && bounds.y + bounds.height > display.y);
    return { onScreen: BrowserWindow.getAllWindows().filter(window => window.isVisible() && onDisplay(window.getBounds())).length,
      dock: process.platform === "darwin" ? app.dock.isVisible() : false };
  });
  assert.deepEqual(visible, { onScreen: 0, dock: false }, "the test app appeared on the user's screen");
}

// Discard only isolated test windows; normal quit can wait on an invisible unsaved-work dialog.
export async function closeHidden(app) {
  await app.evaluate(({ BrowserWindow }) => {
    if (!process.env.FOLIO_TEST_USER_DATA) throw new Error("Refusing to discard a non-test profile");
    BrowserWindow.getAllWindows().forEach(window => window.destroy());
  });
  app.process().kill("SIGKILL");
  await app.close();
}
