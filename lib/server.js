// Drobnosti kolem serveru organizace, které jdou testovat bez Electronu.

// Přihlášení ze stránky: PocketBase SDK ho drží v localStorage pod klíčem pocketbase_auth
// jako JSON { token, record }. Vrací { token, uzivatel, vyprselo } nebo null (nepřihlášen).
// `vyprselo` čte platnost přímo z tokenu: server totiž s propadlým tokenem nevrátí chybu,
// jen ho bere jako nepřihlášeného — a upozornění by potichu přestala chodit.
export function tokenZUlozeni(ulozeni, ted = Date.now()) {
  if (typeof ulozeni !== 'string' || !ulozeni) return null;
  let data;
  try { data = JSON.parse(ulozeni); } catch { return null; }
  const token = data && typeof data.token === 'string' ? data.token : '';
  if (!token) return null;
  const obsah = obsahTokenu(token);
  const zaznam = (data.record && data.record.id) || (data.model && data.model.id) || (obsah && obsah.id) || '';
  if (typeof zaznam !== 'string' || !/^[\w-]{1,64}$/.test(zaznam)) return null;
  const vyprselo = !!(obsah && Number.isFinite(obsah.exp) && obsah.exp * 1000 <= ted);
  return { token, uzivatel: zaznam, vyprselo };
}

function obsahTokenu(token) {
  const casti = token.split('.');
  if (casti.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(casti[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// Nejstarší server, se kterým aplikace počítá (stejná hranice jako výběr serveru v Androidu).
export const MIN_SERVER = [0, 16];

// „v0.80-beta“, „0.80“ → je starší než MIN_SERVER? Vývojová „dev“ a neznámé = nevarovat.
export function jeStarsiServer(verze) {
  const m = String(verze || '').match(/(\d+)\.(\d+)/);
  if (!m) return false;
  const hlavni = Number(m[1]);
  const vedlejsi = Number(m[2]);
  return hlavni < MIN_SERVER[0] || (hlavni === MIN_SERVER[0] && vedlejsi < MIN_SERVER[1]);
}
