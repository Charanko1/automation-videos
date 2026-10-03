[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DialogueJsonPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputDir,

  [string]$Language = "id-ID"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $DialogueJsonPath)) {
  throw "Dialogue JSON was not found: $DialogueJsonPath"
}

$null = New-Item -ItemType Directory -Force -Path $OutputDir

$parsedItems = Get-Content -Raw -LiteralPath $DialogueJsonPath | ConvertFrom-Json
$items = @($parsedItems | ForEach-Object { $_ })

# Windows keeps modern/OneCore voices under Speech_OneCore. SAPI COM can
# enumerate that category directly without copying registry keys.
$category = New-Object -ComObject SAPI.SpObjectTokenCategory
$category.SetId("HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices")

$tokens = @($category.EnumerateTokens())
$targetTokens = @(
  $tokens | Where-Object {
    $languageValue = ""
    try { $languageValue = [string]$_.GetAttribute("Language") } catch {}
    $description = ""
    try { $description = [string]$_.GetDescription() } catch {}

    ($languageValue -match "(^|;)0421(;|$)|(^|;)421(;|$)") -or
    ($description -match "\(id-ID\)") -or
    ($_.Id -match "(?i)(id[-_]?ID|Indonesian|Andika)")
  }
)

$requestedVoice = $env:AI_OFFICE_VOX_VOICE
$selectedToken = $null

if ($requestedVoice) {
  $selectedToken = $targetTokens |
    Where-Object {
      $_.Id -eq $requestedVoice -or
      $_.GetDescription() -eq $requestedVoice
    } |
    Select-Object -First 1

  if (-not $selectedToken) {
    $available = ($targetTokens | ForEach-Object {
      try {
        $_.GetDescription() + " [" + $_.GetAttribute("Language") + "]"
      } catch {
        $_.Id
      }
    }) -join "; "

    throw "Configured Vox voice was not found among Indonesian OneCore voices: $requestedVoice. Available id-ID voices: $available"
  }
}

if (-not $selectedToken) {
  $selectedToken = $targetTokens | Select-Object -First 1
}

if (-not $selectedToken) {
  $allVoiceInfo = ($tokens | ForEach-Object {
    try {
      $_.GetDescription() + " [" + $_.GetAttribute("Language") + "]"
    } catch {
      $_.Id
    }
  }) -join "; "

  throw "No Indonesian OneCore/SAPI voice was found. Required language: id-ID. Installed OneCore voices: $allVoiceInfo"
}

$voiceLabel = [string]$selectedToken.GetDescription()
$voiceLanguage = ""
try { $voiceLanguage = [string]$selectedToken.GetAttribute("Language") } catch {}

Write-Output (
  "TTS engine=SAPI COM OneCore; language=" + $Language +
  "; items=" + $items.Count +
  "; totalOneCoreVoices=" + $tokens.Count +
  "; targetVoices=" + $targetTokens.Count +
  "; selectedVoice=" + $voiceLabel +
  "; selectedLanguage=" + $voiceLanguage +
  "; outDir=" + $OutputDir
)

$voice = New-Object -ComObject SAPI.SpVoice
$voice.Voice = $selectedToken
$voice.Rate = 0
$voice.Volume = 100

foreach ($item in $items) {
  $index = [int]$item.index
  $file = Join-Path $OutputDir (($index.ToString("000")) + ".wav")
  $line = [string]$item.line

  if ([string]::IsNullOrWhiteSpace($line)) {
    throw "Dialogue line $index is empty."
  }

  if (Test-Path -LiteralPath $file) {
    Remove-Item -LiteralPath $file -Force
  }

  $stream = New-Object -ComObject SAPI.SpFileStream

  try {
    # 3 = SSFMCreateForWrite
    $stream.Open($file, 3, $false)
    $voice.AudioOutputStream = $stream
    $null = $voice.Speak($line, 0)
    $stream.Close()
    $voice.AudioOutputStream = $null
  }
  finally {
    try { $stream.Close() } catch {}
    try { $voice.AudioOutputStream = $null } catch {}
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($stream) | Out-Null } catch {}
  }

  if (-not (Test-Path -LiteralPath $file)) {
    throw "Speech synthesis produced no WAV for dialogue line $index."
  }

  $length = (Get-Item -LiteralPath $file).Length

  if ($length -le 44) {
    throw "Speech synthesis produced an empty WAV for dialogue line $index ($length bytes)."
  }

  Write-Output ("TTS wrote line " + $index + ": " + $length + " bytes")
}

try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($voice) | Out-Null } catch {}
try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($category) | Out-Null } catch {}
