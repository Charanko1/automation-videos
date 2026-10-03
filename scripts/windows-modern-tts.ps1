[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DialogueJsonPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputDir,

  [string]$Language = "id-ID"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Runtime.WindowsRuntime

[void][Windows.Foundation.IAsyncOperation`1, Windows.Foundation, ContentType=WindowsRuntime]
[void][Windows.Foundation.IAsyncOperationWithProgress`2, Windows.Foundation, ContentType=WindowsRuntime]
[void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
[void][Windows.Media.SpeechSynthesis.VoiceInformation, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
[void][Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.IBuffer, Windows.Storage.Streams, ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.InputStreamOptions, Windows.Storage.Streams, ContentType=WindowsRuntime]

$_taskMethods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1
}
$asTaskGeneric = ($_taskMethods | Where-Object {
  $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation`1"
})[0]
$asTaskGeneric2 = ($_taskMethods | Where-Object {
  $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperationWithProgress`2"
})[0]

function Await-WinRtOperation($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}

function Await-WinRtOperationWithProgress($WinRtTask, $ResultType1, $ResultType2) {
  $asTask = $asTaskGeneric2.MakeGenericMethod($ResultType1, $ResultType2)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}

if (-not (Test-Path -LiteralPath $DialogueJsonPath)) {
  throw "Dialogue JSON was not found: $DialogueJsonPath"
}

$parsedItems = Get-Content -Raw -LiteralPath $DialogueJsonPath | ConvertFrom-Json
$items = @($parsedItems | ForEach-Object { $_ })

$allVoices = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices)
$targetVoices = @(
  $allVoices |
    Where-Object {
      $_.Language -eq $Language -or $_.Language -like "id-*"
    }
)

$requestedVoice = $env:AI_OFFICE_VOX_VOICE
$selectedVoice = $null

if ($requestedVoice) {
  $selectedVoice = $targetVoices |
    Where-Object {
      $_.DisplayName -eq $requestedVoice -or
      $_.Id -eq $requestedVoice -or
      $_.Description -eq $requestedVoice
    } |
    Select-Object -First 1

  if (-not $selectedVoice) {
    $available = ($targetVoices | ForEach-Object {
      $_.DisplayName + " [" + $_.Language + "]"
    }) -join "; "

    throw "Configured Vox voice was not found among Indonesian Windows voices: $requestedVoice. Available id-ID voices: $available"
  }
}

if (-not $selectedVoice) {
  $selectedVoice = $targetVoices | Select-Object -First 1
}

if (-not $selectedVoice) {
  $allVoiceInfo = ($allVoices | ForEach-Object {
    $_.DisplayName + " [" + $_.Language + "]"
  }) -join "; "

  throw "No Indonesian Windows modern Speech voice is installed. Required culture: id-ID. Installed voices: $allVoiceInfo"
}

$voiceLabel = [string]$selectedVoice.DisplayName
$null = New-Item -ItemType Directory -Force -Path $OutputDir

Write-Output (
  "TTS engine=Windows.Media.SpeechSynthesis; language=" + $Language +
  "; items=" + $items.Count +
  "; targetVoices=" + $targetVoices.Count +
  "; selectedVoice=" + $voiceLabel +
  "; outDir=" + $OutputDir
)

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

  $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  $synth.Voice = $selectedVoice
  $stream = $null

  try {
    $stream = Await-WinRtOperation (
      $synth.SynthesizeTextToStreamAsync($line)
    ) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])

    if (-not $stream) {
      throw "Speech synthesis returned no stream for dialogue line $index."
    }

    $size = [uint32]$stream.Size

    if ($size -le 44) {
      throw "Speech synthesis returned an empty stream for dialogue line $index."
    }

    $bytes = [array]::CreateInstance([byte], $size)
    $buffer = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::AsBuffer($bytes)

    Await-WinRtOperationWithProgress (
      $stream.ReadAsync(
        $buffer,
        $size,
        [Windows.Storage.Streams.InputStreamOptions]::None
      )
    ) ([Windows.Storage.Streams.IBuffer]) ([uint32]) | Out-Null

    [System.IO.File]::WriteAllBytes($file, $bytes)
  }
  finally {
    if ($stream) { $stream.Dispose() }
    if ($synth) { $synth.Dispose() }
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
