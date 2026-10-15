import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Brzda, MAX_STAZENI_ZA_MINUTU, MISTNI_ORIGIN, mistniSoubor, rozhodniStahovani, zonaInternet, originOf, rozhodniNavigaci, rozhodniOtevreni, smiKanal, smiOpravneni, smiVen,
} from '../lib/politika.js';

const SERVER = 'https://tengo.killbottleneck.com';

test('původ adresy', () => {
  assert.equal(originOf('https://tengo.killbottleneck.com/map/abc?x=1'), SERVER);
  assert.equal(originOf('http://10.1.2.20:2056/'), 'http://10.1.2.20:2056');
  assert.equal(originOf('kb-app://app/vyber.html'), MISTNI_ORIGIN);
  assert.equal(originOf('file:///C:/x'), null);
  assert.equal(originOf('nesmysl'), null);
});

test('ven smí jen web a pošta', () => {
  for (const ok of ['https://killbottleneck.com/', 'http://example.com/a', 'mailto:info@killbottleneck.com']) assert.equal(smiVen(ok), true, ok);
  for (const ne of ['file:///C:/Windows/System32/calc.exe', 'ms-msdt:/id PCWDiagnostic', 'search-ms:query=x', 'javascript:alert(1)',
    'data:text/html,x', '\\\\server\\share\\x.exe', 'ms-settings:privacy', 'kb-app://app/vyber.html', 'vbscript:x', '', null]) {
    assert.equal(smiVen(ne), false, String(ne));
  }
  assert.equal(smiVen(`https://example.com/${'a'.repeat(5000)}`), false, 'nesmyslně dlouhá adresa');
});

test('navigace hlavního okna', () => {
  assert.equal(rozhodniNavigaci(`${SERVER}/tasks`, SERVER), 'povolit');
  assert.equal(rozhodniNavigaci('https://checkout.stripe.com/pay/x', SERVER), 'ven');
  assert.equal(rozhodniNavigaci('mailto:a@b.cz', SERVER), 'ven');
  assert.equal(rozhodniNavigaci('https://tengo.killbottleneck.com.evil.cz/', SERVER), 'ven', 'podobná doména není náš server');
  assert.equal(rozhodniNavigaci('http://tengo.killbottleneck.com/', SERVER), 'ven', 'jiné schéma = jiný původ');
  assert.equal(rozhodniNavigaci('kb-app://app/vyber.html', SERVER), 'zakazat', 'místní stránky otevírá jen rám');
  assert.equal(rozhodniNavigaci('file:///C:/x', SERVER), 'zakazat');
  assert.equal(rozhodniNavigaci(`${SERVER}/`, null), 'ven', 'bez aktivní organizace nic nezůstane v okně');
});

test('window.open / target=_blank', () => {
  assert.equal(rozhodniOtevreni('about:blank', SERVER), 'tise');
  assert.equal(rozhodniOtevreni('', SERVER), 'tise');
  assert.equal(rozhodniOtevreni(`${SERVER}/api/files/pbc_1/abc/smlouva.pdf?token=x`, SERVER), 'stahnout');
  assert.equal(rozhodniOtevreni(`${SERVER}/map/abc`, SERVER), 'vOkne');
  assert.equal(rozhodniOtevreni('https://accounts.google.com/o/oauth2/auth?x=1', SERVER), 'ven');
  assert.equal(rozhodniOtevreni('javascript:alert(1)', SERVER), 'zakazat');
  assert.equal(rozhodniOtevreni('ms-msdt:/id x', SERVER), 'zakazat');
});

test('kdo smí volat který kanál', () => {
  const mistni = { frameUrl: 'kb-app://app/vyber.html', hlavniRamec: true };
  const server = { frameUrl: `${SERVER}/tasks`, hlavniRamec: true };
  assert.equal(smiKanal(mistni, 'mistni', SERVER), true);
  assert.equal(smiKanal(server, 'server', SERVER), true);
  assert.equal(smiKanal(server, 'mistni', SERVER), false, 'server na privilegované kanály nedosáhne');
  assert.equal(smiKanal(mistni, 'server', SERVER), false);
  assert.equal(smiKanal({ ...server, hlavniRamec: false }, 'server', SERVER), false, 'iframe nic nezavolá');
  assert.equal(smiKanal({ ...mistni, hlavniRamec: false }, 'mistni', SERVER), false);
  assert.equal(smiKanal({ frameUrl: 'https://jiny.killbottleneck.com/', hlavniRamec: true }, 'server', SERVER), false);
  assert.equal(smiKanal(server, 'server', null), false);
  assert.equal(smiKanal(server, 'neznamy', SERVER), false);
});

