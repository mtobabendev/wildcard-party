# WildCard DEV Owner upload. One-time browser pairing; then no upload form.
# The token is encrypted with Windows DPAPI and never passed in CLI arguments.
[CmdletBinding()]
param(
  [switch]$Pair,
  [switch]$PairFromClipboard,
  [switch]$Unpair,
  [ValidateSet('check','upload')][string]$Mode = 'check',
  [ValidateSet('penny','kandy','ashley')][string]$Area = 'penny',
  [string]$File = '',
  [string]$Name = '',
  [switch]$NewVersion
)
$ErrorActionPreference = 'Stop'
$storeDir = Join-Path $env:APPDATA 'WildCardDEV'
$store = Join-Path $storeDir 'afterhours-upload-credential.dpapi'
if ((@($Pair, $PairFromClipboard, $Unpair) | Where-Object { $_ }).Count -gt 1) {
  throw 'Choose one pairing action at a time.'
}
if ($Unpair) {
  if (Test-Path -LiteralPath $store) { Remove-Item -LiteralPath $store -Force }
  Write-Output 'Local pairing cleared. Revoke active keys in Owner Admin as needed.'
  return
}
if ($Pair -or $PairFromClipboard) {
  New-Item -Path $storeDir -ItemType Directory -Force | Out-Null
  if ($PairFromClipboard) {
    $value = Get-Clipboard -Raw
    if ($value -notmatch '^wcu1_[A-Za-z0-9_-]{43}$') {
      throw 'Clipboard does not contain a valid Owner pairing key.'
    }
    $secret = ConvertTo-SecureString $value -AsPlainText -Force
    $value = $null
    try { Set-Clipboard -Value '' } catch { }
  } else {
    $secret = Read-Host 'Paste the one-time Owner pairing key (hidden)' -AsSecureString
    $handle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
      $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle)
      if ($value -notmatch '^wcu1_[A-Za-z0-9_-]{43}$') {
        throw 'Invalid pairing key format. Nothing was saved.'
      }
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle)
      $value = $null
    }
  }
  $secret | ConvertFrom-SecureString | Set-Content -LiteralPath $store -Encoding ASCII -NoNewline
  Write-Output 'Owner workstation paired. Future approved files use the existing Party API.'
  return
}
if (-not (Test-Path -LiteralPath $store)) {
  throw 'Workstation not paired. Create and copy an Owner key in Party Admin once.'
}
$secret = Get-Content -LiteralPath $store -Raw | ConvertTo-SecureString
$handle = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $env:WCD_UPLOAD_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle)
  $nodeArgs = @((Join-Path $PSScriptRoot 'afterhours-upload.mjs'), '--mode', $Mode, '--area', $Area)
  if ($File) { $nodeArgs += @('--file', $File) }
  if ($Name) { $nodeArgs += @('--name', $Name) }
  if ($NewVersion) { $nodeArgs += '--new-version' }
  & node @nodeArgs
  if ($LASTEXITCODE -ne 0) { throw 'Owner media transfer was not verified.' }
} finally {
  Remove-Item Env:\WCD_UPLOAD_TOKEN -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle)
}
