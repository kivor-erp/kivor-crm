# Cria o atalho "KIVOR-CRM" que abre o app em janela própria (sem abas nem barra de endereço).
# -Separado: cria "KIVOR-CRM (navegador)", janela normal do Edge com perfil próprio, sem a conta do Windows
#            (para PCs de outra empresa: a conta da Voltrum fica só nesse perfil).
# Uso:  powershell -ExecutionPolicy Bypass -File criar-atalho.ps1 [-Separado] [-AreaDeTrabalho] [-Url ...]
param(
  [string]$Url = 'https://kivor-erp.github.io/kivor-crm/',
  [switch]$AreaDeTrabalho,
  [switch]$Separado
)

$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge não encontrado.' }

$pasta = $PSScriptRoot
$nome = if ($Separado) { 'KIVOR-CRM (navegador).lnk' } else { 'KIVOR-CRM.lnk' }
$argumentos = if ($Separado) {
  # pasta de dados própria = Edge isolado: sem login do Windows, sem extensões e cookies do perfil da empresa
  $perfil = Join-Path $env:LOCALAPPDATA 'KIVOR-CRM\Edge'
  "--user-data-dir=`"$perfil`" --no-first-run --new-window $Url"
} else { "--app=$Url" }
$destinos = @(Join-Path $pasta $nome)
if ($AreaDeTrabalho) { $destinos += Join-Path ([Environment]::GetFolderPath('Desktop')) $nome }

$shell = New-Object -ComObject WScript.Shell
foreach ($d in $destinos) {
  $lnk = $shell.CreateShortcut($d)
  $lnk.TargetPath = $edge
  $lnk.Arguments = $argumentos
  $lnk.IconLocation = (Join-Path $pasta 'public\icone.ico')
  $lnk.Description = 'KIVOR-CRM'
  $lnk.WorkingDirectory = $pasta
  $lnk.Save()
  Write-Output "Atalho criado: $d"
}
