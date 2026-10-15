import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { nacti, odeberOrganizaci, pridejOrganizaci, uloz, vycisti } from '../lib/nastaveni.js';

test('výchozí nastavení', () => {
  assert.deepEqual(vycisti(null), {
    verze: 1, organizace: [], aktivni: null, okno: null, autostartAuto: false, zavreniOznameno: false, poAktualizaciSkryte: false,
  });
});

test('podvržený nebo poškozený obsah se pročistí', () => {
  const v = vycisti({
    organizace: [
      { origin: 'https://a.killbottleneck.com/cesta', nazev: 'A' },
      { origin: 'https://a.killbottleneck.com', nazev: 'duplicita' },
      { origin: 'file:///C:/x' },
      { origin: 'javascript:alert(1)' },
      { origin: 42 },
      null,
      { origin: 'http://10.1.2.20:2056', nazev: 'x'.repeat(500) },
    ],
    aktivni: 'https://neexistuje.cz',
    okno: { x: 'a', y: 0, width: 10, height: 10 },
  });
  assert.deepEqual(v.organizace.map((o) => o.origin), ['https://a.killbottleneck.com', 'http://10.1.2.20:2056']);
  assert.equal(v.organizace[1].nazev.length, 120);
  assert.equal(v.aktivni, 'https://a.killbottleneck.com', 'neznámá aktivní → první v seznamu');
  assert.equal(v.okno, null);
});

test('nejvýš 20 organizací', () => {
  const v = vycisti({ organizace: Array.from({ length: 30 }, (_, i) => ({ origin: `https://o${i}.killbottleneck.com` })) });
  assert.equal(v.organizace.length, 20);
});

test('přidání a odebrání organizace', () => {
  let s = vycisti(null);
  s = pridejOrganizaci(s, { origin: 'https://a.killbottleneck.com', nazev: 'A' });
  s = pridejOrganizaci(s, { origin: 'https://b.killbottleneck.com', nazev: 'B' });
  assert.equal(s.aktivni, 'https://b.killbottleneck.com');
  assert.deepEqual(s.organizace.map((o) => o.nazev), ['B', 'A']);
  s = pridejOrganizaci(s, { origin: 'https://a.killbottleneck.com' });
  assert.equal(s.aktivni, 'https://a.killbottleneck.com');
  assert.deepEqual(s.organizace.map((o) => o.nazev), ['A', 'B'], 'znovu zvolená si drží název a jde nahoru');
  s = odeberOrganizaci(s, 'https://a.killbottleneck.com');
  assert.equal(s.aktivni, 'https://b.killbottleneck.com', 'odebraná aktivní předá místo další');
  s = odeberOrganizaci(s, 'https://b.killbottleneck.com');
  assert.equal(s.aktivni, null);
  assert.equal(pridejOrganizaci(s, { origin: 'file:///x' }).organizace.length, 0);
});

test('zápis a čtení ze souboru; poškozený soubor = výchozí', () => {
  const slozka = mkdtempSync(join(tmpdir(), 'kb-nast-'));
  try {
    const cesta = join(slozka, 'pod', 'nastaveni.json');
    const data = pridejOrganizaci(vycisti(null), { origin: 'https://a.killbottleneck.com', nazev: 'A' });
    uloz(cesta, { ...data, okno: { x: 10, y: 20, width: 1200, height: 800, maximized: true } });
    const nactene = nacti(cesta);
    assert.equal(nactene.aktivni, 'https://a.killbottleneck.com');
    assert.deepEqual(nactene.okno, { x: 10, y: 20, width: 1200, height: 800, maximized: true });
    assert.ok(readFileSync(cesta, 'utf8').endsWith('\n'));
    writeFileSync(cesta, '{ rozbité');
    assert.deepEqual(nacti(cesta), vycisti(null));
    assert.deepEqual(nacti(join(slozka, 'neni.json')), vycisti(null));
  } finally {
    rmSync(slozka, { recursive: true, force: true });
  }
});
