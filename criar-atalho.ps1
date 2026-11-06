# Cria o atalho "KIVOR-CRM" que abre o app em janela própria (sem abas nem barra de endereço).
# Uso:  powershell -ExecutionPolicy Bypass -File criar-atalho.ps1 [-Url https://kivor-erp.github.io/kivor-crm/] [-AreaDeTrabalho]
param(
  [string]$Url = 'https://kivor-erp.github.io/kivor-crm/',
  [switch]$AreaDeTrabalho
)

$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge não encontrado.' }

$pasta = $PSScriptRoot
$destinos = @(Join-Path $pasta 'KIVOR-CRM.lnk')
if ($AreaDeTrabalho) { $destinos += Join-Path ([Environment]::GetFolderPath('Desktop')) 'KIVOR-CRM.lnk' }

$shell = New-Object -ComObject WScript.Shell
foreach ($d in $destinos) {
  $lnk = $shell.CreateShortcut($d)
  $lnk.TargetPath = $edge
  $lnk.Arguments = "--app=$Url"
  $lnk.IconLocation = (Join-Path $pasta 'public\icone.ico')
  $lnk.Description = 'KIVOR-CRM'
  $lnk.WorkingDirectory = $pasta
  $lnk.Save()
  Write-Output "Atalho criado: $d"
}
