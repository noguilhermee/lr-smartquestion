// Agroindústria e região já chegam resolvidas pelo ETL em sq_fato_economico (regra 12):
// a API apenas lê as colunas. As antigas importações sanitizeConsultorList/isTestData/
// ehCadeiaLeite/mapAgroindustria não existem mais em shared.js e faziam esta rota
// devolver HTTP 500 em toda requisição.
//
// 2026-09-23: correção da fórmula do COE/Margem Bruta no ETL (scripts/functions/
// carregar_fato_economico.py), validada 1:1 contra os indicadores ANUAIS do Elabore
// (98,75% de aderência em janelas de 12 meses). Esta API foi ajustada para:
//   1) usar apenas linhas com possui_dados_economicos=1 (exclui também o resíduo de
//      ~323k linhas da carga legada anterior, que ficam com possui_dados_economicos=0
//      por padrão e ainda não foram excluídas da tabela);
//   2) calcular preço/COE/margem por litro como médias PONDERADAS (Σvalor/Σlitros),
//      não média simples entre linhas de fazendas com portes muito diferentes.
const {
  getSupabaseClient,
  fetchAll,
  fetchWithCache,
  monthLabel
} = require('./shared');

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const supabase = getSupabaseClient();

    // Leitura das tabelas econômicas e de vínculos
    const [rawEconData, rawVinculosData] = await Promise.all([
      fetchWithCache('FATO_ECONOMICO', () =>
        fetchAll(() => supabase.from('sq_fato_economico').select('*'), 1000, 'id_composto').catch(() => [])
      ),
      fetchWithCache('RAW_VINCULOS_ECON', () =>
        fetchAll(() => supabase.from('sq_raw_vinculos').select('*'), 1000, 'id_composto').catch(() => [])
      )
    ]);

    // Filtros da requisição (mesmos nomes de query usados por overview/visits/turnover/consistency)
    const filterAgro = (req.query.industry || '').trim().toUpperCase();
    const filterRegion = (req.query.region || '').trim().toUpperCase();
    const filterProject = (req.query.project || '').trim().toUpperCase();
    const filterStatus = (req.query.status || '').trim().toUpperCase();
    const filterConsultant = (req.query.consultant || '').trim().toUpperCase();
    const filterProducer = (req.query.producer || '').trim().toUpperCase();
    const filterMonth = (req.query.month || '').trim();

    // Mapeamento de cadastro de vínculos
    const vinculoMap = new Map();
    (rawVinculosData || []).forEach(v => {
      const cod = String(v.codigo_lr || '').trim().toUpperCase();
      if (cod) vinculoMap.set(cod, v);
    });

    // Filtrar dados econômicos
    let econList = (rawEconData || []).map(row => {
      const cod = String(row.codigo_lr || '').trim().toUpperCase();
      const vinculo = vinculoMap.get(cod) || {};
      const agro = String(row.agroindustria || vinculo.agroindustria || '').trim();
      const reg = String(row.regiao || vinculo.regiao || '').trim() || 'NÃO INFORMADA';

      return {
        ...row,
        codigo_lr: cod,
        agroindustria: agro,
        regiao: reg,
        projeto: String(row.projeto || vinculo.projeto || '').trim(),
        consultor: String(row.nome_consultor || vinculo.consultor_campo || '').trim(),
        produtor: String(row.nome_produtor || vinculo.nome_produtor || '').trim(),
        status: String(vinculo.status_cadastro || 'Ativo').trim(),
        data_associacao: row.data_associacao || vinculo.data_associacao
      };
    });

    // Aplicação dos filtros de dimensão (agro/região/projeto/status/consultor/produtor).
    // O filtro de mês é aplicado separadamente logo abaixo: ele deve valer para os KPIs
    // pontuais (foto do mês selecionado), mas NUNCA para séries históricas (evolução mensal),
    // senão o gráfico de tendência fica com um único ponto — mesmo padrão de overview.js
    // (carteiraTodos vs. carteiraMes).
    if (filterAgro) econList = econList.filter(r => r.agroindustria.toUpperCase() === filterAgro);
    if (filterRegion) econList = econList.filter(r => r.regiao.toUpperCase() === filterRegion);
    if (filterProject) econList = econList.filter(r => r.projeto.toUpperCase() === filterProject);
    if (filterStatus) econList = econList.filter(r => r.status.toUpperCase() === filterStatus);
    if (filterConsultant) econList = econList.filter(r => r.consultor.toUpperCase() === filterConsultant);
    if (filterProducer) econList = econList.filter(r => (r.produtor.toUpperCase() === filterProducer || r.codigo_lr === filterProducer));

    // Descarta linhas sem lançamento econômico real no mês (inclui, por ora, o resíduo de
    // carga legada anterior à correção de 2026-09-23, que ficou com possui_dados_economicos=0
    // por padrão e não foi excluído da tabela — ver ETL scripts/functions/carregar_fato_economico.py).
    // Regra 12 (AGENTS.md): a exclusão definitiva do legado deve ocorrer na origem (Supabase),
    // este filtro é apenas para não diluir os KPIs enquanto o DELETE não é confirmado.
    // econSemFiltroMes mantém todos os meses (para séries históricas); econComDados aplica
    // também o filtro de mês (para KPIs pontuais e ranking do mês selecionado).
    const econSemFiltroMes = econList.filter(r => Number(r.possui_dados_economicos) === 1);
    const econComDados = filterMonth
      ? econSemFiltroMes.filter(r => String(r.mes_referencia).startsWith(filterMonth))
      : econSemFiltroMes;

    // Cálculos de KPIs do Slide 4 (Econômico e Produção) — médias PONDERADAS pelo volume/receita
    // de cada linha, nunca média simples entre fazendas de porte muito diferente.
    const totalRegistros = econComDados.length;
    const volDiarioTotal = econComDados.reduce((acc, r) => acc + Number(r.volume_diario_litros || 0), 0);
    const volumeTotalLitros = econComDados.reduce((acc, r) => acc + Number(r.volume_leite_mes || 0), 0);
    const receitaTotalBruta = econComDados.reduce((acc, r) => acc + Number(r.receita_bruta_atividade || 0), 0);
    const coeTotalGeral = econComDados.reduce((acc, r) => acc + Number(r.coe_total_reais || 0), 0);
    const mbTotalGeral = econComDados.reduce((acc, r) => acc + Number(r.margem_bruta_total || 0), 0);
    const somaProdutividadePonderada = econComDados.reduce((acc, r) => acc + Number(r.produtividade_l_vl_dia || 0) * Number(r.vacas_lactacao || 0), 0);
    const somaVacasLactacao = econComDados.reduce((acc, r) => acc + Number(r.vacas_lactacao || 0), 0);

    const prodMedia = somaVacasLactacao > 0 ? (somaProdutividadePonderada / somaVacasLactacao) : 0;
    const precoMedio = volumeTotalLitros > 0 ? (receitaTotalBruta / volumeTotalLitros) : 0;
    const coeMedio = volumeTotalLitros > 0 ? (coeTotalGeral / volumeTotalLitros) : 0;
    const mbMedia = volumeTotalLitros > 0 ? (mbTotalGeral / volumeTotalLitros) : 0;

    const mbPositivas = econComDados.filter(r => Number(r.margem_bruta_total || 0) > 0);
    const percMbPositiva = totalRegistros > 0 ? ((mbPositivas.length / totalRegistros) * 100) : 0;

    // Breakdown Top 5 Itens COE
    const coeConcentrado = econComDados.reduce((acc, r) => acc + Number(r.coe_concentrado || 0), 0);
    const coeVolumoso = econComDados.reduce((acc, r) => acc + Number(r.coe_volumoso || 0), 0);
    const coeMaoDeObra = econComDados.reduce((acc, r) => acc + Number(r.coe_mao_de_obra || 0), 0);
    const coeSanidade = econComDados.reduce((acc, r) => acc + Number(r.coe_sanidade || 0), 0);
    const coeOutros = econComDados.reduce((acc, r) => acc + Number(r.coe_outros || 0), 0);

    const top5Coe = [
      { item: 'Concentrado', valor: coeConcentrado },
      { item: 'Volumoso / Forragem', valor: coeVolumoso },
      { item: 'Mão de Obra', valor: coeMaoDeObra },
      { item: 'Sanidade / Hormônios', valor: coeSanidade },
      { item: 'Outras Despesas', valor: coeOutros }
    ];

    // Série temporal de variação de volume mensal — usa econSemFiltroMes (todos os meses)
    // para preservar o histórico independentemente do mês selecionado no filtro principal.
    const volPorMesMap = new Map();
    econSemFiltroMes.forEach(r => {
      const mesKey = String(r.mes_referencia || '').substring(0, 7);
      if (mesKey) {
        volPorMesMap.set(mesKey, (volPorMesMap.get(mesKey) || 0) + Number(r.volume_leite_mes || (r.volume_diario_litros * 30) || 0));
      }
    });

    const mesKeysOrdenados = Array.from(volPorMesMap.keys()).sort();
    const volumeEvolution = mesKeysOrdenados.map((mes, idx) => {
      const volAtual = volPorMesMap.get(mes);
      const volAnterior = idx > 0 ? volPorMesMap.get(mesKeysOrdenados[idx - 1]) : null;
      let varPerc = 0;
      if (volAnterior && volAnterior > 0) {
        varPerc = Number((((volAtual - volAnterior) / volAnterior) * 100).toFixed(2));
      }
      return {
        mes,
        mes_label: monthLabel(mes),
        volume: volAtual,
        variacao_percentual: varPerc
      };
    });

    // Cálculos do Slide 5 (Perfil da Base e Tempo de Cadastro)
    const hoje = new Date();
    let cad1Ano = 0;
    let cad2Anos = 0;
    let cad3PlusAnos = 0;

    econComDados.forEach(r => {
      if (r.data_associacao) {
        const dtAssoc = new Date(r.data_associacao);
        const diffAnos = Math.floor((hoje - dtAssoc) / (1000 * 60 * 60 * 24 * 365.25));
        if (diffAnos <= 1) cad1Ano++;
        else if (diffAnos === 2) cad2Anos++;
        else cad3PlusAnos++;
      } else {
        cad1Ano++; // Fallback padrão
      }
    });

    const totalFazendas = econComDados.length;
    const mbNegativasCount = totalFazendas - mbPositivas.length;

    // Top 10 Fazendas por Margem Bruta
    // econComDados tem uma linha por fazenda POR MÊS (id_composto = codigo_lr + mes_referencia).
    // Sem agrupar por fazenda antes de rankear, a mesma fazenda pode ocupar várias posições do
    // top 10 (uma para cada mês em que ela pontuou alto) sempre que o recorte filtrado abranger
    // mais de um mês. Aqui mantemos apenas o registro do mês mais recente por codigo_lr.
    const ultimoRegistroPorFazenda = new Map();
    econComDados.forEach(r => {
      const atual = ultimoRegistroPorFazenda.get(r.codigo_lr);
      if (!atual || String(r.mes_referencia) > String(atual.mes_referencia)) {
        ultimoRegistroPorFazenda.set(r.codigo_lr, r);
      }
    });

    const top10MbRanking = Array.from(ultimoRegistroPorFazenda.values())
      .sort((a, b) => Number(b.margem_bruta_por_litro || 0) - Number(a.margem_bruta_por_litro || 0))
      .slice(0, 10)
      .map(r => ({
        codigo_lr: r.codigo_lr,
        produtor: r.produtor || r.codigo_lr,
        margem_bruta_por_litro: Number(r.margem_bruta_por_litro || 0),
        flag_positiva: Number(r.margem_bruta_por_litro || 0) > 0
      }));

    const cadastroBreakdown = [
      { categoria: '1 ano de cadastro', count: cad1Ano, perc: totalFazendas > 0 ? Number(((cad1Ano / totalFazendas) * 100).toFixed(1)) : 0 },
      { categoria: '2 anos de cadastro', count: cad2Anos, perc: totalFazendas > 0 ? Number(((cad2Anos / totalFazendas) * 100).toFixed(1)) : 0 },
      { categoria: '3+ anos de cadastro', count: cad3PlusAnos, perc: totalFazendas > 0 ? Number(((cad3PlusAnos / totalFazendas) * 100).toFixed(1)) : 0 }
    ];

    const kpisConsolidados = {
      volume_diario_total: Math.round(volDiarioTotal),
      produtividade_l_vl_dia: Number(prodMedia.toFixed(2)),
      preco_medio_litro: Number(precoMedio.toFixed(2)),
      coe_medio_litro: Number(coeMedio.toFixed(2)),
      margem_bruta_litro: Number(mbMedia.toFixed(2)),
      perc_mb_positiva: Number(percMbPositiva.toFixed(1)),
      total_fazendas_ativas: totalFazendas,
      fazendas_mb_positiva: mbPositivas.length,
      perc_mb_positiva_base: totalFazendas > 0 ? Number(((mbPositivas.length / totalFazendas) * 100).toFixed(1)) : 0,
      fazendas_mb_negativa: mbNegativasCount,
      perc_mb_negativa: totalFazendas > 0 ? Number(((mbNegativasCount / totalFazendas) * 100).toFixed(1)) : 0,
      cad_1_ano: cad1Ano,
      perc_cad_1_ano: totalFazendas > 0 ? Number(((cad1Ano / totalFazendas) * 100).toFixed(1)) : 0,
      cad_2_anos: cad2Anos,
      perc_cad_2_anos: totalFazendas > 0 ? Number(((cad2Anos / totalFazendas) * 100).toFixed(1)) : 0,
      cad_3_plus_anos: cad3PlusAnos,
      perc_cad_3_plus_anos: totalFazendas > 0 ? Number(((cad3PlusAnos / totalFazendas) * 100).toFixed(1)) : 0
    };

    return res.status(200).json({
      kpis: kpisConsolidados,
      top5_coe: top5Coe,
      volume_evolution: volumeEvolution,
      cadastro_breakdown: cadastroBreakdown,
      top10_mb_ranking: top10MbRanking,
      slide4: {
        kpis: kpisConsolidados,
        top5_coe: top5Coe,
        volume_evolution: volumeEvolution
      },
      slide5: {
        kpis: kpisConsolidados,
        cadastro_breakdown: cadastroBreakdown,
        top10_mb_ranking: top10MbRanking
      }
    });

  } catch (error) {
    console.error('💥 Erro na API /api/economics:', error);
    return res.status(500).json({ error: 'Erro interno no servidor ao processar indicadores econômicos.' });
  }
};
