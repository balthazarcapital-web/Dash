$ErrorActionPreference = 'Stop'
$runtimeRoot = 'C:\Users\balth\.cache\codex-runtimes\codex-primary-runtime\dependencies'
$node = Join-Path $runtimeRoot 'node\bin\node.exe'
$env:DETERLIMP_NODE_MODULES = Join-Path $runtimeRoot 'node\node_modules'
$env:DETERLIMP_PYTHON = Join-Path $runtimeRoot 'python\python.exe'
$env:DETERLIMP_PDFTOPPM = Join-Path $runtimeRoot 'native\poppler\Library\bin\pdftoppm.exe'

if (-not (Test-Path -LiteralPath $node)) {
  throw 'Runtime local do dashboard não foi encontrado.'
}

$lanAddress = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -ExpandProperty IPAddress -First 1
Write-Host 'Dashboard de obras disponível em http://localhost:4173/' -ForegroundColor Green
if ($lanAddress) {
  Write-Host "Acesso na mesma rede: http://${lanAddress}:4173/" -ForegroundColor Cyan
}
Write-Host 'Mantenha esta janela aberta. Pressione Ctrl+C para encerrar.' -ForegroundColor DarkGray
& $node (Join-Path $PSScriptRoot 'server.mjs')
