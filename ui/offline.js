// „Server neodpovídá“ a „Připojuji…“. Opakování řídí hlavní proces (á 30 s, po probuzení
// počítače); stránka přidá jen ruční „Zkusit znovu“ a návrat sítě.
'use strict';
(async () => {
  const { info, t } = await window.kbStranka;
  const $ = (id) => document.getElementById(id);
  const m = info.mistni || {};
  const host = m.host || '';

  if (m.pripojuji) {
    $('titulek').textContent = t('offline.pripojuji', { host });
    $('tocic').hidden = false;
    $('paticka').hidden = false;
  } else {
    $('titulek').textContent = t('offline.titulek');
    const duvod = { server: 'offline.popisServer', neniKb: 'offline.popisNeniKb', mimoSit: 'offline.popisMimoSit' }[m.duvod] || 'offline.popisSit';
    $('popis').textContent = `${t('offline.popis', { host })} ${t(duvod, { host })}`;
    $('karta').hidden = false;
  }

  const znovu = $('znovu');
  znovu.addEventListener('click', () => {
    znovu.disabled = true;
    window.kbApp.zkusZnovu();
    setTimeout(() => { znovu.disabled = false; }, 3000);
  });
  for (const id of ['zmenit', 'zmenit2']) $(id).addEventListener('click', () => window.kbApp.zmenit());
  window.addEventListener('online', () => window.kbApp.zkusZnovu());
})();
