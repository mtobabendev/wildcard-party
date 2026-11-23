# One-time Owner authorization. Scope: private media uploads ONLY.
# DPAPI CurrentUser encrypts pairing credentials on this Windows account.
[CmdletBinding()]
param(
  [switch]$Pair,
  [switch]$PairFromClipboard,
  [switch]$Unpair,
  [ValidateSet('check','upload')][string]$Mode='check',
  [ValidateSet('penny','kandy','ashley')][string]$Area='penny',
  [string]$File='',
  [string]$Name='',
  [switch]$NewVersion
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$storeDir=Join-Path $env:APPDATA 'WildCardDEV'
$store=Join-Path $storeDir 'afterhours-upload-credential.dpapi'
if ((@($Pair,$PairFromClipboard,$Unpair) | Where-Object { $_ }).Count -gt 1) {
  throw 'Choose only one pairing action.'
}
if ($Unpair) {
  if (Test-Path -LiteralPath $store) { Remove-Item -LiteralPath $store -Force }
  Write-Output 'Local pairing cleared. Revoke the server key in Owner Admin if needed.'
  return
}
if ($Pair -or $PairFromClipboard) {
  if ($PairFromClipboard) {
    $token=Get-Clipboard -Raw
  } else {
    $secret=Read-Host 'Enter the Owner pairing key (hidden)' -AsSecureString
    $handle=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { $token=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($handle) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($handle) }
  }
  if ($token -cnotmatch '^wcu1_[A-Za-z0-9_-]{43}$') {
    throw 'Invalid pairing key. Nothing stored.'
  }
  $plain=[Text.Encoding]::UTF8.GetBytes($token)
  try {
    $cipher=[Security.Cryptography.ProtectedData]::Protect(
      $plain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    New-Item -Path $storeDir -ItemType Directory -Force | Out-Null
    [IO.File]::WriteAllBytes($store,$cipher)
  } finally {
    [Array]::Clear($plain,0,$plain.Length)
    if ($cipher) { [Array]::Clear($cipher,0,$cipher.Length) }
    $token=$null
  }
  if ($PairFromClipboard) { try { Set-Clipboard -Value '' } catch {} }
  Write-Output 'Owner workstation pairing encrypted with Windows DPAPI.'
  return
}
if (-not (Test-Path -LiteralPath $store)) {
  throw 'Workstation not paired. Copy the key from Owner Admin first.'
}
$encrypted=[IO.File]::ReadAllBytes($store)
$plain=[Security.Cryptography.ProtectedData]::Unprotect(
  $encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
  $env:WCD_UPLOAD_TOKEN=[Text.Encoding]::UTF8.GetString($plain)
  $argsForNode=@((Join-Path $PSScriptRoot 'afterhours-upload.mjs'),
    '--mode',$Mode,'--area',$Area)
  if ($File) { $argsForNode+=@('--file',$File) }
  if ($Name) { $argsForNode+=@('--name',$Name) }
  if ($NewVersion) { $argsForNode+='--new-version' }
  & node @argsForNode
  if ($LASTEXITCODE -ne 0) { throw 'Owner media command did not pass verification.' }
} finally {
  Remove-Item Env:\WCD_UPLOAD_TOKEN -ErrorAction SilentlyContinue
  [Array]::Clear($plain,0,$plain.Length)
  [Array]::Clear($encrypted,0,$encrypted.Length)
}
