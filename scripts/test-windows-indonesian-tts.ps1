[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$ttsScript = Join-Path $projectRoot "scripts\windows-modern-tts.ps1"
$tempDir = Join-Path $projectRoot ".ai-office-tts-test"
$dialogueJson = Join-Path $tempDir "dialogue-test.json"
$outputDir = Join-Path $tempDir "output"

New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$payload = @(
  @{
    index = 0
    sceneId = "TEST"
    speaker = "Vox"
    line = "Halo, ini uji suara Bahasa Indonesia dari Vox."
  }
)

$payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $dialogueJson -Encoding UTF8

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ttsScript `
  -DialogueJsonPath $dialogueJson `
  -OutputDir $outputDir `
  -Language "id-ID"

$wav = Join-Path $outputDir "000.wav"
if (-not (Test-Path -LiteralPath $wav)) {
  throw "TTS test failed: 000.wav was not created."
}

$size = (Get-Item -LiteralPath $wav).Length
if ($size -le 44) {
  throw "TTS test failed: 000.wav is empty."
}

Write-Output ("SUCCESS: Indonesian Vox WAV created at " + $wav + " (" + $size + " bytes).")
