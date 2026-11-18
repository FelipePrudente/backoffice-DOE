' Run worker hidden (no console window)
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
node = sh.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
If Not fso.FileExists(node) Then
  node = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\nodejs\node.exe")
End If
If Not fso.FileExists(node) Then
  node = "node"
End If
cmd = """" & node & """ """ & root & "\worker.js"""
sh.CurrentDirectory = root
sh.Run cmd, 0, False
