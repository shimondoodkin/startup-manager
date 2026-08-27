# Runs the startup-manager server with no console window. Used by the StartupManager
# scheduled task (logon trigger). Stays alive while node runs so the task can restart it.
Set-Location $PSScriptRoot
$p = Start-Process -FilePath "node" -ArgumentList "dist\server.js" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
$p.WaitForExit()
exit $p.ExitCode
