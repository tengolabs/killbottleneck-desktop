// Aktualizace aplikace z GitHub Releases (tengolabs/killbottleneck-desktop, viz „publish“
// v package.json — napevno, jinak by se do stavby propsalo repo z gitu, odkud se staví).
// Stáhne se na pozadí. Aplikace ve skutečnosti skoro nikdy „nekončí“ (běží vedle hodin),
// takže čekat na ukončení nestačí: když je okno skryté a počítač chvíli bez práce, nová verze
// se nainstaluje tiše a aplikace se znovu spustí skrytá; jinak nabídne menu „Restartovat
// a aktualizovat“. Ve vývojové stavbě se nespouští.
import updater from 'electron-updater';

const { autoUpdater } = updater;

const KONTROLA_MS = 6 * 3600_000;
const PRVNI_KONTROLA_MS = 30_000;
const ZKUSIT_NAINSTALOVAT_MS = 10 * 60_000;

export function spustAktualizace({ log, jeSkryteANecinne, pripravRestart, pripraveno }) {
  autoUpdater.logger = {
    info: (m) => log('aktualizace:', m),
    warn: (m) => log('aktualizace:', m),
    error: (m) => log('aktualizace chyba:', m),
    debug: () => {},
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  let stazena = null;
  let instaluje = false;
  const nainstaluj = async () => {
    if (!stazena || instaluje) return;
    instaluje = true;
    await pripravRestart();
    autoUpdater.quitAndInstall(true, true);
  };

  autoUpdater.on('update-downloaded', (info) => {
    stazena = info && info.version;
    pripraveno(stazena);
    if (jeSkryteANecinne()) nainstaluj();
  });
  autoUpdater.on('error', (e) => log('aktualizace chyba', e && e.message));

  const zkontroluj = () => autoUpdater.checkForUpdates().catch((e) => log('aktualizace: kontrola selhala', e && e.message));
  setTimeout(zkontroluj, PRVNI_KONTROLA_MS);
  setInterval(zkontroluj, KONTROLA_MS);
  setInterval(() => { if (stazena && jeSkryteANecinne()) nainstaluj(); }, ZKUSIT_NAINSTALOVAT_MS);

  return { nainstaluj };
}
