// killBottleneck pro Windows — hlavní proces rámu (Electron).
//
// Okno načítá stránky PŘÍMO ze serveru organizace (cloud {firma}.killbottleneck.com nebo
// vlastní server). Rám nenosí vlastní kopii webu — novinky přijdou se serverem — a přidává
// jen to, co umí Windows: oznamovací oblast, upozornění, počet nepřečtených, autostart,
// aktualizace. Rozhodovací logika (co smí do okna, co ven, kdo smí volat rám) je v
// lib/politika.js jako čisté funkce s testy; tady se jen napojuje na události Electronu.
import {
  BrowserWindow, Menu, Notification, Tray, app, clipboard, crashReporter, dialog, ipcMain,
  nativeImage, powerMonitor, protocol, screen, session, shell,
} from 'electron';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { adresaFirmy, normalizujAdresu, vseDoPrivatniSite } from './lib/adresa.js';
import { spustAktualizace } from './lib/aktualizace.js';
import { overExistenci } from './lib/existence.js';
import { Hlidac, rozdelUpozorneni } from './lib/hlidac.js';
import { jazykZLocale, vytvorPreklad } from './lib/i18n.js';
import { vytvorLog } from './lib/log.js';
import * as nastaveni from './lib/nastaveni.js';
import { obnovRozmery, titulekOkna } from './lib/okno.js';
import {
  Brzda, MISTNI_ORIGIN, MISTNI_SCHEMA, mistniSoubor, originOf, rozhodniNavigaci,
  rozhodniOtevreni, smiKanal, smiOpravneni, smiVen,
} from './lib/politika.js';
import { jeStarsiServer, tokenZUlozeni } from './lib/server.js';

const APP_ID = 'com.killbottleneck.app';
const PARTITION = 'persist:kb';
const KOREN = import.meta.dirname;
const VERZE = app.getVersion();
const BARVA_POZADI = '#121F32';

// Režimy mimo běžný provoz. E2E jen ve vývojové stavbě (zabalená aplikace ho nezapne nikdy).
const E2E = !app.isPackaged && process.env.KB_DESKTOP_E2E === '1';
const SMOKE = process.argv.includes('--smoke-test');
const START_SKRYTE = process.argv.includes('--hidden');

// Odkazy, které smí otevřít místní stránky (jen podle klíče — stránka adresu nepředává).
const ODKAZY = {
  registrace: { cs: 'https://killbottleneck.cz/registrace', en: 'https://killbottleneck.com/registration' },
  napoveda: { cs: 'https://killbottleneck.cz/dokumentace', en: 'https://killbottleneck.com/documentation' },
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};
const CSP_MISTNI = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; "
  + "connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// Výchozí stav rámu na jednom místě.
const stav = {
  nast: nastaveni.vycisti(null),
  cestaNastaveni: '',
  log: () => {},
  t: (k) => k,
  slovnik: {},
  jazyk: 'en',
  okno: null,
  tray: null,
  ses: null,
  hlidac: null,
  updater: null,
  aktivni: null,
  mistniStav: { stranka: 'vyber' },
  overene: new Set(),
  konci: false,
  flushPodporovan: false,
  flushId: 0,
  cekajiciFlush: new Map(),
  otevreni: null,
  neprectene: 0,
  nactenoV: 0,
  skrytoOd: 0,
  offlineCasovac: null,
  aktualizace: null,
  zive: [],
  e2ePopredi: null,
};

// ---------------------------------------------------------------- před spuštěním

// Výpisy pádů jen místně (crashpad složka v profilu) — nic se nikam neodesílá.
crashReporter.start({ uploadToServer: false });

// Zabalená aplikace se nenechá ovládat zvenku přes ladicí port Chromia.
if (app.isPackaged && (app.commandLine.hasSwitch('remote-debugging-port') || app.commandLine.hasSwitch('remote-debugging-pipe'))) {
  app.exit(1);
}

if (E2E && process.env.KB_DESKTOP_USERDATA) app.setPath('userData', process.env.KB_DESKTOP_USERDATA);

protocol.registerSchemesAsPrivileged([{ scheme: MISTNI_SCHEMA, privileges: { standard: true, secure: true } }]);

function e2e(udalost, data = {}) {
  if (!E2E || !process.env.KB_DESKTOP_E2E_LOG) return;
  try {
    appendFileSync(process.env.KB_DESKTOP_E2E_LOG, `${JSON.stringify({ t: Date.now(), udalost, ...data })}\n`);
  } catch { /* testovací log nesmí shodit rám */ }
}

// ---------------------------------------------------------------- pomocné

const hostZ = (origin) => {
  try { return new URL(origin).host; } catch { return ''; }
};
const hostAktivni = () => hostZ(stav.aktivni);
const ulozNastaveni = () => {
  try { nastaveni.uloz(stav.cestaNastaveni, stav.nast); } catch (e) { stav.log('nastavení: zápis selhal', e); }
};
const oknoZije = () => !!stav.okno && !stav.okno.isDestroyed();
const oknoUkazujeServer = () => oknoZije() && !!stav.aktivni && originOf(stav.okno.webContents.getURL()) === stav.aktivni;
const oknoSkryte = () => !oknoZije() || !stav.okno.isVisible() || stav.okno.isMinimized();
const oknoVPopredi = () => {
  if (stav.e2ePopredi !== null) return stav.e2ePopredi;
  return oknoZije() && stav.okno.isVisible() && !stav.okno.isMinimized() && stav.okno.isFocused();
};

