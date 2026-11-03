# Deploys the ai-import Edge Function with the git commit stamped into it, so
# Settings > Diagnostics "Server build" shows the commit that is really
# deployed (owner decision 2026-11-03). Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File .\scripts\deploy-ai-import.ps1
# The stamp file is restored afterwards; nothing is left changed in git.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$hash = (git rev-parse --short HEAD).Trim()
if (-not $hash) { throw 'git rev-parse failed: run this from the repo.' }
$dirty = git status --porcelain -- supabase/functions/ai-import
if ($dirty) { $hash = "$hash+dirty" }
$at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

$stampFile = Join-Path $root 'supabase/functions/ai-import/buildStamp.ts'
$original = [System.IO.File]::ReadAllText($stampFile)
try {
  $stamped = @"
// Written by scripts/deploy-ai-import.ps1 at deploy time. Never commit a stamped copy.
export const AI_IMPORT_GIT_HASH = '$hash';
export const AI_IMPORT_DEPLOYED_AT = '$at';
"@
  [System.IO.File]::WriteAllText($stampFile, $stamped)
  supabase functions deploy ai-import --project-ref mbzonnoglreoeqihzfce
  if ($LASTEXITCODE -ne 0) { throw "supabase functions deploy failed (exit $LASTEXITCODE)" }
  Write-Host "Deployed ai-import at commit $hash ($at UTC)"
}
finally {
  [System.IO.File]::WriteAllText($stampFile, $original)
}
