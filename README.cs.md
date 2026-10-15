# killBottleneck pro Windows

[killBottleneck](https://killbottleneck.cz) vaší organizace ve vlastním okně — s upozorněními
Windows i se zavřeným oknem, počtem nepřečtených u hodin a volitelným spuštěním se systémem.

[English](README.md)

## Stažení

**[Stáhnout killBottleneck pro Windows](https://github.com/tengolabs/killbottleneck-desktop/releases/latest/download/killBottleneck-Setup.exe)**
(Windows 10 a 11, 64 bit). Odkaz vede vždy na nejnovější verzi.

Instalace nepotřebuje práva správce a instaluje se jen pro váš účet ve Windows.

> **„Systém Windows ochránil váš počítač“?** Aplikace zatím není digitálně podepsaná, takže Windows
> nezná vydavatele. Klikněte na **Další informace → Přesto spustit**. Každé vydání má kontrolní
> součty SHA-256 (`SHA256SUMS.txt`), pokud si chcete stažený soubor ověřit.

## První spuštění

1. Napište **název firmy** — stejně jako při přihlášení na webu (`Moje Firma` →
   `moje-firma.killbottleneck.com`). Máte vlastní server? Zvolte **Zadat adresu ručně**.
2. Přihlaste se **e-mailem a heslem**.

Organizací může být víc; přepínají se v menu ikony u hodin.

## Co aplikace dělá — a co ne

- **Okno ukazuje přímo stránky serveru vaší organizace.** Aplikace nenosí vlastní kopii
  killBottlenecku: novinky přijdou se serverem a samotná aplikace se aktualizuje jen kvůli rámu okna.
- **Upozornění:** jednou za minutu (a hned po probuzení počítače) se aplikace zeptá *vašeho* serveru
  na nepřečtená upozornění — s vaším přihlášením. Nová ukáže jako upozornění Windows; v titulku je
  adresa serveru, takže se upozornění nemůže vydávat za někoho jiného.
- **Zavřením okna aplikace běží dál vedle hodin.** Ukončit ji jde v menu ikony.
- **Odkazy jinam** (platby, dokumentace, e-mail) se otevřou ve výchozím prohlížeči nebo poště — okno
  ukazuje vždy jen server vaší organizace.
- **Aktualizace:** aplikace se při startu a pak každých 6 hodin podívá do vydání tohoto repozitáře na
  GitHubu a novou verzi nainstaluje potichu, když je okno skryté (nebo přes *Restartovat a aktualizovat*).
- **Žádná telemetrie.** Nám se neposílá nic. Kromě vašeho serveru aplikace mluví jen s GitHubem
  (aktualizace — GitHub vidí vaši IP adresu) a při zadání názvu firmy s DNS resolverem Cloudflare,
  aby ověřila, že organizace existuje.
- **Ve vašem počítači** (`%APPDATA%\killBottleneck`) zůstává: seznam vašich organizací, poloha okna,
  přihlášení (drží ho stránka jako v prohlížeči) a místní log. Výpisy pádů zůstávají místně a nikam se
  neodesílají. Odinstalace vše smaže.

## Bezpečnost

Okno ukazuje stránky serveru, který si zvolíte — aplikace je proto bere jako nedůvěryhodné:

- stránka běží v sandboxu s oddělením kontextu a bez Node.js; dostane jen malé API
  (`window.kbDesktop`, verze 1) a aplikace u každého volání ověří, odkud přišlo;
- okno smí ukazovat jen zvolený server; všechno ostatní se otevře v prohlížeči a z aplikace odejdou
  jen odkazy `https:`, `http:` a `mailto:` (nikdy `file:`, `ms-msdt:`, `search-ms:` ani cesty UNC),
  s brzdou proti zahlcení;
- oprávnění jsou na každé session ve výchozím stavu zamítnutá — stránka serveru smí jen mikrofon
  (hlasové zprávy, jen zvuk), zápis do schránky a celou obrazovku;
- nešifrované `http://` jen v privátní síti; chyby certifikátů se nikdy nepřebíjejí;
- Electron fuses: bez `RunAsNode`, bez `NODE_OPTIONS`, bez ladicího inspektoru, kontrola integrity ASAR.

Našli jste problém? Viz [SECURITY.md](SECURITY.md).

## Sestavení ze zdrojáků

```bash
npm ci
npm test          # jednotkové testy (čistý Node.js, Electron netřeba)
npm start         # spustí vývojovou stavbu
npm run dist      # instalačka pro Windows (na Windows)
```

Repozitář se vydává z monorepa killBottlenecku; hlášení chyb tu vítáme, pull requesty přenášíme ručně.

## Licence

[Sustainable Use License](LICENSE) — stejná jako killBottleneck. Licence Electronu (MIT) a Chromia
jsou přibalené v instalačce.
