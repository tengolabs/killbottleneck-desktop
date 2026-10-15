// Hlídač notifikací: upozornění Windows a počet nepřečtených u ikony.
//
// Proč se rám ptá serveru á minutu a nespoléhá na realtime stránky:
//  · realtime (SSE) přes Cloudflare padá po ~100 s nečinnosti a PocketBase spojení zavírá
//    po 5/30 min — SDK se znovu připojí, ale co přišlo mezitím, už nepřehraje;
//  · server notifikace SLUČUJE: opakování v okně a přetok nad denní strop jen přepíšou
//    existující záznam (count roste, přetokový souhrn se vrací do read=false) — kdo
//    poslouchá jen „create“, takové nikdy neuvidí;
//  · funguje to i se staršími servery, které o aplikaci pro Windows nic nevědí.
// Cena: upozornění chodí se zpožděním do jedné minuty.

export const NOVA_VERZE = 'new_version';
export const MAX_UPOZORNENI = 3;
// Hranice „co je nové“ snese mírný rozdíl hodin mezi počítačem a serverem.
const TOLERANCE_MS = 2 * 60_000;
const MAX_VIDENYCH = 1000;

const pocetZaznamu = (n) => Math.max(1, Number(n && n.count) || 1);
const casVytvoreni = (n) => {
  const t = Date.parse(String((n && n.created) || '').replace(' ', 'T'));
  return Number.isFinite(t) ? t : 0;
};

// Stav jedné organizace a jednoho přihlášeného člověka.
export const novyStav = () => ({ videne: null, odKdy: 0 });

// Zpracuje odpověď serveru (nejnovější nepřečtené) a vrátí, co ohlásit.
//  · první dotaz (po startu, přihlášení, přepnutí organizace) jen zapamatuje — žádná záplava
//    starých upozornění, počet nepřečtených ukáže odznak;
//  · záznam, který rám ještě neviděl, je nový, jen když vznikl až po začátku hlídání (jinak
//    to je starší nepřečtený, který se jen posunul do okna nejnovějších třiceti);
//  · známý záznam s vyšším počtem = sloučená notifikace nebo přetok nad strop.
// `videne` si pamatuje i přečtené záznamy, které ze seznamu vypadly — přetokový souhrn se
// po přečtení vrací s vyšším počtem a musí se ohlásit znovu.
export function zpracuj(stav, polozky, serverCasMs) {
  const seznam = (Array.isArray(polozky) ? polozky : []).filter((n) => n && typeof n.id === 'string');
  if (!stav.videne) {
    stav.videne = new Map(seznam.map((n) => [n.id, pocetZaznamu(n)]));
    stav.odKdy = Number.isFinite(serverCasMs) && serverCasMs > 0 ? serverCasMs : Date.now();
    return [];
  }
  const nove = [];
  for (const n of seznam) {
    const pocet = pocetZaznamu(n);
    const bylo = stav.videne.get(n.id);
    if (bylo === undefined) {
      if (casVytvoreni(n) >= stav.odKdy - TOLERANCE_MS) nove.push(n);
    } else if (pocet > bylo) {
      nove.push(n);
    }
    stav.videne.delete(n.id); // znovu na konec — mazání při přetečení bere nejdéle neviděné
    stav.videne.set(n.id, pocet);
  }
  while (stav.videne.size > MAX_VIDENYCH) stav.videne.delete(stav.videne.keys().next().value);
  return nove;
}

// Časovač a napojení. `dotaz()` vrací { stav, uzivatel, polozky, celkem, serverCas }:
//  'ok' · 'odmitnuto' (401/403 — přihlášení vypršelo) · 'neprihlasen' · 'nelze' (okno teď
//  neukazuje server) · 'chyba' (síť). Ostatní jsou zpětná volání do rámu.
// Když okno ještě neukazuje server (start, načítání, přepnutí organizace), zkusit to znovu
// za pár sekund, ne až za minutu: co přijde do prvního úspěšného dotazu, spadne do výchozího
// stavu a neohlásí se (nalezeno na Windows 10 — komentář krátce po skrytém startu zapadl).
export const ZNOVU_PO_NELZE_MS = 3000;

export class Hlidac {
  constructor({ dotaz, ukaz, odznak, novaVerze, odmitnuto, intervalMs = 60_000, log = () => {} }) {
    Object.assign(this, { dotaz, ukaz, odznak, novaVerze, odmitnuto, intervalMs, log });
    this.stav = novyStav();
    this.uzivatel = null;
    this.odmitnutoHlaseno = false;
    this.bezi = false;
    this.probiha = false;
    this.casovac = null;
  }

  start() {
    this.bezi = true;
    this.naplanuj(1000);
  }

  stop() {
    this.bezi = false;
    clearTimeout(this.casovac);
    this.casovac = null;
  }

  // Hned (po probuzení, odemčení, návratu sítě) — jen přeplánuje, souběžné kolo nespustí.
  ted() {
    if (this.bezi) this.naplanuj(500);
  }

  // Jiná organizace nebo odhlášení: začít znovu od výchozího stavu.
  reset() {
    this.stav = novyStav();
    this.uzivatel = null;
    this.odmitnutoHlaseno = false;
    this.odznak(0);
  }

  naplanuj(ms) {
    clearTimeout(this.casovac);
    this.casovac = setTimeout(() => this.kolo(), ms);
  }

  async kolo() {
    if (this.probiha) return;
    this.probiha = true;
    let pristi = this.intervalMs;
    try {
      const r = (await this.dotaz()) || {};
      if (r.stav === 'nelze') pristi = Math.min(this.intervalMs, ZNOVU_PO_NELZE_MS);
      if (r.stav === 'ok') {
        if (r.uzivatel !== this.uzivatel) {
          this.stav = novyStav();
          this.uzivatel = r.uzivatel;
        }
        this.odmitnutoHlaseno = false;
        const nove = zpracuj(this.stav, r.polozky, r.serverCas);
        this.odznak(Math.max(0, Number(r.celkem) || 0));
        const kOhlaseni = nove.filter((n) => n.type !== NOVA_VERZE);
        if (kOhlaseni.length) this.ukaz(kOhlaseni);
        if (nove.length !== kOhlaseni.length) this.novaVerze();
      } else if (r.stav === 'odmitnuto') {
        this.odznak(0);
        if (!this.odmitnutoHlaseno) {
          this.odmitnutoHlaseno = true;
          this.odmitnuto();
        }
      } else if (r.stav === 'neprihlasen') {
        if (this.uzivatel !== null) this.stav = novyStav();
        this.uzivatel = null;
        this.odmitnutoHlaseno = false;
        this.odznak(0);
      }
      // 'nelze' a 'chyba': stav držet a zkusit to příště
    } catch (e) {
      this.log('hlídač: kolo selhalo', e && e.message);
    } finally {
      this.probiha = false;
      if (this.bezi) this.naplanuj(pristi);
    }
  }
}

// Co z nových ukázat jako jednotlivá upozornění a kolik shrnout do „+N dalších“.
export const rozdelUpozorneni = (nove) => ({
  jednotlive: nove.slice(0, MAX_UPOZORNENI),
  dalsich: Math.max(0, nove.length - MAX_UPOZORNENI),
});
