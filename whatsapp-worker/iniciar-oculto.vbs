Rem Abre o iniciar.cmd sem janela. A pasta Inicializar do Windows tem um atalho para este arquivo.
Set sh = CreateObject("WScript.Shell")
sh.Run """" & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\iniciar.cmd""", 0, False
