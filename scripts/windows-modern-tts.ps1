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
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]

function Await-WinRTOperation {
  param([Parameter(Mandatory = $true)]$Operation)

  $asyncInterface = $Operation.GetType().GetInterfaces() |
    Where-Object {
      $_.IsGenericType -and
      $_.GetGenericTypeDefinition().FullName -eq "Windows.Foundation.IAsyncOperation`1"
    } |
    Select-Object -First 1

  if (-not $asyncInterface) {
    throw "Unsupported WinRT async operation type: $($Operation.GetType().FullName)"
  }

  $resultType = $asyncInterface.GetGenericArguments()[0]

  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq "AsTask" -and
      $_.IsGenericMethod -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.IsGenericType -and
      $_.GetParameters()[0].ParameterType.GetGenericTypeDefinition().FullName -eq "Windows.Foundation.IAsyncOperation`1"
    } |
    Select-Object -First 1

  if (-not $asTaskMethod) {
    throw "Could not find WindowsRuntimeSystemExtensions.AsTask(IAsyncOperation<TResult>)."
  }

  $closedMethod = $asTaskMethod.MakeGenericMethod($resultType)
  $task = $closedMethod.Invoke($null, @($Operation))

  return $task.GetAwaiter().GetResult()
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
  $inputStream = $null
  $reader = $null

  try {
    $stream = Await-WinRTOperation ($synth.SynthesizeTextToStreamAsync($line))

    if (-not $stream) {
      throw "Speech synthesis returned no stream for dialogue line $index."
    }

    $inputStream = $stream.GetInputStreamAt(0)
    $reader = New-Object Windows.Storage.Streams.DataReader($inputStream)

    $size = [uint32]$stream.Size

    if ($size -le 0) {
      throw "Speech synthesis returned an empty stream for dialogue line $index."
    }

    Await-WinRTOperation ($reader.LoadAsync($size)) | Out-Null

    $bytes = New-Object byte[] $size
    $reader.ReadBytes($bytes)
    [System.IO.File]::WriteAllBytes($file, $bytes)
  }
  finally {
    if ($reader) { $reader.Dispose() }
    if ($inputStream) { $inputStream.Dispose() }
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
