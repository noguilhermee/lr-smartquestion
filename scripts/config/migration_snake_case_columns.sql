-- Tabela: sq_dim_agroindustria
ALTER TABLE IF EXISTS public.sq_dim_agroindustria RENAME COLUMN "ID" TO id;
ALTER TABLE IF EXISTS public.sq_dim_agroindustria RENAME COLUMN "Status" TO status;
ALTER TABLE IF EXISTS public.sq_dim_agroindustria RENAME COLUMN "Excluido" TO excluido;
ALTER TABLE IF EXISTS public.sq_dim_agroindustria RENAME COLUMN "editadoPor" TO editado_por;
ALTER TABLE IF EXISTS public.sq_dim_agroindustria RENAME COLUMN "criadoPor" TO criado_por;
ALTER TABLE IF EXISTS public.sq_dim_agroindustria RENAME COLUMN "Criado" TO criado_em;
ALTER TABLE IF EXISTS public.sq_dim_agroindustria RENAME COLUMN "Modificado" TO modificado_em;
ALTER TABLE IF EXISTS public.sq_dim_agroindustria RENAME COLUMN "Criado por" TO criado_por_nome;
ALTER TABLE IF EXISTS public.sq_dim_agroindustria RENAME COLUMN "Modificado por" TO modificado_por_nome;

-- Tabela: sq_dim_consultor
ALTER TABLE IF EXISTS public.sq_dim_consultor RENAME COLUMN "ID" TO id;
ALTER TABLE IF EXISTS public.sq_dim_consultor RENAME COLUMN "Status" TO status;
ALTER TABLE IF EXISTS public.sq_dim_consultor RENAME COLUMN "Excluido" TO excluido;
ALTER TABLE IF EXISTS public.sq_dim_consultor RENAME COLUMN "Criado por" TO criado_por_nome;
ALTER TABLE IF EXISTS public.sq_dim_consultor RENAME COLUMN "Modificado por" TO modificado_por_nome;

-- Tabela: sq_dim_fazenda
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "Excluido" TO excluido;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "idProdutor" TO id_produtor;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "idConsultor" TO id_consultor;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "inscricaoEstadual" TO inscricao_estadual;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "idAgroindustria" TO id_agroindustria;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "nomeFazenda" TO nome_fazenda;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "cidadeFazenda" TO cidade_fazenda;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "ufFazenda" TO uf_fazenda;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "latitudeFazenda" TO latitude_fazenda;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "longitudeFazenda" TO longitude_fazenda;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "altitudeFazenda" TO altitude_fazenda;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "dteEntradaInicial" TO data_entrada_inicial;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "dteSaida" TO data_saida;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "Status" TO status;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "editadoPor" TO editado_por;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "criadoPor" TO criado_por;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "Criado" TO criado_em;
ALTER TABLE IF EXISTS public.sq_dim_fazenda RENAME COLUMN "Modificado" TO modificado_em;

NOTIFY pgrst, 'reload schema';