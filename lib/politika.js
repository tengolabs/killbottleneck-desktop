// Bezpečnostní politika okna — co smí zůstat v okně, co odejde do prohlížeče, kdo smí volat
// rám a jaká oprávnění dostane stránka. Čisté funkce bez Electronu: testují se v nodu
// (tests/politika.test.js) a main.js je jen napojuje na události.
//
// Proč tak přísně: okno ukazuje stránky serveru, který si uživatel zvolil — u vlastního
// serveru i takového, který nikdo z nás nezná. Server proto smí jen to, co killBottleneck
// opravdu potřebuje, a odkazy z něj nesmí v systému spustit nic jiného než web a poštu.

// Místní stránky rámu (výběr organizace, „server nedostupný“) mají vlastní schéma — server
// na ně nedosáhne a jejich privilegované volání rám pozná podle původu.
export const MISTNI_SCHEMA = 'kb-app';
export const MISTNI_ORIGIN = `${MISTNI_SCHEMA}://app`;

// Původ adresy: http(s) → https://host[:port], místní → kb-app://app, cokoli jiného → null.
export const originOf = (url) => {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
    if (u.protocol === `${MISTNI_SCHEMA}:`) return `${MISTNI_SCHEMA}://${u.host}`;
    return null;
  } catch {
    return null;
  }
};

export const jeMistni = (url) => originOf(url) === MISTNI_ORIGIN;

// Kam smí odkaz odejít do systému: jen web a pošta. NIKDY file:, ms-msdt:, search-ms:,
// UNC (\\server\…) ani jiná schémata — přes ně se v minulosti dalo spustit cokoli.
const VEN = new Set(['https:', 'http:', 'mailto:']);
export const smiVen = (url) => {
  if (typeof url !== 'string' || url.length > 4096 || /^\s*\\\\/.test(url)) return false;
  try {
    return VEN.has(new URL(url).protocol);
  } catch {
    return false;
  }
};

// Navigace hlavního okna (will-navigate / will-frame-navigate / will-redirect).
// 'povolit' = zůstat v okně · 'ven' = otevřít v prohlížeči · 'zakazat' = nic se nestane.
// Místní stránky otevírá jen rám sám (loadURL, ten tudy nejde) — stránka serveru ne.
export const rozhodniNavigaci = (url, aktivniOrigin) => {
  const o = originOf(url);
  if (o && aktivniOrigin && o === aktivniOrigin) return 'povolit';
  if (o === MISTNI_ORIGIN) return 'zakazat';
  return smiVen(url) ? 'ven' : 'zakazat';
};

// window.open / target=_blank. 'tise' = zahodit bez hluku (about:blank si otevírá PocketBase
// SDK pro přihlášení Googlem — skutečná adresa Googlu přijde hned potom a ta jde ven).
// Přílohy téhož serveru se stahují; jiná stránka téhož serveru se otevře v okně.
export const rozhodniOtevreni = (url, aktivniOrigin) => {
  if (!url || url === 'about:blank') return 'tise';
  const o = originOf(url);
  if (o && aktivniOrigin && o === aktivniOrigin) {
    return new URL(url).pathname.startsWith('/api/files/') ? 'stahnout' : 'vOkne';
  }
  return smiVen(url) ? 'ven' : 'zakazat';
};

// Kdo smí volat který kanál rámu: jen HLAVNÍ rámec okna; místní kanály jen místní stránky,
// serverové jen stránka aktivní organizace. Iframy (i stejného původu) nezavolají nic.
export const smiKanal = ({ frameUrl, hlavniRamec }, druh, aktivniOrigin) => {
  if (!hlavniRamec) return false;
  const o = originOf(frameUrl);
  if (druh === 'mistni') return o === MISTNI_ORIGIN;
  if (druh === 'server') return !!aktivniOrigin && o === aktivniOrigin;
  return false;
};

// Oprávnění stránky. Jen to, co killBottleneck používá — mikrofon (hlasovky, jen zvuk),
// zápis do schránky a celá obrazovka — a jen u serveru aktivní organizace. Externí protokol
// (klik na odkaz s jiným schématem) jen mailto:. Webová upozornění NE: upozornění Windows
// dělá rám sám, se stropem — stránka by je jinak mohla sypat bez brzdy.
export const smiOpravneni = (opravneni, { origin, aktivniOrigin, mediaTypes, mediaType, externalURL } = {}) => {
  const nasServer = !!aktivniOrigin && origin === aktivniOrigin;
  if (!nasServer) return false;
  switch (opravneni) {
    case 'media':
      if (Array.isArray(mediaTypes)) return mediaTypes.length > 0 && mediaTypes.every((t) => t === 'audio');
      return mediaType === 'audio';
    case 'clipboard-sanitized-write':
    case 'fullscreen':
      return true;
    case 'openExternal':
      return typeof externalURL === 'string' && /^mailto:/i.test(externalURL);
    default:
      return false;
  }
};

// Brzda odkazů ven: stránka (i nepřátelský server) nesmí zasypat prohlížeč okny.
export class Brzda {
  constructor({ rozestupMs = 2000, zaMinutu = 10 } = {}, hodiny = () => Date.now()) {
    this.rozestupMs = rozestupMs;
    this.zaMinutu = zaMinutu;
    this.hodiny = hodiny;
    this.casy = [];
  }

  povol() {
    const ted = this.hodiny();
    this.casy = this.casy.filter((t) => ted - t < 60_000);
    const posledni = this.casy[this.casy.length - 1];
    if (this.casy.length >= this.zaMinutu) return false;
    if (posledni !== undefined && ted - posledni < this.rozestupMs) return false;
    this.casy.push(ted);
    return true;
  }
}

// kb-app://app/<cesta> → relativní cesta souboru v ui/, nebo null. Žádné „..“, zpětná
// lomítka ani neznámé přípony — protokol nesmí posloužit ke čtení jiných souborů aplikace.
export const mistniSoubor = (url) => {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${MISTNI_SCHEMA}:` || u.host !== 'app') return null;
  let cesta;
  try { cesta = decodeURIComponent(u.pathname).replace(/^\/+/, ''); } catch { return null; }
  if (!cesta || cesta.includes('..') || cesta.includes('\\')) return null;
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(cesta)) return null;
  if (!/\.(html|js|css|svg|png|woff2)$/i.test(cesta)) return null;
  return cesta;
};
