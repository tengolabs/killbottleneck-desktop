import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hlidac, MAX_UPOZORNENI, ZNOVU_PO_NELZE_MS, novyStav, rozdelUpozorneni, zpracuj } from '../lib/hlidac.js';

const T0 = Date.parse('2026-10-15T08:00:00Z');
const cas = (ms) => new Date(T0 + ms).toISOString().replace('T', ' ');
const n = (id, { count = 1, created = cas(0), type = 'node_assigned', text = `text ${id}` } = {}) => ({ id, count, created, type, text });

test('první dotaz jen zapamatuje — žádná záplava starých upozornění', () => {
  const s = novyStav();
  assert.deepEqual(zpracuj(s, [n('a'), n('b')], T0), []);
  assert.equal(s.videne.size, 2);
});

test('nový záznam po začátku hlídání se ohlásí', () => {
  const s = novyStav();
  zpracuj(s, [n('a')], T0);
  const nove = zpracuj(s, [n('b', { created: cas(30_000) }), n('a')], T0 + 60_000);
  assert.deepEqual(nove.map((x) => x.id), ['b']);
  assert.deepEqual(zpracuj(s, [n('b', { created: cas(30_000) }), n('a')], T0 + 120_000), [], 'podruhé už ne');
});

test('starší nepřečtený, který se jen posunul do okna nejnovějších, se neohlásí', () => {
  const s = novyStav();
  zpracuj(s, [n('a')], T0);
  assert.deepEqual(zpracuj(s, [n('a'), n('stary', { created: cas(-3 * 86_400_000) })], T0 + 60_000), []);
});

test('mírný rozdíl hodin serveru a počítače nevadí', () => {
  const s = novyStav();
  zpracuj(s, [], T0);
  assert.equal(zpracuj(s, [n('x', { created: cas(-60_000) })], T0 + 60_000).length, 1);
});

test('sloučená notifikace (vyšší count) se ohlásí znovu', () => {
  const s = novyStav();
  zpracuj(s, [n('a', { count: 1 })], T0);
  assert.deepEqual(zpracuj(s, [n('a', { count: 1 })], T0 + 60_000), []);
  assert.deepEqual(zpracuj(s, [n('a', { count: 3 })], T0 + 120_000).map((x) => x.id), ['a']);
});

test('přetokový souhrn po přečtení a návratu s vyšším počtem se ohlásí', () => {
  const s = novyStav();
  zpracuj(s, [n('of', { count: 5, type: 'overflow', created: cas(-3_600_000) })], T0);
  assert.deepEqual(zpracuj(s, [], T0 + 60_000), [], 'přečteno — zmizel ze seznamu');
  const nove = zpracuj(s, [n('of', { count: 6, type: 'overflow', created: cas(-3_600_000) })], T0 + 120_000);
  assert.deepEqual(nove.map((x) => x.id), ['of']);
});

test('pozdravení bez čísla a nesmysly v odpovědi nespadnou', () => {
  const s = novyStav();
  zpracuj(s, null, T0);
  assert.deepEqual(zpracuj(s, [null, { id: 5 }, n('a', { count: 'x', created: cas(10) })], T0 + 60_000).map((x) => x.id), ['a']);
});

test('rozdělení na jednotlivá upozornění a souhrn', () => {
  const pet = ['1', '2', '3', '4', '5'].map((id) => n(id));
  const r = rozdelUpozorneni(pet);
  assert.equal(r.jednotlive.length, MAX_UPOZORNENI);
  assert.equal(r.dalsich, 2);
  assert.deepEqual(rozdelUpozorneni([n('1')]), { jednotlive: [n('1')], dalsich: 0 });
});

const hlidacSOdpovedmi = (odpovedi) => {
  const zaznam = { ukaz: [], odznak: [], novaVerze: 0, odmitnuto: 0 };
  let i = 0;
  const h = new Hlidac({
    dotaz: async () => odpovedi[Math.min(i++, odpovedi.length - 1)],
    ukaz: (nove) => zaznam.ukaz.push(nove.map((x) => x.id)),
    odznak: (p) => zaznam.odznak.push(p),
    novaVerze: () => { zaznam.novaVerze++; },
    odmitnuto: () => { zaznam.odmitnuto++; },
  });
  return { h, zaznam };
};

test('hlídač: nová verze serveru se neohlašuje, jen spustí obnovení', async () => {
  const { h, zaznam } = hlidacSOdpovedmi([
    { stav: 'ok', uzivatel: 'u1', polozky: [], celkem: 0, serverCas: T0 },
    { stav: 'ok', uzivatel: 'u1', polozky: [n('v', { type: 'new_version', created: cas(5000) }), n('b', { created: cas(6000) })], celkem: 2, serverCas: T0 + 60_000 },
  ]);
  await h.kolo();
  await h.kolo();
  assert.deepEqual(zaznam.ukaz, [['b']]);
  assert.equal(zaznam.novaVerze, 1);
  assert.deepEqual(zaznam.odznak, [0, 2]);
});

test('hlídač: vypršelé přihlášení ohlásí jednou, po novém přihlášení znovu hlídá', async () => {
  const { h, zaznam } = hlidacSOdpovedmi([
    { stav: 'odmitnuto', uzivatel: 'u1' },
    { stav: 'odmitnuto', uzivatel: 'u1' },
    { stav: 'ok', uzivatel: 'u1', polozky: [], celkem: 0, serverCas: T0 },
    { stav: 'odmitnuto', uzivatel: 'u1' },
  ]);
  for (let k = 0; k < 4; k++) await h.kolo();
  assert.equal(zaznam.odmitnuto, 2, 'jednou za každé vypršení, ne každou minutu');
});

