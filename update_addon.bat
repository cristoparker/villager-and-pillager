@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo   Syncing Smart Villager Addon Development Packs
echo ===================================================

set "BP_SRC=%~dp0BP"
set "RP_SRC=%~dp0RP"
set "MCADDON_DEST=%~dp0SmartVillagerAddon.mcaddon"

if not exist "%BP_SRC%" (
    echo [ERROR] BP directory not found at: %BP_SRC%
    exit /b 1
)
if not exist "%RP_SRC%" (
    echo [ERROR] RP directory not found at: %RP_SRC%
    exit /b 1
)

set "SYNC_COUNT=0"

:: 1. Check all User ID folders in new Minecraft Bedrock Launcher
for /d %%U in ("%APPDATA%\Minecraft Bedrock\Users\*") do (
    if /i not "%%~nxU"=="Shared" (
        if exist "%%U\games\com.mojang" (
            call :SyncPacks "%%U\games\com.mojang" "%%~nxU"
        )
    )
)

:: 2. Check Shared folder
if exist "%APPDATA%\Minecraft Bedrock\Users\Shared\games\com.mojang" (
    call :SyncPacks "%APPDATA%\Minecraft Bedrock\Users\Shared\games\com.mojang" "Shared"
)

:: 3. Check legacy UWP Minecraft Bedrock
if exist "%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang" (
    call :SyncPacks "%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang" "UWP"
)

:: 4. Check Minecraft Preview
if exist "%LOCALAPPDATA%\Packages\Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe\LocalState\games\com.mojang" (
    call :SyncPacks "%LOCALAPPDATA%\Packages\Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe\LocalState\games\com.mojang" "Preview"
)

echo ---------------------------------------------------
echo Synced packs to !SYNC_COUNT! location(s).
echo ---------------------------------------------------

:: 5. Also regenerate SmartVillagerAddon.mcaddon
echo Packaging SmartVillagerAddon.mcaddon...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path 'BP', 'RP' -DestinationPath 'temp_addon.zip' -Force; Move-Item 'temp_addon.zip' 'SmartVillagerAddon.mcaddon' -Force" >nul 2>&1
if exist "%MCADDON_DEST%" (
    echo [OK] SmartVillagerAddon.mcaddon updated!
)

echo.
echo ===================================================
echo   Addon update completed! Reload world in Minecraft.
echo ===================================================
exit /b 0

:SyncPacks
set "TARGET_DIR=%~1"
set "LABEL=%~2"
echo.
echo ---------------------------------------------------
echo Syncing to [%LABEL%]: %TARGET_DIR%
echo ---------------------------------------------------

set "BP_DEST=%TARGET_DIR%\development_behavior_packs\SmartVillager_BP"
set "RP_DEST=%TARGET_DIR%\development_resource_packs\SmartVillager_RP"

if not exist "%BP_DEST%" mkdir "%BP_DEST%"
robocopy "%BP_SRC%" "%BP_DEST%" /MIR /FFT /R:1 /W:1 /NFL /NDL /NJH /NJS /nc /ns /np
if %ERRORLEVEL% LEQ 7 (
    echo [OK] BP synced -^> %BP_DEST%
) else (
    echo [ERROR] Failed to sync BP! Code: %ERRORLEVEL%
)

if not exist "%RP_DEST%" mkdir "%RP_DEST%"
robocopy "%RP_SRC%" "%RP_DEST%" /MIR /FFT /R:1 /W:1 /NFL /NDL /NJH /NJS /nc /ns /np
if %ERRORLEVEL% LEQ 7 (
    echo [OK] RP synced -^> %RP_DEST%
) else (
    echo [ERROR] Failed to sync RP! Code: %ERRORLEVEL%
)

set /a SYNC_COUNT+=1
exit /b 0