const zkrat = (text, max = 240) => {
  const s = String(text || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

// Session fetch respektuje proxy a certifikáty systému stejně jako okno. Volba `mode`
// (no-cors z webové kopie kontroly existence) nemá v hlavním procesu smysl.
const fetchRamu = (url, opts = {}) => {
  const { mode, ...zbytek } = opts;
  return stav.ses.fetch(url, zbytek);
};

function ukazOkno() {
  if (!oknoZije()) return;
  if (stav.okno.isMinimized()) stav.okno.restore();
  stav.okno.show();
  stav.okno.focus();
}

// ---------------------------------------------------------------- upozornění a odznak

const obrazek = (...cesta) => nativeImage.createFromPath(join(KOREN, 'build', ...cesta));
const ikonaTray = (sOdznakem) => obrazek('tray', sOdznakem ? 'tray-odznak.png' : 'tray.png');
const ikonaOdznaku = (n) => obrazek('odznak', n > 9 ? '9plus.png' : `${n}.png`);

function prekresliOverlay() {
  if (!oknoZije() || process.platform !== 'win32') return;
  const n = stav.neprectene;
  stav.okno.setOverlayIcon(n ? ikonaOdznaku(n) : null, n ? stav.t('odznak.popis', { n }) : '');
}

function nastavOdznak(pocet) {
  if (pocet === stav.neprectene) return;
  stav.neprectene = pocet;
  e2e('odznak', { pocet });
  if (stav.tray) {
    stav.tray.setImage(ikonaTray(pocet > 0));
    stav.tray.setToolTip(pocet ? stav.t('tray.tooltipN', { n: pocet }) : stav.t('tray.tooltip'));
  }
  prekresliOverlay();
}

// Upozornění Windows. Na objekt se musí držet odkaz i POTOM, co toast zmizí do Centra akcí:
// Windows při vypršení hlásí „close“ a kdyby se odkaz pustil, uklidí ho garbage collector
// a pozdější klik v Centru akcí už aplikaci nevzbudí (ověřeno na Windows 10 15. 10. 2026).
// Drží se proto posledních MAX_ZIVYCH, pouští se jen po kliknutí nebo chybě.
const MAX_ZIVYCH = 50;
function toast({ titulek, text, idNotifikace = null, poKliku = null }) {
  e2e('toast', { titulek, text, id: idNotifikace });
  if (E2E || !Notification.isSupported()) return;
  const n = new Notification({ title: titulek, body: text });
  stav.zive.push(n);
  if (stav.zive.length > MAX_ZIVYCH) stav.zive.shift();
  const pust = () => { stav.zive = stav.zive.filter((x) => x !== n); };
  n.on('click', () => {
    pust();
    ukazOkno();
    if (idNotifikace) otevriNotifikaci(idNotifikace);
    else if (poKliku) poKliku();
  });
  n.on('failed', (_e, chyba) => { pust(); stav.log('upozornění selhalo', chyba); });
  n.show();
}

function ukazUpozorneni(nove) {
  if (oknoVPopredi()) {
    e2e('toastPotlacen', { pocet: nove.length });
    return;
  }
  // Adresa serveru v titulku: upozornění od vlastního (cizího) serveru se tak nemůže
  // vydávat za hlášku Windows nebo jiné organizace.
  const titulek = `killBottleneck · ${hostAktivni()}`;
  const { jednotlive, dalsich } = rozdelUpozorneni(nove);
  for (const n of jednotlive) toast({ titulek, text: zkrat(n.text), idNotifikace: n.id });
  if (dalsich) toast({ titulek, text: stav.t('upozorneni.dalsi', { n: dalsich }), poKliku: () => naviguj('/notifications') });
}

// Klik na upozornění: nový web si požadavek převezme (otevře cíl a označí přečtené),
// starší web o rámu neví — tomu se po chvíli otevře seznam upozornění.
function otevriNotifikaci(id) {
  if (!oknoUkazujeServer()) return;
  if (stav.otevreni) clearTimeout(stav.otevreni.casovac);
  const casovac = setTimeout(() => {
    stav.otevreni = null;
    e2e('otevreniZaloha', { id });
    naviguj('/notifications');
  }, 1500);
  stav.otevreni = { id, casovac };
  stav.okno.webContents.send('kb:open', { id });
  e2e('otevriNotifikaci', { id });
}

function naviguj(cesta) {
  if (oknoUkazujeServer()) stav.okno.webContents.send('kb:navigate', cesta);
}

// ---------------------------------------------------------------- hlídač notifikací

let koloOvereni = 0;
async function dotazNaNotifikace() {
  if (!oknoUkazujeServer()) return { stav: 'nelze' };
  const origin = stav.aktivni;
  let ulozeni;
  try {
    // Přihlášení drží stránka v localStorage (PocketBase SDK). Čte se v ODDĚLENÉM světě
    // (1999), takže skripty stránky do čtení nezasáhnou; úložiště je sdílené.
    ulozeni = await stav.okno.webContents.executeJavaScriptInIsolatedWorld(
      1999, [{ code: 'localStorage.getItem("pocketbase_auth")' }]);
  } catch {
    return { stav: 'nelze' };
  }
  const prihlaseni = tokenZUlozeni(ulozeni);
  if (!prihlaseni) return { stav: 'neprihlasen' };
  if (prihlaseni.vyprselo) return { stav: 'odmitnuto', uzivatel: prihlaseni.uzivatel };
  const hlavicky = { Authorization: prihlaseni.token };
  const q = new URLSearchParams({ filter: 'read=false', sort: '-created', perPage: '30', fields: 'id,type,text,count,created' });
  try {
    const res = await fetchRamu(`${origin}/api/collections/notifications/records?${q}`, {
      headers: hlavicky, cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    if (origin !== stav.aktivni) return { stav: 'nelze' };
    if (res.status === 401 || res.status === 403) return { stav: 'odmitnuto', uzivatel: prihlaseni.uzivatel };
    if (!res.ok) return { stav: 'chyba' };
    const data = await res.json();
    const celkem = Number(data.totalItems) || 0;
    // PocketBase neplatný token neodmítne — jen ho bere jako nepřihlášeného a vrátí prázdný
    // seznam. Při nule proto občas ověřit, že přihlášení pořád platí (jinak by upozornění
    // potichu přestala chodit a odznak lhal).
    if (celkem === 0 && (koloOvereni++ % 5 === 0)) {
      const over = await fetchRamu(`${origin}/api/collections/users/records/${encodeURIComponent(prihlaseni.uzivatel)}?fields=id`, {
        headers: hlavicky, cache: 'no-store', signal: AbortSignal.timeout(10_000),
      });
      if (over.status === 401 || over.status === 403 || over.status === 404) return { stav: 'odmitnuto', uzivatel: prihlaseni.uzivatel };
    }
    return {
      stav: 'ok',
      uzivatel: prihlaseni.uzivatel,
      polozky: Array.isArray(data.items) ? data.items : [],
      celkem,
      serverCas: Date.parse(res.headers.get('date') || ''),
    };
  } catch {
    return { stav: 'chyba' };
  }
}

// ---------------------------------------------------------------- uložení rozdělané práce

// Před ukončením, přepnutím organizace a obnovením stránky: nový web uloží rozdělanou mapu
// (autosave má zpoždění 1,2 s). Čeká se jen na server, který to ohlásil, a nejvýš 3,5 s.
function ulozRozdelane(maxMs = 3500) {
  if (!stav.flushPodporovan || !oknoUkazujeServer()) return Promise.resolve();
  const id = ++stav.flushId;
  return new Promise((hotovo) => {
    const konec = () => { clearTimeout(casovac); stav.cekajiciFlush.delete(id); hotovo(); };
    const casovac = setTimeout(konec, maxMs);
    stav.cekajiciFlush.set(id, konec);
    stav.okno.webContents.send('kb:flush', id);
    e2e('flush', { id });
  });
}

// ---------------------------------------------------------------- server a místní stránky

// Kontrola serveru před KAŽDÝM načtením (start, obnovení, opakování): když server nejede,
// ukáže se místní stránka — nikdy chyba prohlížeče a nikdy stará stránka z mezipaměti.
async function zkontrolujServer(origin, { timeoutMs = 5000 } = {}) {
  try {
    const res = await fetchRamu(`${origin}/api/health`, {
      cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
    });
    // Cloudflare výzva (ochrana proti robotům): okno ji vyřeší samo, kontrola ne.
    if (res.headers.get('cf-mitigated') === 'challenge') return { ok: true, origin };
    const konecny = originOf(res.url) || origin;
    // Přesměrování na jiný stroj = přihlašovací stránka hotelové Wi-Fi apod., ne náš server.
    if (hostZ(konecny).replace(/:\d+$/, '') !== hostZ(origin).replace(/:\d+$/, '')) return { ok: false, duvod: 'sit' };
    if (res.status >= 500) return { ok: false, duvod: 'server' };
    if (!res.ok) return { ok: false, duvod: 'neniKb' };
    const telo = await res.json().catch(() => null);
    if (!telo || typeof telo !== 'object' || !('code' in telo || 'message' in telo)) return { ok: false, duvod: 'neniKb' };
    return { ok: true, origin: konecny };
  } catch {
    return { ok: false, duvod: 'sit' };
  }
}

async function verzeServeru(origin) {
  try {
    const res = await fetchRamu(`${origin}/api/kb/config`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { kb: false };
    const data = await res.json();
    return data && typeof data === 'object' && 'version' in data ? { kb: true, verze: String(data.version || '') } : { kb: false };
  } catch {
    return { kb: false };
  }
}

function ukazMistni(stranka, data = {}) {
  stav.mistniStav = { stranka, ...data };
  if (!oknoZije()) return Promise.resolve();
  e2e('mistni', { stranka, duvod: data.duvod || null });
  const soubor = stranka === 'vyber' ? 'vyber.html' : 'offline.html';
  return stav.okno.loadURL(`${MISTNI_ORIGIN}/${soubor}`).catch(() => {});
}

function ukazOffline(duvod) {
  clearTimeout(stav.offlineCasovac);
  ukazMistni('offline', { host: hostAktivni(), duvod });
  stav.offlineCasovac = setTimeout(() => nactiServer({ duvod: 'opakovani' }), 30_000);
}

// Uložená adresa se po čase začne přesměrovávat na https (správce zapnul certifikát) —
// takovou změnu přijmout a zapamatovat. Jiný cíl ne: to už není tentýž server.
function prijmiPresun(z, na) {
  const a = new URL(z);
  const b = new URL(na);
  if (a.hostname !== b.hostname || b.protocol !== 'https:') return false;
  const puvodni = stav.nast.organizace.find((o) => o.origin === z);
  stav.nast = nastaveni.pridejOrganizaci(nastaveni.odeberOrganizaci(stav.nast, z), { origin: na, nazev: puvodni && puvodni.nazev });
  stav.aktivni = stav.nast.aktivni;
  ulozNastaveni();
  prestavMenu();
  stav.log('organizace přešla na https', hostZ(na));
  return true;
}

async function nactiServer({ duvod = 'start' } = {}) {
  clearTimeout(stav.offlineCasovac);
  const origin = stav.aktivni;
  if (!origin) return ukazMistni('vyber');
  if (!oknoUkazujeServer()) ukazMistni('offline', { host: hostZ(origin), pripojuji: true });
  const k = await zkontrolujServer(origin);
  if (origin !== stav.aktivni) return undefined; // mezitím přepnuto jinam
  if (!k.ok) return ukazOffline(k.duvod);
  if (k.origin !== origin && !prijmiPresun(origin, k.origin)) return ukazOffline('neniKb');
  stav.flushPodporovan = false;
  stav.nactenoV = Date.now();
  e2e('nacitam', { origin: stav.aktivni, duvod });
  if (oknoUkazujeServer()) {
    stav.okno.webContents.reload();
    return undefined;
  }
  return stav.okno.loadURL(`${stav.aktivni}/`).catch(() => { /* chybu ukáže did-fail-load */ });
}

// Ctrl+R / F5: nejdřív uložit rozdělané, pak ověřit server a teprve potom obnovit.
async function obnovit() {
  await ulozRozdelane();
  return nactiServer({ duvod: 'obnovit' });
}

// Skryté okno se po nasazení nové verze serveru (a jednou denně) tiše obnoví: po nasazení
// chybí staré soubory stránky, a obnovení zároveň prodlouží přihlášení.
async function obnovSkryte(duvod) {
  if (!oknoSkryte() || !oknoUkazujeServer()) return;
  await ulozRozdelane();
  const k = await zkontrolujServer(stav.aktivni);
  if (!k.ok || !oknoSkryte()) return;
  e2e('obnoveniSkryte', { duvod });
  stav.nactenoV = Date.now();
  stav.okno.webContents.reload();
}

async function prepniOrganizaci(origin) {
  if (!stav.nast.organizace.some((o) => o.origin === origin)) return;
  ukazOkno();
  if (origin === stav.aktivni && oknoUkazujeServer()) return;
  await ulozRozdelane();
  stav.nast = nastaveni.pridejOrganizaci(stav.nast, { origin });
  stav.aktivni = stav.nast.aktivni;
  ulozNastaveni();
  stav.hlidac.reset();
  prestavMenu();
  await nactiServer({ duvod: 'prepnuti' });
}

async function zmenitOrganizaci() {
  await ulozRozdelane();
  ukazOkno();
  return ukazMistni('vyber');
}

// ---------------------------------------------------------------- výběr organizace (místní)

const chyba = (kod, host = '') => ({ ok: false, chyba: kod, host });

// Společný konec obou cest: server běží, je to killBottleneck → smí se připojit.
async function overServer(origin) {
  const host = hostZ(origin);
  const k = await zkontrolujServer(origin);
  if (!k.ok) return chyba(k.duvod === 'neniKb' ? 'neniKb' : 'nedostupne', host);
  const v = await verzeServeru(k.origin);
  if (!v.kb) return chyba('neniKb', host);
  stav.overene.add(k.origin);
  return { ok: true, origin: k.origin, host: hostZ(k.origin), starsi: jeStarsiServer(v.verze) };
}

async function overFirmu(nazev) {
  const adresa = adresaFirmy(nazev);
  if (!adresa) return chyba('kratke');
  const host = hostZ(adresa);
  const existuje = await overExistenci(host, fetchRamu);
  if (existuje === false) return chyba('nenalezeno', host);
  return overServer(adresa);
}

async function overAdresu(vstup) {
  const n = normalizujAdresu(vstup);
  if (!n.ok) return chyba(n.chyba);
  if (n.overitPrivatni) {
    const host = new URL(n.url).hostname;
    let adresy = [];
    try { adresy = await lookup(host, { all: true }); } catch { return chyba('nedostupne', hostZ(n.url)); }
    if (!vseDoPrivatniSite(adresy)) return chyba('httpMimoSit', hostZ(n.url));
  }
  return overServer(n.url);
}

function pripojOrganizaci(origin, nazev) {
  if (!stav.overene.has(origin)) return { ok: false };
  stav.nast = nastaveni.pridejOrganizaci(stav.nast, { origin, nazev: zkrat(nazev, 120) });
  stav.aktivni = stav.nast.aktivni;
  ulozNastaveni();
  stav.hlidac.reset();
  prestavMenu();
  nactiServer({ duvod: 'pripojeni' });
  return { ok: true };
}

function infoProMistni() {
  return {
    verze: VERZE,
    jazyk: stav.jazyk,
    texty: stav.slovnik.stranky || {},
    organizace: stav.nast.organizace.map((o) => ({ origin: o.origin, nazev: o.nazev, host: hostZ(o.origin) })),
    aktivni: stav.aktivni,
    mistni: stav.mistniStav,
  };
}

// ---------------------------------------------------------------- IPC

const ramec = (e) => ({ frameUrl: e.senderFrame ? e.senderFrame.url : '', hlavniRamec: !!e.senderFrame && e.senderFrame === e.sender.mainFrame });
const odMistni = (e) => oknoZije() && e.sender === stav.okno.webContents && smiKanal(ramec(e), 'mistni', stav.aktivni);
const odServeru = (e) => oknoZije() && e.sender === stav.okno.webContents && smiKanal(ramec(e), 'server', stav.aktivni);

function mistniKanal(nazev, obsluha) {
  ipcMain.handle(nazev, async (e, ...args) => {
    if (!odMistni(e)) {
      stav.log('odmítnuto volání', nazev);
      throw new Error('forbidden');
    }
    return obsluha(...args);
  });
}

function zaregistrujKanaly() {
  mistniKanal('kb:app:info', () => infoProMistni());
  mistniKanal('kb:app:nahled', (nazev) => {
    const adresa = adresaFirmy(String(nazev || '').slice(0, 200));
    return adresa ? hostZ(adresa) : '';
  });
  mistniKanal('kb:app:overFirmu', (nazev) => overFirmu(String(nazev || '').slice(0, 200)));
  mistniKanal('kb:app:overAdresu', (vstup) => overAdresu(String(vstup || '').slice(0, 300)));
  mistniKanal('kb:app:pripoj', (origin, nazev) => pripojOrganizaci(String(origin || ''), String(nazev || '')));
  mistniKanal('kb:app:prepni', (origin) => prepniOrganizaci(String(origin || '')));
  mistniKanal('kb:app:odeber', (origin) => {
    stav.nast = nastaveni.odeberOrganizaci(stav.nast, String(origin || ''));
    if (stav.aktivni !== stav.nast.aktivni) { stav.aktivni = stav.nast.aktivni; stav.hlidac.reset(); }
    ulozNastaveni();
    prestavMenu();
    return infoProMistni();
  });
  mistniKanal('kb:app:zkusZnovu', () => { nactiServer({ duvod: 'rucne' }); });
  mistniKanal('kb:app:zmenit', () => zmenitOrganizaci());
  mistniKanal('kb:app:otevritVen', (klic) => {
    const odkaz = ODKAZY[String(klic)];
    if (odkaz) otevriVen(odkaz[stav.jazyk] || odkaz.en);
  });

  ipcMain.on('kb:changeOrganization', (e) => { if (odServeru(e)) zmenitOrganizaci(); });
  ipcMain.on('kb:supportsFlush', (e) => {
    if (!odServeru(e)) return;
    stav.flushPodporovan = true;
    e2e('flushPodporovan');
  });
  ipcMain.on('kb:flushDone', (e, id) => {
    if (!odServeru(e)) return;
    const konec = stav.cekajiciFlush.get(Number(id));
    if (konec) konec();
  });
  ipcMain.on('kb:openTaken', (e, id) => {
    if (!odServeru(e) || !stav.otevreni || stav.otevreni.id !== id) return;
    clearTimeout(stav.otevreni.casovac);
    stav.otevreni = null;
  });
}

// ---------------------------------------------------------------- odkazy ven a stahování

const brzdaVen = new Brzda();
function otevriVen(url) {
  if (!smiVen(url) || !brzdaVen.povol()) {
    stav.log('odkaz ven zamítnut');
    e2e('venZamitnuto', { url });
    return false;
  }
  e2e('ven', { url });
  if (!E2E) shell.openExternal(url).catch((e) => stav.log('openExternal selhalo', e));
  return true;
}

const bezpecneJmeno = (jmeno) => {
  const s = basename(String(jmeno || '')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
  return s.slice(0, 180) || 'soubor';
};
function volnaCesta(slozka, jmeno) {
  const pripona = extname(jmeno);
  const zaklad = jmeno.slice(0, jmeno.length - pripona.length);
  let cesta = join(slozka, jmeno);
  for (let i = 1; existsSync(cesta) && i < 1000; i++) cesta = join(slozka, `${zaklad} (${i})${pripona}`);
  return cesta;
}

// Jeden soubor → klasický dialog „Uložit jako“. Dávka (víc souborů během pár sekund, třeba
// rozdělené PDF) → rovnou do Stažených a jedno upozornění, ne deset dialogů za sebou.
let posledniStazeni = 0;
function naStahovani(_e, polozka) {
  const ted = Date.now();
  const davka = ted - posledniStazeni < 3000;
  posledniStazeni = ted;
  const jmeno = bezpecneJmeno(polozka.getFilename());
  if (E2E) {
    polozka.setSavePath(volnaCesta(process.env.KB_DESKTOP_E2E_STAZENE || tmpdir(), jmeno));
  } else if (davka) {
    polozka.setSavePath(volnaCesta(app.getPath('downloads'), jmeno));
    polozka.once('done', (_e2, vysledek) => {
      if (vysledek === 'completed') toast({ titulek: 'killBottleneck', text: stav.t('upozorneni.ulozenoStazene', { soubor: jmeno }) });
    });
  }
  e2e('stahovani', { soubor: jmeno, davka });
}

// ---------------------------------------------------------------- session a webContents

const zabezpecene = new WeakSet();
function zabezpecRelaci(ses) {
  if (zabezpecene.has(ses)) return;
  zabezpecene.add(ses);
  ses.setPermissionRequestHandler((wc, opravneni, callback, details = {}) => {
    const origin = originOf(details.requestingUrl || (wc && wc.getURL()) || '');
    const ok = smiOpravneni(opravneni, {
      origin, aktivniOrigin: stav.aktivni, mediaTypes: details.mediaTypes, externalURL: details.externalURL,
    });
    if (!ok) stav.log('oprávnění zamítnuto', opravneni);
    e2e('opravneni', { opravneni, ok });
    callback(ok);
  });
  ses.setPermissionCheckHandler((_wc, opravneni, requestingOrigin, details = {}) => smiOpravneni(opravneni, {
    origin: originOf(requestingOrigin || ''), aktivniOrigin: stav.aktivni, mediaType: details.mediaType,
  }));
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((_pozadavek, callback) => callback({}));
  // Webový service worker v aplikaci ne: při výpadku by servíroval starou stránku z mezipaměti
  // (místní stránka „server neodpovídá“ by se neukázala) a po nasazení držel staré soubory.
  ses.webRequest.onBeforeRequest({ urls: ['*://*/sw.js'] }, (d, callback) => {
    let zrusit = false;
    try { zrusit = new URL(d.url).pathname === '/sw.js'; } catch { /* nechat projít */ }
    callback({ cancel: zrusit });
  });
  ses.on('will-download', naStahovani);
  ses.setSpellCheckerEnabled(!E2E);
}

function naNavigaci(e, url) {
  const rozhodnuti = rozhodniNavigaci(url, stav.aktivni);
  if (rozhodnuti === 'povolit') return;
  e.preventDefault();
  if (rozhodnuti === 'ven') otevriVen(url);
  else e2e('navigaceZakazana', { url });
}

function zabezpecWebContents(wc) {
  wc.on('will-navigate', (e, url) => naNavigaci(e, (e && e.url) || url));
  wc.on('will-redirect', (e, url) => {
    if (e && e.isMainFrame === false) return;
    naNavigaci(e, (e && e.url) || url);
  });
  // Vnořené rámce (iframe): jen týž server nebo prázdné stránky; nic jiného se do okna nenačte.
  wc.on('will-frame-navigate', (e) => {
    if (e.isMainFrame) return;
    const url = e.url || '';
    if (/^(about:|data:|blob:)/.test(url) || originOf(url) === stav.aktivni) return;
    e.preventDefault();
    e2e('ramecZakazan', { url });
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    const rozhodnuti = rozhodniOtevreni(url, stav.aktivni);
    if (rozhodnuti === 'stahnout') wc.downloadURL(url);
    else if (rozhodnuti === 'vOkne') {
      const u = new URL(url);
      naviguj(`${u.pathname}${u.search}${u.hash}`);
    } else if (rozhodnuti === 'ven') otevriVen(url);
    else if (rozhodnuti === 'zakazat') e2e('oknoZakazano', { url });
    return { action: 'deny' };
  });
}

// ---------------------------------------------------------------- okno

let casovacUlozeniOkna = null;
function zapamatujRozmery() {
  clearTimeout(casovacUlozeniOkna);
  casovacUlozeniOkna = setTimeout(() => {
    if (!oknoZije()) return;
    stav.nast = nastaveni.vycisti({ ...stav.nast, okno: { ...stav.okno.getNormalBounds(), maximized: stav.okno.isMaximized() } });
    ulozNastaveni();
  }, 800);
}

function kontextoveMenu(wc, p) {
  const t = stav.t;
  const polozky = [];
  if (p.misspelledWord) {
    for (const navrh of (p.dictionarySuggestions || []).slice(0, 5)) {
      polozky.push({ label: navrh, click: () => wc.replaceMisspelling(navrh) });
    }
    if (polozky.length) polozky.push({ type: 'separator' });
  }
  if (p.linkURL && smiVen(p.linkURL) && originOf(p.linkURL) !== stav.aktivni) {
    polozky.push({ label: t('menu.otevritOdkaz'), click: () => otevriVen(p.linkURL) });
    polozky.push({ label: t('menu.kopirovatOdkaz'), click: () => clipboard.writeText(p.linkURL) });
    polozky.push({ type: 'separator' });
  }
  if (p.isEditable) {
    polozky.push(
      { role: 'cut', label: t('menu.vyjmout'), enabled: p.editFlags.canCut },
      { role: 'copy', label: t('menu.kopirovat'), enabled: p.editFlags.canCopy },
      { role: 'paste', label: t('menu.vlozit'), enabled: p.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: t('menu.vybratVse') },
    );
  } else if (p.selectionText) {
    polozky.push({ role: 'copy', label: t('menu.kopirovat') });
  }
  while (polozky.length && polozky[polozky.length - 1].type === 'separator') polozky.pop();
  if (polozky.length) Menu.buildFromTemplate(polozky).popup({ window: stav.okno });
}

function klavesy(wc, e, vstup) {
  if (vstup.type !== 'keyDown') return;
  const ctrl = vstup.control || vstup.meta;
  const k = vstup.key;
  const zastav = () => e.preventDefault();
  if ((ctrl && k.toLowerCase() === 'r') || k === 'F5') { zastav(); obnovit(); return; }
  if (k === 'F11') { zastav(); stav.okno.setFullScreen(!stav.okno.isFullScreen()); return; }
  if (ctrl && (k === '+' || k === '=')) { zastav(); wc.setZoomLevel(Math.min(5, wc.getZoomLevel() + 0.5)); return; }
  if (ctrl && k === '-') { zastav(); wc.setZoomLevel(Math.max(-3, wc.getZoomLevel() - 0.5)); return; }
  if (ctrl && k === '0') { zastav(); wc.setZoomLevel(0); return; }
  if (vstup.alt && k === 'ArrowLeft') { zastav(); if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return; }
  if (vstup.alt && k === 'ArrowRight') { zastav(); if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); return; }
  if (app.isPackaged && (k === 'F12' || (ctrl && vstup.shift && k.toLowerCase() === 'i'))) zastav();
}

function vytvorOkno() {
  const primarni = screen.getPrimaryDisplay();
  const plochy = [primarni, ...screen.getAllDisplays().filter((d) => d.id !== primarni.id)].map((d) => d.workArea);
  const r = obnovRozmery(stav.nast.okno, plochy);
  const okno = new BrowserWindow({
    x: r.x, y: r.y, width: r.width, height: r.height,
    minWidth: 480, minHeight: 400,
    show: false,
    backgroundColor: BARVA_POZADI,
    title: 'killBottleneck',
    icon: join(KOREN, 'build', 'tray', 'ikona.png'),
    autoHideMenuBar: true,
    webPreferences: {
      partition: PARTITION,
      preload: join(KOREN, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      safeDialogs: true,
      spellcheck: true,
      devTools: !app.isPackaged,
      additionalArguments: [`--kb-verze=${VERZE}`],
    },
  });
  stav.okno = okno;
  okno.setMenuBarVisibility(false);
  if (r.maximized) okno.maximize();
  const wc = okno.webContents;

  okno.on('close', (e) => {
    if (stav.konci) return;
    e.preventDefault();
    okno.hide();
    nabidniAutostart();
  });
  okno.on('hide', () => { stav.skrytoOd = Date.now(); });
  okno.on('show', () => {
    prekresliOverlay();
    // Skryté okno mohlo propásnout realtime události (spojení mezitím spadlo) → obnovit data.
    if (stav.skrytoOd && Date.now() - stav.skrytoOd > 60_000 && oknoUkazujeServer()) wc.send('kb:resume');
    stav.skrytoOd = 0;
  });
  okno.on('resize', zapamatujRozmery);
  okno.on('move', zapamatujRozmery);
  okno.on('maximize', zapamatujRozmery);
  okno.on('unmaximize', zapamatujRozmery);
  // Odhlášení z Windows / vypnutí: na nic nečekat, systém dá jen pár sekund.
  okno.on('session-end', () => { stav.konci = true; });
  okno.on('app-command', (_e, prikaz) => {
    if (prikaz === 'browser-backward' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    if (prikaz === 'browser-forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  });

  wc.on('page-title-updated', (e, titulek) => {
    e.preventDefault();
    okno.setTitle(oknoUkazujeServer() ? titulekOkna(titulek, hostAktivni()) : 'killBottleneck');
  });
  wc.on('did-start-navigation', (d) => { if (d && d.isMainFrame && !d.isSameDocument) stav.flushPodporovan = false; });
  wc.on('did-fail-load', (_e, kod, _popis, url, hlavni) => {
    if (!hlavni || kod === -3) return; // -3 = zrušeno další navigací
    if (originOf(url) === stav.aktivni) ukazOffline('sit');
  });
  wc.on('did-navigate', (_e, url, httpKod) => {
    if (originOf(url) === stav.aktivni && httpKod >= 500) ukazOffline('server');
  });
  wc.on('render-process-gone', (_e, d) => {
    stav.log('stránka spadla', d && d.reason);
    if (!stav.konci) setTimeout(() => nactiServer({ duvod: 'pad' }), 1000);
  });
  wc.on('unresponsive', () => stav.log('stránka neodpovídá'));
  wc.on('context-menu', (_e, p) => kontextoveMenu(wc, p));
  wc.on('before-input-event', (e, vstup) => klavesy(wc, e, vstup));
  return okno;
}

// ---------------------------------------------------------------- autostart, menu, o aplikaci

const AUTOSTART = { name: 'killBottleneck', args: ['--hidden'] };
const autostartPodporovan = () => process.platform === 'win32' && !E2E;
const autostartZapnut = () => {
  if (!autostartPodporovan()) return false;
  try { return app.getLoginItemSettings(AUTOSTART).openAtLogin; } catch { return false; }
};
function nastavAutostart(zapnout) {
  if (autostartPodporovan()) {
    try { app.setLoginItemSettings({ openAtLogin: !!zapnout, ...AUTOSTART }); } catch (e) { stav.log('autostart selhal', e); }
  }
  prestavMenu();
}

// Při prvním zavření okna: aplikace běží dál vedle hodin — zeptat se, jestli ji spouštět
// i po zapnutí počítače (jinak by po restartu upozornění nechodila), a poradit s ikonou.
async function nabidniAutostart() {
  if (stav.nast.autostartNabidnut) return;
  stav.nast = nastaveni.vycisti({ ...stav.nast, autostartNabidnut: true });
  ulozNastaveni();
  if (!autostartPodporovan()) return;
  if (autostartZapnut()) {
    toast({ titulek: 'killBottleneck', text: stav.t('upozorneni.beziDal') });
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: stav.t('autostart.titulek'),
    message: stav.t('autostart.otazka'),
    detail: stav.t('autostart.detail'),
    buttons: [stav.t('autostart.ano'), stav.t('autostart.ne')],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) nastavAutostart(true);
}

function prestavMenu() {
  if (!stav.tray) return;
  const t = stav.t;
  const organizace = stav.nast.organizace.map((o) => ({
    label: o.nazev ? `${o.nazev} (${hostZ(o.origin)})` : hostZ(o.origin),
    type: 'radio',
    checked: o.origin === stav.aktivni,
    click: () => prepniOrganizaci(o.origin),
  }));
  const sablona = [
    { label: t('tray.otevrit'), click: () => ukazOkno() },
    { type: 'separator' },
    {
      label: t('tray.organizace'),
      submenu: [
        ...organizace,
        ...(organizace.length ? [{ type: 'separator' }] : []),
        { label: t('tray.pridatOrganizaci'), click: () => zmenitOrganizaci() },
      ],
    },
    ...(autostartPodporovan() ? [{ label: t('tray.autostart'), type: 'checkbox', checked: autostartZapnut(), click: (p) => nastavAutostart(p.checked) }] : []),
    ...(stav.aktualizace ? [{ label: t('tray.aktualizovat', { verze: stav.aktualizace.verze }), click: () => stav.updater && stav.updater.nainstaluj() }] : []),
    { label: t('tray.oAplikaci'), click: () => oAplikaci() },
    { type: 'separator' },
    { label: t('tray.ukoncit'), click: () => ukonci() },
  ];
  stav.tray.setContextMenu(Menu.buildFromTemplate(sablona));
}

async function oAplikaci() {
  const t = stav.t;
  const radky = [t('oAplikaci.verzeAplikace', { verze: VERZE })];
  if (stav.aktivni) {
    const v = await verzeServeru(stav.aktivni);
    radky.push(v.kb && v.verze ? t('oAplikaci.verzeServeru', { host: hostAktivni(), verze: v.verze }) : t('oAplikaci.serverNeznamy'));
  }
  radky.push(t('oAplikaci.technika', { electron: process.versions.electron, chrome: process.versions.chrome }));
  const moznosti = {
    type: 'info',
    title: t('oAplikaci.titulek'),
    message: t('oAplikaci.nadpis'),
    detail: radky.join('\n'),
    buttons: [t('oAplikaci.zavrit'), t('oAplikaci.slozkaLogu')],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const { response } = oknoSkryte() ? await dialog.showMessageBox(moznosti) : await dialog.showMessageBox(stav.okno, moznosti);
  if (response === 1) shell.openPath(app.getPath('logs'));
}

async function ukonci() {
  if (stav.konci) return;
  stav.konci = true;
  await ulozRozdelane();
  app.quit();
}

function poProbuzeni() {
  if (stav.hlidac) stav.hlidac.ted();
  if (oknoUkazujeServer()) stav.okno.webContents.send('kb:resume');
  else if (stav.mistniStav.stranka === 'offline' && stav.aktivni) nactiServer({ duvod: 'probuzeni' });
}

// ---------------------------------------------------------------- start

async function smokeTest() {
  const vysledek = { verze: VERZE, kontroly: [] };
  const zapis = (nazev, ok, detail) => vysledek.kontroly.push({ nazev, ok: !!ok, ...(detail !== undefined ? { detail } : {}) });
  try {
    zapis('odkaz file: ven nesmí', !smiVen('file:///C:/Windows/System32/calc.exe'));
    zapis('odkaz ms-msdt: ven nesmí', !smiVen('ms-msdt:/id PCWDiagnostic'));
    zapis('odkaz https: ven smí', smiVen('https://killbottleneck.com/'));
    await stav.okno.loadURL(`${MISTNI_ORIGIN}/vyber.html`);
    const typy = await stav.okno.webContents.executeJavaScript('typeof window.kbApp + "/" + typeof window.kbDesktop');
    zapis('místní stránka má jen kbApp', typy === 'object/undefined', typy);
    const verze = await stav.okno.webContents.executeJavaScript('window.kbApp.info().then((i) => i.verze)');
    zapis('místní kanál odpovídá', verze === VERZE, verze);
    zapis('ikony jsou přibalené', !obrazek('tray', 'tray.png').isEmpty() && !obrazek('odznak', '1.png').isEmpty());
  } catch (e) {
    zapis('výjimka', false, String(e && e.message));
  }
  vysledek.ok = vysledek.kontroly.every((k) => k.ok);
  writeFileSync(join(tmpdir(), 'killbottleneck-smoke.json'), `${JSON.stringify(vysledek, null, 2)}\n`);
  app.exit(vysledek.ok ? 0 : 1);
}

function e2eOvladani() {
  createInterface({ input: process.stdin }).on('line', (radek) => {
    const [prikaz, arg] = radek.trim().split(/\s+/, 2);
    if (prikaz === 'skryj') stav.okno.hide();
    else if (prikaz === 'ukaz') ukazOkno();
    else if (prikaz === 'popredi') stav.e2ePopredi = arg === 'ano' ? true : arg === 'ne' ? false : null;
    else if (prikaz === 'kolo') stav.hlidac.ted();
    else if (prikaz === 'klikni' && arg) { ukazOkno(); otevriNotifikaci(arg); }
    else if (prikaz === 'obnov') obnovit();
    else if (prikaz === 'probuzeni') poProbuzeni();
    else if (prikaz === 'novaVerze') obnovSkryte('test');
    else if (prikaz === 'ukonci') ukonci();
    e2e('prikaz', { prikaz, arg: arg || null });
  });
}

async function start() {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
  Menu.setApplicationMenu(null);

  stav.log = vytvorLog(app.getPath('logs'));
  stav.cestaNastaveni = join(app.getPath('userData'), 'nastaveni.json');
  stav.nast = nastaveni.nacti(stav.cestaNastaveni);
  stav.aktivni = stav.nast.aktivni;
  const preklad = vytvorPreklad(jazykZLocale(app.getPreferredSystemLanguages()[0] || app.getLocale()));
  stav.t = preklad.t;
  stav.slovnik = preklad.slovnik;
  stav.jazyk = preklad.jazyk;
  stav.log('start', VERZE, process.versions.electron, SMOKE ? 'smoke' : '', E2E ? 'e2e' : '');

  app.on('session-created', zabezpecRelaci);
  app.on('web-contents-created', (_e, wc) => zabezpecWebContents(wc));
  zabezpecRelaci(session.defaultSession);
  stav.ses = session.fromPartition(PARTITION);
  zabezpecRelaci(stav.ses);
  // Bez „Electron/x“ a jména aplikace v identifikaci prohlížeče (některé služby takové
  // klienty odmítají), ale se značkou aplikace — hlášení chyb pak ví, odkud přišlo.
  stav.ses.setUserAgent(`${stav.ses.getUserAgent().replace(/ Electron\/\S+/, '').replace(/ killBottleneck\/\S+/, '')} killBottleneckDesktop/${VERZE}`);
  await stav.ses.clearStorageData({ storages: ['serviceworkers'] }).catch(() => {});

  stav.ses.protocol.handle(MISTNI_SCHEMA, async (pozadavek) => {
    const cesta = mistniSoubor(pozadavek.url);
    if (!cesta) return new Response('Not found', { status: 404 });
    try {
      const data = await readFile(join(KOREN, 'ui', cesta));
      return new Response(data, {
        headers: {
          'content-type': MIME[extname(cesta).toLowerCase()] || 'application/octet-stream',
          'content-security-policy': CSP_MISTNI,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  zaregistrujKanaly();
  vytvorOkno();

  if (SMOKE) {
    await smokeTest();
    return;
  }

  stav.hlidac = new Hlidac({
    dotaz: async () => {
      const r = await dotazNaNotifikace();
      e2e('hlidac', { stav: r.stav, celkem: r.celkem ?? null });
      return r;
    },
    ukaz: ukazUpozorneni,
    odznak: nastavOdznak,
    novaVerze: () => obnovSkryte('novaVerze'),
    odmitnuto: () => toast({
      titulek: stav.t('upozorneni.prihlasteSeTitulek'),
      text: stav.t('upozorneni.prihlasteSe'),
      poKliku: () => obnovit(),
    }),
    intervalMs: E2E && Number(process.env.KB_DESKTOP_HLIDAC_MS) > 0 ? Number(process.env.KB_DESKTOP_HLIDAC_MS) : 60_000,
    log: stav.log,
  });

  stav.tray = new Tray(ikonaTray(false));
  stav.tray.setToolTip(stav.t('tray.tooltip'));
  stav.tray.on('click', () => ukazOkno());
  prestavMenu();

  const skryte = (START_SKRYTE || stav.nast.poAktualizaciSkryte) && !!stav.aktivni;
  if (stav.nast.poAktualizaciSkryte) {
    stav.nast = nastaveni.vycisti({ ...stav.nast, poAktualizaciSkryte: false });
    ulozNastaveni();
  }
  if (!skryte) stav.okno.once('ready-to-show', () => ukazOkno());
  if (stav.aktivni) nactiServer({ duvod: 'start' });
  else ukazMistni('vyber');
  stav.hlidac.start();

  powerMonitor.on('resume', poProbuzeni);
  powerMonitor.on('unlock-screen', poProbuzeni);
  setInterval(() => {
    if (Date.now() - stav.nactenoV > 24 * 3600_000) obnovSkryte('denne');
  }, 3600_000);

  if (app.isPackaged) {
    stav.updater = spustAktualizace({
      log: stav.log,
      jeSkryteANecinne: () => oknoSkryte() && powerMonitor.getSystemIdleTime() >= 60,
      pripravRestart: async () => {
        stav.nast = nastaveni.vycisti({ ...stav.nast, poAktualizaciSkryte: oknoSkryte() });
        ulozNastaveni();
        await ulozRozdelane();
        stav.konci = true;
      },
      pripraveno: (verze) => {
        stav.aktualizace = { verze };
        prestavMenu();
        if (!oknoSkryte()) toast({ titulek: 'killBottleneck', text: stav.t('upozorneni.aktualizacePripravena', { verze }) });
      },
    });
  }
  if (E2E) e2eOvladani();
  e2e('pripraven', { verze: VERZE, aktivni: stav.aktivni });
}

const zamek = SMOKE || app.requestSingleInstanceLock();
if (!zamek) {
  app.quit();
} else {
  app.on('second-instance', () => {
    ukazOkno();
    if (!stav.aktivni) ukazMistni('vyber');
  });
  app.on('before-quit', () => { stav.konci = true; });
  // Zavřené okno aplikaci neukončí — běží dál v oznamovací oblasti.
  app.on('window-all-closed', () => {});
  app.whenReady().then(start).catch((e) => {
    stav.log('start selhal', e);
    dialog.showErrorBox('killBottleneck', String((e && e.message) || e));
    app.exit(1);
  });
}
