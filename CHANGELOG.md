# Changelog

## 1.0.1 — 2026-10-15

Security and reliability fixes.

- Downloads: one file always asks where to save it. Several files at once (e.g. a split PDF) go
  straight to Downloads only for common document types and only while you can see the window;
  a hidden window downloads nothing. Saved files are marked as downloaded from the internet, so
  Windows warns before opening programs.
- The microphone (voice messages) works only while the window is in front.
- The app never hands a client certificate from your Windows certificate store to a server.
- Your own server on an unencrypted address (http://): before each connection the app checks
  that the address still leads into your local network.
- The server check follows redirects only within the same server.
- Switching organizations: the previous organization's notifications and unread count no longer
  show up in the new one; clicking an older notification opens the organization it belongs to.
  Notifications that arrive right after switching or signing in are no longer missed.
- The window no longer pops up when Windows starts if it was maximized last time.
- "Change organization" from the "server isn't responding" page is no longer replaced by an
  automatic retry 30 seconds later.
- A full address pasted into the company name (https://name.killbottleneck.com/login) works.
- If installing an update fails, the app keeps running normally.

## 1.0.0 — 2026-10-15

First version of killBottleneck for Windows.

- Sign in by company name (like on the web) or by your own server's address; several organizations
  in one app.
- Windows notifications for your killBottleneck notifications, also when the window is closed; the
  unread count on the icon by the clock and on the taskbar.
- Keeps running by the clock and starts with Windows (turn it off in the icon's menu); no questions asked —
  closing the window for the first time just shows a short notice.
- Opens links to other sites in your default browser; downloads go through the Save dialog.
- "Server isn't responding" page with automatic retry instead of a browser error.
- Updates itself from GitHub Releases.
