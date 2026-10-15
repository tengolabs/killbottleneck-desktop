// Společné pro místní stránky rámu: jazyk a texty. Do stránky se vkládá VÝHRADNĚ přes
// textContent (nikdy innerHTML) — názvy organizací píše uživatel a adresy přicházejí ze sítě.
'use strict';
(() => {
  const najdi = (slovnik, klic) => klic.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), slovnik);
  window.kbStranka = window.kbApp.info().then((info) => {
    const t = (klic, param = {}) => String(najdi(info.texty, klic) ?? klic)
      .replace(/\{\{(\w+)\}\}/g, (_, k) => (param[k] ?? ''));
    document.documentElement.lang = info.jazyk;
    for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
    return { info, t };
  });
})();
