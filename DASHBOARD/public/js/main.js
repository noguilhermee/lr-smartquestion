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

  function matches(row, filter) {
    const consultant = String(row.consultor || row.nome_consultor || '').toLocaleLowerCase('pt-BR');
    const producer = String(row.produtor || row.nome_produtor || row.propriedade || '').toLocaleLowerCase('pt-BR');
    return (!filter.consultant || consultant === filter.consultant.toLocaleLowerCase('pt-BR')) &&
      (!filter.producer || producer === filter.producer.toLocaleLowerCase('pt-BR')) &&
      dimensionMatches(row.agroindustria || row.agroindustrias, filter.industry) &&
      dimensionMatches(row.regiao || row.regioes, filter.region) &&
      dimensionMatches(row.projeto || row.projetos, filter.project) &&
      (!filter.status || normalizeStatus(row.status) === normalizeStatus(filter.status)) &&
      dimensionMatches(String(row.mes_referencia || row.data_referencia || '').slice(0, 10), filter.month);
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

  function showLoading(message = 'Atualizando dados...') {
    const overlay = el('loadingOverlay');
    if (!overlay) return;
    const textEl = overlay.querySelector('.loading-text');
    if (textEl) textEl.textContent = message;
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function hideLoading(delay = 200) {
    clearTimeout(loadingTimeout);
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
    let withoutVisit = (overview.tabelas?.sem_visita || []).filter((row) => matches(row, filter));
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
    let visited = (overview.tabelas?.visitados || []).filter((row) => matches(row, filter));
    updateCount('countVisited', visited);
    visited = sortRows(visited, tableSort.tbodyVisitados, (row, key) => row[key]);
    updateTableHeadIcons('tbodyVisitados', tableSort.tbodyVisitados.colKey, tableSort.tbodyVisitados.dir);
    if (el('tbodyVisitados')) el('tbodyVisitados').innerHTML = rowsOrEmpty(visited, 7, (row) => `<tr><td class="col-left" title="${escapeHtml(row.consultor || '—')}">${escapeHtml(row.consultor || '—')}</td><td class="col-center"><strong>${escapeHtml(row.codigo_lr || '—')}</strong></td><td class="col-left" title="${escapeHtml(row.produtor || '—')}">${escapeHtml(row.produtor || '—')}</td><td class="col-left" title="${escapeHtml(row.profissao || '—')}">${escapeHtml(row.profissao || '—')}</td><td class="col-center" title="${escapeHtml(row.atendimento || '—')}">${escapeHtml(row.atendimento || '—')}</td><td class="col-center">${escapeHtml(row.data_visita || '—')}</td><td class="col-center"><span class="badge ${row.elabore_ok === false ? 'badge-danger' : 'badge-positive'}">${row.elabore_ok === false ? 'NÃO' : 'SIM'}</span></td></tr>`);

    // Tabela 3: Turnover / Movimentação
    let movements = (turnover.tabelaMovimentacao || []).filter((row) => matches(row, filter));
    updateCount('countTurnover', movements);
    movements = sortRows(movements, tableSort.tbodyTurnover, (row, key) => key === 'grupo' ? (row.grupo || row.consultor) : row[key]);
    updateTableHeadIcons('tbodyTurnover', tableSort.tbodyTurnover.colKey, tableSort.tbodyTurnover.dir);
    if (el('tbodyTurnover')) el('tbodyTurnover').innerHTML = rowsOrEmpty(movements, 5, (row) => {
      const isSaida = row.tipo === 'SAÍDA';
      const grp = row.grupo || row.consultor || '—';
      return `<tr class="${isSaida ? 'table-row-grave' : ''}"><td class="col-left" title="${escapeHtml(row.produtor || '—')}"><strong>${escapeHtml(row.produtor || '—')}</strong></td><td class="col-center"><span class="badge ${isSaida ? 'badge-danger' : 'badge-positive'}">${escapeHtml(row.tipo)}</span></td><td class="col-center">${escapeHtml(row.data || '—')}</td><td class="col-left" title="${escapeHtml(grp)}">${escapeHtml(grp)}</td><td class="col-left" title="${escapeHtml(row.motivo || '—')}">${escapeHtml(row.motivo || '—')}</td></tr>`;
    });

    // Tabela 4: Consultores
    let consultants = (visits.tabelaConsultores || []).filter((row) => matches(row, filter));
    updateCount('countConsultants', consultants);
    consultants = sortRows(consultants, tableSort.tbodyConsultants, (row, key) => row[key]);
    updateTableHeadIcons('tbodyConsultants', tableSort.tbodyConsultants.colKey, tableSort.tbodyConsultants.dir);
    if (el('tbodyConsultants')) el('tbodyConsultants').innerHTML = rowsOrEmpty(consultants, 6, (row) => `<tr><td class="col-left" title="${escapeHtml(row.consultor || '—')}"><strong>${escapeHtml(row.consultor || '—')}</strong></td><td class="col-center font-tabular">${number(row.total_fazendas)}</td><td class="col-center font-tabular">${number(row.fazendas_visitadas)}</td><td class="col-center font-tabular">${number(row.total_visitas)}</td><td class="col-center font-tabular">${percent(row.perc_cobertura)}</td><td class="col-center"><span class="badge badge-positive">ATIVO</span></td></tr>`);

    // Tabela 5: Produtores com Dados
    let withData = (consistency.tabelaProdutoresComDados || []).filter((row) => matches(row, filter));
    updateCount('countDataProducers', withData);
    withData = sortRows(withData, tableSort.tbodyDataProducers, (row, key) => key === 'produtor' ? (row.produtor || row.codigo_lr) : row[key]);
    updateTableHeadIcons('tbodyDataProducers', tableSort.tbodyDataProducers.colKey, tableSort.tbodyDataProducers.dir);
    if (el('tbodyDataProducers')) el('tbodyDataProducers').innerHTML = rowsOrEmpty(withData, 6, (row) => {
      const noData = row.possui_dados === false;
      const prodName = row.produtor || row.codigo_lr || '—';
      return `<tr class="${noData ? 'table-row-grave' : ''}"><td class="col-center"><strong>${escapeHtml(row.codigo_lr || '—')}</strong></td><td class="col-left" title="${escapeHtml(prodName)}">${escapeHtml(prodName)}</td><td class="col-left" title="${escapeHtml(row.consultor || '—')}">${escapeHtml(row.consultor || '—')}</td><td class="col-center"><span class="badge ${noData ? 'badge-danger' : 'badge-positive'}">${noData ? 'NÃO' : 'SIM'}</span></td><td class="col-center">${escapeHtml(row.referencia || '—')}</td><td class="col-center"><span class="badge ${String(row.status).toUpperCase() === 'INATIVO' ? 'badge-danger' : 'badge-positive'}">${escapeHtml(row.status || 'ATIVO')}</span></td></tr>`;
    });

    // Tabela 6: Inconsistências
    let inconsistencies = (consistency.tabelaInconsistentes || []).filter((row) => matches(row, filter));
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

  const masterFilterOptions = {
    months: new Set(),
    industries: new Set(),
    regions: new Set(),
    consultants: new Set(),
    producers: new Set()
  };

  function populateSelect(selectId, values, placeholder, masterKey) {
    const select = el(selectId);
    if (!select) return;
    const current = select.value;
    if (masterKey && masterFilterOptions[masterKey]) {
      values.filter(Boolean).map(String).forEach((v) => masterFilterOptions[masterKey].add(v));
    }
    const sourceArray = masterKey && masterFilterOptions[masterKey]?.size > 0
      ? Array.from(masterFilterOptions[masterKey])
      : values.filter(Boolean).map(String);
    const unique = [...new Set(sourceArray)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    select.innerHTML = `<option value="">${placeholder}</option>${unique.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
    if (unique.includes(current)) select.value = current;
  }

  function populateMonthSelect(values) {
    const select = el('filterMonth');
    if (!select) return;
    const current = select.value;
    const maxAllowedMonth = new Date().toISOString().slice(0, 7) + '-01';
    values.filter(Boolean)
      .map((v) => String(v).slice(0, 10))
      .filter((v) => v <= maxAllowedMonth)
      .forEach((v) => masterFilterOptions.months.add(v));
    const sourceArray = Array.from(masterFilterOptions.months).filter((v) => v <= maxAllowedMonth);
    const unique = [...new Set(sourceArray)].sort().reverse();
    const options = unique.map((value) => {
      const parsed = new Date(`${value}T12:00:00`);
      const label = Number.isNaN(parsed.getTime())
        ? value
        : parsed.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (letter) => letter.toUpperCase());
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }).join('');
    select.innerHTML = `<option value="">Atual</option>${options}`;
    if (unique.includes(current)) select.value = current;
  }

  function populateStatusSelect(values) {
    const select = el('filterStatus');
    if (!select) return;
    const current = normalizeStatus(select.value);
    const available = new Set(values.map(normalizeStatus));
    const ordered = ['ATIVO', 'INATIVO'].filter((value) => available.has(value));
    const labels = { ATIVO: 'Ativa', INATIVO: 'Inativo' };
    select.innerHTML = `<option value="">Todos</option>${ordered.map((value) => `<option value="${value}">${labels[value]}</option>`).join('')}`;
    if (ordered.includes(current)) select.value = current;
  }

  function populateProjectSelect() {
    const select = el('filterProject');
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Todos</option>${projectOptions.map((project) => `<option value="${project.value}">${project.label}</option>`).join('')}`;
    if (projectOptions.some((project) => project.value === current)) select.value = current;
  }

  function populateFilters() {
    const overview = state.overview || emptyState.overview;
    const visits = state.visits || emptyState.visits;
    const turnover = state.turnover || emptyState.turnover;
    const consistency = state.consistency || emptyState.consistency;
    const allRows = [
      ...(overview.tabelas?.sem_visita || []),
      ...(overview.tabelas?.visitados || []),
      ...(visits.tabelaConsultores || []),
      ...(turnover.tabelaMovimentacao || []),
      ...(consistency.tabelaProdutoresComDados || []),
      ...(consistency.tabelaInconsistentes || [])
    ];
    const consultants = [
      ...(overview.tabelas?.sem_visita || []).map((row) => row.consultor),
      ...(overview.tabelas?.visitados || []).map((row) => row.consultor),
      ...(visits.tabelaConsultores || []).map((row) => row.consultor),
      ...(turnover.tabelaMovimentacao || []).map((row) => row.consultor),
      ...(consistency.tabelaProdutoresComDados || []).map((row) => row.consultor)
    ];
    const producers = [
      ...(overview.tabelas?.sem_visita || []).map((row) => row.produtor),
      ...(overview.tabelas?.visitados || []).map((row) => row.produtor),
      ...(turnover.tabelaMovimentacao || []).map((row) => row.produtor),
      ...(consistency.tabelaProdutoresComDados || []).map((row) => row.produtor)
    ];
    const industries = [
      ...(overview.filterOptions?.agroindustrias || []),
      ...allRows.flatMap((row) => row.agroindustrias || row.agroindustria || [])
    ];
    const regions = [
      ...(overview.filterOptions?.regioes || []),
      ...allRows.flatMap((row) => row.regioes || row.regiao || [])
    ].filter(r => r && r !== 'LABOR RURAL' && r !== 'UNIDADE GENERICA');
    const statuses = [
      ...(overview.filterOptions?.status || []),
      ...allRows.map((row) => row.status)
    ];
    const months = [
      ...(overview.filterOptions?.meses || []),
      overview.refMonth,
      ...allRows.map((row) => row.mes_referencia || row.data_referencia)
    ];
    populateSelect('filterIndustry', industries, 'Todas', 'industries');
    populateSelect('filterRegion', regions, 'Todas', 'regions');
    populateProjectSelect();
    populateStatusSelect(statuses);
    populateSelect('filterConsultant', consultants, 'Todos', 'consultants');
    populateSelect('filterProducer', producers, 'Todos', 'producers');
    populateMonthSelect(months);
    setupCustomSelectDropdowns();
  }

  function updateTimestamp() {
    const now = new Date();
    if (el('lastUpdateTag')) el('lastUpdateTag').textContent = 'Sincronização automática';
    if (el('lastUpdateDate')) el('lastUpdateDate').textContent = `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  }

  async function loadAllData() {
    showLoading('Atualizando dashboard com filtros...');
    try {
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
      populateFilters();
      renderTables();
      updateTimestamp();
    } finally {
      hideLoading(250);
    }
  }

  function handleFilterChange() {
    loadAllData();
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

  ['filterIndustry', 'filterRegion', 'filterProject', 'filterStatus', 'filterConsultant', 'filterProducer']
    .forEach((id) => el(id)?.addEventListener('change', handleFilterChange));
  el('filterMonth')?.addEventListener('change', loadAllData);
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
  loadAllData();
  setInterval(loadAllData, 300000);

  window.dashboard = { carousel, reload: loadAllData };
});
