// Texty rámu (oznamovací oblast, upozornění, dialogy, místní stránky). Jazyk podle Windows:
// čeština a slovenština → česky, jinak anglicky — stejně jako výchozí volba webu.
import { readFileSync } from 'node:fs';

export const JAZYKY = ['cs', 'en'];

export const jazykZLocale = (locale) => (/^(cs|sk)\b/i.test(String(locale || '')) ? 'cs' : 'en');

const nactiSlovnik = (jazyk) => JSON.parse(readFileSync(new URL(`../i18n/${jazyk}.json`, import.meta.url), 'utf8'));

const najdi = (slovnik, klic) => klic.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), slovnik);

export function vytvorPreklad(jazyk) {
  const j = JAZYKY.includes(jazyk) ? jazyk : 'en';
  const slovnik = nactiSlovnik(j);
  const zaloha = j === 'en' ? slovnik : nactiSlovnik('en');
  const t = (klic, param = {}) => {
    const hodnota = najdi(slovnik, klic) ?? najdi(zaloha, klic) ?? klic;
    return String(hodnota).replace(/\{\{(\w+)\}\}/g, (_, k) => (param[k] ?? ''));
  };
  return { jazyk: j, t, slovnik };
}
