/* ══════════════════════════════════════════════════════════════
   SC Barbearia — relatorios.js
   Aba "Relatórios" do painel: métricas, gráfico por dia, ranking de
   serviços e barbeiros e lista de agendamentos do período escolhido
   (hoje, semana, mês ou datas personalizadas).
══════════════════════════════════════════════════════════════ */

'use strict';

/** Período selecionado: 'dia' | 'semana' | 'mes' | 'custom' */
let relPeriod = 'dia';

/** Máximo de barras no gráfico; períodos maiores são amostrados. */
const MAX_BARRAS = 14;

function setRelPeriod(p) {
  relPeriod = p;
  document.querySelectorAll('.rel-period-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('rel-btn-' + p)?.classList.add('active');

  const datas = document.getElementById('rel-custom-dates');
  if (datas) datas.style.display = p === 'custom' ? 'flex' : 'none';

  // No personalizado, o relatório só é gerado ao clicar em "Gerar"
  if (p !== 'custom') buildRelatorio();
}

/**
 * Intervalo de datas do período selecionado.
 * Semana = domingo a sábado da semana atual.
 * @returns {{ start: string, end: string }} "YYYY-MM-DD"
 */
function getRelRange() {
  const now = new Date();

  if (relPeriod === 'dia') {
    return { start: fmt(now), end: fmt(now) };
  }
  if (relPeriod === 'semana') {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay());
    const start = fmt(d);
    d.setDate(d.getDate() + 6);
    return { start, end: fmt(d) };
  }
  if (relPeriod === 'mes') {
    return {
      start: fmt(new Date(now.getFullYear(), now.getMonth(), 1)),
      end:   fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };
  }
  return {
    start: document.getElementById('rel-start')?.value || fmt(now),
    end:   document.getElementById('rel-end')?.value   || fmt(now),
  };
}

/** Busca o relatório do período e renderiza todas as partes da aba. */
async function buildRelatorio() {
  const { start, end } = getRelRange();
  try {
    const r = await apiFetch(`/api/agendamentos/relatorio?inicio=${start}&fim=${end}`);
    const d = await r.json();
    if (!r.ok) return;

    const rotulo = { dia: 'Hoje', semana: 'Esta Semana', mes: 'Este Mês' }[relPeriod]
      || `${dataBR(start)} – ${dataBR(end)}`;

    renderRelStats(d, rotulo);
    renderRelGrafico(d.agendamentos, start, end);
    renderRelRanking('rel-top-svcs',  d.top_servicos,  110, s => `${s.count}x`,                       30);
    renderRelRanking('rel-top-barbs', d.top_barbeiros,  80, b => 'R$' + parseFloat(b.receita || 0).toFixed(0), 50);
    renderRelTabela(d.agendamentos);
  } catch (e) {
    console.error('[Relatório]', e);
  }
}

/** Cartões de métricas do período. */
function renderRelStats(d, rotulo) {
  document.getElementById('rel-stats').innerHTML = [
    { v: d.total,           l: 'Agendamentos',  c: 'var(--gold-lt)' },
    { v: d.confirmados,     l: 'Confirmados',   c: 'var(--green)' },
    { v: d.cancelados,      l: 'Cancelados',    c: 'var(--red)' },
    { v: d.clientes_unicos, l: 'Clientes',      c: 'var(--gold-lt)' },
    { v: 'R$' + parseFloat(d.receita || 0).toFixed(2),      l: 'Receita Total', c: 'var(--gold-lt)' },
    { v: 'R$' + parseFloat(d.ticket_medio || 0).toFixed(2), l: 'Ticket Médio',  c: 'var(--text)' },
  ].map(s => `
    <div class="adm-stat">
      <div class="adm-stat-v" style="color:${s.c}">${s.v}</div>
      <div class="adm-stat-l">${s.l}</div>
      <div style="font-size:.6rem;color:var(--text3);margin-top:.2rem;letter-spacing:1px">${rotulo}</div>
    </div>`).join('');
}

