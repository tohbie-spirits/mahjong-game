@echo off
rem Double-click to play: starts the local server and opens the game in your browser.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
