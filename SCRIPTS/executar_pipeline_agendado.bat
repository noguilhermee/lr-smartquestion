@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

:: ============================================================================
:: Pipeline Oficial LR-SmartQuestion - Agendador de Tarefas do Windows
:: ============================================================================

set "PROJETO_DIR=c:\Users\Guilherme\LABOR RURAL\Analytics - Departamento Analytics\POWER_BI\PROJETOS\BI_LABOR_RURAL\PY_SCRIPT"
set "PYTHON_EXE=C:\ProgramData\anaconda3\python.exe"
set "SCRIPT_PATH=%PROJETO_DIR%\SCRIPTS\executar_pipeline.py"
set "LOGS_DIR=%PROJETO_DIR%\DB\OUTPUT\LOGS"

:: Garantir pasta de logs
if not exist "%LOGS_DIR%" mkdir "%LOGS_DIR%"

:: Gerar timestamp formatado YYYY_MM_DD_HHMMSS (Regra 3 do AGENTS.md)
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set "DT=%%I"
if not defined DT (
    set "ANO=%date:~6,4%"
    set "MES=%date:~3,2%"
    set "DIA=%date:~0,2%"
    set "HORA=%time:~0,2%"
    if "!HORA:~0,1!"==" " set "HORA=0!HORA:~1,1!"
    set "MIN=%time:~3,2%"
    set "SEG=%time:~6,2%"
    set "TIMESTAMP=!ANO!_!MES!_!DIA!_!HORA!!MIN!!SEG!"
) else (
    set "TIMESTAMP=%DT:~0,4%_%DT:~4,2%_%DT:~6,2%_%DT:~8,2%%DT:~10,2%%DT:~12,2%"
)

set "LOG_FILE=%LOGS_DIR%\%TIMESTAMP%_execucao_agendada.log"

echo ============================================================================ >> "%LOG_FILE%"
echo 🚀 INICIANDO EXECUCAO AGENDADA: LR-SMARTQUESTION PIPELINE >> "%LOG_FILE%"
echo ⏰ Data/Hora: %date% %time% >> "%LOG_FILE%"
echo 📁 Diretorio: %PROJETO_DIR% >> "%LOG_FILE%"
echo ============================================================================ >> "%LOG_FILE%"

cd /d "%PROJETO_DIR%"
"%PYTHON_EXE%" "%SCRIPT_PATH%" >> "%LOG_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

echo. >> "%LOG_FILE%"
echo ============================================================================ >> "%LOG_FILE%"
if %EXIT_CODE% equ 0 (
    echo ✅ PIPELINE CONCLUIDO COM SUCESSO! (Codigo: %EXIT_CODE%^) >> "%LOG_FILE%"
) else (
    echo ❌ ERRO NA EXECUCAO DO PIPELINE! (Codigo: %EXIT_CODE%^) >> "%LOG_FILE%"
)
echo ⏰ Finalizado em: %date% %time% >> "%LOG_FILE%"
echo ============================================================================ >> "%LOG_FILE%"

exit /b %EXIT_CODE%
