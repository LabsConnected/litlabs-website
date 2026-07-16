@echo off
REM Network, Disk, and RAM Optimization Script for P2P/File Operations
REM Run as Administrator

echo === Applying Network Optimizations ===
echo.

REM TCP optimizations for P2P and high throughput
echo Setting autotuninglevel to normal...
netsh int tcp set global autotuninglevel=normal 2>nul || echo (already set or not supported)

echo Setting RSS to enabled...
netsh int tcp set global rss=enabled 2>nul || echo (already set or not supported)

echo.
echo === Optimizing Disk for Performance ===
echo.

REM Disable last access time (faster file operations)
echo Disabling Last Access Time updates...
fsutil behavior set DisableLastAccess 1 2>nul

REM Disable 8dot3 name creation (faster file operations with many small files)
echo Disabling 8dot3 name creation...
fsutil behavior set Disable8dot3 1 2>nul

echo.
echo === Disabling Memory-Hungry Services ===
echo.

REM Disable Windows Search
sc stop WSearch 2>nul
sc config WSearch start= disabled 2>nul
echo Disabled Windows Search

REM Disable Superfetch/SysMain
sc stop SysMain 2>nul
sc config SysMain start= disabled 2>nul
echo Disabled SysMain (Superfetch)

REM Disable Diagnostics Tracking
sc stop DiagTrack 2>nul
sc config DiagTrack start= disabled 2>nul
echo Disabled DiagTrack

echo.
echo === IMPORTANT: Enable Write Cache Manually ===
echo Device Manager ^> Disk drives ^> Right-click each SSD ^> Properties ^> Policies
echo Check: "Enable write caching on the device"
echo Check: "Turn off cache for performance" (if available)
echo.

echo === Optimizations Applied ===
echo Run 'netsh int tcp show global' to verify TCP settings
echo Reboot recommended for full effect
echo.
pause