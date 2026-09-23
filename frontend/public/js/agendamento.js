/* ══════════════════════════════════════════════════════════════
   SC Barbearia — agendamento.js
   Fluxo de agendamento do cliente, em 5 etapas:
     1. Barbeiro  2. Serviço  3. Data e horário
     4. Dados do cliente  5. Resumo e confirmação
   As escolhas ficam no objeto global `st` (utils.js).
══════════════════════════════════════════════════════════════ */

'use strict';

/** Intervalo entre horários disponíveis na agenda, em minutos. */
const INTERVALO_SLOT_MIN = 30;

async function initBooking() {
  await loadPublicData();
  buildBarbers();
  buildSvcs();
  buildCal();
}

// ══════════════════════════════════════════════════════════════
//  Etapa 1 — Barbeiro
// ══════════════════════════════════════════════════════════════
function buildBarbers() {
  const el = document.getElementById('bk-barbers');
  if (!el) return;
  el.innerHTML = barbeiros.map(b => `
    <div class="barber-card${st.barb === b.id ? ' sel' : ''}"
         onclick="selB(${b.id})" role="option"
         aria-selected="${st.barb === b.id}" tabindex="0">
      <div class="barber-av">
        ${b.foto ? `<img src="${esc(b.foto)}" alt="${esc(b.nome)}">` : esc(b.emoji || '💈')}
      </div>
      <div class="barber-nm">${esc(b.nome)}</div>
      <div class="barber-sp">${esc(b.especialidade)}</div>
    </div>`).join('');
}

/** Seleciona o barbeiro e carrega os dias que ele tem bloqueados. */
async function selB(id) {
  st.barb = id;
  buildBarbers();
  try {
    const r = await apiFetch(`/api/bloqueios/dias?barbeiro_id=${id}`);
    st.diasBloqueados = await r.json();
  } catch {
    st.diasBloqueados = [];
  }
  buildCal();
}

// ══════════════════════════════════════════════════════════════
//  Etapa 2 — Serviço
// ══════════════════════════════════════════════════════════════
function buildSvcs() {
  const el = document.getElementById('bk-svcs');
  if (!el) return;
  el.innerHTML = servicos.map(s => `
    <div class="svc-sel-card${st.svc === s.id ? ' sel' : ''}"
         onclick="selS(${s.id})" role="option"
         aria-selected="${st.svc === s.id}" tabindex="0">
      <div class="svc-sel-ico">${esc(s.icone)}</div>
      <div>
        <div class="svc-sel-nm">${esc(s.nome)}</div>
        <div class="svc-sel-pr">${fmtPreco(s.preco)}</div>
        <div class="svc-sel-dur">⏱ ${esc(s.duracao)}min</div>
      </div>
    </div>`).join('');
}

function selS(id) {
  st.svc = id;
  buildSvcs();
}

// ══════════════════════════════════════════════════════════════
//  Etapa 3 — Calendário e horários
// ══════════════════════════════════════════════════════════════

/**
 * Horários de início entre `ini` (inclusive) e `fim` (exclusivo),
 * de 30 em 30 min. Ex.: ('08:00', '09:00') → ['08:00', '08:30'].
 * O backend aplica a mesma regra ao validar o agendamento.
 */
function gerarSlots(ini, fim) {
  const slots = [];
  let [h, m]     = ini.split(':').map(Number);
  const [hf, mf] = fim.split(':').map(Number);
  while (h < hf || (h === hf && m < mf)) {
    slots.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
    m += INTERVALO_SLOT_MIN;
    if (m >= 60) { m -= 60; h++; }
  }
  return slots;
}

/**
 * Horários de atendimento de um dia da semana.
 * @param {number} dow 0 = domingo … 6 = sábado
 * @returns {string[]|null} null quando a barbearia não abre nesse dia
 */
function horariosDoDia(dow) {
  const cfg = lerHorariosFuncionamento();
  if (!cfg) return gerarSlots('08:00', '17:30'); // configurações ainda não carregaram
  const dia = cfg[String(dow)];
  return dia ? gerarSlots(dia.ini, dia.fim) : null;
}

