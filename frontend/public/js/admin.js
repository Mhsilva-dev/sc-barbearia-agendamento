/* ══════════════════════════════════════════════════════════════
   SC Barbearia — admin.js
   Painel administrativo: login, abas, agendamentos, barbeiros,
   serviços, histórico de clientes, localização, horários de
   funcionamento, bloqueios de agenda e dados de acesso.

   WhatsApp e Relatórios ficam em admin-whatsapp.js e relatorios.js.
   Todas as chamadas usam apiFetch(), que envia o token JWT.
══════════════════════════════════════════════════════════════ */

'use strict';

/** Linha de tabela vazia ("nenhum registro"). */
function linhaVazia(colunas, texto) {
  return `<tr><td colspan="${colunas}" style="text-align:center;color:var(--text3);padding:2.5rem;font-size:.8rem;letter-spacing:1px">${texto}</td></tr>`;
}

// ══════════════════════════════════════════════════════════════
//  Login e sessão
// ══════════════════════════════════════════════════════════════
function showLoginScreen() {
  document.getElementById('adm-login').style.display = 'block';
  document.getElementById('adm-dash').style.display  = 'none';
}

/** Mostra o painel e carrega a aba inicial (agendamentos). */
function showDashboard() {
  document.getElementById('adm-login').style.display = 'none';
  document.getElementById('adm-dash').style.display  = 'block';
  renderStats();
  renderAgend();
}

async function doLogin() {
  const user = document.getElementById('l-u')?.value;
  const pass = document.getElementById('l-p')?.value;
  const btn  = document.querySelector('.login-card .btn-solid');
  const liberarBotao = () => { if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; } };
  if (btn) { btn.disabled = true; btn.textContent = 'Entrando...'; }

  try {
    // fetch direto: o apiFetch trataria o 401 de senha errada como sessão expirada
    const r = await fetch(API_BASE + '/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ user, pass }),
    });
    const d = await r.json();
    if (!r.ok) {
      showToast('❌ ' + (d.erro || 'Credenciais inválidas'), 'err');
      liberarBotao();
      return;
    }
    adminToken = d.token;
    gravarStorage(TOKEN_KEY, adminToken);
    showDashboard();
  } catch {
    showToast('❌ Erro de conexão', 'err');
    liberarBotao();
  }
}

function doLogout() {
  limparToken();
  showLoginScreen();
  document.getElementById('l-u').value = '';
  document.getElementById('l-p').value = '';
  navTo('home');
}

/** Troca de aba do painel, carregando os dados da aba aberta. */
function swTab(e, tab) {
  document.querySelectorAll('.adm-tab').forEach(t => t.classList.remove('active'));
  e.currentTarget.classList.add('active');
  document.querySelectorAll('.adm-sec').forEach(s => s.classList.remove('active'));
  document.getElementById('sec-' + tab).classList.add('active');

  if (tab === 'agend') { renderAgend(); renderStats(); }
  if (tab === 'barb')  renderBarbEd();
  if (tab === 'svc')   renderSvcEd();
  if (tab === 'hist')  renderHist();
  if (tab === 'loc')   loadCfgForm();
  if (tab === 'rel')   buildRelatorio();
  // 'wapp' e 'bloq' carregam pelo próprio onclick da aba
}

// ══════════════════════════════════════════════════════════════
//  Agendamentos
// ══════════════════════════════════════════════════════════════

/** Cartões do topo: hoje, mês, clientes e receita. */
async function renderStats() {
  try {
    const d = await (await apiFetch('/api/agendamentos/stats')).json();
    document.getElementById('adm-stats').innerHTML = [
      { v: d.hoje,                                l: 'Hoje' },
      { v: d.mes,                                 l: 'Este Mês' },
      { v: d.clientes,                            l: 'Clientes' },
      { v: 'R$' + parseFloat(d.receita || 0).toFixed(0), l: 'Receita' },
    ].map(s => `<div class="adm-stat"><div class="adm-stat-v">${s.v}</div><div class="adm-stat-l">${s.l}</div></div>`).join('');
  } catch {}
}

