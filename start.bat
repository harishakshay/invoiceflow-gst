@echo off
title InvoiceFlow - localhost:8002
cd /d "%~dp0"
echo Starting InvoiceFlow at http://localhost:8002  (close this window to stop)
start "" http://localhost:8002
php -S localhost:8002
pause