test('oprávnění stránky', () => {
  const nas = { origin: SERVER, aktivniOrigin: SERVER };
  assert.equal(smiOpravneni('media', { ...nas, mediaTypes: ['audio'], vPopredi: true }), true, 'hlasovky');
  assert.equal(smiOpravneni('media', { ...nas, mediaTypes: ['audio'], vPopredi: false }), false, 'skryté okno nenahrává');
  assert.equal(smiOpravneni('media', { ...nas, mediaTypes: ['audio'] }), false, 'žádost bez údaje o okně = ne');
  assert.equal(smiOpravneni('media', { ...nas, mediaTypes: ['video'], vPopredi: true }), false, 'kamera ne');
  assert.equal(smiOpravneni('media', { ...nas, mediaTypes: ['audio', 'video'], vPopredi: true }), false);
  assert.equal(smiOpravneni('media', { ...nas, mediaTypes: [], vPopredi: true }), false);
  assert.equal(smiOpravneni('media', { ...nas, mediaType: 'audio' }), true, 'kontrola (check handler)');
  assert.equal(smiOpravneni('media', { ...nas, mediaType: 'video' }), false);
  assert.equal(smiOpravneni('media', { origin: 'https://evil.cz', aktivniOrigin: SERVER, mediaTypes: ['audio'], vPopredi: true }), false);
  assert.equal(smiOpravneni('clipboard-sanitized-write', nas), true);
  assert.equal(smiOpravneni('fullscreen', nas), true);
  assert.equal(smiOpravneni('openExternal', { ...nas, externalURL: 'mailto:a@b.cz' }), true);
  assert.equal(smiOpravneni('openExternal', { ...nas, externalURL: 'ms-msdt:/id x' }), false);
  for (const ne of ['notifications', 'geolocation', 'clipboard-read', 'display-capture', 'midi', 'hid', 'serial', 'usb', 'unknown']) {
    assert.equal(smiOpravneni(ne, nas), false, ne);
  }
  assert.equal(smiOpravneni('fullscreen', { origin: MISTNI_ORIGIN, aktivniOrigin: SERVER }), false);
  assert.equal(smiOpravneni('media', {}), false);
});

test('stahování: dávka bez dialogu jen viditelně, jen dokumenty, se stropem', () => {
  const zaklad = { jmeno: 'mapa.pdf', davka: false, skryte: false, zaMinutu: 1 };
  assert.equal(rozhodniStahovani(zaklad), 'dialog', 'jeden soubor = Uložit jako');
  assert.equal(rozhodniStahovani({ ...zaklad, davka: true }), 'stazene', 'rozdělené PDF rovnou do Stažených');
  assert.equal(rozhodniStahovani({ ...zaklad, davka: true, jmeno: 'Mapa.PPTX' }), 'stazene');
  for (const jmeno of ['setup.exe', 'version.dll', 'faktura.pdf.exe', 'odkaz.url', 'x.lnk', 'x.scf', 'x.library-ms',
    'x.hta', 'x.js', 'x.cmd', 'x.bat', 'x.ps1', 'x.msi', 'x.html', 'x.svg', 'bezpripony', 'x.pdf.']) {
    assert.equal(rozhodniStahovani({ ...zaklad, davka: true, jmeno }), 'dialog', jmeno);
  }
  assert.equal(rozhodniStahovani({ ...zaklad, skryte: true }), 'zrusit', 'skryté okno nestahuje nic');
  assert.equal(rozhodniStahovani({ ...zaklad, davka: true, skryte: true }), 'zrusit');
  assert.equal(rozhodniStahovani({ ...zaklad, davka: true, zaMinutu: MAX_STAZENI_ZA_MINUTU }), 'stazene');
  assert.equal(rozhodniStahovani({ ...zaklad, davka: true, zaMinutu: MAX_STAZENI_ZA_MINUTU + 1 }), 'zrusit', 'strop');
  assert.equal(rozhodniStahovani({ ...zaklad, zaMinutu: MAX_STAZENI_ZA_MINUTU + 1 }), 'zrusit', 'ani dialogy bez konce');
});

test('značka „staženo z internetu“', () => {
  assert.equal(zonaInternet('https://tengo.killbottleneck.com/api/files/c/r/a.pdf?token=TAJNE&x=1'),
    '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://tengo.killbottleneck.com/api/files/c/r/a.pdf\r\n');
  assert.equal(zonaInternet('blob:https://x.cz/123'), '[ZoneTransfer]\r\nZoneId=3\r\n', 'blob bez adresy');
  assert.equal(zonaInternet('nesmysl'), '[ZoneTransfer]\r\nZoneId=3\r\n');
  assert.ok(!/[\r\n]HostUrl=.*[\r\n]./.test(zonaInternet('https://x.cz/a%0d%0aZoneId=0')), 'adresa nevloží řádek');
});

test('brzda odkazů ven', () => {
  let ted = 0;
  const b = new Brzda({ rozestupMs: 2000, zaMinutu: 3 }, () => ted);
  assert.equal(b.povol(), true);
  ted = 500;
  assert.equal(b.povol(), false, 'moc brzy po předchozím');
  ted = 2500;
  assert.equal(b.povol(), true);
  ted = 5000;
  assert.equal(b.povol(), true);
  ted = 8000;
  assert.equal(b.povol(), false, 'strop za minutu');
  ted = 61_000;
  assert.equal(b.povol(), true, 'po minutě zase smí');
});

test('místní soubory jen z ui/ a bez triků', () => {
  assert.equal(mistniSoubor('kb-app://app/vyber.html'), 'vyber.html');
  assert.equal(mistniSoubor('kb-app://app/styl.css?v=1'), 'styl.css');
  // „..“ vyřeší už URL — cesta zůstane uvnitř ui/ (ui/main.js neexistuje → 404), ven se nedostane
  assert.equal(mistniSoubor('kb-app://app/../main.js'), 'main.js');
  assert.equal(mistniSoubor('kb-app://app/%2e%2e/%2e%2e/main.js'), 'main.js');
  for (const ne of ['kb-app://app/..%5cmain.js', 'kb-app://app/x%2f..%2f..%2fmain.js', 'kb-app://jiny/vyber.html',
    'kb-app://app/main.js.map', 'kb-app://app/', 'https://app/vyber.html', 'kb-app://app/%E0%A4%A', 'kb-app://app/.skryty.js']) {
    assert.equal(mistniSoubor(ne), null, ne);
  }
  for (const u of ['kb-app://app/a/../../b.js', 'kb-app://app/%2e%2e%2fb.js', 'kb-app://app//b.js']) {
    const v = mistniSoubor(u);
    assert.ok(v === null || (!v.includes('..') && !v.startsWith('/')), `${u} → ${v}`);
  }
});
