-- ==============================================================================
-- MIGRATION: Renomear sq_raw_fazendas para sq_raw_fazendas_grupo
-- Projeto: BI Labor Rural / SmartQuestion
-- Executar no SQL Editor do Supabase (lr-analytics-db)
-- ==============================================================================

BEGIN;

-- 1. Renomear a tabela principal fisica
ALTER TABLE IF EXISTS public.sq_raw_fazendas 
  RENAME TO sq_raw_fazendas_grupo;

-- 2. Criar VIEW de compatibilidade com o nome antigo (para nao quebrar relatorios do Power BI legados)
CREATE OR REPLACE VIEW public.sq_raw_fazendas AS 
SELECT * FROM public.sq_raw_fazendas_grupo;

-- 3. Notificar o PostgREST para recarregar o cache de esquemas imediatamente
NOTIFY pgrst, 'reload schema';

COMMIT;
