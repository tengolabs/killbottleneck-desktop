// Nastavení rámu: %APPDATA%\killBottleneck\nastaveni.json — uložené organizace, poloha okna
// a pár voleb. Přihlášení tu NENÍ: to drží stránka serveru ve svém úložišti jako v prohlížeči.
// Zápis přes dočasný soubor a přejmenování (pád uprostřed nesmí nechat půlku JSONu);
// poškozený nebo podvržený soubor se při čtení pročistí na výchozí hodnoty.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { originOf } from './politika.js';

const MAX_ORGANIZACI = 20;

const vycistiOkno = (o) => {
  if (!o || typeof o !== 'object') return null;
  const { x, y, width, height } = o;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width < 200 || height < 150 || width > 20000 || height > 20000) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), maximized: !!o.maximized };
};

export function vycisti(data) {
  const d = data && typeof data === 'object' ? data : {};
  const organizace = [];
  for (const o of Array.isArray(d.organizace) ? d.organizace : []) {
    const origin = o && typeof o.origin === 'string' ? originOf(o.origin) : null;
    if (!origin || !/^https?:/.test(origin) || organizace.some((x) => x.origin === origin)) continue;
    organizace.push({ origin, nazev: typeof o.nazev === 'string' ? o.nazev.trim().slice(0, 120) : '' });
    if (organizace.length >= MAX_ORGANIZACI) break;
  }
  const aktivni = organizace.some((o) => o.origin === d.aktivni) ? d.aktivni : (organizace[0] ? organizace[0].origin : null);
  return {
    verze: 1,
    organizace,
    aktivni,
    okno: vycistiOkno(d.okno),
    autostartNabidnut: !!d.autostartNabidnut,
    poAktualizaciSkryte: !!d.poAktualizaciSkryte,
  };
}

export function nacti(cesta) {
  try {
    return vycisti(JSON.parse(readFileSync(cesta, 'utf8')));
  } catch {
    return vycisti(null);
  }
}

export function uloz(cesta, data) {
  mkdirSync(dirname(cesta), { recursive: true });
  const docasny = `${cesta}.tmp`;
  writeFileSync(docasny, `${JSON.stringify(vycisti(data), null, 2)}\n`);
  renameSync(docasny, cesta);
}

// Přidaná (nebo znovu zvolená) organizace jde na začátek seznamu a stává se aktivní.
export function pridejOrganizaci(nast, { origin, nazev }) {
  const o = originOf(origin);
  if (!o || !/^https?:/.test(o)) return vycisti(nast);
  const ostatni = (nast.organizace || []).filter((x) => x.origin !== o);
  const puvodni = (nast.organizace || []).find((x) => x.origin === o);
  return vycisti({ ...nast, organizace: [{ origin: o, nazev: nazev || (puvodni && puvodni.nazev) || '' }, ...ostatni], aktivni: o });
}

// Odebraná aktivní organizace předá místo další v pořadí (nebo nikomu → výběr organizace).
export function odeberOrganizaci(nast, origin) {
  const organizace = (nast.organizace || []).filter((x) => x.origin !== origin);
  const aktivni = nast.aktivni === origin ? (organizace[0] ? organizace[0].origin : null) : nast.aktivni;
  return vycisti({ ...nast, organizace, aktivni });
}
