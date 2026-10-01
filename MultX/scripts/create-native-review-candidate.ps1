param(
  [Parameter(Mandatory = $true)][string]$OutputZip,
  [Parameter(Mandatory = $true)][string]$BytecodeEvidence,
  [Parameter(Mandatory = $true)][string]$PreviousReview,
  [Parameter(Mandatory = $true)][string]$CIEvidenceDirectory
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

function Add-Bytes([System.IO.Compression.ZipArchive]$Zip, [string]$Name, [byte[]]$Bytes) {
  $entry = $Zip.CreateEntry($Name, [System.IO.Compression.CompressionLevel]::Optimal)
  $stream = $entry.Open()
  try { $stream.Write($Bytes, 0, $Bytes.Length) } finally { $stream.Dispose() }
}

$repo = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Git repository unavailable' }
$commit = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid source commit' }
$output = [System.IO.Path]::GetFullPath($OutputZip)
if (Test-Path -LiteralPath $output) { throw 'Output archive already exists' }
$evidence = (Resolve-Path -LiteralPath $BytecodeEvidence).Path
$review = (Resolve-Path -LiteralPath $PreviousReview).Path
$ciEvidence = (Resolve-Path -LiteralPath $CIEvidenceDirectory).Path
$evidenceText = [System.IO.File]::ReadAllText($evidence)
if ($evidenceText -notmatch '"commit"\s*:\s*"([0-9a-f]{40})"' -or $Matches[1] -ne $commit) {
  throw 'Bytecode evidence does not match source commit'
}
$requiredCI = @('GIT_COMMIT.txt', 'GIT_STATUS.txt', 'SHA256SUMS.txt',
  'results-all.json', 'contracts-tests.log', 'signer-tests.log')
foreach ($name in $requiredCI) {
  if (-not (Test-Path -LiteralPath (Join-Path $ciEvidence $name) -PathType Leaf)) {
    throw "Missing retained CI evidence: $name"
  }
}
if (([System.IO.File]::ReadAllText((Join-Path $ciEvidence 'GIT_COMMIT.txt'))).Trim() -ne $commit) {
  throw 'CI rehearsal source commit mismatch'
}
if (-not [string]::IsNullOrWhiteSpace([System.IO.File]::ReadAllText((Join-Path $ciEvidence 'GIT_STATUS.txt')))) {
  throw 'CI rehearsal checkout was not clean'
}
$ciResults = @(Get-Content -LiteralPath (Join-Path $ciEvidence 'results-all.json') -Raw | ConvertFrom-Json)
if ($ciResults.Count -lt 6 -or @($ciResults | Where-Object { $_.exitCode -ne 0 }).Count -gt 0) {
  throw 'CI rehearsal phase failure or incomplete results'
}
foreach ($line in [System.IO.File]::ReadAllLines((Join-Path $ciEvidence 'SHA256SUMS.txt'))) {
  if ($line -notmatch '^([0-9a-f]{64})\s+(.+)$') { throw 'Malformed CI evidence checksum line' }
  $namedFile = [System.IO.Path]::GetFileName($Matches[2])
  $checkedFile = Join-Path $ciEvidence $namedFile
  if (-not (Test-Path -LiteralPath $checkedFile -PathType Leaf) -or
      (Get-FileHash -LiteralPath $checkedFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Matches[1]) {
    throw "CI evidence checksum mismatch: $namedFile"
  }
}

& git -C $repo archive --format=zip "--output=$output" $commit .github/workflows/ci-multx.yaml MultX/contracts MultX/signer MultX/scripts/create-native-review-candidate.ps1
if ($LASTEXITCODE -ne 0) { throw 'Git archive failed' }

$process = New-Object System.Diagnostics.Process
$process.StartInfo.FileName = 'git'
$process.StartInfo.Arguments = "-C `"$repo`" cat-file commit $commit"
$process.StartInfo.UseShellExecute = $false
$process.StartInfo.RedirectStandardOutput = $true
$process.StartInfo.RedirectStandardError = $true
if (-not $process.Start()) { throw 'Could not read signed Git commit' }
$memory = New-Object System.IO.MemoryStream
try {
  $process.StandardOutput.BaseStream.CopyTo($memory)
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw 'Could not read signed Git commit' }
  $commitBytes = $memory.ToArray()
} finally {
  $memory.Dispose()
  $process.Dispose()
}
$commitText = [System.Text.Encoding]::UTF8.GetString($commitBytes)
if ($commitText -notmatch 'gpgsig -----BEGIN SSH SIGNATURE-----') { throw 'Source commit is not SSH signed' }
$prefix = [System.Text.Encoding]::ASCII.GetBytes("commit $($commitBytes.Length)`0")
$sha1 = [System.Security.Cryptography.SHA1]::Create()
try {
  $actualCommit = [System.BitConverter]::ToString($sha1.ComputeHash([byte[]]($prefix + $commitBytes))).Replace('-', '').ToLowerInvariant()
  if ($actualCommit -ne $commit) { throw 'Signed commit bytes do not reproduce HEAD' }
} finally { $sha1.Dispose() }

$metadata = [ordered]@{
  schemaVersion = 1
  candidate = [System.IO.Path]::GetFileNameWithoutExtension($output)
  commit = $commit
  source = 'git archive of the exact signed commit'
  deploymentAuthorized = $false
  signingEnabled = $false
  relayingEnabled = $false
  swapEnabled = $false
  ciRehearsal = 'Retained CI_EVIDENCE results and raw test logs, bound to this source commit'
  developerToolingAudit = '34 findings; see NATIVE_TOOLCHAIN_RISK_DISPOSITION_2026-10-01.md'
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$zip = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Update)
try {
  Add-Bytes $zip 'SIGNED_COMMIT.txt' $commitBytes
  Add-Bytes $zip 'BYTECODE_EVIDENCE.json' ([System.IO.File]::ReadAllBytes($evidence))
  Add-Bytes $zip ([System.IO.Path]::GetFileName($review)) ([System.IO.File]::ReadAllBytes($review))
  foreach ($file in @(Get-ChildItem -LiteralPath $ciEvidence -File | Sort-Object Name)) {
    Add-Bytes $zip "CI_EVIDENCE/$($file.Name)" ([System.IO.File]::ReadAllBytes($file.FullName))
  }
  Add-Bytes $zip 'CANDIDATE_METADATA.json' ($utf8.GetBytes(($metadata | ConvertTo-Json -Depth 5) + "`n"))
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $lines = foreach ($entry in @($zip.Entries | Sort-Object FullName)) {
      $stream = $entry.Open()
      try {
        $digest = [System.BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
        "$digest  $($entry.FullName)"
      } finally { $stream.Dispose() }
    }
    Add-Bytes $zip 'FILE_MANIFEST.sha256' ($utf8.GetBytes(($lines -join "`n") + "`n"))
  } finally { $sha.Dispose() }
} finally { $zip.Dispose() }

$result = [ordered]@{
  archive = $output
  sha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
  commit = $commit
  manifestEntries = $lines.Count
}
$result | ConvertTo-Json -Depth 4