test('hlídač: jiný přihlášený člověk = nový výchozí stav (žádná cizí upozornění)', async () => {
  const { h, zaznam } = hlidacSOdpovedmi([
    { stav: 'ok', uzivatel: 'u1', polozky: [n('a')], celkem: 1, serverCas: T0 },
    { stav: 'ok', uzivatel: 'u2', polozky: [n('x', { created: cas(30_000) })], celkem: 1, serverCas: T0 + 60_000 },
  ]);
  await h.kolo();
  await h.kolo();
  assert.deepEqual(zaznam.ukaz, [], 'první dotaz za nového člověka jen zapamatuje');
});

test('hlídač: chyba sítě drží stav a nic neohlásí', async () => {
  const { h, zaznam } = hlidacSOdpovedmi([
    { stav: 'ok', uzivatel: 'u1', polozky: [n('a')], celkem: 1, serverCas: T0 },
    { stav: 'chyba' },
    { stav: 'ok', uzivatel: 'u1', polozky: [n('a')], celkem: 1, serverCas: T0 + 120_000 },
  ]);
  for (let k = 0; k < 3; k++) await h.kolo();
  assert.deepEqual(zaznam.ukaz, []);
  assert.deepEqual(zaznam.odznak, [1, 1]);
});

test('hlídač: odhlášení vynuluje odznak', async () => {
  const { h, zaznam } = hlidacSOdpovedmi([
    { stav: 'ok', uzivatel: 'u1', polozky: [n('a')], celkem: 1, serverCas: T0 },
    { stav: 'neprihlasen' },
  ]);
  await h.kolo();
  await h.kolo();
  assert.deepEqual(zaznam.odznak, [1, 0]);
});

test('hlídač: stránka se ještě načítá → zkusit znovu za pár sekund, ne za minutu', async () => {
  const planovano = [];
  const h = new Hlidac({ dotaz: async () => ({ stav: 'nelze' }), ukaz() {}, odznak() {}, novaVerze() {}, odmitnuto() {} });
  h.naplanuj = (ms) => planovano.push(ms);
  h.bezi = true;
  await h.kolo();
  assert.deepEqual(planovano, [ZNOVU_PO_NELZE_MS]);
  h.dotaz = async () => ({ stav: 'ok', uzivatel: 'u1', polozky: [], celkem: 0, serverCas: T0 });
  await h.kolo();
  assert.deepEqual(planovano, [ZNOVU_PO_NELZE_MS, 60_000], 'po úspěchu zase po minutě');
});

test('hlídač: přepnutí organizace během kola — výsledek staré firmy se zahodí', async () => {
  const zaznam = { ukaz: [], odznak: [] };
  let pust;
  const h = new Hlidac({
    dotaz: () => new Promise((hotovo) => { pust = hotovo; }),
    ukaz: (nove) => zaznam.ukaz.push(nove.map((x) => x.id)),
    odznak: (p) => zaznam.odznak.push(p),
    novaVerze() {}, odmitnuto() {},
  });
  const planovano = [];
  h.naplanuj = (ms) => planovano.push(ms);
  h.bezi = true;
  const kolo = h.kolo();
  h.reset(); // přepnuto na jinou firmu, zatímco se čeká na server té staré
  pust({ stav: 'ok', uzivatel: 'stary', polozky: [n('a')], celkem: 7, serverCas: T0 });
  await kolo;
  assert.deepEqual(zaznam.odznak, [0], 'odznak nesmí ukázat počet staré firmy');
  assert.equal(h.uzivatel, null, 'výchozí stav se nebere ze staré firmy');
  assert.equal(h.stav.videne, null);
  assert.equal(planovano[planovano.length - 1], ZNOVU_PO_NELZE_MS, 'nová firma se zeptá hned');
});

test('hlídač: reset a nepřihlášený se ptají hned, ne za minutu', async () => {
  const planovano = [];
  const h = new Hlidac({ dotaz: async () => ({ stav: 'neprihlasen' }), ukaz() {}, odznak() {}, novaVerze() {}, odmitnuto() {} });
  h.naplanuj = (ms) => planovano.push(ms);
  h.bezi = true;
  h.reset();
  assert.deepEqual(planovano, [ZNOVU_PO_NELZE_MS], 'reset přeplánuje');
  await h.kolo();
  assert.deepEqual(planovano, [ZNOVU_PO_NELZE_MS, ZNOVU_PO_NELZE_MS], 'stránka přihlášení: zkoušet často');
});

test('hlídač: ted() během běžícího kola se neztratí', async () => {
  const planovano = [];
  let pust;
  const h = new Hlidac({ dotaz: () => new Promise((hotovo) => { pust = hotovo; }), ukaz() {}, odznak() {}, novaVerze() {}, odmitnuto() {} });
  h.naplanuj = (ms) => planovano.push(ms);
  h.bezi = true;
  const kolo = h.kolo();
  h.ted(); // probuzení počítače během dotazu
  pust({ stav: 'ok', uzivatel: 'u1', polozky: [], celkem: 0, serverCas: T0 });
  await kolo;
  assert.equal(planovano[planovano.length - 1], ZNOVU_PO_NELZE_MS, 'po kole se zeptat hned znovu, ne za minutu');
});
