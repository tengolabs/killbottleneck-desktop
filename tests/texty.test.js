// Texty a místní stránky: obě jazykové verze mají tytéž klíče, stránky používají jen
// existující klíče a nemají nic inline (CSP místních stránek inline skripty ani styly nepustí).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { jazykZLocale, vytvorPreklad } from '../lib/i18n.js';

const klice = (o, predpona = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? klice(v, `${predpona}${k}.`) : [`${predpona}${k}`]));
const nacti = (j) => JSON.parse(readFileSync(new URL(`../i18n/${j}.json`, import.meta.url), 'utf8'));

test('čeština a angličtina mají tytéž klíče', () => {
  assert.deepEqual(klice(nacti('cs')).sort(), klice(nacti('en')).sort());
});

test('jazyk podle Windows', () => {
  assert.equal(jazykZLocale('cs-CZ'), 'cs');
  assert.equal(jazykZLocale('sk'), 'cs');
  assert.equal(jazykZLocale('en-US'), 'en');
  assert.equal(jazykZLocale('de-DE'), 'en');
  assert.equal(jazykZLocale(undefined), 'en');
});

test('překlad s parametry a záložní angličtina', () => {
  const { t } = vytvorPreklad('cs');
  assert.equal(t('tray.tooltipN', { n: 3 }), 'killBottleneck — nepřečtená upozornění: 3');
  assert.equal(t('neexistuje.klic'), 'neexistuje.klic');
  assert.equal(vytvorPreklad('xx').jazyk, 'en');
});

test('místní stránky: klíče existují a nic není inline', () => {
  const stranky = nacti('cs').stranky;
  const slozka = new URL('../ui/', import.meta.url);
  for (const soubor of readdirSync(slozka).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(new URL(soubor, slozka), 'utf8');
    for (const [, klic] of html.matchAll(/data-t="([^"]+)"/g)) {
      const hodnota = klic.split('.').reduce((o, k) => (o ? o[k] : undefined), stranky);
      assert.equal(typeof hodnota, 'string', `${soubor}: chybí text ${klic}`);
    }
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${soubor}: inline skript`);
    assert.doesNotMatch(html, /\sstyle=/i, `${soubor}: inline styl`);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${soubor}: inline obsluha události`);
  }
  for (const soubor of readdirSync(slozka).filter((f) => f.endsWith('.js'))) {
    const js = readFileSync(new URL(soubor, slozka), 'utf8');
    assert.doesNotMatch(js, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\(|document\.write\(/, `${soubor}: vkládání HTML`);
  }
});
