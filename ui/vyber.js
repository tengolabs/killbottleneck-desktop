// Výběr organizace: název firmy (jako přihlášení na webu) nebo ruční adresa vlastního serveru.
// Ověřování dělá hlavní proces (DNS, kontrola serveru) — stránka jen zobrazuje výsledek.
'use strict';
(async () => {
  const { info, t } = await window.kbStranka;
  const $ = (id) => document.getElementById(id);
  const REZIM = 'kb-vyber-rezim';

  const formFirma = $('formFirma');
  const formAdresa = $('formAdresa');
  const firma = $('firma');
  const adresa = $('adresa');

  const ukazChybu = (el, r, varovani = false) => {
    const kod = r && r.chyba ? r.chyba : 'jine';
    const text = t(`vyber.chyby.${kod}`, { host: (r && r.host) || '' });
    el.textContent = text.startsWith('vyber.') ? t('vyber.chyby.jine') : text;
    el.classList.toggle('varovani', varovani);
    el.hidden = false;
  };
  const skryjChybu = (el) => { el.hidden = true; el.textContent = ''; };

  const prepniRezim = (rucne) => {
    formFirma.hidden = rucne;
    formAdresa.hidden = !rucne;
    try { localStorage.setItem(REZIM, rucne ? 'rucne' : 'firma'); } catch { /* jen pohodlí */ }
    (rucne ? adresa : firma).focus();
  };

  // Server se starší verzí: první „Pokračovat“ jen varuje, druhé na TÝŽ server připojí.
  let potvrzenoStarsi = null;

  async function odesli({ tlacitko, chybaEl, overit, nazev }) {
    skryjChybu(chybaEl);
    tlacitko.disabled = true;
    tlacitko.textContent = t('vyber.overuji');
    try {
      const r = await overit();
      if (!r || !r.ok) {
        potvrzenoStarsi = null;
        ukazChybu(chybaEl, r);
        return;
      }
      if (r.starsi && potvrzenoStarsi !== r.origin) {
        potvrzenoStarsi = r.origin;
        ukazChybu(chybaEl, { chyba: 'starsiServer', host: r.host }, true);
        return;
      }
      await window.kbApp.pripoj(r.origin, nazev());
    } catch {
      ukazChybu(chybaEl, null);
    } finally {
      tlacitko.disabled = false;
      tlacitko.textContent = t('vyber.pokracovat');
    }
  }

  formFirma.addEventListener('submit', (e) => {
    e.preventDefault();
    odesli({
      tlacitko: $('tlFirma'),
      chybaEl: $('chybaFirma'),
      overit: () => window.kbApp.overFirmu(firma.value),
      nazev: () => firma.value.trim(),
    });
  });
  formAdresa.addEventListener('submit', (e) => {
    e.preventDefault();
    odesli({
      tlacitko: $('tlAdresa'),
      chybaEl: $('chybaAdresa'),
      overit: () => window.kbApp.overAdresu(adresa.value),
      nazev: () => '',
    });
  });

  // Náhled adresy pod polem — stejný jako na webu: kdo píše „Moje Firma s.r.o.“, vidí, kam to vede.
  let posledni = 0;
  firma.addEventListener('input', async () => {
    skryjChybu($('chybaFirma'));
    potvrzenoStarsi = null;
    const poradi = ++posledni;
    const host = await window.kbApp.nahled(firma.value);
    if (poradi === posledni) $('nahled').textContent = host;
  });
  adresa.addEventListener('input', () => { skryjChybu($('chybaAdresa')); potvrzenoStarsi = null; });

  $('naRucne').addEventListener('click', () => prepniRezim(true));
  $('naFirmu').addEventListener('click', () => prepniRezim(false));
  $('vyzkouset').addEventListener('click', () => window.kbApp.otevritVen('registrace'));

  function vykresliUlozene(organizace, aktivni) {
    const seznam = $('seznam');
    seznam.replaceChildren();
    for (const o of organizace) {
      const li = document.createElement('li');
      const polozka = document.createElement('button');
      polozka.type = 'button';
      polozka.className = 'polozka';
      const nazev = document.createElement('span');
      nazev.className = 'nazev';
      nazev.textContent = o.nazev || o.host;
      const host = document.createElement('span');
      host.className = 'host';
      host.textContent = o.origin === aktivni ? `${o.host} ✓` : o.host;
      polozka.append(nazev, host);
      polozka.addEventListener('click', () => window.kbApp.prepni(o.origin));
      const odebrat = document.createElement('button');
      odebrat.type = 'button';
      odebrat.className = 'odebrat';
      odebrat.textContent = '✕';
      odebrat.title = t('vyber.odebratPopis', { host: o.host });
      odebrat.setAttribute('aria-label', odebrat.title);
      odebrat.addEventListener('click', async () => {
        const nove = await window.kbApp.odeber(o.origin);
        vykresliUlozene(nove.organizace, nove.aktivni);
      });
      li.append(polozka, odebrat);
      seznam.append(li);
    }
    $('ulozene').hidden = organizace.length === 0;
  }

  vykresliUlozene(info.organizace, info.aktivni);
  let rucne = false;
  try { rucne = localStorage.getItem(REZIM) === 'rucne'; } catch { /* výchozí název firmy */ }
  prepniRezim(rucne);
})();
