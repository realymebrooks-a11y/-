@echo off
chcp 65001 >nul
echo 正在启动电费侦探，请保持此窗口打开...
start "" http://localhost:8787
node server.js
pause
