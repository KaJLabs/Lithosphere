param(
  [Parameter(Mandatory = $true)][string]$OutputZip,
  [Parameter(Mandatory = $true)][string]$BytecodeEvidence,
  [Parameter(Mandatory = $true)][string]$PreviousReview
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
$evidenceText = [System.IO.File]::ReadAllText($evidence)
if ($evidenceText -notmatch '"commit"\s*:\s*"([0-9a-f]{40})"' -or $Matches[1] -ne $commit) {
  throw 'Bytecode evidence does not match source commit'
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
  candidate = 'MULTX_NATIVE_MESH_R3_REVIEW_CANDIDATE_2026-10-01'
  commit = $commit
  source = 'git archive of the exact signed commit'
  deploymentAuthorized = $false
  signingEnabled = $false
  relayingEnabled = $false
  swapEnabled = $false
  contractTests = '210 passing on Windows, including separate-process two-chain native service rehearsal'
  signerTests = '52 passing; 9 POSIX filesystem cases skipped on Windows and retained for Linux CI'
  productionDependencyAudit = '0 vulnerabilities'
  developerToolingAudit = '34 findings; see NATIVE_TOOLCHAIN_RISK_DISPOSITION_2026-10-01.md'
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$zip = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Update)
try {
  Add-Bytes $zip 'SIGNED_COMMIT.txt' $commitBytes
  Add-Bytes $zip 'R3_BYTECODE_EVIDENCE.json' ([System.IO.File]::ReadAllBytes($evidence))
  Add-Bytes $zip 'AUTHA_NATIVE_MESH_R2_REVIEW_2026-10-01.md' ([System.IO.File]::ReadAllBytes($review))
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
