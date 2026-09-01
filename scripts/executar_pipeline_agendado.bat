@echo off
setlocal enabledelayedexpansion

:: ============================================================================
:: Pipeline Oficial LR-SmartQuestion - Agendador de Tarefas do Windows
:: ============================================================================

set "PROJETO_DIR=c:\Users\Guilherme\LABOR RURAL\Analytics - Departamento Analytics\POWER_BI\PROJETOS\BI_LABOR_RURAL\bi-gerencial"
set "PYTHON_EXE=C:\ProgramData\anaconda3\python.exe"
set "SCRIPT_PATH=%PROJETO_DIR%\scripts\executar_pipeline.py"
set "LOGS_DIR=%PROJETO_DIR%\db\output\logs"

:: Garantir pasta de logs
if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%"

:: Gerar timestamp formatado YYYY_MM_DD_HHMMSS via powershell
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy_MM_dd_HHmmss'"`) do set "TIMESTAMP=%%i"

if not defined TIMESTAMP (
    set "TIMESTAMP=%DATE:/=_%_%TIME::=_%"
    set "TIMESTAMP=%TIMESTAMP: =0%"
    set "TIMESTAMP=%TIMESTAMP:,=%"
)

set "LOG_FILE=%LOGS_DIR%\%TIMESTAMP%_execucao_agendada.log"

echo ============================================================================ >> "%LOG_FILE%"
echo [INICIO] EXECUCAO AGENDADA: LR-SMARTQUESTION PIPELINE >> "%LOG_FILE%"
echo Data/Hora: %date% %time% >> "%LOG_FILE%"
echo Diretorio: %PROJETO_DIR% >> "%LOG_FILE%"
echo ============================================================================ >> "%LOG_FILE%"

cd /d "%PROJETO_DIR%"
"%PYTHON_EXE%" "%SCRIPT_PATH%" >> "%LOG_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

echo. >> "%LOG_FILE%"
echo ============================================================================ >> "%LOG_FILE%"
if %EXIT_CODE% equ 0 (
    echo [SUCESSO] PIPELINE CONCLUIDO COM SUCESSO! (Codigo: %EXIT_CODE%^) >> "%LOG_FILE%"
) else (
    echo [ERRO] ERRO NA EXECUCAO DO PIPELINE! (Codigo: %EXIT_CODE%^) >> "%LOG_FILE%"
)
echo Finalizado em: %date% %time% >> "%LOG_FILE%"
echo ============================================================================ >> "%LOG_FILE%"

exit /b %EXIT_CODE%