/** Monta a grade do mês atual do calendário (st.calY / st.calM). */
function buildCal() {
  const calLbl = document.getElementById('cal-month');
  if (calLbl) calLbl.textContent = MESES[st.calM] + ' ' + st.calY;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Cabeçalho: iniciais dos dias da semana
  let html = DIAS_SEMANA.map(d => `<div class="cal-dh">${d.charAt(0)}</div>`).join('');

  // Espaços vazios antes do dia 1
  const primeiroDow = new Date(st.calY, st.calM, 1).getDay();
  const diasNoMes   = new Date(st.calY, st.calM + 1, 0).getDate();
  for (let i = 0; i < primeiroDow; i++) html += '<div class="cal-day emp"></div>';

  for (let d = 1; d <= diasNoMes; d++) {
    const date     = new Date(st.calY, st.calM, d);
    const ds       = fmt(date);
    const passado  = date < today;
    const fechado  = horariosDoDia(date.getDay()) === null;
    const bloq     = (st.diasBloqueados || []).includes(ds);
    const inativo  = passado || fechado || bloq;

    const cls = [
      'cal-day',
      inativo ? 'dis' : '',
      bloq ? 'bloq' : '',
      fechado && !passado ? 'fechado' : '',
      date.toDateString() === today.toDateString() ? 'today' : '',
      st.data === ds ? 'sel' : '',
    ].filter(Boolean).join(' ');

    const title = bloq ? ' title="Dia bloqueado"' : fechado ? ' title="Fechado"' : '';
    const acao  = inativo ? ' aria-disabled="true"' : ` onclick="selD('${ds}')" tabindex="0"`;
    html += `<div class="${cls}"${acao}${title}>${d}</div>`;
  }

  const grid = document.getElementById('cal-grid');
  if (grid) grid.innerHTML = html;
}

/** Avança (+1) ou volta (-1) um mês no calendário. */
function chM(dir) {
  st.calM += dir;
  if (st.calM < 0)  { st.calM = 11; st.calY--; }
  if (st.calM > 11) { st.calM = 0;  st.calY++; }
  buildCal();
}

/**
 * Seleciona o dia e monta a grade de horários, marcando os que já
 * passaram, os ocupados por outro cliente e os bloqueados pelo admin.
 * @param {string} ds "YYYY-MM-DD"
 */
async function selD(ds) {
  st.data = ds;
  st.hora = null;
  buildCal();

  const tl = document.getElementById('time-title');
  if (tl) {
    tl.textContent = parseData(ds)
      .toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
      .toUpperCase();
  }

  const tg = document.getElementById('time-grid');
  if (tg) tg.innerHTML = '<div style="color:var(--text3);font-size:.75rem;padding:.5rem">Carregando horários...</div>';

  // horário → { tipo: 'agendamento' | 'bloqueio', servico }
  const ocupados = new Map();
  if (st.barb) {
    try {
      const r = await apiFetch(`/api/agendamentos/horarios-ocupados?barbeiro_id=${st.barb}&data=${ds}`);
      (await r.json()).forEach(s => ocupados.set(s.horario, s));
    } catch {}
  }

  // "Passado" é calculado no horário de Brasília, não no do aparelho
  const agora   = agoraBRT();
  const isHoje  = ds === fmt(agora);
  const horaAgr = fmtHoraLocal(agora);
  const slots   = horariosDoDia(parseData(ds).getDay()) || [];

  if (!tg) return;
  tg.innerHTML = slots.map(t => {
    if (isHoje && t <= horaAgr) {
      return `<div class="time-slot passado" onclick="selHPass()" tabindex="0" aria-disabled="true">
          <span class="slot-hora">⏰ ${t}</span>
          <span class="slot-label">Passado</span>
        </div>`;
    }

    const ocup = ocupados.get(t);
    if (ocup) {
      const isBloq = ocup.tipo === 'bloqueio';
      const label  = isBloq ? 'Bloqueado' : (ocup.servico || 'Ocupado');
      return `<div class="time-slot ocu${isBloq ? ' bloq' : ''}" onclick="selHOcu()" tabindex="0" aria-disabled="true">
          <span class="slot-hora">🔒 ${t}</span>
          <span class="slot-label">${isBloq ? '🚫' : '✂️'} ${esc(label)}</span>
        </div>`;
    }

    return `<div class="time-slot${st.hora === t ? ' sel' : ''}" onclick="selH('${t}')" tabindex="0">
        <span class="slot-hora">${t}</span>
      </div>`;
  }).join('');
}

