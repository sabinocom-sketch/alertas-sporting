$ErrorActionPreference = "Stop"

$nodeCandidates = @(
  "$env:LOCALAPPDATA\OpenAI\Codex\bin\node.exe",
  "node"
)

$node = $null
foreach ($candidate in $nodeCandidates) {
  try {
    $command = Get-Command $candidate -ErrorAction Stop
    $node = $command.Source
    break
  } catch {
  }
}

if (-not $node) {
  Write-Host "Nao encontrei Node.js neste computador."
  Write-Host "Instala Node.js em https://nodejs.org/ ou abre a app atraves do Codex."
  exit 1
}

if (-not $env:FOOTBALL_DATA_KEY -and -not $env:API_FOOTBALL_KEY) {
  $env:FOOTBALL_DATA_KEY = Read-Host "Cola aqui a tua API key do football-data.org"
}

Write-Host "A iniciar Alertas Sporting..."
Write-Host "Abre no browser: http://localhost:4173"
& $node "$PSScriptRoot\server.js"
