import assert from 'node:assert/strict';
import { test } from 'node:test';
import { obnovRozmery, rezimListy, titulekOkna } from '../lib/okno.js';

const PRIMARNI = { x: 0, y: 0, width: 1920, height: 1040 };
const DRUHY = { x: 1920, y: 0, width: 2560, height: 1400 };

test('bez uložené polohy: vycentrovat na primárním monitoru', () => {
  assert.deepEqual(obnovRozmery(null, [PRIMARNI]), { x: 320, y: 90, width: 1280, height: 860, maximized: false });
});

test('malá obrazovka: výchozí velikost se zmenší', () => {
  const r = obnovRozmery(null, [{ x: 0, y: 0, width: 1366, height: 728 }]);
  assert.equal(r.width, 1280);
  assert.equal(r.height, 728);
});

test('uložená poloha na existujícím monitoru zůstane', () => {
  const ulozene = { x: 2000, y: 100, width: 1400, height: 900, maximized: true };
  assert.deepEqual(obnovRozmery(ulozene, [PRIMARNI, DRUHY]), ulozene);
});

test('odpojený monitor: okno se vrátí na obrazovku', () => {
  const ulozene = { x: 2000, y: 100, width: 1400, height: 900, maximized: false };
  const r = obnovRozmery(ulozene, [PRIMARNI]);
  assert.deepEqual(r, { x: 320, y: 90, width: 1280, height: 860, maximized: false });
});

test('okno přesahující okraj se zarovná dovnitř', () => {
  const r = obnovRozmery({ x: 1500, y: 600, width: 1000, height: 700 }, [PRIMARNI]);
  assert.deepEqual(r, { x: 920, y: 340, width: 1000, height: 700, maximized: false });
});

test('bez monitorů (nemělo by nastat) se vrátí výchozí velikost', () => {
  assert.deepEqual(obnovRozmery(null, []), { width: 1280, height: 860, maximized: false });
});

test('titulek okna nese adresu organizace', () => {
  assert.equal(titulekOkna('Úkoly', 'tengo.killbottleneck.com'), 'Úkoly — tengo.killbottleneck.com');
  assert.equal(titulekOkna('', 'tengo.killbottleneck.com'), 'killBottleneck — tengo.killbottleneck.com');
  assert.equal(titulekOkna('Mapa', ''), 'Mapa');
});

test('barva lišty okna podle stránky', () => {
  assert.equal(rezimListy('#1d2638'), 'dark', 'výchozí tmavý killBottleneck');
  assert.equal(rezimListy('#121F32'), 'dark');
  assert.equal(rezimListy('#f7f3ea'), 'light', 'světlý vzhled');
  assert.equal(rezimListy(null), 'dark');
  assert.equal(rezimListy('nesmysl'), 'dark');
});
