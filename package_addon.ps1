<#
.SYNOPSIS
    Compiles and packages Smart Villager Addon v1.0.1 into .mcaddon and .mcpack files.
#>

[CmdletBinding()]
param(
    [string]$Version = "1.0.1"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = (Get-Location).Path
$bpDir = Join-Path $root "BP"
$rpDir = Join-Path $root "RP"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Smart Villager Addon Packager (v$Version)              " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Validate manifests
Write-Host "`n[1/4] Verifying manifests..." -ForegroundColor Yellow
$bpManifest = Get-Content (Join-Path $bpDir "manifest.json") -Raw | ConvertFrom-Json
$rpManifest = Get-Content (Join-Path $rpDir "manifest.json") -Raw | ConvertFrom-Json

Write-Host "  BP Header Name : $($bpManifest.header.name)" -ForegroundColor Green
Write-Host "  BP Version     : $($bpManifest.header.version -join '.')" -ForegroundColor Green
Write-Host "  RP Header Name : $($rpManifest.header.name)" -ForegroundColor Green
Write-Host "  RP Version     : $($rpManifest.header.version -join '.')" -ForegroundColor Green

# 2. Build SmartVillagerAddon_v1.0.1.mcaddon (contains BP/ and RP/ directories)
Write-Host "`n[2/4] Packaging SmartVillagerAddon_v$Version.mcaddon..." -ForegroundColor Yellow
$addonFile = Join-Path $root "SmartVillagerAddon_v$Version.mcaddon"
$addonLegacy = Join-Path $root "SmartVillagerAddon.mcaddon"

if (Test-Path $addonFile) { Remove-Item $addonFile -Force }

$tempZip = Join-Path $root "temp_addon_build.zip"
if (Test-Path $tempZip) { Remove-Item $tempZip -Force }

$zip = [System.IO.Compression.ZipFile]::Open($tempZip, [System.IO.Compression.ZipArchiveMode]::Create)

function Add-DirectoryToZip {
    param(
        [System.IO.Compression.ZipArchive]$Archive,
        [string]$SourceDir,
        [string]$ArchivePrefix
    )
    $files = Get-ChildItem -Path $SourceDir -Recurse -File
    foreach ($file in $files) {
        $rel = $file.FullName.Substring($SourceDir.Length).TrimStart('\', '/')
        $entryName = ($ArchivePrefix + "/" + $rel).Replace('\', '/')
        $entry = $Archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        $fileStream = [System.IO.File]::OpenRead($file.FullName)
        $fileStream.CopyTo($entryStream)
        $fileStream.Close()
        $entryStream.Close()
    }
}

Add-DirectoryToZip -Archive $zip -SourceDir $bpDir -ArchivePrefix "BP"
Add-DirectoryToZip -Archive $zip -SourceDir $rpDir -ArchivePrefix "RP"
$zip.Dispose()

Move-Item -Path $tempZip -Destination $addonFile -Force
Copy-Item -Path $addonFile -Destination $addonLegacy -Force

$addonSize = (Get-Item $addonFile).Length
Write-Host "  Created: $([System.IO.Path]::GetFileName($addonFile)) ($([Math]::Round($addonSize / 1KB, 1)) KB)" -ForegroundColor Green
Write-Host "  Updated: $([System.IO.Path]::GetFileName($addonLegacy))" -ForegroundColor Green

# 3. Build standalone .mcpack files
Write-Host "`n[3/4] Packaging standalone .mcpack files..." -ForegroundColor Yellow
function Build-StandaloneMcpack {
    param(
        [string]$SourceDir,
        [string]$DestinationPath
    )
    if (Test-Path $DestinationPath) { Remove-Item $DestinationPath -Force }
    $tZip = $DestinationPath + ".tmp.zip"
    if (Test-Path $tZip) { Remove-Item $tZip -Force }
    
    $arch = [System.IO.Compression.ZipFile]::Open($tZip, [System.IO.Compression.ZipArchiveMode]::Create)
    $files = Get-ChildItem -Path $SourceDir -Recurse -File
    foreach ($file in $files) {
        $entryName = $file.FullName.Substring($SourceDir.Length).TrimStart('\', '/').Replace('\', '/')
        $entry = $arch.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $eStream = $entry.Open()
        $fStream = [System.IO.File]::OpenRead($file.FullName)
        $fStream.CopyTo($eStream)
        $fStream.Close()
        $eStream.Close()
    }
    $arch.Dispose()
    Move-Item -Path $tZip -Destination $DestinationPath -Force
    $sz = (Get-Item $DestinationPath).Length
    Write-Host "  Created: $([System.IO.Path]::GetFileName($DestinationPath)) ($([Math]::Round($sz / 1KB, 1)) KB)" -ForegroundColor Green
}

$bpPack = Join-Path $root "SmartVillager_BP_v$Version.mcpack"
$rpPack = Join-Path $root "SmartVillager_RP_v$Version.mcpack"

Build-StandaloneMcpack -SourceDir $bpDir -DestinationPath $bpPack
Build-StandaloneMcpack -SourceDir $rpDir -DestinationPath $rpPack

# 4. Verification summary
Write-Host "`n[4/4] Verification Summary:" -ForegroundColor Yellow
$verifyZip = [System.IO.Compression.ZipFile]::OpenRead($addonFile)
Write-Host "  Total files in .mcaddon : $($verifyZip.Entries.Count)" -ForegroundColor Green
$verifyZip.Dispose()

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "   Compilation and packaging complete!                    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
