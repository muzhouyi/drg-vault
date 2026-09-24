param([switch]$CheckOnly, [switch]$RunTests, [switch]$DebugBuild)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project

$local = Join-Path $project '.build-tools'
$localCargo = Join-Path $local 'cargo'
$localRustup = Join-Path $local 'rustup'
$localLlvm = Join-Path $local 'llvm\clang+llvm-23.1.2-x86_64-pc-windows-msvc\bin'
$localSysroot = Join-Path $local 'xwin-cache\windows-msvc-sysroot\windows-msvc-sysroot'

if (Test-Path (Join-Path $localCargo 'bin\cargo.exe')) {
  $env:CARGO_HOME = $localCargo
  $env:RUSTUP_HOME = $localRustup
  $env:PATH = "$(Join-Path $localCargo 'bin');$env:PATH"
}

if ((Test-Path (Join-Path $localLlvm 'lld-link.exe')) -and (Test-Path (Join-Path $localSysroot 'lib\x86_64-unknown-windows-msvc\kernel32.lib'))) {
  $env:PATH = "$localLlvm;$env:PATH"
  $env:LIB = Join-Path $localSysroot 'lib\x86_64-unknown-windows-msvc'
  $env:INCLUDE = "$(Join-Path $localSysroot 'include');$(Join-Path $localSysroot 'include\c++\stl');$(Join-Path $localSysroot 'include\__msvc_vcruntime_intrinsics')"
  $env:RUSTFLAGS = "-C linker=lld-link -Lnative=$($env:LIB.Replace('\','/')) -C link-arg=-defaultlib:oldnames"
  $env:CC = 'clang-cl'
  $env:CXX = 'clang-cl'
  $env:RC = 'llvm-rc'
}

& node scripts/build-desktop.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($RunTests) {
  & cargo test --manifest-path src-tauri\Cargo.toml
} elseif ($DebugBuild) {
  & cargo build --manifest-path src-tauri\Cargo.toml
} elseif ($CheckOnly) {
  & cargo check --manifest-path src-tauri\Cargo.toml
} else {
  & .\node_modules\.bin\tauri.cmd build --bundles nsis
}
exit $LASTEXITCODE
