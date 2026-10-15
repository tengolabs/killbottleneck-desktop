// Místní log rámu (%APPDATA%\killBottleneck\logs\main.log, při 1 MB se otočí do main.1.log).
// Nikam se neposílá — slouží podpoře, když uživatel log sám přiloží. Nezapisuje se do něj
// obsah notifikací ani přihlašovací údaje, jen co rám dělá.
import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const text = (c) => {
  if (c instanceof Error) return c.stack || c.message;
  if (typeof c === 'string') return c;
  try { return JSON.stringify(c); } catch { return String(c); }
};

export function vytvorLog(slozka, { maxBajtu = 1_000_000 } = {}) {
  const soubor = join(slozka, 'main.log');
  try { mkdirSync(slozka, { recursive: true }); } catch { /* bez logu rám běží dál */ }
  return (...casti) => {
    try {
      try {
        if (statSync(soubor).size > maxBajtu) {
          rmSync(`${soubor}.1`, { force: true });
          renameSync(soubor, `${soubor}.1`);
        }
      } catch { /* soubor zatím není */ }
      appendFileSync(soubor, `${new Date().toISOString()} ${casti.map(text).join(' ')}\n`);
    } catch { /* plný disk apod. — log nesmí shodit aplikaci */ }
  };
}
