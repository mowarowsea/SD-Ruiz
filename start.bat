@echo off
rem LocalLauncher からの起動口。フォアグラウンドで走り続けること
cd /d %~dp0
if not exist node_modules ( call npm install )
call npm run build || exit /b 1
call npm start
