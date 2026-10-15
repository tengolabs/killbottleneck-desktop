// Preload rámu (sandbox, contextIsolation). Dvě různé tváře podle toho, co okno ukazuje:
//  · místní stránky rámu (kb-app://) dostanou window.kbApp — výběr organizace a opakování;
//  · stránka serveru organizace dostane jen malé neškodné window.kbDesktop.
// Rozhoduje se při načtení stránky a hlavní proces navíc u KAŽDÉHO volání ověří, odkud
// přišlo (lib/politika.js: smiKanal) — server se k privilegovaným kanálům nedostane, ani
// kdyby si je zavolal sám přes ipcRenderer.
//
// API window.kbDesktop je veřejná smlouva s webem killBottlenecku (product/frontend,
// lib/desktopApp.js) — proto anglicky a s číslem verze `api`. Data stránce předává jen
// přes funkce: objekt vytvořený v izolovaném světě preloadu (CustomEvent.detail) stránka
// nevidí, proto události nesou jen jméno a obsah si stránka vyzvedne voláním.
const { contextBridge, ipcRenderer } = require('electron');

const verze = (process.argv.find((a) => a.startsWith('--kb-verze=')) || '').slice('--kb-verze='.length);

if (location.protocol === 'kb-app:') {
  contextBridge.exposeInMainWorld('kbApp', {
    info: () => ipcRenderer.invoke('kb:app:info'),
    nahled: (nazev) => ipcRenderer.invoke('kb:app:nahled', String(nazev ?? '')),
    overFirmu: (nazev) => ipcRenderer.invoke('kb:app:overFirmu', String(nazev ?? '')),
    overAdresu: (adresa) => ipcRenderer.invoke('kb:app:overAdresu', String(adresa ?? '')),
    pripoj: (origin, nazev) => ipcRenderer.invoke('kb:app:pripoj', String(origin ?? ''), String(nazev ?? '')),
    prepni: (origin) => ipcRenderer.invoke('kb:app:prepni', String(origin ?? '')),
    odeber: (origin) => ipcRenderer.invoke('kb:app:odeber', String(origin ?? '')),
    zkusZnovu: () => ipcRenderer.invoke('kb:app:zkusZnovu'),
    zmenit: () => ipcRenderer.invoke('kb:app:zmenit'),
    otevritVen: (klic) => ipcRenderer.invoke('kb:app:otevritVen', String(klic ?? '')),
  });
} else if (location.protocol === 'https:' || location.protocol === 'http:') {
  let flushId = 0;
  let pozadavek = null;

  // Rám chce uložit rozdělanou práci (ukončení, přepnutí organizace, obnovení stránky).
  ipcRenderer.on('kb:flush', (_e, id) => {
    flushId = id;
    window.dispatchEvent(new Event('kb-desktop-flush-request'));
  });
  // Klik na upozornění Windows: stránka si požadavek vyzvedne přes takeOpenRequest().
  ipcRenderer.on('kb:open', (_e, data) => {
    pozadavek = data && typeof data.id === 'string' ? { id: data.id } : null;
    if (pozadavek) window.dispatchEvent(new Event('kb-desktop-open'));
  });
  // Po probuzení počítače / návratu okna: tutéž událost už poslouchá web (Android obal).
  ipcRenderer.on('kb:resume', () => window.dispatchEvent(new Event('kb-native-resume')));
  // Přechod uvnitř webu bez znovunačtení (React Router reaguje na popstate).
  ipcRenderer.on('kb:navigate', (_e, cesta) => {
    if (typeof cesta !== 'string' || !cesta.startsWith('/') || cesta.startsWith('//')) return;
    history.pushState(null, '', cesta);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  contextBridge.exposeInMainWorld('kbDesktop', Object.freeze({
    api: 1,
    version: verze,
    changeOrganization: () => ipcRenderer.send('kb:changeOrganization'),
    supportsFlush: () => ipcRenderer.send('kb:supportsFlush'),
    flushDone: () => ipcRenderer.send('kb:flushDone', flushId),
    takeOpenRequest: () => {
      const r = pozadavek;
      pozadavek = null;
      if (r) ipcRenderer.send('kb:openTaken', r.id);
      return r;
    },
  }));
}
