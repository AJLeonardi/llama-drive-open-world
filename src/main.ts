import { Game } from './game/Game';

// Block Safari gestures that get in the way of play (pinch-zoom, double-tap zoom, long-press menus).
for (const type of ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu'])
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });

const game = new Game(document.getElementById('game') as HTMLCanvasElement);
game.init().catch((err) => {
  console.error(err);
  document.getElementById('ui')!.innerHTML = `<div class="screen on dim"><h2>Oops, the game could not start.</h2><div>${String(err)}</div></div>`;
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {}),
  );
}

/**
 * Home-screen apps on iOS are usually paused rather than closed, so check for a newer
 * build at launch and every time the app comes back to the front.
 */
async function newerBuildAvailable() {
  if (!import.meta.env.PROD) return false;
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    const { build } = (await res.json()) as { build: string };
    return Number(build) > Number(__BUILD_NUMBER__);
  } catch {
    return false; // offline: keep playing what we have
  }
}

async function checkForUpdate() {
  if (await newerBuildAvailable()) game.offerUpdate();
}
checkForUpdate();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkForUpdate();
});
