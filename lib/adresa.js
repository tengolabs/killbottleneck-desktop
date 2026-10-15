// Adresa organizace, ke které se okno připojí. Dvě cesty, obě jako jinde v killBottlenecku:
//  · NÁZEV FIRMY → {slug}.killbottleneck.com — stejně jako přihlášení na webu
//    (product/docs/.vitepress/theme/slug.mjs; tam i zdůvodnění pořadí operací);
//  · „Zadat adresu ručně“ (vlastní server) — pravidla jako frontend/src/lib/serverUrl.js
//    (normalizeServerUrl), navíc jména v místní síti, která rám ověří přes DNS.
// Kopie, ne import: rám je samostatný program s vlastním veřejným repem. Že se kopie
// nerozjely, hlídají product/tests/web-slugify-parita.mjs a desktop-adresa-parita.mjs.

// Nejkratší jméno, které server pustí (signup.py: ^[a-z0-9][a-z0-9-]{2,29}$).
export const MIN_SLUG = 3;

export const CLOUD_SUFFIX = '.killbottleneck.com';

// Port slugify() ze signup.py — 1:1 s webovou kopií (slug.mjs), pořadí operací se nesmí měnit.
export const slugifyCompany = (text) => {
  let t = String(text || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '');
  t = t.replace(/\b(s\.?\s?r\.?\s?o|a\.?\s?s|spol|z\.?\s?s|o\.?\s?p\.?\s?s)\b\.?/gi, ' ');
  t = t.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return t.replace(/-{2,}/g, '-').slice(0, 30).replace(/^-+|-+$/g, '');
};

// Kdo do pole „název firmy“ vloží rovnou adresu z prohlížeče („tengo.killbottleneck.com“),
// myslí tu firmu — slugify by z ní udělalo nesmysl „tengo-killbottleneck-com“.
const CLOUD_ADRESA = /^(?:https?:\/\/)?([a-z0-9][a-z0-9-]*)\.killbottleneck\.com\/?$/i;

// Název firmy → adresa instance v cloudu, nebo null (kratší než minimum serveru).
export const adresaFirmy = (nazev) => {
  const vlozena = String(nazev || '').trim().match(CLOUD_ADRESA);
  const slug = vlozena ? slugifyCompany(vlozena[1]) : slugifyCompany(nazev);
  return slug.length >= MIN_SLUG ? `https://${slug}${CLOUD_SUFFIX}` : null;
};

// IPv4-mapped IPv6 přijde z URL v šestnáctkové podobě ([::ffff:a00:1]) — převést na tečky.
const zMapovaneIpv6 = (s) => {
  const tecky = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tecky) return tecky[1];
  const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
};

// Holá IP adresa v privátní síti: LAN (10/8, 172.16/12, 192.168/16), Tailscale (100.64/10),
// loopback a link-local; u IPv6 ::1, ULA (fc00::/7) a link-local (fe80::/10).
export const jePrivatniIp = (ip) => {
  let s = String(ip || '').toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const c = v4.slice(1).map(Number);
    if (c.some((x) => x > 255)) return false;
    const [a, b] = c;
    return a === 10 || a === 127
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254);
  }
  if (!s.includes(':')) return false;
  if (s === '::1') return true;
  const mapovana = zMapovaneIpv6(s);
  if (mapovana) return jePrivatniIp(mapovana);
  return /^f[cd][0-9a-f]{0,2}:/.test(s) || /^fe[89ab][0-9a-f]?:/.test(s);
};

const jeIpLiteral = (host) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith('[');

// „Zadat adresu ručně“: plná adresa, jméno hostitele, nebo holé jméno instance (→ cloud).
// Bez schématu = https. Vrací { ok, url } | { ok, url, overitPrivatni } | { ok: false, chyba }.
// `overitPrivatni`: http na jméno (ne IP) — rám ho pustí, jen když DNS vede výhradně do
// privátní sítě (server.lan, intranet firmy). Chyby: prazdne | neplatne | httpVerejne.
export const normalizujAdresu = (vstup) => {
  let s = String(vstup || '').trim().replace(/\/+$/, '');
  if (!s) return { ok: false, chyba: 'prazdne' };
  if (!s.includes('.') && !s.includes(':') && !s.includes('/')) s = `${s}${CLOUD_SUFFIX}`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return { ok: false, chyba: 'neplatne' }; }
  if (u.pathname !== '/' || u.search || u.hash) return { ok: false, chyba: 'neplatne' };
  if (u.protocol !== 'http:') return { ok: true, url: u.origin };
  const host = u.hostname;
  if (host === 'localhost' || host.endsWith('.local') || jePrivatniIp(host)) return { ok: true, url: u.origin };
  if (jeIpLiteral(host)) return { ok: false, chyba: 'httpVerejne' };
  return { ok: true, url: u.origin, overitPrivatni: true };
};

// Výsledek DNS dotazu ([{address}] z dns.lookup(…, {all:true})) → smí na http? Jen když
// VŠECHNY adresy vedou do privátní sítě (jedna veřejná = provoz by mohl odejít ven nešifrovaný).
export const vseDoPrivatniSite = (adresy) =>
  Array.isArray(adresy) && adresy.length > 0 && adresy.every((a) => jePrivatniIp(a && a.address));
