@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0DRG-local-helper.ps1" -HtmlPath "%~dp0DRG-save-editor.html"
pause