/** Marca o horário escolhido (só entre os disponíveis). */
function selH(t) {
  st.hora = t;
  document.querySelectorAll('.time-slot').forEach(e => {
    e.classList.remove('sel');
    if (e.textContent.includes(t) && !e.classList.contains('ocu') && !e.classList.contains('passado')) {
      e.classList.add('sel');
    }
  });
}

/** Toques em horários indisponíveis só mostram um aviso. */
function selHOcu()  { toastFlutuante('toast-ocu',  '🔒 Horário ocupado! Escolha outro.',   '#c0392b'); }
function selHPass() { toastFlutuante('toast-pass', '⏰ Horário já passou! Escolha outro.', '#7c3aed'); }

// ══════════════════════════════════════════════════════════════
//  Navegação entre etapas
// ══════════════════════════════════════════════════════════════

/** Dados digitados pelo cliente na etapa 4. */
function lerDadosCliente() {
  return {
    nome: document.getElementById('c-nome')?.value.trim() || '',
    fone: document.getElementById('c-fone')?.value.trim() || '',
    obs:  document.getElementById('c-obs')?.value.trim()  || '',
  };
}

/**
 * Consulta a API para saber se o número tem WhatsApp. Só bloqueia se a
 * API disser que não existe; falha de rede ou WhatsApp offline deixam passar.
 * @returns {Promise<boolean>}
 */
async function validarWhatsAppCliente(fone) {
  const btn = document.querySelector('#step-4 .btn-solid');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Verificando...'; }
  try {
    const resp = await apiFetch('/api/whatsapp/validar?fone=' + encodeURIComponent(fone.replace(/\D/g, '')));
    if (!resp.ok) {
      const data = await resp.json();
      showToast('❌ ' + data.erro, 'err');
      return false;
    }
  } catch {
    // erro de rede: não impede o agendamento
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Revisar →'; }
  }
  return true;
}

/** Valida a etapa atual e avança para a próxima. */
async function nextStep(from) {
  if (from === 1 && !st.barb) { showToast('⚠️ Selecione um barbeiro'); return; }
  if (from === 2 && !st.svc)  { showToast('⚠️ Selecione um serviço');  return; }
  if (from === 3) {
    if (!st.data) { showToast('⚠️ Selecione uma data');   return; }
    if (!st.hora) { showToast('⚠️ Selecione um horário'); return; }
  }
  if (from === 4) {
    const { nome, fone } = lerDadosCliente();
    if (!nome) { showToast('⚠️ Informe seu nome'); return; }
    if (fone.replace(/\D/g, '').length < 10) { showToast('⚠️ Informe um WhatsApp válido'); return; }
    if (!(await validarWhatsAppCliente(fone))) return;
    buildSum();
  }
  goStep(from + 1);
}

function prevStep(from) {
  goStep(from - 1);
}