/** Tabela de agendamentos, com os filtros de data e status. */
async function renderAgend() {
  const params = new URLSearchParams();
  const filtData   = document.getElementById('f-data')?.value;
  const filtStatus = document.getElementById('f-status')?.value;
  if (filtData)   params.set('data', filtData);
  if (filtStatus) params.set('status', filtStatus);

  try {
    const list = await (await apiFetch('/api/agendamentos/admin?' + params)).json();
    const tb   = document.getElementById('tb-agend');
    if (!Array.isArray(list) || !list.length) {
      tb.innerHTML = linhaVazia(7, 'NENHUM AGENDAMENTO');
      return;
    }
    tb.innerHTML = list.map(a => {
      const { cls, txt } = statusInfo(a.status);
      return `<tr>
        <td><strong>${esc(a.cliente_nome)}</strong>${a.observacao ? `<br><small style="color:var(--text3)">${esc(a.observacao)}</small>` : ''}</td>
        <td><a href="${linkWhatsApp(a.cliente_fone)}" target="_blank" style="color:var(--gold-lt);text-decoration:none">📲 ${esc(a.cliente_fone)}</a></td>
        <td>${esc(a.barbeiro_nome)}</td><td>${esc(a.servico_nome)}</td>
        <td style="white-space:nowrap">${dataBR(a.data)} ${esc(a.horario)}</td>
        <td><span class="chip chip-${cls}">${txt}</span></td>
        <td>
          <div style="display:flex;gap:.3rem">
            ${a.status === 'confirmado' ? `<button class="btn btn-sm btn-outline" onclick="markDone(${a.id})" style="font-size:.7rem;padding:.4rem .7rem">✅</button>` : ''}
            <button class="btn btn-danger btn-sm btn-icon" onclick="delAgend(${a.id})" style="font-size:.75rem">🗑</button>
          </div>
        </td></tr>`;
    }).join('');
  } catch {
    showToast('❌ Erro ao carregar agendamentos', 'err');
  }
}

