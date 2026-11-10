; Run the same handoff as a silent update, using a disposable executable in NSIS's temp folder.
Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "Doko update test"
OutFile "${OUTFILE}"
!include LogicLib.nsh
!include "..\build\installer.nsh"
!define APP_EXECUTABLE_FILENAME "Doko.exe"

!macro testUpdate PREVIOUS_EXECUTABLE
  StrCpy $R0 "$INSTDIR\${PREVIOUS_EXECUTABLE}"
  CopyFiles /SILENT "$SYSDIR\cmd.exe" "$R0"
  nsExec::Exec '"$R0" /d /c exit 11'
  Pop $R1
  ${If} $R1 != 11
    SetErrorLevel 1
    Quit
  ${EndIf}

  !insertmacro holdPreviousExecutable
  nsExec::Exec '"$R0" /d /c exit 11'
  Pop $R1
  ${If} $R1 != "error"
    SetErrorLevel 2
    Quit
  ${EndIf}

  ; electron-builder renames the old file before extracting its replacement at the same path.
  ClearErrors
  Rename "$R0" "$PLUGINSDIR\old.exe"
  IfErrors 0 +3
    SetErrorLevel 3
    Quit
  StrCpy $R0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  CopyFiles /SILENT "$SYSDIR\cmd.exe" "$R0"
  nsExec::Exec '"$R0" /d /c exit 12'
  Pop $R1
  ${If} $R1 != 12
    SetErrorLevel 4
    Quit
  ${EndIf}
  System::Call 'kernel32::CloseHandle(p $previousExeHandle)'
  Delete "$R0"
  Delete "$PLUGINSDIR\old.exe"
!macroend

Section
  InitPluginsDir
  StrCpy $INSTDIR "$PLUGINSDIR\Installed Reader"
  CreateDirectory "$INSTDIR"
  !insertmacro testUpdate "Doko.exe"
  !insertmacro testUpdate "Folio Local.exe"
  SetErrorLevel 0
SectionEnd