/** Exibe a etapa `n` e atualiza a barra de progresso. */
function goStep(n) {
  st.step = n;
  document.querySelectorAll('.step').forEach((p, i) => p.classList.toggle('active', i + 1 === n));
  document.querySelectorAll('.prog-step').forEach((s, i) => {
    const num = s.querySelector('.prog-num');
    s.classList.remove('active', 'done');
    if (i + 1 === n)     { s.classList.add('active'); num.textContent = i + 1; }
    else if (i + 1 < n)  { s.classList.add('done');   num.textContent = '✓'; }
    else                 { num.textContent = i + 1; }
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ══════════════════════════════════════════════════════════════
//  Etapa 5 — Resumo e confirmação
// ══════════════════════════════════════════════════════════════

/** Monta o cartão de resumo antes de confirmar. */
function buildSum() {
  const box = document.getElementById('sum-card');
  if (!box) return;

  const b = barbeiros.find(x => x.id === st.barb);
  const s = servicos.find(x => x.id === st.svc);
  const { nome, fone, obs } = lerDadosCliente();
  const dataLonga = parseData(st.data).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  const avatar = b?.foto
    ? `<img src="${esc(b.foto)}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:4px">`
    : esc((b?.emoji || '') + ' ');

  const linha = (k, v) => `<div class="sum-row"><span class="sum-key">${k}</span><span class="sum-val">${v}</span></div>`;

  box.innerHTML =
    '<div class="sum-head">✦ Resumo</div>' +
    linha('Cliente',  esc(nome)) +
    linha('WhatsApp', esc(fone)) +
    linha('Barbeiro', avatar + esc(b?.nome)) +
    linha('Serviço',  esc(s?.icone) + ' ' + esc(s?.nome)) +
    linha('Data',     dataLonga) +
    linha('Horário',  st.hora) +
    (obs ? linha('Obs.', esc(obs)) : '') +
    linha('Total',    fmtPreco(s?.preco));
}

/** Envia o agendamento para a API e mostra a tela de sucesso. */
async function confirmar() {
  const b = barbeiros.find(x => x.id === st.barb);
  const s = servicos.find(x => x.id === st.svc);
  const { nome, fone, obs } = lerDadosCliente();

  const btn = document.querySelector('#step-5 .btn-solid');
  const liberarBotao = () => { if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar Agendamento'; } };
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Confirmando...'; }

  try {
    const resp = await apiFetch('/api/agendamentos', {
      method: 'POST',
      body: JSON.stringify({
        cliente_nome: nome,
        cliente_fone: fone.replace(/\D/g, ''),
        observacao:   obs,
        barbeiro_id:  st.barb,
        servico_id:   st.svc,
        data:         st.data,
        horario:      st.hora,
      }),
    });
    const data = await resp.json();

    if (!resp.ok) {
      showToast('❌ ' + (data.erro || 'Erro ao confirmar'), 'err');
      liberarBotao();
      return;
    }

    mostrarSucesso(b, s, nome, fone);
  } catch {
    showToast('❌ Erro de conexão. Tente novamente.', 'err');
    liberarBotao();
  }
}

/**
 * Tela final: esconde as etapas e mostra o resumo, com um link que abre
 * o WhatsApp já com o texto da confirmação para o cliente guardar.
 */
function mostrarSucesso(b, s, nome, fone) {
  const dp = dataBR(st.data);
  const texto =
    `✅ *SC Barbearia — Confirmado!*\n\nOlá *${nome}*! ✂\n\n` +
    `👤 Barbeiro: ${b?.nome}\n💈 Serviço: ${s?.nome}\n📅 ${dp} às ${st.hora}\n` +
    `💰 ${fmtPreco(s?.preco)}\n\n📍 Serra do Salitre - MG`;

  document.querySelectorAll('.step').forEach(p => { p.style.display = 'none'; });
  document.querySelector('.progress').style.display = 'none';
  document.getElementById('bk-success').style.display = 'block';
  document.getElementById('success-txt').innerHTML =
    `Horário com <strong>${esc(b?.nome)}</strong> para <strong>${esc(s?.nome)}</strong> ` +
    `no dia <strong>${dp} às ${st.hora}</strong> confirmado!` +
    `<br><br><a href="${esc(linkWhatsApp(fone, texto))}" target="_blank" ` +
    'style="color:var(--gold-lt);font-weight:600;text-decoration:none">📩 Abrir confirmação no WhatsApp →</a>';
}

/** Volta ao início para um novo agendamento. */
function resetBk() {
  Object.assign(st, { barb: null, svc: null, data: null, hora: null, step: 1 });
  ['c-nome', 'c-fone', 'c-obs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('bk-success').style.display = 'none';
  document.querySelector('.progress').style.display = 'flex';
  document.querySelectorAll('.step').forEach(p => { p.style.display = ''; });
  goStep(1);
  buildBarbers();
  buildSvcs();
}