async function markDone(id) {
  await apiFetch(`/api/agendamentos/admin/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'concluido' }) });
  showToast('✅ Concluído!', 'ok');
  renderAgend();
  renderStats();
}

async function delAgend(id) {
  if (!confirm('Excluir agendamento?')) return;
  await apiFetch(`/api/agendamentos/admin/${id}`, { method: 'DELETE' });
  showToast('🗑 Removido', 'ok');
  renderAgend();
  renderStats();
}

// ══════════════════════════════════════════════════════════════
//  Barbeiros
// ══════════════════════════════════════════════════════════════
async function renderBarbEd() {
  const list = await (await apiFetch('/api/barbeiros')).json();
  document.getElementById('barb-ed').innerHTML = list.map(b => `
    <div class="barb-card">
      <div class="barb-card-edit"><button class="btn btn-ghost btn-sm" onclick="openEditBarb(${b.id})">✏️</button></div>
      ${b.foto
        ? `<img src="${esc(b.foto)}" style="width:76px;height:76px;border-radius:50%;object-fit:cover;border:2px solid var(--gold);margin:0 auto .85rem;display:block">`
        : `<div style="width:76px;height:76px;border-radius:50%;background:var(--ink4);border:2px solid var(--ink5);display:flex;align-items:center;justify-content:center;font-size:2rem;margin:0 auto .85rem">${esc(b.emoji || '💈')}</div>`}
      <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:1rem;letter-spacing:1px;text-transform:uppercase;margin-bottom:.2rem">${esc(b.nome)}</div>
      <div style="font-size:.75rem;color:var(--text3);margin-bottom:.85rem">${esc(b.especialidade)}</div>
      <button class="btn btn-danger btn-sm btn-full" onclick="delBarb(${b.id})">🗑 Remover</button>
    </div>`
  ).join('') +
  `<div class="add-tile" onclick="openAddBarb()"><div style="font-size:1.8rem">➕</div><div style="font-size:.78rem;font-weight:600;letter-spacing:1px;text-transform:uppercase">Adicionar Barbeiro</div></div>`;
}

/**
 * Mostra a foto no quadro de upload do modal, ou o espaço vazio.
 * @param {string} [src] URL ou data URL; vazio = sem foto
 */
function mostrarFotoModal(src) {
  const prev = document.getElementById('pu-prev');
  const ph   = document.querySelector('#pu .photo-upload-ph');
  if (src) prev.src = src;
  prev.style.display = src ? 'block' : 'none';
  ph.style.display   = src ? 'none'  : 'block';
  document.getElementById('pu').classList.toggle('has-photo', !!src);
}

function openAddBarb() {
  st.editB = null;
  st.foto  = '';
  document.getElementById('mb-title').textContent = 'Adicionar Barbeiro';
  document.getElementById('mb-n').value = '';
  document.getElementById('mb-s').value = '';
  document.getElementById('mb-e').value = '💈';
  document.getElementById('pu-input').value = '';
  mostrarFotoModal('');
  openModal('modal-barb');
}

async function openEditBarb(id) {
  const list = await (await apiFetch('/api/barbeiros')).json();
  const b = list.find(x => x.id === id);
  if (!b) return;

  st.editB = id;
  st.foto  = b.foto || '';
  document.getElementById('mb-title').textContent = 'Editar Barbeiro';
  document.getElementById('mb-n').value = b.nome;
  document.getElementById('mb-s').value = b.especialidade;
  document.getElementById('mb-e').value = b.emoji || '💈';
  document.getElementById('pu-input').value = '';
  mostrarFotoModal(b.foto);
  openModal('modal-barb');
}

/** Pré-visualiza a foto escolhida; o envio acontece ao salvar. */
function prevFoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('❌ Foto muito grande (máx 5MB)', 'err'); return; }

  const reader = new FileReader();
  reader.onload = ev => {
    st.foto = ev.target.result; // data URL
    mostrarFotoModal(st.foto);
  };
  reader.readAsDataURL(file);
}

/** Cria/atualiza o barbeiro e, se houver foto nova, envia em seguida. */
async function saveBarb() {
  const nome = document.getElementById('mb-n').value.trim();
  if (!nome) { showToast('⚠️ Nome obrigatório'); return; }

  const body = JSON.stringify({
    nome,
    especialidade: document.getElementById('mb-s').value.trim(),
    emoji:         document.getElementById('mb-e').value.trim() || '💈',
  });
  const r = st.editB
    ? await apiFetch(`/api/admin/barbeiros/${st.editB}`, { method: 'PUT', body })
    : await apiFetch('/api/admin/barbeiros', { method: 'POST', body });
  const d = await r.json();
  if (!r.ok) { showToast('❌ ' + d.erro, 'err'); return; }

  // Foto nova é sempre data URL; foto já salva é "/uploads/..." e não reenvia
  if (st.foto && st.foto.startsWith('data:')) {
    await apiFetch(`/api/admin/barbeiros/${d.id || st.editB}/foto-base64`, {
      method: 'POST',
      body:   JSON.stringify({ fotoBase64: st.foto }),
    });
  }
  showToast(st.editB ? '✅ Atualizado!' : '✅ Barbeiro adicionado!', 'ok');
  closeModal('modal-barb');
  renderBarbEd();
}

async function delBarb(id) {
  if (!confirm('Remover barbeiro?')) return;
  await apiFetch(`/api/admin/barbeiros/${id}`, { method: 'DELETE' });
  showToast('🗑 Removido', 'ok');
  renderBarbEd();
}

// ══════════════════════════════════════════════════════════════
//  Serviços
// ══════════════════════════════════════════════════════════════
async function renderSvcEd() {
  const list = await (await apiFetch('/api/servicos')).json();
  document.getElementById('svc-ed').innerHTML = list.map(s => `
    <div class="svc-list-item">
      <div style="font-size:1.4rem">${esc(s.icone)}</div>
      <div style="flex:1">
        <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:.95rem;letter-spacing:.5px;text-transform:uppercase">${esc(s.nome)}</div>
        <div style="color:var(--gold-lt);font-weight:700;font-size:1rem;font-family:'Barlow Condensed',sans-serif">${fmtPreco(s.preco)}</div>
        <div style="font-size:.65rem;color:var(--text3);letter-spacing:1px;text-transform:uppercase">⏱ ${esc(s.duracao)}min</div>
      </div>
      <div style="display:flex;gap:.3rem;flex-shrink:0">
        <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditSvc(${s.id})">✏️</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="delSvc(${s.id})">🗑</button>
      </div>
    </div>`).join('');
}

/**
 * Abre o modal de serviço.
 * @param {number|null} [id] id para editar; vazio = novo serviço
 */
async function openSvcModal(id = null) {
  st.editS = id;
  document.getElementById('ms-title').textContent = id ? 'Editar Serviço' : 'Adicionar Serviço';

  if (id) {
    const list = await (await apiFetch('/api/servicos')).json();
    const s = list.find(x => x.id === id);
    if (s) {
      document.getElementById('ms-n').value = s.nome;
      document.getElementById('ms-p').value = s.preco;
      document.getElementById('ms-d').value = s.duracao;
      document.getElementById('ms-i').value = s.icone;
    }
  } else {
    ['ms-n', 'ms-p', 'ms-d'].forEach(i => { document.getElementById(i).value = ''; });
    document.getElementById('ms-i').value = '✂';
  }
  openModal('modal-svc');
}

function openEditSvc(id) {
  openSvcModal(id);
}

async function saveSvc() {
  const nome    = document.getElementById('ms-n').value.trim();
  const preco   = parseFloat(document.getElementById('ms-p').value);
  const duracao = parseInt(document.getElementById('ms-d').value, 10);
  const icone   = document.getElementById('ms-i').value.trim() || '✂';
  if (!nome || isNaN(preco) || isNaN(duracao)) { showToast('⚠️ Preencha todos os campos'); return; }

  const body = JSON.stringify({ nome, preco, duracao, icone });
  const r = st.editS
    ? await apiFetch(`/api/admin/servicos/${st.editS}`, { method: 'PUT', body })
    : await apiFetch('/api/admin/servicos', { method: 'POST', body });

  if (!r.ok) { showToast('❌ Erro ao salvar', 'err'); return; }
  showToast(st.editS ? '✅ Atualizado!' : '✅ Serviço adicionado!', 'ok');
  closeModal('modal-svc');
  renderSvcEd();

  // Atualiza também a vitrine pública (grade e faixa de serviços)
  await loadPublicData();
  buildSvcGrid();
  buildMarquee();
}

async function delSvc(id) {
  if (!confirm('Remover serviço?')) return;
  await apiFetch(`/api/admin/servicos/${id}`, { method: 'DELETE' });
  showToast('🗑 Removido', 'ok');
  renderSvcEd();
}

// ══════════════════════════════════════════════════════════════
//  Histórico de clientes
// ══════════════════════════════════════════════════════════════
async function renderHist() {
  const list = await (await apiFetch('/api/agendamentos/historico')).json();
  const tb   = document.getElementById('tb-hist');
  if (!list.length) { tb.innerHTML = linhaVazia(5, 'SEM HISTÓRICO'); return; }

  tb.innerHTML = list.map(c => `<tr>
      <td><strong>${esc(c.cliente_nome)}</strong></td>
      <td><a href="${linkWhatsApp(c.cliente_fone)}" target="_blank" style="color:var(--gold-lt);text-decoration:none">📲 ${esc(c.cliente_fone)}</a></td>
      <td><strong>${c.visitas}</strong></td>
      <td>${esc(c.ultimo_servico)}</td>
      <td>${c.ultima_visita ? dataBR(c.ultima_visita) : '-'}</td>
    </tr>`).join('');
}

// ══════════════════════════════════════════════════════════════
//  Localização e horários de funcionamento
// ══════════════════════════════════════════════════════════════

/** Preenche o formulário da aba "Localização" com as configurações salvas. */
async function loadCfgForm() {
  const d = await (await apiFetch('/api/config/admin')).json();
  document.getElementById('cfg-end').value  = d.endereco    || '';
  document.getElementById('cfg-hrs').value  = d.horarios    || '';
  document.getElementById('cfg-wa').value   = d.whatsapp    || '';
  document.getElementById('cfg-how').value  = d.como_chegar || '';
  document.getElementById('cfg-maps').value = d.maps_embed  || '';
  buildHFGrid(d.horarios_funcionamento || null);
}

async function saveLoc() {
  // Aceita tanto a URL quanto o código <iframe> completo copiado do Google Maps
  const mapsRaw   = document.getElementById('cfg-maps').value.trim();
  const srcMatch  = mapsRaw.match(/src="([^"]+)"/);
  const mapsEmbed = srcMatch ? srcMatch[1] : mapsRaw;

  const r = await apiFetch('/api/config/admin', {
    method: 'PUT',
    body: JSON.stringify({
      endereco:    document.getElementById('cfg-end').value,
      horarios:    document.getElementById('cfg-hrs').value,
      whatsapp:    document.getElementById('cfg-wa').value,
      como_chegar: document.getElementById('cfg-how').value,
      maps_embed:  mapsEmbed,
    }),
  });
  showToast(r.ok ? '📍 Localização salva!' : '❌ Erro ao salvar', r.ok ? 'ok' : 'err');
  if (r.ok) {
    await loadPublicData();
    buildLocCards();
  }
}

/**
 * Monta a grade "dia da semana → abre/fecha" do painel.
 * @param {string|object|null} hfCfg configuração salva ({ "0".."6": {ini,fim}|null })
 */
function buildHFGrid(hfCfg) {
  const grid = document.getElementById('hf-grid');
  if (!grid) return;

  let cfg = {};
  try { cfg = typeof hfCfg === 'string' ? JSON.parse(hfCfg) : (hfCfg || {}); } catch {}

  // Opções de 06:00 a 22:30, de 30 em 30 min
  const horas = [];
  for (let h = 6; h <= 22; h++) {
    horas.push(String(h).padStart(2, '0') + ':00', String(h).padStart(2, '0') + ':30');
  }
  const opts = horas.map(t => `<option value="${t}">${t}</option>`).join('');

  grid.innerHTML = DIAS_SEMANA.map((nome, dow) => {
    const fechado = !cfg[String(dow)];
    return `
      <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;background:var(--ink3);border:1px solid var(--ink5);border-radius:var(--r);padding:.65rem 1rem">
        <span style="width:72px;font-size:.8rem;font-weight:700;color:var(--text2)">${nome}</span>
        <label style="display:flex;align-items:center;gap:.4rem;font-size:.8rem;cursor:pointer;color:var(--text3)">
          <input type="checkbox" id="hf-fechado-${dow}" onchange="toggleHFDia(${dow})" ${fechado ? 'checked' : ''}
            style="accent-color:var(--gold);width:14px;height:14px"> Fechado
        </label>
        <div id="hf-range-${dow}" style="display:flex;align-items:center;gap:.5rem;${fechado ? 'opacity:.3;pointer-events:none' : ''}">
          <select id="hf-ini-${dow}" class="field-input" style="width:90px;padding:.35rem .5rem;font-size:.8rem">${opts}</select>
          <span style="color:var(--text3);font-size:.8rem">até</span>
          <select id="hf-fim-${dow}" class="field-input" style="width:90px;padding:.35rem .5rem;font-size:.8rem">${opts}</select>
        </div>
      </div>`;
  }).join('');

  // Seleciona os horários salvos (dias fechados ficam no primeiro item)
  DIAS_SEMANA.forEach((_, dow) => {
    const dia = cfg[String(dow)];
    if (!dia) return;
    document.getElementById(`hf-ini-${dow}`).value = dia.ini;
    document.getElementById(`hf-fim-${dow}`).value = dia.fim;
  });
}

/** Ativa/desativa os campos de horário quando "Fechado" é marcado. */
function toggleHFDia(dow) {
  const fechado = document.getElementById(`hf-fechado-${dow}`).checked;
  const range   = document.getElementById(`hf-range-${dow}`);
  range.style.opacity       = fechado ? '.3' : '1';
  range.style.pointerEvents = fechado ? 'none' : '';
}

async function saveHorariosFuncionamento() {
  const hf = {};
  DIAS_SEMANA.forEach((_, dow) => {
    const fechado = document.getElementById(`hf-fechado-${dow}`)?.checked;
    hf[String(dow)] = fechado ? null : {
      ini: document.getElementById(`hf-ini-${dow}`)?.value || '08:00',
      fim: document.getElementById(`hf-fim-${dow}`)?.value || '17:30',
    };
  });

  // A API grava texto: o objeto vai serializado em JSON
  const r = await apiFetch('/api/config/admin', {
    method: 'PUT',
    body: JSON.stringify({ horarios_funcionamento: JSON.stringify(hf) }),
  });
  if (r.ok) {
    showToast('🕐 Horários salvos!', 'ok');
    await loadPublicData(); // atualiza configData com os novos horários
    buildCal();             // e o calendário do agendamento
  } else {
    showToast('❌ Erro ao salvar horários', 'err');
  }
}

// ══════════════════════════════════════════════════════════════
//  Bloqueios de agenda
//  Dia inteiro ou horário específico, para um barbeiro ou todos.
// ══════════════════════════════════════════════════════════════

/** Horários oferecidos no formulário de bloqueio (08:00 a 18:30). */
const HORARIOS_BLOQUEIO = gerarSlots('08:00', '19:00');

/** Mostra o campo de horário só quando o tipo é "horário". */
function toggleBloqHorario() {
  const tipo = document.getElementById('bloq-tipo').value;
  document.getElementById('bloq-hora-wrap').style.display = tipo === 'horario' ? '' : 'none';
}

/** Preenche os selects do formulário e a tabela de bloqueios. */
async function loadBloqueios() {
  try {
    const barbs = await (await apiFetch('/api/barbeiros')).json();
    document.getElementById('bloq-barb').innerHTML =
      '<option value="">Todos os barbeiros</option>' +
      barbs.map(b => `<option value="${b.id}">${esc(b.nome)}</option>`).join('');
  } catch {}

  document.getElementById('bloq-hora').innerHTML =
    HORARIOS_BLOQUEIO.map(t => `<option value="${t}">${t}</option>`).join('');

  try {
    const lista = await (await apiFetch('/api/bloqueios')).json();
    const tb    = document.getElementById('tb-bloq');
    if (!lista.length) {
      tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3)">Nenhum bloqueio</td></tr>';
      return;
    }
    tb.innerHTML = lista.map(b => `<tr>
        <td>${dataBR(b.data)}</td>
        <td>${b.tipo === 'dia' ? 'Dia inteiro' : 'Horário'}</td>
        <td>${esc(b.horario || '—')}</td>
        <td>${esc(b.barbeiro_nome || 'Todos')}</td>
        <td>${esc(b.motivo || '—')}</td>
        <td><button class="btn" style="padding:.25rem .6rem;font-size:.7rem;color:#e74c3c;border-color:#e74c3c" onclick="deletarBloqueio(${b.id})">Remover</button></td>
      </tr>`).join('');
  } catch {}
}

async function criarBloqueio() {
  const tipo = document.getElementById('bloq-tipo').value;
  const body = {
    tipo,
    data:        document.getElementById('bloq-data').value,
    motivo:      document.getElementById('bloq-motivo').value,
    barbeiro_id: document.getElementById('bloq-barb').value || null,
  };
  if (!body.data) { showToast('❌ Selecione uma data', 'err'); return; }
  if (tipo === 'horario') body.horario = document.getElementById('bloq-hora').value;

  const r = await apiFetch('/api/bloqueios', { method: 'POST', body: JSON.stringify(body) });
  if (r.ok) {
    showToast('🚫 Bloqueio criado!', 'ok');
    document.getElementById('bloq-data').value   = '';
    document.getElementById('bloq-motivo').value = '';
    await loadBloqueios();
  } else {
    showToast('❌ Erro ao criar bloqueio', 'err');
  }
}

async function deletarBloqueio(id) {
  const r = await apiFetch(`/api/bloqueios/${id}`, { method: 'DELETE' });
  if (r.ok) {
    showToast('✅ Bloqueio removido', 'ok');
    await loadBloqueios();
  }
}

// ══════════════════════════════════════════════════════════════
//  Dados de acesso (usuário e senha do admin)
// ══════════════════════════════════════════════════════════════
async function alterarUsuario() {
  const novo  = document.getElementById('u-novo').value.trim();
  const senha = document.getElementById('u-senha').value;
  const msg   = document.getElementById('usuario-msg');

  if (!novo || !senha) return setMsg(msg, false, 'Preencha todos os campos.');
  if (novo.length < 3) return setMsg(msg, false, 'O usuário deve ter pelo menos 3 caracteres.');

  const r = await apiFetch('/api/auth/usuario', {
    method: 'PUT',
    body:   JSON.stringify({ novoUsuario: novo, senhaAtual: senha }),
  });
  const d = await r.json();
  if (r.ok) {
    setMsg(msg, true, '✅ Usuário alterado com sucesso!');
    document.getElementById('u-novo').value  = '';
    document.getElementById('u-senha').value = '';
  } else {
    setMsg(msg, false, '❌ ' + (d.erro || 'Erro ao alterar usuário.'));
  }
}

async function alterarSenha() {
  const atual = document.getElementById('s-atual').value;
  const nova  = document.getElementById('s-nova').value;
  const conf  = document.getElementById('s-conf').value;
  const msg   = document.getElementById('senha-msg');

  if (!atual || !nova || !conf) return setMsg(msg, false, 'Preencha todos os campos.');
  if (nova.length < 6)          return setMsg(msg, false, 'A nova senha deve ter pelo menos 6 caracteres.');
  if (nova !== conf)            return setMsg(msg, false, 'A confirmação não confere com a nova senha.');

  const r = await apiFetch('/api/auth/senha', {
    method: 'PUT',
    body:   JSON.stringify({ senhaAtual: atual, novaSenha: nova }),
  });
  const d = await r.json();
  if (r.ok) {
    setMsg(msg, true, '✅ Senha alterada com sucesso!');
    ['s-atual', 's-nova', 's-conf'].forEach(id => { document.getElementById(id).value = ''; });
  } else {
    setMsg(msg, false, '❌ ' + (d.erro || 'Erro ao alterar senha.'));
  }
}
