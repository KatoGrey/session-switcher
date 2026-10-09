' Starts Session Switcher in its own window, without a console.
' Double-click this (or the desktop shortcut the app can create for you).
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

On Error Resume Next
sh.Run "node --version", 0, True
If Err.Number <> 0 Then
  MsgBox "Session Switcher needs Node.js." & vbCrLf & vbCrLf & "Install the LTS version from https://nodejs.org, then try again.", 48, "Session Switcher"
  WScript.Quit 1
End If
On Error GoTo 0

' If it's already running, this just brings its window up.
sh.Run "node """ & dir & "\server.js""", 0, False
