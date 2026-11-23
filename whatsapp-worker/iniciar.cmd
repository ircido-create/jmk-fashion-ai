@echo off
rem Worker de WhatsApp da JMK MODAS. Se cair, sobe de novo em 30 s.
rem Log em %LOCALAPPDATA%\jmk-whatsapp\worker.log
cd /d "%~dp0"
title JMK WhatsApp
if not exist "%LOCALAPPDATA%\jmk-whatsapp" mkdir "%LOCALAPPDATA%\jmk-whatsapp"
:inicio
node worker.mjs >> "%LOCALAPPDATA%\jmk-whatsapp\worker.log" 2>&1
timeout /t 30 /nobreak >nul
goto inicio
