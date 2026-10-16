; Extras del instalador NSIS (por usuario, sin admin).
; El desinstalador ya figura en "Aplicaciones instaladas" (clave HKCU\...\Uninstall que escribe electron-builder).

!macro customInstall
  ; Acceso directo "Desinstalar" en el menú Inicio.
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Desinstalar.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\${UNINSTALL_FILENAME}" 0
!macroend

!macro customUnInstall
  ; Arranque con Windows (login item de Electron) y accesos directos propios.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_PACKAGE_NAME}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCT_NAME}"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\Desinstalar.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  ; Ajustes locales (clave del relay, alias): se pregunta, por defecto NO se borran.
  ; No se pregunta en una actualización ni en una desinstalación silenciosa.
  ${ifNot} ${isUpdated}
    IfSilent skipAppData
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "¿Borrar también los ajustes guardados de Oficina virtual (clave, alias y preferencias)?$\n$\nSi elegís No, se conservan por si la volvés a instalar." IDNO skipAppData
    RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    skipAppData:
  ${endIf}
!macroend