/** Gráfico de barras: agendamentos não cancelados por dia do período. */
function renderRelGrafico(agendamentos, start, end) {
  const porDia = {};
  agendamentos.filter(a => a.status !== 'cancelado').forEach(a => {
    porDia[a.data] = (porDia[a.data] || 0) + 1;
  });

  const dias = [];
  for (let cur = new Date(start + 'T00:00:00'), fim = new Date(end + 'T00:00:00'); cur <= fim; cur.setDate(cur.getDate() + 1)) {
    dias.push(fmt(cur));
  }
  const maxV = Math.max(...dias.map(dia => porDia[dia] || 0), 1);

  // Períodos longos: mostra só 1 a cada N dias para caber na tela
  const passo    = Math.ceil(dias.length / MAX_BARRAS);
  const visiveis = dias.length > MAX_BARRAS ? dias.filter((_, i) => i % passo === 0) : dias;

  document.getElementById('rel-chart-title').textContent =
    relPeriod === 'dia' ? 'AGENDAMENTOS POR HORÁRIO' : 'AGENDAMENTOS POR DIA';

  document.getElementById('rel-chart').innerHTML = visiveis.map(dia => {
    const v   = porDia[dia] || 0;
    const pct = Math.round(v / maxV * 100);
    return `<div class="rel-bar-wrap"><div class="rel-bar" style="height:${Math.max(pct, 2)}%" title="${v}"></div><div class="rel-bar-lbl">${v}</div></div>`;
  }).join('');

  document.getElementById('rel-chart-labels').innerHTML = visiveis.map(dia => {
    const [, m, d] = dia.split('-');
    return `<div style="flex:1;text-align:center;font-size:.58rem;color:var(--text3)">${d}/${m}</div>`;
  }).join('');
}

/**
 * Ranking (top 5) com barra proporcional ao mais frequente.
 * @param {string}   id        elemento de destino
 * @param {object[]} itens     { nome, count, receita } já ordenados
 * @param {number}   largNome  largura mínima da coluna do nome (px)
 * @param {Function} valor     texto exibido à direita de cada item
 * @param {number}   largValor largura mínima da coluna do valor (px)
 */
function renderRelRanking(id, itens, largNome, valor, largValor) {
  const max = itens[0]?.count || 1;
  document.getElementById(id).innerHTML = itens.slice(0, 5).map(i => `
    <div class="rel-top-row">
      <div style="flex-shrink:0;font-size:.78rem;font-weight:600;min-width:${largNome}px;color:var(--text)">${esc(i.nome)}</div>
      <div class="rel-top-bar-bg"><div class="rel-top-bar-fill" style="width:${Math.round(i.count / max * 100)}%"></div></div>
      <div style="flex-shrink:0;font-size:.75rem;color:var(--gold-lt);font-weight:700;min-width:${largValor}px;text-align:right">${valor(i)}</div>
    </div>`).join('') || '<div style="color:var(--text3);font-size:.8rem">Sem dados</div>';
}

/** Tabela do período, do mais recente para o mais antigo. */
function renderRelTabela(agendamentos) {
  const tbody = document.getElementById('rel-tbody');
  if (!agendamentos.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:2rem;font-size:.8rem;letter-spacing:1px">NENHUM AGENDAMENTO NESTE PERÍODO</td></tr>`;
    return;
  }
  tbody.innerHTML = [...agendamentos].reverse().map(a => {
    const { cls, txt } = statusInfo(a.status);
    return `<tr>
      <td style="white-space:nowrap">${dataBR(a.data)} ${esc(a.horario)}</td>
      <td><strong>${esc(a.cliente_nome)}</strong></td>
      <td>${esc(a.barbeiro_nome)}</td>
      <td>${esc(a.servico_nome)}</td>
      <td style="color:var(--gold-lt);font-weight:700">${fmtPreco(a.preco)}</td>
      <td><span class="chip chip-${cls}">${txt}</span></td>
    </tr>`;
  }).join('');
}

function printRelatorio() {
  window.print();
}
