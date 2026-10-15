# killBottleneck for Windows

Your organization's [killBottleneck](https://killbottleneck.com) in its own window — with Windows
notifications even when the window is closed, an unread counter by the clock; it starts with
Windows (turn that off in the menu of the icon by the clock).

[Česky](README.cs.md)

## Download

**[Download killBottleneck for Windows](https://github.com/tengolabs/killbottleneck-desktop/releases/latest/download/killBottleneck-Setup.exe)**
(Windows 10 and 11, 64-bit). The link always points to the newest version.

The installer needs no administrator rights and installs only for your Windows account.

> **"Windows protected your PC"?** The app is not code-signed yet, so Windows doesn't know the
> publisher. Click **More info → Run anyway**. Each release lists SHA-256 checksums
> (`SHA256SUMS.txt`) if you want to verify the download.

## First start

1. Type your **company name** — the same as when you sign in on the web (`My Company` →
   `my-company.killbottleneck.com`). Running your own server? Choose **Enter the address manually**.
2. Sign in with your **e-mail and password**.

You can keep several organizations and switch between them in the menu of the icon by the clock.

## What the app does — and what it doesn't

- **The window shows your organization's own web pages.** The app doesn't ship its own copy of
  killBottleneck: new features arrive with your server, and the app itself updates only when the
  window around it changes.
- **Notifications:** once a minute (and right after the computer wakes up) the app asks *your*
  server for your unread notifications, using your own sign-in. New ones appear as Windows
  notifications; the server's address is in the title, so a notification can't pretend to come
  from somewhere else.
- **Closing the window keeps the app running by the clock**, and it starts with your computer so notifications
  keep coming. Both are in the icon's menu (Quit, Start when the computer starts).
- **Links to other sites** (payments, documentation, e-mail) open in your default browser or mail
  app — the window only ever shows your organization's server.
- **Updates:** the app checks GitHub Releases of this repository at start and every 6 hours and
  installs a new version quietly when the window is hidden (or when you choose *Restart and update*).
- **No telemetry.** Nothing is sent to us. The only other party the app talks to is GitHub (update
  checks — GitHub sees your IP address) and, when you type a company name, a DNS lookup through
  Cloudflare's resolver to check that the organization exists.
- **Stored on your computer** (`%APPDATA%\killBottleneck`): the list of your organizations, the
  window position, your sign-in (kept by the web page like in a browser) and a local log. Crash
  reports are kept locally and never uploaded. Uninstalling removes all of it.

## Security

The window displays pages from a server you choose, so the app treats them as untrusted:

- sandboxed renderer with context isolation and no Node.js; the page gets only a tiny API
  (`window.kbDesktop`, version 1) and the app checks the sender of every call;
- the window may only show the selected server; everything else opens in your browser, and only
  `https:`, `http:` and `mailto:` links ever leave the app (never `file:`, `ms-msdt:`, `search-ms:`
  or UNC paths), rate-limited;
- permissions are denied by default on every session — the server's page may use only the
  microphone (voice messages, audio only), clipboard writes and full screen;
- unencrypted `http://` only inside a private network; certificate errors are never ignored;
- Electron fuses: no `RunAsNode`, no `NODE_OPTIONS`, no inspector, ASAR integrity validation.

Found a problem? See [SECURITY.md](SECURITY.md).

## Building from source

```bash
npm ci
npm test          # unit tests (plain Node.js, no Electron needed)
npm start         # run the development build
npm run dist      # Windows installer (on Windows)
```

This repository is published from the killBottleneck monorepo; issues are welcome here, pull
requests get ported by hand.

## License

[Sustainable Use License](LICENSE) — the same as killBottleneck. Electron (MIT) and Chromium
licenses ship with the installer.
