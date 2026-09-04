# ==============================================================================
# Script Oficial para Cadastro e Gestão da Tarefa Agendada no Windows
# Nome Padrão: LR_SmartQuestion_Pipeline_Diario
# ==============================================================================

$taskName = "LR_SmartQuestion_Pipeline_Diario"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$rootDir = Split-Path -Parent $scriptDir
$batPath = Join-Path $scriptDir "executar_pipeline_agendado.bat"
$pythonExe = "C:\ProgramData\anaconda3\python.exe"
$pipelineScript = Join-Path $scriptDir "executar_pipeline.py"

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  CONFIGURANDO TAREFA NO AGENDADOR DE TAREFAS DO WINDOWS          " -ForegroundColor Cyan
Write-Host "  Nome da Tarefa: $taskName                                      " -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# 1. Definir Ação da Tarefa
$action = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $rootDir

# 2. Definir Gatilho Diário (ex: 06:00 todos os dias)
$trigger = New-ScheduledTaskTrigger -Daily -At "06:00"

# 3. Definir Configurações de Execução
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -RestartCount 1 `
    -RestartInterval (New-TimeSpan -Minutes 15)

# 4. Registrar / Atualizar a Tarefa
try {
    # Se já existir, desregistra primeiro
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description "Execução diária automática do Pipeline ETL SmartQuestion para Supabase (Labor Rural)" `
        -User $env:USERNAME

    Write-Host "`n✅ Tarefa '$taskName' cadastrada com sucesso no Agendador do Windows!" -ForegroundColor Green
    Write-Host "⏰ Horário padrão: Diariamente às 06:00" -ForegroundColor Yellow
    Write-Host "📁 Arquivo executado: $batPath" -ForegroundColor White
    Write-Host "📂 Diretório de trabalho: $rootDir" -ForegroundColor White
}
catch {
    Write-Host "`n⚠️ Fallback para comando nativo schtasks..." -ForegroundColor Yellow
    $schCommand = "schtasks /create /tn `"$taskName`" /tr `"`"$batPath`"`" /sc DAILY /st 06:00 /f"
    Invoke-Expression $schCommand
}

# 5. Exibir Status Atual
Write-Host "`n📋 STATUS DA TAREFA NO SISTEMA:" -ForegroundColor Cyan
Get-ScheduledTask -TaskName $taskName | Format-List TaskName, State, Triggers, Actions
