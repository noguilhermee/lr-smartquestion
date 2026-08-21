-- ======================================================================
-- MIGRATION: ADICIONAR COLUNAS DE TIPO DE VISITA E VALORES PAGOS
-- EXECUTE ESTE SCRIPT NO SQL EDITOR DO SUPABASE (lr-analytics-db)
-- ======================================================================

-- 1. Adicionar colunas na tabela de Ingestão/Raw
ALTER TABLE IF EXISTS public.sq_raw_visitas ADD COLUMN IF NOT EXISTS tipo_visita text;
ALTER TABLE IF EXISTS public.sq_raw_visitas ADD COLUMN IF NOT EXISTS valor_pago_produtor numeric;
ALTER TABLE IF EXISTS public.sq_raw_visitas ADD COLUMN IF NOT EXISTS valor_pago_agroindustria numeric;

-- 2. Adicionar colunas na tabela Fato Analítica
ALTER TABLE IF EXISTS public.sq_fato_visitas ADD COLUMN IF NOT EXISTS tipo_visita text;
ALTER TABLE IF EXISTS public.sq_fato_visitas ADD COLUMN IF NOT EXISTS valor_pago_produtor numeric;
ALTER TABLE IF EXISTS public.sq_fato_visitas ADD COLUMN IF NOT EXISTS valor_pago_agroindustria numeric;

-- 3. Atualizar valor padrão de tipo_visita para registros existentes se nulo
UPDATE public.sq_raw_visitas SET tipo_visita = 'RELATÓRIO DE VISITA LABOR RURAL - LEITE' WHERE tipo_visita IS NULL;
UPDATE public.sq_fato_visitas SET tipo_visita = 'RELATÓRIO DE VISITA LABOR RURAL - LEITE' WHERE tipo_visita IS NULL;
