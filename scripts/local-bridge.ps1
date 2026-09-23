param(
  [string]$HtmlPath = (Join-Path $PSScriptRoot 'DRG存档编辑器_中文版_v8.html'),
  [string]$SaveFile = '',
  [int]$Port = 0,
  [string]$AccessKey = '',
  [switch]$NoBrowser,
  [switch]$Probe
)

$ErrorActionPreference = 'Stop'
$appId = '548430'
$maxSaveBytes = 25MB

function Find-CurrentSave {
  if ($SaveFile) {
    $chosen = (Resolve-Path -LiteralPath $SaveFile).Path
    if ((Split-Path -Leaf $chosen) -notmatch '^\d+_Player\.sav$') { throw '指定的测试文件必须是 SteamID_Player.sav' }
    return $chosen
  }

  $libraries = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  function Add-Library([string]$candidate) {
    if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate 'steamapps') -PathType Container)) {
      [void]$libraries.Add($candidate)
    }
  }

  $steamRoots = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($registryKey in @('HKCU:\Software\Valve\Steam', 'HKLM:\Software\WOW6432Node\Valve\Steam', 'HKLM:\Software\Valve\Steam')) {
    $entry = Get-ItemProperty -Path $registryKey -ErrorAction SilentlyContinue
    foreach ($candidate in @($entry.SteamPath, $entry.InstallPath)) {
      if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)) { [void]$steamRoots.Add($candidate) }
    }
  }
  foreach ($candidate in @(
    (Join-Path ${env:ProgramFiles(x86)} 'Steam'),
    (Join-Path $env:ProgramFiles 'Steam')
  )) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)) { [void]$steamRoots.Add($candidate) }
  }
  foreach ($drive in [System.IO.DriveInfo]::GetDrives()) {
    if (-not $drive.IsReady -or $drive.DriveType -ne 'Fixed') { continue }
    foreach ($name in @('SteamLibrary', 'Steam')) { Add-Library (Join-Path $drive.RootDirectory.FullName $name) }
  }
  foreach ($steamRoot in $steamRoots) {
    Add-Library $steamRoot
    $libraryList = Join-Path $steamRoot 'steamapps\libraryfolders.vdf'
    if (-not (Test-Path -LiteralPath $libraryList -PathType Leaf)) { continue }
    $contents = Get-Content -LiteralPath $libraryList -Raw
    foreach ($match in [regex]::Matches($contents, '"path"\s+"([^"]+)"')) {
      Add-Library ($match.Groups[1].Value.Replace('\\', '\'))
    }
  }

  $saveCandidates = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
  foreach ($library in $libraries) {
    $manifest = Join-Path $library "steamapps\appmanifest_$appId.acf"
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { continue }
    $manifestText = Get-Content -LiteralPath $manifest -Raw
    $installMatch = [regex]::Match($manifestText, '"installdir"\s+"([^"]+)"')
    if (-not $installMatch.Success) { continue }
    $directory = Join-Path $library ("steamapps\common\" + $installMatch.Groups[1].Value + '\FSD\Saved\SaveGames')
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { continue }
    foreach ($file in Get-ChildItem -LiteralPath $directory -File -Filter '*_Player.sav') {
      if ($file.Name -match '^\d+_Player\.sav$') { $saveCandidates.Add($file) }
    }
  }
  if ($saveCandidates.Count -eq 0) { throw '未从 Steam 游戏库找到 *_Player.sav。请确认已安装并运行过深岩银河。' }

  $activeUser = (Get-ItemProperty -Path 'HKCU:\Software\Valve\Steam\ActiveProcess' -Name ActiveUser -ErrorAction SilentlyContinue).ActiveUser
  if ($activeUser) {
    $steamId64 = [long]76561197960265728 + [long]$activeUser
    $activeSave = $saveCandidates | Where-Object { $_.Name -eq "${steamId64}_Player.sav" } | Select-Object -First 1
    if ($activeSave) { return $activeSave.FullName }
  }
  return ($saveCandidates | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).FullName
}

function Send-Json($context, [int]$status, $data) {
  $body = [System.Text.Encoding]::UTF8.GetBytes(($data | ConvertTo-Json -Compress -Depth 5))
  $context.Response.StatusCode = $status
  $context.Response.ContentType = 'application/json; charset=utf-8'
  $context.Response.ContentLength64 = $body.Length
  $context.Response.Headers.Add('Cache-Control', 'no-store')
  $context.Response.OutputStream.Write($body, 0, $body.Length)
}

function Send-Bytes($context, [byte[]]$bytes, [string]$type) {
  $context.Response.ContentType = $type
  $context.Response.ContentLength64 = $bytes.Length
  $context.Response.Headers.Add('Cache-Control', 'no-store')
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

$currentSave = Find-CurrentSave
if ($Probe) { Write-Output $currentSave; exit 0 }
if (-not (Test-Path -LiteralPath $HtmlPath -PathType Leaf)) { throw "找不到网页版文件：$HtmlPath" }
$currentSave = (Resolve-Path -LiteralPath $currentSave).Path
$saveDirectory = Split-Path -Parent $currentSave

if ($Port -eq 0) {
  $portPicker = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $portPicker.Start()
  $Port = ([System.Net.IPEndPoint]$portPicker.LocalEndpoint).Port
  $portPicker.Stop()
}
$baseUrl = "http://127.0.0.1:$Port"
$secret = if ($AccessKey -and $NoBrowser) { $AccessKey } else { [guid]::NewGuid().ToString('N') }
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("$baseUrl/")
$listener.Start()
Write-Host "本地版已启动：$baseUrl/"
Write-Host "当前存档：$currentSave"
Write-Host '关闭此窗口即可停止本地助手。'
if (-not $NoBrowser) { Start-Process -FilePath "$baseUrl/?key=$secret" }

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $request = $context.Request
      $route = $request.Url.AbsolutePath
      if ($route -eq '/' -and $request.HttpMethod -eq 'GET') {
        Send-Bytes $context ([System.IO.File]::ReadAllBytes($HtmlPath)) 'text/html; charset=utf-8'
        continue
      }
      if ($request.Headers['X-DRG-Key'] -cne $secret) { Send-Json $context 403 @{ error = '本地助手密钥不匹配' }; continue }
      if ($route -eq '/api/info' -and $request.HttpMethod -eq 'GET') {
        $file = Get-Item -LiteralPath $currentSave
        Send-Json $context 200 @{ fileName = $file.Name; directory = $saveDirectory; bytes = $file.Length; sha256 = (Get-FileHash -LiteralPath $currentSave -Algorithm SHA256).Hash.ToLowerInvariant() }
      } elseif ($route -eq '/api/current' -and $request.HttpMethod -eq 'GET') {
        Send-Bytes $context ([System.IO.File]::ReadAllBytes($currentSave)) 'application/octet-stream'
      } elseif ($route -eq '/api/open-folder' -and $request.HttpMethod -eq 'POST') {
        Start-Process -FilePath 'explorer.exe' -ArgumentList @($saveDirectory)
        Send-Json $context 200 @{ directory = $saveDirectory }
      } elseif ($route -eq '/api/replace' -and $request.HttpMethod -eq 'POST') {
        if (Get-Process -Name 'FSD-Win64-Shipping', 'FSD' -ErrorAction SilentlyContinue) { Send-Json $context 423 @{ error = '请先退出游戏，再替换当前存档' }; continue }
        $expected = $request.Headers['X-Expected-Sha256']
        if ($expected -notmatch '^[a-fA-F0-9]{64}$') { Send-Json $context 400 @{ error = '缺少原存档校验值' }; continue }
        $actual = (Get-FileHash -LiteralPath $currentSave -Algorithm SHA256).Hash
        if ($actual -ine $expected) { Send-Json $context 409 @{ error = '游戏存档已在载入后变化，请重新载入后再试' }; continue }
        if ($request.ContentLength64 -le 0 -or $request.ContentLength64 -gt $maxSaveBytes) { Send-Json $context 400 @{ error = '新存档大小不符合要求' }; continue }
        $memory = [System.IO.MemoryStream]::new()
        $request.InputStream.CopyTo($memory)
        $newBytes = $memory.ToArray()
        $memory.Dispose()
        if ($newBytes.Length -le 0 -or $newBytes.Length -gt $maxSaveBytes) { Send-Json $context 400 @{ error = '新存档大小不符合要求' }; continue }
        $backDirectory = Join-Path (Split-Path -Parent $saveDirectory) 'back'
        [void][System.IO.Directory]::CreateDirectory($backDirectory)
        $stamp = (Get-Date).ToString('yyyy-MM-dd_HH-mm-ss-fff')
        $backupFolder = Join-Path $backDirectory $stamp
        if (Test-Path -LiteralPath $backupFolder) { $backupFolder = Join-Path $backDirectory "${stamp}_$([guid]::NewGuid().ToString('N').Substring(0,6))" }
        [void][System.IO.Directory]::CreateDirectory($backupFolder)
        $backup = Join-Path $backupFolder ([System.IO.Path]::GetFileName($currentSave))
        $temporary = Join-Path $saveDirectory ('.drg-vault-' + [guid]::NewGuid().ToString('N') + '.tmp')
        try {
          [System.IO.File]::WriteAllBytes($temporary, $newBytes)
          [System.IO.File]::Replace($temporary, $currentSave, $backup, $true)
        } finally {
          if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        }
        Send-Json $context 200 @{ backup = $backup; sha256 = (Get-FileHash -LiteralPath $currentSave -Algorithm SHA256).Hash.ToLowerInvariant() }
      } else {
        Send-Json $context 404 @{ error = '未知操作' }
      }
    } catch {
      try { Send-Json $context 500 @{ error = $_.Exception.Message } } catch {}
    } finally {
      try { $context.Response.OutputStream.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
