@echo off
rem Night Ride Throught Budapest - lanzador
rem Abre la aplicacion en un servidor local (el navegador recuerda mejor el permiso del microfono).
setlocal
cd /d "%~dp0"
title Night Ride Throught Budapest

where node >nul 2>nul
if %errorlevel%==0 (
  node serve.js --open
  goto :fin
)

where py >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:5173
  py -m http.server 5173
  goto :fin
)

rem Sin Node ni Python: se abre el archivo directamente (funciona, pero Chrome pide el microfono cada vez)
start "" "%~dp0index.html"

:fin
endlocal
