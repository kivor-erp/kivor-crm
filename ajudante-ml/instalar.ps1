# Instala o ajudante do Mercado Livre neste computador (uma vez só, sem precisar de administrador).
#  1. Cria o atalho "kivor-ml:" do Windows, que o botão "Ligar o ajudante" do KIVOR usa para iniciar o ajudante escondido.
#  2. Faz o ajudante ligar sozinho quando você entra no Windows (use -SemInicioAutomatico para não).
# Só altera o seu usuário (HKCU e pasta Inicializar). Para desfazer, rode desinstalar.ps1.
param([switch]$SemInicioAutomatico)
$ErrorActionPreference = 'Stop'

$pasta = $PSScriptRoot
$servidor = Join-Path $pasta 'servidor.mjs'
if (-not (Test-Path $servidor)) { throw "Não achei $servidor" }

$candidatos = @(
  (Get-Command node -ErrorAction SilentlyContinue).Source,
  "$env:ProgramFiles\nodejs\node.exe",
  "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
) | Where-Object { $_ -and (Test-Path $_) }
if (-not $candidatos) { throw 'Não achei o Node.js. Instale o Node (nodejs.org) e rode este arquivo de novo.' }
$node = $candidatos[0]

# Script que liga o ajudante sem abrir janela
$vbs = Join-Path $pasta 'iniciar-oculto.vbs'
@"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$pasta"
sh.Run """$node"" ""$servidor""", 0, False
"@ | Set-Content -Path $vbs -Encoding ASCII

# Atalho kivor-ml:
$chave = 'HKCU:\Software\Classes\kivor-ml'
New-Item -Path "$chave\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $chave -Name '(default)' -Value 'URL:KIVOR Mercado Livre'
New-ItemProperty -Path $chave -Name 'URL Protocol' -Value '' -Force | Out-Null
Set-ItemProperty -Path "$chave\shell\open\command" -Name '(default)' -Value "wscript.exe //B `"$vbs`""

# Iniciar com o Windows
$atalho = Join-Path ([Environment]::GetFolderPath('Startup')) 'KIVOR Ajudante Mercado Livre.lnk'
if ($SemInicioAutomatico) {
  Remove-Item $atalho -ErrorAction SilentlyContinue
} else {
  $l = (New-Object -ComObject WScript.Shell).CreateShortcut($atalho)
  $l.TargetPath = 'wscript.exe'
  $l.Arguments = "//B `"$vbs`""
  $l.WorkingDirectory = $pasta
  $l.Save()
}

# Liga agora
Start-Process wscript.exe -ArgumentList "//B `"$vbs`""
Write-Host "Pronto. O ajudante está ligado e o botão 'Ligar o ajudante' do KIVOR já funciona."
if (-not $SemInicioAutomatico) { Write-Host 'Ele também liga sozinho quando você entra no Windows.' }
