// Agroindústria e região já chegam resolvidas pelo ETL em sq_fato_economico (regra 13):
// a API apenas lê as colunas. As antigas importações sanitizeConsultorList/isTestData/
// ehCadeiaLeite/mapAgroindustria não existem mais em shared.js e faziam esta rota
// devolver HTTP 500 em toda requisição.
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
        fetchAll(() => supabase.from('sq_fato_economico').select('*')).catch(() => [])
      ),
      fetchWithCache('RAW_VINCULOS_ECON', () =>
        fetchAll(() => supabase.from('sq_raw_vinculos').select('*')).catch(() => [])
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

    // Aplicação dos filtros
    if (filterAgro) econList = econList.filter(r => r.agroindustria.toUpperCase() === filterAgro);
    if (filterRegion) econList = econList.filter(r => r.regiao.toUpperCase() === filterRegion);
    if (filterProject) econList = econList.filter(r => r.projeto.toUpperCase() === filterProject);
    if (filterStatus) econList = econList.filter(r => r.status.toUpperCase() === filterStatus);
    if (filterConsultant) econList = econList.filter(r => r.consultor.toUpperCase() === filterConsultant);
    if (filterProducer) econList = econList.filter(r => (r.produtor.toUpperCase() === filterProducer || r.codigo_lr === filterProducer));
    if (filterMonth) econList = econList.filter(r => String(r.mes_referencia).startsWith(filterMonth));

    // Cálculos de KPIs do Slide 4 (Econômico e Produção)
    const totalRegistros = econList.length;
    const volDiarioTotal = econList.reduce((acc, r) => acc + Number(r.volume_diario_litros || 0), 0);
    const prodMedia = totalRegistros > 0 ? (econList.reduce((acc, r) => acc + Number(r.produtividade_l_vl_dia || 0), 0) / totalRegistros) : 0;
    const precoMedio = totalRegistros > 0 ? (econList.reduce((acc, r) => acc + Number(r.preco_medio_litro || 0), 0) / totalRegistros) : 0;
    const coeMedio = totalRegistros > 0 ? (econList.reduce((acc, r) => acc + Number(r.coe_por_litro || 0), 0) / totalRegistros) : 0;
    const mbMedia = totalRegistros > 0 ? (econList.reduce((acc, r) => acc + Number(r.margem_bruta_por_litro || 0), 0) / totalRegistros) : 0;
    
    const mbPositivas = econList.filter(r => Number(r.margem_bruta_por_litro || r.margem_bruta_total || 0) > 0);
    const percMbPositiva = totalRegistros > 0 ? ((mbPositivas.length / totalRegistros) * 100) : 0;

    // Breakdown Top 5 Itens COE
    const coeConcentrado = econList.reduce((acc, r) => acc + Number(r.coe_concentrado || 0), 0);
    const coeVolumoso = econList.reduce((acc, r) => acc + Number(r.coe_volumoso || 0), 0);
    const coeMaoDeObra = econList.reduce((acc, r) => acc + Number(r.coe_mao_de_obra || 0), 0);
    const coeSanidade = econList.reduce((acc, r) => acc + Number(r.coe_sanidade || 0), 0);
    const coeOutros = econList.reduce((acc, r) => acc + Number(r.coe_outros || 0), 0);

    const top5Coe = [
      { item: 'Concentrado', valor: coeConcentrado },
      { item: 'Volumoso / Forragem', valor: coeVolumoso },
      { item: 'Mão de Obra', valor: coeMaoDeObra },
      { item: 'Sanidade / Hormônios', valor: coeSanidade },
      { item: 'Outras Despesas', valor: coeOutros }
    ];

    // Série temporal de variação de volume mensal
    const volPorMesMap = new Map();
    econList.forEach(r => {
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

    econList.forEach(r => {
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

    const totalFazendas = econList.length;
    const mbNegativasCount = totalFazendas - mbPositivas.length;

    // Top 10 Fazendas por Margem Bruta
    const top10MbRanking = [...econList]
      .sort((a, b) => Number(b.margem_bruta_por_litro || 0) - Number(a.margem_bruta_por_litro || 0))
      .slice(0, 10)
      .map(r => ({
        codigo_lr: r.codigo_lr,
        produtor: r.produtor || r.codigo_lr,
        margem_bruta_por_litro: Number(r.margem_bruta_por_litro || 0),
        flag_positiva: Number(r.margem_bruta_por_litro || 0) > 0
      }));

    return res.status(200).json({
      slide4: {
        kpis: {
          volume_diario_total: Math.round(volDiarioTotal),
          produtividade_l_vl_dia: Number(prodMedia.toFixed(2)),
          preco_medio_litro: Number(precoMedio.toFixed(2)),
          coe_medio_litro: Number(coeMedio.toFixed(2)),
          margem_bruta_litro: Number(mbMedia.toFixed(2)),
          perc_mb_positiva: Number(percMbPositiva.toFixed(1))
        },
        top5_coe: top5Coe,
        volume_evolution: volumeEvolution
      },
      slide5: {
        kpis: {
          total_fazendas_ativas: totalFazendas,
          fazendas_mb_positiva: mbPositivas.length,
          perc_mb_positiva: totalFazendas > 0 ? Number(((mbPositivas.length / totalFazendas) * 100).toFixed(1)) : 0,
          fazendas_mb_negativa: mbNegativasCount,
          perc_mb_negativa: totalFazendas > 0 ? Number(((mbNegativasCount / totalFazendas) * 100).toFixed(1)) : 0,
          cad_1_ano: cad1Ano,
          perc_cad_1_ano: totalFazendas > 0 ? Number(((cad1Ano / totalFazendas) * 100).toFixed(1)) : 0,
          cad_2_anos: cad2Anos,
          perc_cad_2_anos: totalFazendas > 0 ? Number(((cad2Anos / totalFazendas) * 100).toFixed(1)) : 0,
          cad_3_plus_anos: cad3PlusAnos,
          perc_cad_3_plus_anos: totalFazendas > 0 ? Number(((cad3PlusAnos / totalFazendas) * 100).toFixed(1)) : 0
        },
        cadastro_breakdown: [
          { categoria: '1 ano de cadastro', count: cad1Ano, perc: totalFazendas > 0 ? Number(((cad1Ano / totalFazendas) * 100).toFixed(1)) : 0 },
          { categoria: '2 anos de cadastro', count: cad2Anos, perc: totalFazendas > 0 ? Number(((cad2Anos / totalFazendas) * 100).toFixed(1)) : 0 },
          { categoria: '3+ anos de cadastro', count: cad3PlusAnos, perc: totalFazendas > 0 ? Number(((cad3PlusAnos / totalFazendas) * 100).toFixed(1)) : 0 }
        ],
        top10_mb_ranking: top10MbRanking
      }
    });

  } catch (error) {
    console.error('💥 Erro na API /api/economics:', error);
    return res.status(500).json({ error: 'Erro interno no servidor ao processar indicadores econômicos.' });
  }
};
