// Velikost a poloha okna. Uložená poloha se použije jen tehdy, když okno aspoň ze čtvrtiny
// leží na některém z AKTUÁLNÍCH monitorů — notebook odpojený od druhého monitoru by ho
// jinak otevřel mimo obrazovku. Pak se ořízne, aby se vešlo celé. Čistá funkce (testy).

export const VYCHOZI_VELIKOST = Object.freeze({ width: 1280, height: 860 });

const prunik = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

// `plochy` = pracovní plochy monitorů ({x, y, width, height}), primární jako PRVNÍ.
export function obnovRozmery(ulozene, plochy, vychozi = VYCHOZI_VELIKOST) {
  const seznam = (plochy || []).filter((p) => p && p.width > 0 && p.height > 0);
  if (!seznam.length) return { ...vychozi, maximized: false };
  if (ulozene) {
    let nejlepsi = null;
    let nejvic = 0;
    for (const p of seznam) {
      const v = prunik(ulozene, p);
      if (v > nejvic) { nejvic = v; nejlepsi = p; }
    }
    if (nejlepsi && nejvic >= 0.25 * ulozene.width * ulozene.height) {
      const width = Math.min(ulozene.width, nejlepsi.width);
      const height = Math.min(ulozene.height, nejlepsi.height);
      const x = Math.min(Math.max(ulozene.x, nejlepsi.x), nejlepsi.x + nejlepsi.width - width);
      const y = Math.min(Math.max(ulozene.y, nejlepsi.y), nejlepsi.y + nejlepsi.height - height);
      return { x, y, width, height, maximized: !!ulozene.maximized };
    }
  }
  const p = seznam[0];
  const width = Math.min(vychozi.width, p.width);
  const height = Math.min(vychozi.height, p.height);
  return {
    x: p.x + Math.round((p.width - width) / 2),
    y: p.y + Math.round((p.height - height) / 2),
    width,
    height,
    maximized: false,
  };
}

// Titulek okna: titulek stránky + adresa organizace (kdo má víc firem, vidí, ve které je).
export const titulekOkna = (titulekStranky, host) => {
  const t = String(titulekStranky || '').trim() || 'killBottleneck';
  return host ? `${t} — ${host}` : t;
};
