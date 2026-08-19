/**
 * Controlador da interface e integração somente leitura com as APIs do dashboard.
 */
document.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const themeToggle = document.getElementById('themeToggle');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const carousel = new DashboardCarousel({ slideDuration: 30000 });
  const charts = new DashboardCharts();
  const state = { overview: null, visits: null, turnover: null, consistency: null, rankingDimension: 'producer' };
  const projectOptions = [
    { value: 'ALVOAR ASSIST', label: 'Alvoar Assist' },
    { value: 'ALVOAR ECO', label: 'Alvoar Eco' },
    { value: 'ATEG_CCPR', label: 'Ateg_Ccpr' },
    { value: 'LPA', label: 'Lpa' },
    { value: 'REGENERA', label: 'Regenera' },
    { value: 'SEMEAR', label: 'Semear' }
  ];

  const emptyState = {
    overview: {
      refMonth: null,
      kpis: {},
      evolucaoMensal: { labels: [], fazendasAtivas: [], fazendasVisitadas: [], percCobertura: [] },
      evolucaoVisitas: { labels: [], values: [] },
      rankingProdutores: { labels: [], values: [] },
      filterOptions: { agroindustrias: [], regioes: [], projetos: projectOptions.map((p) => p.value), status: ['ATIVO', 'INATIVO'], meses: [] },
      tabelas: { movimentacao: [], sem_visita: [], visitados: [] }
    },
    visits: {
      kpis: {},
      rankingConsultores: { labels: [], coberturas: [], visitas: [] },
      tabelaConsultores: []
    },
    turnover: {
      kpis: {},
      historicoMovimentacao: { labels: [], entradas: [], saidas: [] },
      historicoCarteira: { labels: [], values: [] },
      tabelaMovimentacao: []
    },
    consistency: {
      kpis: {},
      evolucaoConsistencia: { labels: [], mensal: [], anual: [] },
      distribuicaoDonut: { labels: ['Registros aptos', 'Registros incompletos', 'Registros divergentes'], values: [0, 0, 0] },
      tabelaProdutoresComDados: [],
      tabelaInconsistentes: []
    }
  };

  const el = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '—').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const number = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('pt-BR') : '—';
  const percent = (value) => value === null || value === undefined || value === '' ? '—' : `${String(value).replace('.', ',')}%`;
  const date = (value) => {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString('pt-BR');
  };

  function isStatusInconsistente(statusStr) {
    if (!statusStr) return false;
    const normalized = String(statusStr)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
    if (normalized.includes('SEM DADOS') || normalized.includes('NAO CALCULADO') || normalized.includes('PENDENTE')) {
      return false;
    }
    return normalized.includes('INCONSIST') || normalized.includes('DIVERG');
  }

  function updateValue(id, value) {
    const node = el(id);
    if (!node) return;
    const text = String(value ?? '—');
    if (node.textContent !== text) {
      node.textContent = text;
      node.classList.remove('pulse-update');
      void node.offsetWidth;
      node.classList.add('pulse-update');
    }
  }

  function setTheme(theme, persist = true) {
    root.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    const isDark = root.dataset.theme === 'dark';
    themeToggle?.setAttribute('aria-pressed', String(isDark));
    themeToggle?.setAttribute('aria-label', `Ativar modo ${isDark ? 'claro' : 'escuro'}`);
    const label = themeToggle?.querySelector('.theme-toggle-label');
    if (label) label.textContent = `Modo ${isDark ? 'claro' : 'escuro'}`;
    if (themeMeta) themeMeta.content = isDark ? '#072824' : '#ffffff';
    if (persist) {
      try { localStorage.setItem('lr-dashboard-theme', root.dataset.theme); } catch (_) { /* preferência opcional */ }
    }
    charts.applyTheme();
  }

  setTheme(root.dataset.theme, false);
  themeToggle?.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));

  function updateClock() {
    const now = new Date();
    if (el('headerClock')) el('headerClock').textContent = now.toLocaleTimeString('pt-BR');
  }
  updateClock();
  setInterval(updateClock, 1000);

  async function getJson(url) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`${url} indisponível.`, error);
      return null;
    }
  }

  function renderOverview(data) {
    const kpi = data.kpis || {};
    const totalActive = Number(kpi.produtores_ativos) || 0;
    const totalVisited = Number(kpi.produtores_visitados) || Math.max(0, totalActive - Number(state.visits?.kpis?.fazendas_nao_visitadas || 0));
    updateValue('kpiVisitsTotal', number(kpi.total_visitas));
    updateValue('kpiVisitsActive', number(kpi.produtores_ativos));
    updateValue('kpiVisitsVisited', number(totalVisited));
    updateValue('kpiVisitsCoverage', percent(kpi.perc_visitados));
    updateValue('kpiVisitsPerProducer', String(kpi.visitas_por_produtor || '—').replace('.', ','));
    updateValue('kpiVisitsMissing', number(Math.max(0, totalActive - totalVisited)));

    updateValue('kpiTurnActive', number(kpi.produtores_ativos));
    updateValue('kpiDataProducers', number(kpi.produtores_com_dados));
    updateValue('kpiDataEligible', number(state.consistency?.kpis?.fazendas_aptas || kpi.produtores_com_dados));

    charts.renderCoverage('chartVisitsCoverage', data.evolucaoMensal || emptyState.overview.evolucaoMensal);
    renderSelectedRanking();
  }

  function renderSelectedRanking() {
    const isConsultant = state.rankingDimension === 'consultant';
    const producerRanking = state.overview?.rankingProdutores || emptyState.overview.rankingProdutores;
    const consultantSource = state.visits?.rankingConsultores || emptyState.visits.rankingConsultores;
    let rawRanking = isConsultant
      ? { labels: consultantSource.labels || [], values: consultantSource.visitas || [] }
      : { labels: producerRanking.labels || [], values: producerRanking.values || [] };

    // Ordenação estrita do MAIOR para o MENOR valor
    const paired = (rawRanking.labels || []).map((label, idx) => ({
      label,
      value: Number(rawRanking.values?.[idx]) || 0
    }));
    paired.sort((a, b) => b.value - a.value);

    const ranking = {
      labels: paired.map((item) => item.label),
      values: paired.map((item) => item.value)
    };

    const viewport = el('rankingChartViewport');
    const inner = el('rankingChartInner');
    if (viewport && inner) {
      const availableHeight = Math.max(viewport.clientHeight, 170);
      inner.style.height = `${Math.max(availableHeight, ranking.labels.length * 28 + 8)}px`;
      viewport.scrollTop = 0;
    }
    charts.renderRanking('chartVisitsRanking', ranking);
    if (el('rankingSubtitle')) el('rankingSubtitle').textContent = `Ranking por ${isConsultant ? 'consultor' : 'produtor'}`;
    document.querySelectorAll('[data-ranking]').forEach((button) => {
      const active = button.dataset.ranking === state.rankingDimension;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function renderVisits(data) {
    const kpi = data.kpis || {};
    updateValue('kpiVisitsCoverage', percent(kpi.perc_cobertura_geral || state.overview?.kpis?.perc_visitados));
    updateValue('kpiVisitsTotal', number(kpi.total_visitas || state.overview?.kpis?.total_visitas));
    updateValue('kpiVisitsMissing', number(kpi.fazendas_nao_visitadas));
    updateValue('kpiTurnConsultants', number(data.tabelaConsultores?.length || state.overview?.kpis?.consultores_ativos));
  }

  function renderTurnover(data) {
    const kpi = data.kpis || {};
    updateValue('kpiTurnEntradas', number(kpi.entradas_mes));
    updateValue('kpiTurnSaidas', number(kpi.saidas_mes));
    updateValue('kpiTurnSaldo', Number(kpi.saldo) >= 0 ? `+${number(kpi.saldo)}` : number(kpi.saldo));
    updateValue('kpiTurnChurn', percent(kpi.taxa_churn));
    charts.renderTurnover('chartTurnoverHistory', data.historicoMovimentacao || emptyState.turnover.historicoMovimentacao);
    charts.renderPortfolio('chartPortfolioHistory', data.historicoCarteira || emptyState.turnover.historicoCarteira);
  }

  function renderConsistency(data) {
    const kpi = data.kpis || {};
    const values = data.distribuicaoDonut?.values || [];
    const base = Number(kpi.base_analisada) || values.reduce((sum, item) => sum + Number(item || 0), 0);
    const divergences = Number(kpi.registros_divergentes) || Number(values[1] || 0);
    updateValue('kpiDataProducers', number(kpi.produtores_com_dados || state.overview?.kpis?.produtores_com_dados));
    updateValue('kpiDataEligible', number(kpi.fazendas_aptas || kpi.produtores_com_dados || state.overview?.kpis?.produtores_com_dados));
    updateValue('kpiDataMonthly', percent(kpi.perc_consistente));
    updateValue('kpiDataAnnual', percent(kpi.perc_anual));
    updateValue('kpiDataDivergent', number(divergences));
    updateValue('kpiDataBase', number(base));
    charts.renderConsistencyHistory('chartConsistencyHistory', data.evolucaoConsistencia || emptyState.consistency.evolucaoConsistencia);
    charts.renderQuality('chartDataQuality', data.distribuicaoDonut || emptyState.consistency.distribuicaoDonut);
  }

  function currentFilter() {
    return {
      industry: el('filterIndustry')?.value || '',
      region: el('filterRegion')?.value || '',
      project: el('filterProject')?.value || '',
      status: el('filterStatus')?.value || '',
      consultant: el('filterConsultant')?.value || '',
      producer: el('filterProducer')?.value || '',
      month: el('filterMonth')?.value || ''
    };
  }

  function dimensionMatches(rowValue, filterValue) {
    if (!filterValue) return true;
    if (rowValue === null || rowValue === undefined || rowValue === '' || rowValue === 'Todos') return true;
    const expected = String(filterValue).toLocaleLowerCase('pt-BR');
    const values = Array.isArray(rowValue) ? rowValue : [rowValue];
    return values.some((value) => String(value).toLocaleLowerCase('pt-BR') === expected);
  }

  function normalizeStatus(value) {
    const normalized = String(value || '').trim().toLocaleUpperCase('pt-BR');
    if (normalized.startsWith('INATIV')) return 'INATIVO';
    if (normalized.startsWith('ATIV')) return 'ATIVO';
    return normalized;
  }

  function fixMojibake(str) {
    if (!str) return '';
    return String(str)
      .replace(/Ã§/g, 'ç')
      .replace(/Ã‡/g, 'Ç')
      .replace(/Ã¡/g, 'á')
      .replace(/Ã /g, 'Á')
      .replace(/Ã¢/g, 'â')
      .replace(/Ã‚/g, 'Â')
      .replace(/Ã£/g, 'ã')
      .replace(/Ãƒ/g, 'Ã')
      .replace(/Ã©/g, 'é')
      .replace(/Ã‰/g, 'É')
      .replace(/Ãª/g, 'ê')
      .replace(/ÃŠ/g, 'Ê')
      .replace(/Ã­/g, 'í')
      .replace(/Ã /g, 'Í')
      .replace(/Ã³/g, 'ó')
      .replace(/Ã“/g, 'Ó')
      .replace(/Ã´/g, 'ô')
      .replace(/Ã”/g, 'Ô')
      .replace(/Ãµ/g, 'õ')
      .replace(/Ã•/g, 'Õ')
      .replace(/Ãº/g, 'ú')
      .replace(/Ãš/g, 'Ú');
  }

  const KNOWN_ACRONYMS = new Set(['AL', 'MG', 'SP', 'GO', 'CE', 'BA', 'SE', 'PE', 'RJ', 'PR', 'SC', 'RS', 'ES', 'MT', 'MS', 'RO', 'AC', 'AM', 'PA', 'MA', 'PI', 'RN', 'PB', 'TO', 'DF']);
  const LOWERCASE_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

  function formatSingleRegionName(raw) {
    const str = fixMojibake(raw).trim();
    if (!str) return null;

    const explicitMap = {
      'alagoas': 'Alagoas',
      'aracatuba': 'Araçatuba',
      'bahia': 'Bahia',
      'batalha/al': 'Batalha/AL',
      'ceara': 'Ceará',
      'goiania': 'Goiânia',
      'ibia': 'Ibiá',
      'independente': 'Independente',
      'itambacuri': 'Itambacuri',
      'ituiutaba': 'Ituiutaba',
      'minas gerais': 'Minas Gerais',
      'montes claros': 'Montes Claros',
      'patos de minas': 'Patos de Minas',
      'pedra do forte': 'Pedra do Forte',
      'pernambuco': 'Pernambuco',
      'ponte nova': 'Ponte Nova',
      'quixeramobim': 'Quixeramobim',
      'sergipe': 'Sergipe',
      'sertao norte': 'Sertão Norte',
      'sul de minas': 'Sul de Minas',
      'triangulo mineiro': 'Triângulo Mineiro'
    };

    const suffixMatch = str.match(/\s*-\s*(\d+)\s*$/);
    let base = str;
    let suffix = '';
    if (suffixMatch) {
      base = str.substring(0, suffixMatch.index).trim();
      suffix = ` - ${suffixMatch[1]}`;
    }

    const baseKey = base.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    if (explicitMap[baseKey]) {
      return explicitMap[baseKey] + suffix;
    }

    const words = base.split(/\s+/);
    const formattedWords = words.map((w, idx) => {
      const wUpper = w.toUpperCase();
      if (KNOWN_ACRONYMS.has(wUpper)) return wUpper;
      const wLower = w.toLowerCase();
      if (idx > 0 && LOWERCASE_WORDS.has(wLower)) return wLower;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });

    return formattedWords.join(' ') + suffix;
  }

  function sanitizeRegiao(rawRegion) {
    if (!rawRegion) return null;
    const str = fixMojibake(String(rawRegion).trim());
    if (!str) return null;

    const upper = str.toUpperCase().trim();
    if (
      upper === '1' ||
      upper === '0' ||
      upper === 'TESTE' ||
      upper === 'TEST' ||
      upper === 'LABOR RURAL' ||
      upper === 'UNIDADE GENERICA' ||
      upper === 'NÃO INFORMADA' ||
      upper === 'NAO INFORMADA' ||
      /^\d+$/.test(upper)
    ) {
      return null;
    }

    if (str.includes('/')) {
      const parts = str.split('/').map(p => p.trim()).filter(Boolean);
      const cleanParts = parts.map(part => formatSingleRegionName(part)).filter(Boolean);
      if (cleanParts.length === 0) return null;

      // Preservar formato Cidade/UF (ex: BATALHA/AL)
      const lastPart = cleanParts[cleanParts.length - 1];
      if (cleanParts.length === 2 && KNOWN_ACRONYMS.has(lastPart.toUpperCase())) {
        return `${cleanParts[0]}/${lastPart.toUpperCase()}`;
      }

      // Ordenar alfabeticamente para estados compostos (ex: Sergipe/Bahia -> Bahia/Sergipe)
      cleanParts.sort((a, b) => a.localeCompare(b, 'pt-BR'));
      return cleanParts.join('/');
    }

    return formatSingleRegionName(str);
  }

  const LAC_CONSULTORIA_RAW = new Set([
    'CELIO ROBERTO OLIVEIRA (REGENERA)',
    'SUELY DE JESUS OLIVEIRA (REGENERA)'
  ]);

  function sanitizeConsultorList(rawName) {
    if (!rawName) return [''];
    return String(rawName)
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((part) => {
        const upper = part.toUpperCase();
        if (LAC_CONSULTORIA_RAW.has(upper)) return 'LAC CONSULTORIA';
        return part.replace(/\s*\([^)]+\)\s*$/, '').trim() || part;
      });
  }

  function matches(row, filter, ignoreMonth = false) {
    const rawConsultant = String(row.consultor || row.nome_consultor || '');
    const consultores = sanitizeConsultorList(rawConsultant).map((c) => c.toLocaleLowerCase('pt-BR'));
    const filterConsult = (filter.consultant || '').toLocaleLowerCase('pt-BR');
    const consultantMatch = !filterConsult ||
      consultores.includes(filterConsult) ||
      rawConsultant.toLocaleLowerCase('pt-BR').includes(filterConsult);

    const producer = String(row.produtor || row.nome_produtor || row.propriedade || '').toLocaleLowerCase('pt-BR');
    const rowRegion = sanitizeRegiao(row.regiao || row.regioes);
    const filterRegion = sanitizeRegiao(filter.region);
    const rowMonth = String(row.mes_referencia || row.data_referencia || '').slice(0, 10);
    const monthMatch = ignoreMonth || !filter.month || !rowMonth || dimensionMatches(rowMonth, filter.month);

    return consultantMatch &&
      (!filter.producer || producer === filter.producer.toLocaleLowerCase('pt-BR')) &&
      dimensionMatches(row.agroindustria || row.agroindustrias, filter.industry) &&
      (!filterRegion || rowRegion === filterRegion) &&
      dimensionMatches(row.projeto || row.projetos, filter.project) &&
      (!filter.status || normalizeStatus(row.status) === normalizeStatus(filter.status)) &&
      monthMatch;
  }

  // Estado de ordenação para cada tabela do dashboard
  const tableSort = {
    tbodySemVisita: { colKey: null, dir: 'asc' },
    tbodyVisitados: { colKey: null, dir: 'asc' },
    tbodyTurnover: { colKey: null, dir: 'asc' },
    tbodyConsultants: { colKey: null, dir: 'asc' },
    tbodyDataProducers: { colKey: null, dir: 'asc' },
    tbodyInconsistencies: { colKey: null, dir: 'asc' }
  };

  let loadingTimeout = null;

  function showLoading(message = 'Atualizando dashboard com filtros...') {
    const overlay = el('loadingOverlay');
    if (!overlay) return;
    const textEl = overlay.querySelector('.loading-text');
    if (textEl) textEl.textContent = message;
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function hideLoading(delay = 0) {
    clearTimeout(loadingTimeout);
    if (delay <= 0) {
      const overlay = el('loadingOverlay');
      if (overlay) {
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
      }
      return;
    }
    loadingTimeout = setTimeout(() => {
      const overlay = el('loadingOverlay');
      if (!overlay) return;
      overlay.classList.remove('active');
      overlay.setAttribute('aria-hidden', 'true');
    }, delay);
  }

  function parseSortValue(value) {
    if (value === null || value === undefined || value === '' || value === '—') return null;
    if (typeof value === 'number') return value;
    const str = String(value).trim();
    if (/^-?\d+([.,]\d+)?%?$/.test(str)) {
      return parseFloat(str.replace('%', '').replace(/\./g, '').replace(',', '.'));
    }
    const brDateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
    if (brDateMatch) {
      return new Date(`${brDateMatch[3]}-${brDateMatch[2]}-${brDateMatch[1]}`).getTime();
    }
    return str.toLocaleLowerCase('pt-BR');
  }

  function sortRows(rows, sortConfig, keyGetter) {
    if (!sortConfig || !sortConfig.colKey) return rows;
    const { colKey, dir } = sortConfig;
    return [...rows].sort((a, b) => {
      const valA = parseSortValue(keyGetter(a, colKey));
      const valB = parseSortValue(keyGetter(b, colKey));
      if (valA === null && valB === null) return 0;
      if (valA === null) return 1;
      if (valB === null) return -1;
      let res = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        res = valA - valB;
      } else {
        res = String(valA).localeCompare(String(valB), 'pt-BR');
      }
      return dir === 'asc' ? res : -res;
    });
  }

  function rowsOrEmpty(rows, columns, mapper) {
    if (!rows.length) return `<tr><td colspan="${columns}" class="empty-cell">Nenhum registro para os filtros selecionados.</td></tr>`;
    return rows.map(mapper).join('');
  }

  function updateCount(id, rows) {
    const node = el(id);
    if (!node) return;
    node.textContent = `${rows.length} registros`;
  }

  function updateTableHeadIcons(tbodyId, activeColKey, dir) {
    const tbody = el(tbodyId);
    if (!tbody) return;
    const table = tbody.closest('table');
    if (!table) return;
    table.querySelectorAll('th').forEach((th) => {
      const key = th.dataset.sortKey;
      th.classList.remove('sort-asc', 'sort-desc');
      if (key && key === activeColKey) {
        th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  let isTableResizing = false;
  let tableResizeEndTime = 0;

  function setupTableSorting() {
    const MAPPINGS = {
      tbodySemVisita: ['consultor', 'codigo_lr', 'produtor', 'data_vinculacao', 'dias_sem_visita', 'status'],
      tbodyVisitados: ['consultor', 'codigo_lr', 'produtor', 'profissao', 'atendimento', 'data_visita', 'elabore_ok'],
      tbodyTurnover: ['produtor', 'tipo', 'data', 'grupo', 'motivo'],
      tbodyConsultants: ['consultor', 'total_fazendas', 'fazendas_visitadas', 'total_visitas', 'perc_cobertura', 'status'],
      tbodyDataProducers: ['codigo_lr', 'produtor', 'consultor', 'possui_dados', 'referencia', 'status'],
      tbodyInconsistencies: ['produtor', 'consultor', 'projeto', 'meses_sequenciais', 'consistencia', 'acao']
    };

    Object.entries(MAPPINGS).forEach(([tbodyId, colKeys]) => {
      const tbody = el(tbodyId);
      if (!tbody) return;
      const table = tbody.closest('table');
      if (!table) return;
      const ths = table.querySelectorAll('thead th');
      ths.forEach((th, idx) => {
        const key = colKeys[idx];
        if (!key || key === 'acao') return;
        th.dataset.sortKey = key;
        th.classList.add('sortable');
        th.title = `Clique para ordenar por ${th.textContent.trim()}`;
        th.addEventListener('click', (e) => {
          // Bloqueia ordenação se o usuário estiver redimensionando colunas ou acabou de soltar a divisória
          if (e.target.closest('.col-resizer') || isTableResizing || (Date.now() - tableResizeEndTime < 350)) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }

          const current = tableSort[tbodyId] || { colKey: null, dir: 'asc' };
          if (current.colKey === key) {
            current.dir = current.dir === 'asc' ? 'desc' : 'asc';
          } else {
            current.colKey = key;
            current.dir = 'asc';
          }
          tableSort[tbodyId] = current;
          showLoading('Ordenando dados...');
          setTimeout(() => {
            renderTables();
            hideLoading(150);
          }, 60);
        });
      });
    });
  }

  function setupColumnResizers() {
    document.querySelectorAll('.data-table').forEach((table) => {
      const ths = table.querySelectorAll('thead th');
      const tableScroll = table.closest('.table-scroll');

      ths.forEach((th, idx) => {
        if (th.querySelector('.col-resizer')) return;

        const resizer = document.createElement('span');
        resizer.className = 'col-resizer';
        resizer.title = 'Arraste para redimensionar a coluna ou dê um duplo clique para auto-ajustar';
        th.appendChild(resizer);

        // Previne que cliques isolados na alça disparem ordenação
        resizer.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
        });

        let startX = 0;
        let startWidth = 0;
        let rafId = null;

        const initExplicitWidths = () => {
          if (!table.dataset.hasExplicitWidths) {
            ths.forEach((colTh) => {
              const currentW = Math.round(colTh.getBoundingClientRect().width);
              colTh.style.width = `${currentW}px`;
              colTh.style.minWidth = `${currentW}px`;
            });
            table.dataset.hasExplicitWidths = 'true';
            table.style.width = 'max-content';
            table.style.minWidth = '100%';
            if (tableScroll) tableScroll.style.overflowX = 'auto';
          }
        };

        const onMouseMove = (e) => {
          const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
          const diff = clientX - startX;
          const newWidth = Math.max(50, startWidth + diff);

          if (rafId) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
            th.style.width = `${newWidth}px`;
            th.style.minWidth = `${newWidth}px`;
          });
        };

        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          document.removeEventListener('touchmove', onMouseMove);
          document.removeEventListener('touchend', onMouseUp);
          document.body.classList.remove('table-resizing');
          resizer.classList.remove('is-active');

          isTableResizing = false;
          tableResizeEndTime = Date.now();
        };

        const startResize = (clientX) => {
          isTableResizing = true;
          initExplicitWidths();

          startX = clientX;
          startWidth = th.offsetWidth;
          resizer.classList.add('is-active');
          document.body.classList.add('table-resizing');

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp, { once: false });
        };

        resizer.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          startResize(e.clientX);
        });

        resizer.addEventListener('touchstart', (e) => {
          e.stopPropagation();
          startResize(e.touches[0].clientX);
          document.addEventListener('touchmove', onMouseMove, { passive: false });
          document.addEventListener('touchend', onMouseUp, { once: false });
        }, { passive: false });

        resizer.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          e.preventDefault();
          isTableResizing = true;
          initExplicitWidths();

          const tableRows = table.querySelectorAll('tbody tr');
          let maxWidth = th.textContent.trim().length * 8.5 + 24;

          const ruler = document.createElement('span');
          ruler.style.visibility = 'hidden';
          ruler.style.position = 'absolute';
          ruler.style.whiteSpace = 'nowrap';
          ruler.style.font = '600 11px "Open Sans", sans-serif';
          document.body.appendChild(ruler);

          tableRows.forEach((tr) => {
            const cell = tr.children[idx];
            if (cell) {
              ruler.textContent = cell.textContent.trim();
              const w = ruler.offsetWidth + 22;
              if (w > maxWidth) maxWidth = w;
            }
          });

          document.body.removeChild(ruler);
          const optimalWidth = Math.min(520, Math.max(65, Math.ceil(maxWidth)));

          th.style.width = `${optimalWidth}px`;
          th.style.minWidth = `${optimalWidth}px`;

          isTableResizing = false;
          tableResizeEndTime = Date.now();
        });
      });
    });
  }

  function renderTables() {
    const filter = currentFilter();
    const overview = state.overview || emptyState.overview;
    const visits = state.visits || emptyState.visits;
    const turnover = state.turnover || emptyState.turnover;
    const consistency = state.consistency || emptyState.consistency;

    // Tabela 1: Sem Visita
    let withoutVisit = (overview.tabelas?.sem_visita || []).filter((row) => matches(row, filter, true));
    updateCount('countWithoutVisit', withoutVisit);
    withoutVisit = sortRows(withoutVisit, tableSort.tbodySemVisita, (row, key) => row[key] ?? row.data_referencia);
    updateTableHeadIcons('tbodySemVisita', tableSort.tbodySemVisita.colKey, tableSort.tbodySemVisita.dir);
    if (el('tbodySemVisita')) el('tbodySemVisita').innerHTML = rowsOrEmpty(withoutVisit, 6, (row) => {
      const hasDays = row.dias_sem_visita !== null && row.dias_sem_visita !== undefined && row.dias_sem_visita !== '';
      const days = hasDays ? Number(row.dias_sem_visita) : null;
      const isGrave = hasDays && days >= 60;
      const status = !hasDays ? 'Sem visita no período' : isGrave ? 'Sem visita > 60 dias' : days >= 45 ? 'Sem visita > 45 dias' : 'Sem visita > 30 dias';
      const rowClass = isGrave ? 'table-row-grave' : 'table-row-pending';
      const badgeClass = isGrave ? 'badge-danger' : 'badge-warning';
      const dtVinc = row.data_vinculacao || row.data_referencia || '—';
      return `<tr class="${rowClass}"><td class="col-left" title="${escapeHtml(row.consultor || '—')}">${escapeHtml(row.consultor || '—')}</td><td class="col-center"><strong>${escapeHtml(row.codigo_lr || '—')}</strong></td><td class="col-left" title="${escapeHtml(row.produtor || '—')}">${escapeHtml(row.produtor || '—')}</td><td class="col-center" title="${escapeHtml(dtVinc)}">${escapeHtml(dtVinc)}</td><td class="col-center font-tabular">${hasDays ? days : '—'}</td><td class="col-center"><span class="badge ${badgeClass}" title="${escapeHtml(status)}">${escapeHtml(status)}</span></td></tr>`;
    });

    // Tabela 2: Visitados
    let visited = (overview.tabelas?.visitados || []).filter((row) => matches(row, filter, true));
    updateCount('countVisited', visited);
    visited = sortRows(visited, tableSort.tbodyVisitados, (row, key) => row[key]);
    updateTableHeadIcons('tbodyVisitados', tableSort.tbodyVisitados.colKey, tableSort.tbodyVisitados.dir);
    if (el('tbodyVisitados')) el('tbodyVisitados').innerHTML = rowsOrEmpty(visited, 7, (row) => `<tr><td class="col-left" title="${escapeHtml(row.consultor || '—')}">${escapeHtml(row.consultor || '—')}</td><td class="col-center"><strong>${escapeHtml(row.codigo_lr || '—')}</strong></td><td class="col-left" title="${escapeHtml(row.produtor || '—')}">${escapeHtml(row.produtor || '—')}</td><td class="col-left" title="${escapeHtml(row.profissao || '—')}">${escapeHtml(row.profissao || '—')}</td><td class="col-center" title="${escapeHtml(row.atendimento || '—')}">${escapeHtml(row.atendimento || '—')}</td><td class="col-center">${escapeHtml(row.data_visita || '—')}</td><td class="col-center"><span class="badge ${row.elabore_ok === false ? 'badge-danger' : 'badge-positive'}">${row.elabore_ok === false ? 'NÃO' : 'SIM'}</span></td></tr>`);

    // Tabela 3: Turnover / Movimentação
    let movements = (turnover.tabelaMovimentacao || []).filter((row) => matches(row, filter, true));
    updateCount('countTurnover', movements);
    movements = sortRows(movements, tableSort.tbodyTurnover, (row, key) => key === 'grupo' ? (row.grupo || row.consultor) : row[key]);
    updateTableHeadIcons('tbodyTurnover', tableSort.tbodyTurnover.colKey, tableSort.tbodyTurnover.dir);
    if (el('tbodyTurnover')) el('tbodyTurnover').innerHTML = rowsOrEmpty(movements, 5, (row) => {
      const isSaida = row.tipo === 'SAÍDA';
      const grp = row.grupo || row.consultor || '—';
      return `<tr class="${isSaida ? 'table-row-grave' : ''}"><td class="col-left" title="${escapeHtml(row.produtor || '—')}"><strong>${escapeHtml(row.produtor || '—')}</strong></td><td class="col-center"><span class="badge ${isSaida ? 'badge-danger' : 'badge-positive'}">${escapeHtml(row.tipo)}</span></td><td class="col-center">${escapeHtml(row.data || '—')}</td><td class="col-left" title="${escapeHtml(grp)}">${escapeHtml(grp)}</td><td class="col-left" title="${escapeHtml(row.motivo || '—')}">${escapeHtml(row.motivo || '—')}</td></tr>`;
    });

    // Tabela 4: Consultores
    let consultants = (visits.tabelaConsultores || []).filter((row) => matches(row, filter, true));
    updateCount('countConsultants', consultants);
    consultants = sortRows(consultants, tableSort.tbodyConsultants, (row, key) => row[key]);
    updateTableHeadIcons('tbodyConsultants', tableSort.tbodyConsultants.colKey, tableSort.tbodyConsultants.dir);
    if (el('tbodyConsultants')) el('tbodyConsultants').innerHTML = rowsOrEmpty(consultants, 6, (row) => `<tr><td class="col-left" title="${escapeHtml(row.consultor || '—')}"><strong>${escapeHtml(row.consultor || '—')}</strong></td><td class="col-center font-tabular">${number(row.total_fazendas)}</td><td class="col-center font-tabular">${number(row.fazendas_visitadas)}</td><td class="col-center font-tabular">${number(row.total_visitas)}</td><td class="col-center font-tabular">${percent(row.perc_cobertura)}</td><td class="col-center"><span class="badge badge-positive">ATIVO</span></td></tr>`);

    // Tabela 5: Produtores com Dados
    let withData = (consistency.tabelaProdutoresComDados || []).filter((row) => matches(row, filter, true));
    updateCount('countDataProducers', withData);
    withData = sortRows(withData, tableSort.tbodyDataProducers, (row, key) => key === 'produtor' ? (row.produtor || row.codigo_lr) : row[key]);
    updateTableHeadIcons('tbodyDataProducers', tableSort.tbodyDataProducers.colKey, tableSort.tbodyDataProducers.dir);
    if (el('tbodyDataProducers')) el('tbodyDataProducers').innerHTML = rowsOrEmpty(withData, 6, (row) => {
      const noData = row.possui_dados === false;
      const prodName = row.produtor || row.codigo_lr || '—';
      return `<tr class="${noData ? 'table-row-grave' : ''}"><td class="col-center"><strong>${escapeHtml(row.codigo_lr || '—')}</strong></td><td class="col-left" title="${escapeHtml(prodName)}">${escapeHtml(prodName)}</td><td class="col-left" title="${escapeHtml(row.consultor || '—')}">${escapeHtml(row.consultor || '—')}</td><td class="col-center"><span class="badge ${noData ? 'badge-danger' : 'badge-positive'}">${noData ? 'NÃO' : 'SIM'}</span></td><td class="col-center">${escapeHtml(row.referencia || '—')}</td><td class="col-center"><span class="badge ${String(row.status).toUpperCase() === 'INATIVO' ? 'badge-danger' : 'badge-positive'}">${escapeHtml(row.status || 'ATIVO')}</span></td></tr>`;
    });

    // Tabela 6: Inconsistências
    let inconsistencies = (consistency.tabelaInconsistentes || []).filter((row) => matches(row, filter, true));
    updateCount('countInconsistencies', inconsistencies);
    inconsistencies = sortRows(inconsistencies, tableSort.tbodyInconsistencies, (row, key) => key === 'produtor' ? (row.produtor || row.codigo_lr) : row[key]);
    updateTableHeadIcons('tbodyInconsistencies', tableSort.tbodyInconsistencies.colKey, tableSort.tbodyInconsistencies.dir);
    if (el('tbodyInconsistencies')) el('tbodyInconsistencies').innerHTML = rowsOrEmpty(inconsistencies, 6, (row, idx) => {
      const isGrave = isStatusInconsistente(row.consistencia);
      const rowClass = isGrave ? 'table-row-grave' : 'table-row-pending';
      const badgeClass = isGrave ? 'badge-danger' : 'badge-warning';
      const prodName = row.produtor || row.codigo_lr || '—';
      return `<tr class="${rowClass}"><td class="col-left" title="${escapeHtml(prodName)}"><strong>${escapeHtml(prodName)}</strong></td><td class="col-left" title="${escapeHtml(row.consultor || '—')}">${escapeHtml(row.consultor || '—')}</td><td class="col-left" title="${escapeHtml(row.projeto || '—')}">${escapeHtml(row.projeto || '—')}</td><td class="col-center font-tabular">${number(row.meses_sequenciais)}</td><td class="col-center"><span class="badge ${badgeClass}" title="${escapeHtml(row.consistencia || 'PENDENTE')}">${escapeHtml(row.consistencia || 'PENDENTE')}</span></td><td class="col-center"><button class="link-button btn-view-details" type="button" onclick="window.openInconsistencyDetail('${escapeHtml(row.codigo_lr || row.produtor)}')">Ver detalhes ›</button></td></tr>`;
    });
  }

  // ─── LÓGICA DE FILTRAGEM MULTIDIRECIONAL ESTILO POWER BI ──────────────

  const PROJECT_LABEL_MAP = {
    'ALVOAR ASSIST': 'Alvoar Assist',
    'ALVOAR ECO': 'Alvoar Eco',
    'ATEG_CCPR': 'Ateg_Ccpr',
    'LPA': 'Lpa',
    'REGENERA': 'Regenera',
    'SEMEAR': 'Semear',
    'M&E CAFE': 'M&E Café',
    'M&E CACAU': 'M&E Cacau',
    'PV CARGILL': 'PV Cargill',
    'MAIS GRAOS': 'Mais Grãos',
    'CFT PIRACANJUBA': 'CFT Piracanjuba',
    'OFI': 'OFI',
    'CAMPILEITE': 'Campileite',
    'CAFE & GESTAO': 'Café & Gestão',
    'SENAR MS': 'Senar MS',
    'COPRIL': 'Copril',
    'CFT DANONE 2026': 'CFT Danone 2026',
    'CFT_DANONE': 'CFT Danone',
    'CFT LPA 2026': 'CFT LPA 2026',
    'QUILLAYES - CFT': 'Quillayes - CFT'
  };

  function formatProjectLabel(projectCode) {
    if (!projectCode) return '';
    const code = String(projectCode).trim().toUpperCase();
    if (PROJECT_LABEL_MAP[code]) return PROJECT_LABEL_MAP[code];
    return String(projectCode)
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  function mapAgroindustria(projeto) {
    if (!projeto) return '';
    const p = String(projeto).toUpperCase();
    if (p.includes('ALVOAR')) return 'Alvoar';
    if (p.includes('CCPR')) return 'CCPR';
    if (p.includes('LPA')) return 'Laticínios Porto Alegre';
    if (p.includes('REGENERA')) return 'Nestlé';
    if (p.includes('SEMEAR') || p.includes('DANONE')) return 'Danone';
    return String(projeto).trim();
  }

  function extractMasterRows(overview, visits, turnover, consistency) {
    const o = overview || emptyState.overview;
    const v = visits || emptyState.visits;
    const t = turnover || emptyState.turnover;
    const c = consistency || emptyState.consistency;

    const rows = [];
    const seen = new Set();

    function addRow(r) {
      if (!r) return;
      const consultores = sanitizeConsultorList(r.consultor || r.nome_consultor);
      const produtor = String(r.produtor || r.nome_produtor || '').trim();
      const codigoLr = String(r.codigo_lr || '').trim();
      const agro = mapAgroindustria(r.agroindustria || r.projeto);
      const reg = sanitizeRegiao(r.regiao || r.unidade_atendimento);
      const proj = String(r.projeto || '').trim();
      const stat = normalizeStatus(r.status || 'ATIVO');
      const mes = String(r.mes_referencia || r.data_referencia || '').slice(0, 10);

      if (produtor.includes('_CONSULTOR') || produtor === 'CONTA DE SUPERVISÃO') return;

      consultores.forEach((consult) => {
        const cleanConsult = String(consult || '').trim();
        const key = `${agro}|${reg}|${proj}|${stat}|${cleanConsult}|${produtor}|${codigoLr}|${mes}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({
            agroindustria: agro || '',
            regiao: reg || '',
            projeto: proj || '',
            status: stat || 'ATIVO',
            consultor: cleanConsult || '',
            produtor: produtor || '',
            codigo_lr: codigoLr || '',
            mes_referencia: mes || ''
          });
        }
      });
    }

    (o.tabelas?.sem_visita || []).forEach(addRow);
    (o.tabelas?.visitados || []).forEach(addRow);
    (c.tabelaProdutoresComDados || []).forEach(addRow);
    (c.tabelaInconsistentes || []).forEach(addRow);
    (t.tabelaMovimentacao || []).forEach(addRow);

    return rows;
  }

  function syncCustomSelectDisplay(selectId) {
    const select = el(selectId);
    if (!select) return;
    const control = select.closest('.filter-control');
    if (!control) return;
    const displayValue = control.querySelector('.select-display-value');
    if (!displayValue) return;
    const selectedOpt = select.options[select.selectedIndex];
    displayValue.textContent = selectedOpt ? selectedOpt.text : (select.value || '');
  }

  function populateMonthSelect(values) {
    const select = el('filterMonth');
    if (!select) return;
    const current = select.value;
    const maxAllowedMonth = new Date().toISOString().slice(0, 7) + '-01';
    const unique = [...new Set((values || []).filter(Boolean).map((v) => String(v).slice(0, 10)).filter((v) => v <= maxAllowedMonth))].sort().reverse();
    const options = unique.map((value) => {
      const parsed = new Date(`${value}T12:00:00`);
      const label = Number.isNaN(parsed.getTime())
        ? value
        : parsed.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (letter) => letter.toUpperCase());
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }).join('');
    select.innerHTML = `<option value="">Atual</option>${options}`;
    if (unique.includes(current)) select.value = current;
    syncCustomSelectDisplay('filterMonth');
  }

  function updateAllCrossFilters() {
    const current = currentFilter();
    const rows = state.masterRows || [];
    if (!rows.length) return;

    function matchesActiveExcept(row, fieldKey) {
      if (fieldKey !== 'industry' && current.industry) {
        if (mapAgroindustria(row.agroindustria || row.projeto) !== current.industry) return false;
      }
      if (fieldKey !== 'region' && current.region) {
        const rowReg = sanitizeRegiao(row.regiao);
        const curReg = sanitizeRegiao(current.region);
        if (rowReg !== curReg) return false;
      }
      if (fieldKey !== 'project' && current.project) {
        if (String(row.projeto || '') !== current.project) return false;
      }
      if (fieldKey !== 'status' && current.status) {
        if (normalizeStatus(row.status) !== normalizeStatus(current.status)) return false;
      }
      if (fieldKey !== 'consultant' && current.consultant) {
        const consultores = sanitizeConsultorList(row.consultor);
        if (!consultores.some((c) => c && c.toLowerCase() === current.consultant.toLowerCase())) return false;
      }
      if (fieldKey !== 'producer' && current.producer) {
        const pName = String(row.produtor || row.codigo_lr || '').toLowerCase();
        if (pName !== current.producer.toLowerCase()) return false;
      }
      return true;
    }

    // 1. Agroindústria
    const indSelect = el('filterIndustry');
    if (indSelect) {
      const prevVal = indSelect.value;
      const validRows = rows.filter((r) => matchesActiveExcept(r, 'industry'));
      const available = [...new Set(validRows.map((r) => mapAgroindustria(r.agroindustria || r.projeto)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      indSelect.innerHTML = `<option value="">Todas</option>${available.map((ind) => `<option value="${escapeHtml(ind)}">${escapeHtml(ind)}</option>`).join('')}`;
      if (available.includes(prevVal)) indSelect.value = prevVal;
      else indSelect.value = '';
      syncCustomSelectDisplay('filterIndustry');
    }

    // 2. Região
    const regSelect = el('filterRegion');
    if (regSelect) {
      const prevVal = regSelect.value;
      const validRows = rows.filter((r) => matchesActiveExcept(r, 'region'));
      const available = [...new Set(validRows.map((r) => sanitizeRegiao(r.regiao)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      regSelect.innerHTML = `<option value="">Todas</option>${available.map((reg) => `<option value="${escapeHtml(reg)}">${escapeHtml(reg)}</option>`).join('')}`;
      if (available.includes(prevVal)) regSelect.value = prevVal;
      else regSelect.value = '';
      syncCustomSelectDisplay('filterRegion');
    }

    // 3. Projeto
    const projSelect = el('filterProject');
    if (projSelect) {
      const prevVal = projSelect.value;
      const validRows = rows.filter((r) => matchesActiveExcept(r, 'project'));
      const availableProjects = [...new Set(validRows.map((r) => r.projeto).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      projSelect.innerHTML = `<option value="">Todos</option>${availableProjects.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(formatProjectLabel(p))}</option>`).join('')}`;
      if (availableProjects.includes(prevVal)) projSelect.value = prevVal;
      else projSelect.value = '';
      syncCustomSelectDisplay('filterProject');
    }

    // 4. Status
    const statSelect = el('filterStatus');
    if (statSelect) {
      const prevVal = normalizeStatus(statSelect.value);
      const validRows = rows.filter((r) => matchesActiveExcept(r, 'status'));
      const availableStatuses = new Set(validRows.map((r) => normalizeStatus(r.status)));
      const ordered = ['ATIVO', 'INATIVO'].filter((val) => availableStatuses.has(val));
      const labels = { ATIVO: 'Ativa', INATIVO: 'Inativo' };
      statSelect.innerHTML = `<option value="">Todos</option>${ordered.map((val) => `<option value="${val}">${labels[val]}</option>`).join('')}`;
      if (ordered.includes(prevVal)) statSelect.value = prevVal;
      else statSelect.value = '';
      syncCustomSelectDisplay('filterStatus');
    }

    // 5. Consultor
    const consultSelect = el('filterConsultant');
    if (consultSelect) {
      const prevVal = consultSelect.value;
      const validRows = rows.filter((r) => matchesActiveExcept(r, 'consultant'));
      const available = [...new Set(validRows.flatMap((r) => sanitizeConsultorList(r.consultor)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      consultSelect.innerHTML = `<option value="">Todos</option>${available.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}`;
      if (available.includes(prevVal)) consultSelect.value = prevVal;
      else consultSelect.value = '';
      syncCustomSelectDisplay('filterConsultant');
    }

    // 6. Produtor
    const prodSelect = el('filterProducer');
    if (prodSelect) {
      const prevVal = prodSelect.value;
      const validRows = rows.filter((r) => matchesActiveExcept(r, 'producer'));
      const available = [...new Set(
        validRows.map((r) => r.produtor)
          .filter((p) => p && !String(p).includes('_CONSULTOR') && p !== 'CONTA DE SUPERVISÃO')
      )].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      prodSelect.innerHTML = `<option value="">Todos</option>${available.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('')}`;
      if (available.includes(prevVal)) prodSelect.value = prevVal;
      else prodSelect.value = '';
      syncCustomSelectDisplay('filterProducer');
    }
  }

  function exportTableToCsv(tableId, defaultFilename) {
    const table = el(tableId);
    if (!table) return;
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;

    const headers = Array.from(thead.querySelectorAll('th')).map((th) => {
      return th.textContent.replace(/[↑↓▲▼]/g, '').trim();
    }).filter((h) => h && h !== 'Ação');

    const rows = Array.from(tbody.querySelectorAll('tr'));
    if (rows.length === 1 && rows[0].querySelector('.empty-cell')) {
      alert('Nenhum dado disponível para exportação com os filtros atuais.');
      return;
    }

    const csvLines = [headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(';')];

    rows.forEach((tr) => {
      if (tr.querySelector('.empty-cell')) return;
      const cells = Array.from(tr.querySelectorAll('td'));
      const rowValues = [];
      cells.forEach((td, idx) => {
        if (idx < headers.length) {
          let txt = td.textContent.trim().replace(/\s+/g, ' ');
          rowValues.push(`"${txt.replace(/"/g, '""')}"`);
        }
      });
      if (rowValues.length > 0) {
        csvLines.push(rowValues.join(';'));
      }
    });

    const bom = '\uFEFF';
    const blob = new Blob([bom + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const d = new Date();
    const dateStr = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    link.href = url;
    link.download = `${dateStr}_${defaultFilename || 'export'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function exportInconsistenciesToCsv() {
    const filter = currentFilter();
    let inconsistencies = (state.consistency?.tabelaInconsistentes || []).filter((row) => matches(row, filter));
    if (!inconsistencies.length) {
      alert('Nenhum dado disponível para exportação com os filtros atuais.');
      return;
    }
    inconsistencies = sortRows(inconsistencies, tableSort.tbodyInconsistencies, (row, key) => key === 'produtor' ? (row.produtor || row.codigo_lr) : row[key]);

    const headers = [
      'ID (Código LR)',
      'Produtor(a)',
      'Consultor(a)',
      'Projeto',
      'Agroindústria',
      'Região',
      'Mês Referência',
      'Meses Consecutivos',
      'Situação',
      'Detalhamento da Inconsistência'
    ];

    const csvLines = [headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(';')];

    inconsistencies.forEach((row) => {
      const prodName = row.produtor || row.codigo_lr || '—';
      const det = row.detalhamento || 'Nenhum detalhamento registrado na base de auditoria.';
      const values = [
        row.codigo_lr || '—',
        prodName,
        row.consultor || '—',
        row.projeto || '—',
        row.agroindustria || '—',
        row.regiao || '—',
        row.mes_referencia || '—',
        row.meses_sequenciais ?? '0',
        row.consistencia || 'PENDENTE',
        det
      ];
      csvLines.push(values.map((v) => `"${String(v).trim().replace(/\r?\n/g, ' | ').replace(/"/g, '""')}"`).join(';'));
    });

    const bom = '\uFEFF';
    const blob = new Blob([bom + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const d = new Date();
    const dateStr = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    link.href = url;
    link.download = `${dateStr}_inconsistencias_identificadas.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function setupExportButtons() {
    el('btnExportSemVisita')?.addEventListener('click', () => exportTableToCsv('tableSemVisita', 'produtores_sem_visita'));
    el('btnExportVisitados')?.addEventListener('click', () => exportTableToCsv('tableVisitados', 'produtores_visitados'));
    el('btnExportTurnover')?.addEventListener('click', () => exportTableToCsv('tableTurnover', 'movimentacao_produtores'));
    el('btnExportConsultants')?.addEventListener('click', () => exportTableToCsv('tableConsultants', 'consultores_ativos'));
    el('btnExportDataProducers')?.addEventListener('click', () => exportTableToCsv('tableDataProducers', 'produtores_com_dados'));
    el('btnExportInconsistencies')?.addEventListener('click', exportInconsistenciesToCsv);
  }

  function updateTimestamp() {
    const now = new Date();
    if (el('lastUpdateTag')) el('lastUpdateTag').textContent = 'Sincronização automática';
    if (el('lastUpdateDate')) el('lastUpdateDate').textContent = `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  async function fetchMonthMasterData() {
    const selectedMonth = el('filterMonth')?.value || '';
    const query = selectedMonth ? `?month=${encodeURIComponent(selectedMonth)}` : '';
    const [overview, visits, turnover, consistency] = await Promise.all([
      getJson(`/api/overview${query}`),
      getJson(`/api/visits${query}`),
      getJson(`/api/turnover${query}`),
      getJson(`/api/consistency${query}`)
    ]);

    state.masterOverview = overview;
    state.masterVisits = visits;
    state.masterTurnover = turnover;
    state.masterConsistency = consistency;
    state.masterRows = extractMasterRows(overview, visits, turnover, consistency);

    if (overview?.filterOptions?.meses) {
      populateMonthSelect(overview.filterOptions.meses);
    }
  }

  let debounceFilterTimer = null;

  async function loadAllData(isFilterChange = false) {
    showLoading(isFilterChange ? 'Atualizando dashboard com filtros...' : 'Carregando dados...');
    if (el('lastUpdateTag')) {
      el('lastUpdateTag').textContent = 'Atualizando dashboard com filtros...';
    }

    try {
      if (!state.masterRows || state.masterRows.length === 0) {
        await fetchMonthMasterData();
        updateAllCrossFilters();
      }

      const filter = currentFilter();
      const params = new URLSearchParams();
      if (filter.month) params.set('month', filter.month);
      if (filter.industry) params.set('industry', filter.industry);
      if (filter.region) params.set('region', filter.region);
      if (filter.project) params.set('project', filter.project);
      if (filter.consultant) params.set('consultant', filter.consultant);
      if (filter.status) params.set('status', filter.status);
      if (filter.producer) params.set('producer', filter.producer);

      const query = params.toString() ? `?${params.toString()}` : '';
      const [overview, visits, turnover, consistency] = await Promise.all([
        getJson(`/api/overview${query}`),
        getJson(`/api/visits${query}`),
        getJson(`/api/turnover${query}`),
        getJson(`/api/consistency${query}`)
      ]);
      state.overview = overview;
      state.visits = visits;
      state.turnover = turnover;
      state.consistency = consistency;
      renderVisits(visits);
      renderConsistency(consistency);
      renderOverview(overview);
      renderTurnover(turnover);
      renderTables();
      updateTimestamp();
    } finally {
      hideLoading(0);
    }
  }

  function handleFilterSelectionChange() {
    showLoading('Atualizando dashboard com filtros...');
    updateAllCrossFilters();
    loadAllData(true);
  }

  function closeAllPopups() {
    document.querySelectorAll('.custom-select-popup').forEach((p) => p.classList.remove('open'));
    document.querySelectorAll('.filter-control').forEach((fc) => fc.classList.remove('active-popup'));
  }

  function normalizeText(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function setupCustomSelectDropdowns() {
    const filterControls = document.querySelectorAll('.filter-control');
    
    filterControls.forEach((control) => {
      const select = control.querySelector('select');
      if (!select) return;

      let displayValue = control.querySelector('.select-display-value');
      if (!displayValue) {
        displayValue = document.createElement('div');
        displayValue.className = 'select-display-value';
        control.appendChild(displayValue);
      }

      function syncDisplayValue() {
        const selectedOpt = select.options[select.selectedIndex];
        displayValue.textContent = selectedOpt ? selectedOpt.text : (select.value || '');
      }

      syncDisplayValue();

      let popup = control.querySelector('.custom-select-popup');
      if (!popup) {
        popup = document.createElement('div');
        popup.className = 'custom-select-popup';
        control.appendChild(popup);
      }

      select.onchange = syncDisplayValue;

      if (control.dataset.customSelectInitialized === 'true') {
        return;
      }
      control.dataset.customSelectInitialized = 'true';

      function updatePopupOptions(searchQuery = '') {
        const options = Array.from(select.options);
        const queryNorm = normalizeText(searchQuery);

        const filtered = options.filter(opt => {
          if (!queryNorm) return true;
          return normalizeText(opt.text).includes(queryNorm);
        });

        let searchWrap = popup.querySelector('.custom-select-search-wrap');
        let optionsList = popup.querySelector('.custom-select-options-list');

        if (!searchWrap || !optionsList) {
          popup.innerHTML = `
            <div class="custom-select-search-wrap">
              <input type="text" class="custom-select-search-input" placeholder="Pesquisar..." aria-label="Pesquisar opção">
            </div>
            <div class="custom-select-options-list"></div>
          `;
          searchWrap = popup.querySelector('.custom-select-search-wrap');
          optionsList = popup.querySelector('.custom-select-options-list');

          const inputEl = searchWrap.querySelector('.custom-select-search-input');
          inputEl.addEventListener('click', (e) => e.stopPropagation());
          inputEl.addEventListener('mousedown', (e) => e.stopPropagation());
          inputEl.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') closeAllPopups();
          });
          inputEl.addEventListener('input', (e) => {
            updatePopupOptions(e.target.value);
          });
        }

        if (filtered.length === 0) {
          optionsList.innerHTML = `<div class="custom-select-no-results">Nenhum resultado encontrado</div>`;
        } else {
          optionsList.innerHTML = filtered.map((opt) => {
            const isSelected = opt.value === select.value;
            return `<div class="custom-select-option ${isSelected ? 'selected' : ''}" data-value="${escapeHtml(opt.value)}">
              <span>${escapeHtml(opt.text)}</span>
              ${isSelected ? '<span style="font-size:10px;">✓</span>' : ''}
            </div>`;
          }).join('');
        }

        optionsList.querySelectorAll('.custom-select-option').forEach((optEl) => {
          optEl.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const val = optEl.dataset.value;
            select.value = val;
            syncDisplayValue();
            closeAllPopups();
            showLoading('Atualizando dashboard com filtros...');
            select.dispatchEvent(new Event('change', { bubbles: true }));
          });
        });
      }

      function togglePopup(e) {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        const isOpen = popup.classList.contains('open');
        closeAllPopups();
        if (!isOpen) {
          updatePopupOptions('');
          popup.classList.add('open');
          control.classList.add('active-popup');
          const searchInput = popup.querySelector('.custom-select-search-input');
          if (searchInput) {
            searchInput.value = '';
            setTimeout(() => searchInput.focus(), 60);
          }
        }
      }

      control.addEventListener('click', (e) => {
        if (e.target.closest('.custom-select-popup')) return;
        togglePopup(e);
      });
    });

    if (!window._customSelectDocumentListenerAttached) {
      window._customSelectDocumentListenerAttached = true;
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.filter-control')) {
          closeAllPopups();
        }
      });
    }
  }

  // Eventos de filtros com suporte a filtragem cruzada multidirecional estilo Power BI
  ['filterIndustry', 'filterRegion', 'filterProject', 'filterStatus', 'filterConsultant', 'filterProducer']
    .forEach((id) => el(id)?.addEventListener('change', handleFilterSelectionChange));
  el('filterMonth')?.addEventListener('change', async () => {
    showLoading('Atualizando dashboard com filtros...');
    state.masterRows = null;
    await fetchMonthMasterData();
    updateAllCrossFilters();
    await loadAllData(true);
  });
  document.querySelectorAll('[data-ranking]').forEach((button) => button.addEventListener('click', () => {
    state.rankingDimension = button.dataset.ranking;
    renderSelectedRanking();
  }));

  function setupDetailsModal() {
    const detailsModal = el('detailsModal');
    const modalBody = el('modalBody');
    const modalCancelBtn = el('modalCancelBtn');

    function openDetailsModal(item) {
      if (!item || !detailsModal || !modalBody) return;
      const isGrave = isStatusInconsistente(item.consistencia);
      const badgeClass = isGrave ? 'badge-danger' : 'badge-warning';
      const highlightBoxClass = isGrave ? 'field-box--danger' : 'field-box--warning';
      const statusBadge = String(item.status || 'ATIVO').toUpperCase() === 'INATIVO' ? 'badge-danger' : 'badge-positive';

      const refMonthText = item.mes_referencia ? String(item.mes_referencia).slice(0, 7).split('-').reverse().join('/') : '--/----';
      const refMonthEl = el('modalRefMonthText');
      if (refMonthEl) refMonthEl.textContent = refMonthText;

      modalBody.innerHTML = `
        <fieldset class="modal-fieldset">
          <legend class="modal-legend">Informações do Produtor e Vínculo</legend>
          <div class="detail-grid">
            <div class="detail-field">
              <label class="field-label">Código LR</label>
              <div class="field-box">${escapeHtml(item.codigo_lr || '—')}</div>
            </div>
            <div class="detail-field">
              <label class="field-label">Produtor(a)</label>
              <div class="field-box field-box--bold">${escapeHtml(item.produtor || '—')}</div>
            </div>
            <div class="detail-field">
              <label class="field-label">Consultor(a) Técnico(a)</label>
              <div class="field-box">${escapeHtml(item.consultor || '—')}</div>
            </div>
            <div class="detail-field">
              <label class="field-label">Agroindústria</label>
              <div class="field-box">${escapeHtml(item.agroindustria || item.projeto || '—')}</div>
            </div>
            <div class="detail-field">
              <label class="field-label">Região Leiteira</label>
              <div class="field-box">${escapeHtml(item.regiao || '—')}</div>
            </div>
            <div class="detail-field">
              <label class="field-label">Projeto / Programa</label>
              <div class="field-box">${escapeHtml(item.projeto || '—')}</div>
            </div>
            <div class="detail-field">
              <label class="field-label">Status Cadastral</label>
              <div class="field-box"><span class="badge ${statusBadge}">${escapeHtml(item.status || 'ATIVO')}</span></div>
            </div>
          </div>
        </fieldset>

        <fieldset class="modal-fieldset">
          <legend class="modal-legend">Indicadores de Consistência e Qualidade</legend>
          <div class="detail-grid">
            <div class="detail-field">
              <label class="field-label">Mês Referência</label>
              <div class="field-box">${escapeHtml(item.mes_referencia || '—')}</div>
            </div>
            <div class="detail-field">
              <label class="field-label">Meses Consecutivos</label>
              <div class="field-box">${number(item.meses_sequenciais)} mês(es)</div>
            </div>
            <div class="detail-field">
              <label class="field-label">Classificação da Inconsistência</label>
              <div class="field-box"><span class="badge ${badgeClass}">${escapeHtml(item.consistencia || 'PENDENTE')}</span></div>
            </div>
            <div class="detail-field field-full">
              <label class="field-label">Detalhamento da Inconsistência</label>
              <div class="field-box ${highlightBoxClass}">${escapeHtml(item.detalhamento || 'Nenhum detalhamento registrado na base de auditoria.')}</div>
            </div>
          </div>
        </fieldset>
      `;

      detailsModal.classList.add('active');
      detailsModal.setAttribute('aria-hidden', 'false');
    }

    function closeDetailsModal() {
      if (!detailsModal) return;
      detailsModal.classList.remove('active');
      detailsModal.setAttribute('aria-hidden', 'true');
    }

    modalCloseBtn?.addEventListener('click', closeDetailsModal);
    modalOkBtn?.addEventListener('click', closeDetailsModal);
    modalCancelBtn?.addEventListener('click', closeDetailsModal);
    detailsModal?.addEventListener('click', (e) => {
      if (e.target === detailsModal) closeDetailsModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && detailsModal?.classList.contains('active')) {
        closeDetailsModal();
      }
    });

    window.openInconsistencyDetail = function(codigoLr) {
      if (!codigoLr) return;
      const targetCode = String(codigoLr).trim().toLowerCase();
      const list = (state.consistency?.tabelaInconsistentes || []);
      const selectedItem = list.find(r => String(r.codigo_lr || '').trim().toLowerCase() === targetCode)
                        || list.find(r => String(r.produtor || '').trim().toLowerCase() === targetCode);
      if (selectedItem) {
        openDetailsModal(selectedItem);
      }
    };

    el('tbodyInconsistencies')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-view-details');
      if (!btn) return;
      const idx = Number(btn.dataset.idx);
      const filter = getFilterState();
      let inconsistencies = (state.consistency?.tabelaInconsistentes || []).filter((row) => matches(row, filter));
      inconsistencies = sortRows(inconsistencies, tableSort.tbodyInconsistencies, (row, key) => key === 'produtor' ? (row.produtor || row.codigo_lr) : row[key]);
      const selectedItem = inconsistencies[idx];
      if (selectedItem) openDetailsModal(selectedItem);
    });
  }

  function setupKpiInfoPopovers() {
    const popover = el('kpiInfoPopover');
    const popoverTitle = el('kpiPopoverTitle');
    const popoverBody = el('kpiPopoverBody');
    if (!popover || !popoverTitle || !popoverBody) return;

    let activeBtn = null;

    function showPopover(btn) {
      const title = btn.dataset.infoTitle || 'Informação do Indicador';
      const body = btn.dataset.infoBody || '';
      popoverTitle.textContent = title;
      popoverBody.textContent = body;

      const rect = btn.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;

      popover.style.display = 'block';
      const popoverHeight = popover.offsetHeight || 100;
      const popoverWidth = popover.offsetWidth || 270;

      let top = rect.top + scrollY - popoverHeight - 8;
      let left = rect.left + scrollX + (rect.width / 2) - (popoverWidth / 2);

      if (rect.top - popoverHeight < 10) {
        top = rect.bottom + scrollY + 8;
      }
      if (left < 10) left = 10;
      if (left + popoverWidth > window.innerWidth - 10) {
        left = window.innerWidth - popoverWidth - 10;
      }

      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
      popover.classList.add('active');
      popover.setAttribute('aria-hidden', 'false');
      activeBtn = btn;
    }

    function hidePopover() {
      popover.classList.remove('active');
      popover.setAttribute('aria-hidden', 'true');
      activeBtn = null;
    }

    document.querySelectorAll('.kpi-info-btn').forEach((btn) => {
      btn.addEventListener('mouseenter', () => showPopover(btn));
      btn.addEventListener('mouseleave', () => hidePopover());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeBtn === btn) {
          hidePopover();
        } else {
          showPopover(btn);
        }
      });
    });

    document.addEventListener('click', (e) => {
      if (activeBtn && !popover.contains(e.target) && !e.target.closest('.kpi-info-btn')) {
        hidePopover();
      }
    });

    window.addEventListener('scroll', hidePopover, { passive: true });
  }

  function setupProvenanceModal() {
    const modalOverlay = el('modalProvenanceOverlay');
    const btnProvenance = el('btnProvenance');
    const closeBtn = el('provCloseBtn');
    const okBtn = el('provOkBtn');
    const groupsContainer = el('provGroupsContainer');
    const totalBadge = el('provTotalFilesBadge');
    const summaryDir = el('provSummaryDir');
    const summaryInspection = el('provSummaryInspection');

    function openModal() {
      modalOverlay.classList.add('active');
      modalOverlay.setAttribute('aria-hidden', 'false');
      renderProvenanceData();
    }

    function closeModal() {
      modalOverlay.classList.remove('active');
      modalOverlay.setAttribute('aria-hidden', 'true');
    }

    btnProvenance?.addEventListener('click', openModal);
    closeBtn?.addEventListener('click', closeModal);
    okBtn?.addEventListener('click', closeModal);
    modalOverlay?.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalOverlay?.classList.contains('active')) {
        closeModal();
      }
    });

    async function renderProvenanceData() {
      let data = state.overview?.dataProvenance;
      if (!data) {
        data = await getJson('/data/fontes_metadados.json');
      }
      if (!data || !data.arquivos || data.arquivos.length === 0) {
        if (groupsContainer) {
          groupsContainer.innerHTML = '<div class="provenance-loading-state">Nenhum metadado de planilha disponível no momento.</div>';
        }
        return;
      }

      if (totalBadge) totalBadge.textContent = String(data.total_arquivos || data.arquivos.length);
      if (summaryDir) summaryDir.textContent = data.diretorio_origem ? '.../' + data.diretorio_origem.split(/[\\/]/).pop() : 'BD_SMARTQUESTION';
      
      const summaryEtl = el('provSummaryEtl');
      if (summaryEtl) {
        if (data.ultima_execucao_etl_formatada) {
          summaryEtl.textContent = data.ultima_execucao_etl_formatada;
        } else {
          const etlTime = data.timestamp_etl || data.timestamp_inspecao;
          if (etlTime) {
            const d = new Date(etlTime);
            summaryEtl.textContent = `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
          }
        }
      }

      if (summaryInspection && data.timestamp_inspecao) {
        const d = new Date(data.timestamp_inspecao);
        summaryInspection.textContent = `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      }

      // Agrupar arquivos por categoria
      const groups = {};
      data.arquivos.forEach(file => {
        const cat = file.categoria || 'Outros Relatórios';
        if (!groups[cat]) {
          groups[cat] = {
            categoria: cat,
            icone: file.icone || 'description',
            descricao: file.descricao || '',
            files: []
          };
        }
        groups[cat].files.push(file);
      });

      let html = '';
      Object.values(groups).forEach(grp => {
        html += `
          <div class="prov-category-card">
            <div class="prov-category-header">
              <div class="prov-category-title-box">
                <span class="material-symbols-rounded prov-cat-icon" aria-hidden="true">${escapeHtml(grp.icone)}</span>
                <span class="prov-category-title">${escapeHtml(grp.categoria)}</span>
              </div>
              <span class="prov-category-count">${grp.files.length} ${grp.files.length === 1 ? 'arquivo' : 'arquivos'}</span>
            </div>
            <div class="prov-file-list">
        `;

        grp.files.forEach(f => {
          const recText = f.total_registros !== null && f.total_registros !== undefined
            ? `${Number(f.total_registros).toLocaleString('pt-BR')} registros`
            : 'Planilha bruta';
          html += `
            <div class="prov-file-item">
              <div class="prov-file-name-col">
                <span class="prov-file-name">${escapeHtml(f.nome)}</span>
                <span class="prov-file-desc">${escapeHtml(f.descricao)}</span>
              </div>
              <div class="prov-file-date">
                <span class="prov-date-label">Exportação SmartQuestion</span>
                <span class="prov-date-val">${escapeHtml(f.data_modificacao_formatada || f.data_modificacao)}</span>
              </div>
              <div>
                <span class="prov-badge-size">${escapeHtml(f.tamanho_formatado)}</span>
              </div>
              <div>
                <span class="prov-badge-records">${escapeHtml(recText)}</span>
              </div>
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      });

      if (groupsContainer) groupsContainer.innerHTML = html;
    }
  }

  setupTableSorting();
  setupColumnResizers();
  setupCustomSelectDropdowns();
  setupDetailsModal();
  setupKpiInfoPopovers();
  setupProvenanceModal();
  setupExportButtons();
  loadAllData();
  setInterval(loadAllData, 300000);

  window.dashboard = { carousel, reload: loadAllData };
});
