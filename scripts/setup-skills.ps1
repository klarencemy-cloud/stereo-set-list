# Links .claude/skills to .agents/skills with a junction (no admin needed).
# Run from anywhere: powershell -File scripts/setup-skills.ps1
# On Windows git checks the committed symlink out as a text file (core.symlinks=false),
# so this replaces that stand-in, or any real folder, with a working link.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root '.agents\skills'
$link = Join-Path $root '.claude\skills'

if (-not (Test-Path $target)) { throw "Missing $target. Run this from a full clone." }
New-Item -ItemType Directory -Force (Split-Path $link) | Out-Null

$item = Get-Item $link -Force -ErrorAction SilentlyContinue
if ($item) {
  $isLink = [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
  if ($isLink) {
    Write-Host "Already a link: $link -> $($item.Target). Nothing to do."
    exit 0
  }
  if ($item.PSIsContainer) {
    Write-Host "Deleting real folder $link (not a link)."
    Remove-Item $link -Recurse -Force
  } else {
    Write-Host "Deleting text-file stand-in $link (git's copy of the symlink)."
    Remove-Item $link -Force
  }
}

New-Item -ItemType Junction -Path $link -Target $target | Out-Null
Write-Host "Created junction $link -> $target"
Write-Host "Tip: git will show .claude/skills as changed; that is expected. Don't commit it."
