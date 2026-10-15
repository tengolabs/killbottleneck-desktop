// Existuje organizace {slug}.killbottleneck.com? Kopie ověřené logiky z přihlášení na webu
// (product/docs/.vitepress/theme/instanceCheck.mjs) — překlep v názvu firmy musí skončit
// hláškou „takovou organizaci nevidíme“, ne syrovou chybou spojení.
// Paritu hlídá product/tests/web-instance-check.mjs (tytéž případy proti oběma kopiím).
//
// Primárně DNS přes DoH (Cloudflare — naše zóna tam žije): odpoví jednoznačně a rychle
// bez ohledu na resolver počítače. ⚠️ Dotek instance je jen ZÁLOHA — na Windows trvá
// NXDOMAIN déle než rozumný timeout (zkouší víc resolverů).

export function fetchSTimeoutem(fetchFn, url, options, ms) {
  const ctl = new AbortController();
  const casovac = setTimeout(() => ctl.abort(), ms);
  return fetchFn(url, { ...options, signal: ctl.signal }).finally(() => clearTimeout(casovac));
}

// true = existuje, false = neexistuje, null = nejde rozhodnout
export async function overExistenci(hostname, fetchFn = globalThis.fetch) {
  try {
    const r = await fetchSTimeoutem(
      fetchFn,
      `https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`,
      { headers: { accept: 'application/dns-json' } }, 3000);
    if (r.ok) {
      const d = await r.json();
      if (d.Status === 3) return false;                       // NXDOMAIN
      if (d.Status === 0 && (d.Answer || []).length) return true;
    }
  } catch (e) { /* DoH nedostupné → záloha níž */ }
  try {
    await fetchSTimeoutem(fetchFn, `https://${hostname}/`, { mode: 'no-cors', cache: 'no-store' }, 4000);
    return true;
  } catch (e) {
    return e && e.name === 'AbortError' ? null : false;
  }
}
