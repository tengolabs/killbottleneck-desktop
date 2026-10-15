import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLOUD_SUFFIX, MIN_SLUG, adresaFirmy, jePrivatniIp, normalizujAdresu, slugifyCompany, vseDoPrivatniSite,
} from '../lib/adresa.js';

test('slugify jako web a signup.py', () => {
  const pripady = [
    ['Šťastná Kavárna s.r.o.', 'stastna-kavarna'],
    ['Novák & Syn, spol. s r.o.', 'novak-syn'],
    ['Dlouhé Jméno Firmy Které Přeteče Třicet Znaků', 'dlouhe-jmeno-firmy-ktere-prete'],
    ['Železárny a.s.', 'zelezarny'],
    ['Tengo, s.r.o.', 'tengo'],
    ['A -- B ---- C', 'a-b-c'],
    ['', ''],
  ];
  for (const [vstup, ocekavane] of pripady) assert.equal(slugifyCompany(vstup), ocekavane, vstup);
  assert.equal(MIN_SLUG, 3);
  assert.equal(CLOUD_SUFFIX, '.killbottleneck.com');
});

test('název firmy → adresa v cloudu', () => {
  assert.equal(adresaFirmy('Moje Firma s.r.o.'), 'https://moje-firma.killbottleneck.com');
  assert.equal(adresaFirmy('ab'), null, 'pod minimem serveru');
  assert.equal(adresaFirmy('  '), null);
});

test('vložená adresa z prohlížeče v poli firmy znamená tu firmu', () => {
  assert.equal(adresaFirmy('tengo.killbottleneck.com'), 'https://tengo.killbottleneck.com');
  assert.equal(adresaFirmy('https://tengo.killbottleneck.com/'), 'https://tengo.killbottleneck.com');
  assert.equal(adresaFirmy('Tengo.KillBottleneck.com'), 'https://tengo.killbottleneck.com');
  assert.equal(adresaFirmy('https://tengo.killbottleneck.com/login'), 'https://tengo.killbottleneck.com', 'zkopírovaná adresa přihlášení');
  assert.equal(adresaFirmy('tengo.killbottleneck.com/projects?x=1#a'), 'https://tengo.killbottleneck.com');
  assert.notEqual(adresaFirmy('tengo.killbottleneck.com.evil.cz'), 'https://tengo.killbottleneck.com', 'cizí doména není naše adresa');
});

test('ruční adresa: chyby', () => {
  assert.deepEqual(normalizujAdresu(''), { ok: false, chyba: 'prazdne' });
  assert.deepEqual(normalizujAdresu('   '), { ok: false, chyba: 'prazdne' });
  assert.equal(normalizujAdresu('https://kb.firma.cz/login').chyba, 'neplatne');
  assert.equal(normalizujAdresu('kb.firma.cz/?x=1').chyba, 'neplatne');
  assert.equal(normalizujAdresu('kb.firma.cz/#a').chyba, 'neplatne');
  assert.equal(normalizujAdresu('http://8.8.8.8').chyba, 'httpVerejne');
  assert.equal(normalizujAdresu('http://[2001:db8::1]:8090').chyba, 'httpVerejne');
});

test('ruční adresa: úspěch', () => {
  assert.deepEqual(normalizujAdresu('tengo'), { ok: true, url: 'https://tengo.killbottleneck.com' });
  assert.deepEqual(normalizujAdresu('kb.firma.cz/'), { ok: true, url: 'https://kb.firma.cz' });
  assert.deepEqual(normalizujAdresu('HTTPS://KB.Firma.cz:8443'), { ok: true, url: 'https://kb.firma.cz:8443' });
  assert.deepEqual(normalizujAdresu('http://192.168.1.20:8090'), { ok: true, url: 'http://192.168.1.20:8090' });
  assert.deepEqual(normalizujAdresu('http://100.90.1.2:8090'), { ok: true, url: 'http://100.90.1.2:8090' });
  assert.deepEqual(normalizujAdresu('http://localhost:8090'), { ok: true, url: 'http://localhost:8090' });
  assert.deepEqual(normalizujAdresu('http://server.local'), { ok: true, url: 'http://server.local' });
  assert.deepEqual(normalizujAdresu('http://[fd00::5]:8090'), { ok: true, url: 'http://[fd00::5]:8090' });
});

test('http na jméno se musí ověřit přes DNS', () => {
  assert.deepEqual(normalizujAdresu('http://server.lan:8090'), { ok: true, url: 'http://server.lan:8090', overitPrivatni: true });
  assert.deepEqual(normalizujAdresu('http://intranet.firma.cz'), { ok: true, url: 'http://intranet.firma.cz', overitPrivatni: true });
  assert.equal(vseDoPrivatniSite([{ address: '10.1.0.5' }, { address: 'fd00::5' }]), true);
  assert.equal(vseDoPrivatniSite([{ address: '10.1.0.5' }, { address: '93.184.216.34' }]), false, 'jedna veřejná stačí k odmítnutí');
  assert.equal(vseDoPrivatniSite([]), false);
  assert.equal(vseDoPrivatniSite(null), false);
});

test('privátní IP adresy', () => {
  for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '100.64.0.1', '100.127.255.254', '127.0.0.1', '169.254.1.1',
    '::1', '[::1]', 'fd00::1', 'fc12::1', 'fe80::1', '::ffff:10.1.0.1', '::ffff:a00:1']) {
    assert.equal(jePrivatniIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '192.169.0.1', '2001:db8::1', '::ffff:8.8.8.8', '300.1.1.1', 'server.lan', '']) {
    assert.equal(jePrivatniIp(ip), false, ip);
  }
});
