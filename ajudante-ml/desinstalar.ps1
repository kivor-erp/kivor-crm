# Desfaz o instalar.ps1: remove o atalho kivor-ml:, a inicialização com o Windows e desliga o ajudante.
# Não apaga as credenciais (C:\Users\<você>\.kivor\ml.json).
$ErrorActionPreference = 'SilentlyContinue'
Remove-Item 'HKCU:\Software\Classes\kivor-ml' -Recurse -Force
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'KIVOR Ajudante Mercado Livre.lnk') -Force
Remove-Item (Join-Path $PSScriptRoot 'iniciar-oculto.vbs') -Force
$c = Get-NetTCPConnection -LocalPort 5198 -State Listen
if ($c) { Stop-Process -Id $c.OwningProcess -Force }
Write-Host 'Ajudante removido.'
