; Doplněk instalačky (electron-builder NSIS, per-user).
;
; Autostart si aplikace zapisuje sama (app.setLoginItemSettings, hodnota „killBottleneck“
; v HKCU\…\Run) — standardní odinstalace o ní neví a nechala by ve Windows mrtvou položku
; po spuštění. Při AKTUALIZACI se ale starý odinstalátor spouští taky: tam položku smazat
; NESMÍME, jinak by se autostart po každé nové verzi tiše vypnul.
; Totéž mezipaměť aktualizací (electron-updater): při aktualizaci ji updater právě používá,
; při odinstalaci by po aplikaci zůstala (ověřeno na Windows 10 15. 10. 2026).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "killBottleneck"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "killBottleneck"
    RMDir /r "$LOCALAPPDATA\killbottleneck-desktop-updater"
  ${endIf}
!macroend
