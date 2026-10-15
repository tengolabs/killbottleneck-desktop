// Smlouva preloadu: co přesně dostane stránka serveru a co místní stránka. Preload se spustí
// v izolovaném kontextu s podvrženým `electron` a zaznamená, co vystaví a co pošle.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const ZDROJ = readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8');

function spust(protocol) {
  const vystaveno = {};
  const poslano = [];
  const posluchaci = {};
  const udalosti = [];
  const historie = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (jmeno, api) => { vystaveno[jmeno] = api; } },
    ipcRenderer: {
      invoke: (...a) => { poslano.push(a); return Promise.resolve(); },
      send: (...a) => { poslano.push(a); },
      on: (kanal, fn) => { posluchaci[kanal] = fn; },
    },
  };
  class Udalost { constructor(typ) { this.type = typ; } }
  const kontext = {
    require: (m) => { if (m === 'electron') return electron; throw new Error(`require ${m}`); },
    process: { argv: ['electron', '--kb-verze=1.2.3'] },
    location: { protocol },
    window: { dispatchEvent: (e) => udalosti.push(e.type) },
    history: { pushState: (_s, _t, cesta) => historie.push(cesta) },
    Event: Udalost,
    PopStateEvent: Udalost,
  };
  vm.runInNewContext(ZDROJ, kontext);
  return { vystaveno, poslano, posluchaci, udalosti, historie };
}

test('stránka serveru dostane jen malé API kbDesktop', () => {
  const { vystaveno } = spust('https:');
  assert.deepEqual(Object.keys(vystaveno), ['kbDesktop']);
  assert.deepEqual(Object.keys(vystaveno.kbDesktop).sort(),
    ['api', 'changeOrganization', 'flushDone', 'supportsFlush', 'takeOpenRequest', 'version'].sort());
  assert.equal(vystaveno.kbDesktop.api, 1);
  assert.equal(vystaveno.kbDesktop.version, '1.2.3');
  assert.ok(Object.isFrozen(vystaveno.kbDesktop));
});

test('místní stránka dostane kbApp, ne kbDesktop', () => {
  const { vystaveno } = spust('kb-app:');
  assert.deepEqual(Object.keys(vystaveno), ['kbApp']);
  assert.ok(typeof vystaveno.kbApp.overFirmu === 'function');
});

test('jiná schémata nedostanou nic', () => {
  for (const p of ['file:', 'about:', 'data:', 'blob:']) assert.deepEqual(Object.keys(spust(p).vystaveno), [], p);
});

test('klik na upozornění: událost bez dat, data si stránka vyzvedne jednou', () => {
  const { vystaveno, posluchaci, udalosti, poslano } = spust('https:');
  posluchaci['kb:open']({}, { id: 'abc' });
  assert.deepEqual(udalosti, ['kb-desktop-open']);
  assert.deepEqual(JSON.parse(JSON.stringify(vystaveno.kbDesktop.takeOpenRequest())), { id: 'abc' });
  assert.equal(vystaveno.kbDesktop.takeOpenRequest(), null);
  assert.deepEqual(poslano.at(-1), ['kb:openTaken', 'abc']);
  posluchaci['kb:open']({}, { id: 42 });
  assert.equal(udalosti.length, 1, 'nesmyslné id se zahodí');
});

test('uložení rozdělané práce vrací totéž číslo požadavku', () => {
  const { vystaveno, posluchaci, udalosti, poslano } = spust('https:');
  posluchaci['kb:flush']({}, 7);
  assert.deepEqual(udalosti, ['kb-desktop-flush-request']);
  vystaveno.kbDesktop.flushDone();
  assert.deepEqual(poslano.at(-1), ['kb:flushDone', 7]);
});

test('přechod uvnitř webu jen na cestu téhož serveru', () => {
  const { posluchaci, historie, udalosti } = spust('https:');
  posluchaci['kb:navigate']({}, '/notifications');
  posluchaci['kb:navigate']({}, '//evil.cz/x');
  posluchaci['kb:navigate']({}, 'https://evil.cz/');
  posluchaci['kb:navigate']({}, 42);
  assert.deepEqual(historie, ['/notifications']);
  assert.deepEqual(udalosti, ['popstate']);
});

test('probuzení počítače = událost, kterou už poslouchá web', () => {
  const { posluchaci, udalosti } = spust('https:');
  posluchaci['kb:resume']();
  assert.deepEqual(udalosti, ['kb-native-resume']);
});
