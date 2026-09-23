/* ══════════════════════════════════════════════════════════════
   SC Barbearia — utils.js
   Base compartilhada por todas as telas: estado global, chamadas
   à API, formatação, datas no fuso de Brasília e avisos (toast).

   Os scripts do site são carregados em ordem no index.html:
     utils.js → site.js → agendamento.js → admin.js
     → admin-whatsapp.js → relatorios.js → main.js
   Todos compartilham o escopo global (os onclick do HTML chamam
   as funções pelo nome), por isso este arquivo vem primeiro.
══════════════════════════════════════════════════════════════ */

'use strict';

// ── Configuração ──────────────────────────────────────────────
const API_BASE      = '';                // API no mesmo domínio do site
const TOKEN_KEY     = 'sc_admin_token';  // chave do JWT no localStorage
const FUSO          = 'America/Sao_Paulo';
const MESES         = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DIAS_SEMANA   = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

// ── Estado global ─────────────────────────────────────────────
// Dados públicos carregados da API (barbeiros, serviços, configurações)
let barbeiros  = [];
let servicos   = [];
let configData = {};

// Token do painel admin (vazio = não logado)
let adminToken = lerStorage(TOKEN_KEY);

// Estado do fluxo de agendamento e dos modais do painel
const st = {
  step: 1,                                    // etapa atual do agendamento (1–5)
  barb: null, svc: null, data: null, hora: null,
  diasBloqueados: [],                         // datas bloqueadas do barbeiro escolhido
  calY: new Date().getFullYear(),             // mês exibido no calendário
  calM: new Date().getMonth(),
  editB: null, editS: null,                   // id em edição nos modais (null = novo)
  foto: '',                                   // foto do barbeiro (data URL) no modal
};

// ══════════════════════════════════════════════════════════════
//  Armazenamento local
//  localStorage pode lançar erro (modo privado, bloqueio de site)
// ══════════════════════════════════════════════════════════════
function lerStorage(chave) {
  try { return localStorage.getItem(chave) || ''; } catch { return ''; }
}
function gravarStorage(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch {}
}
function apagarStorage(chave) {
  try { localStorage.removeItem(chave); } catch {}
}

/** Descarta o token salvo (logout ou sessão expirada). */
function limparToken() {
  adminToken = '';
  apagarStorage(TOKEN_KEY);
}

// ══════════════════════════════════════════════════════════════
//  API
// ══════════════════════════════════════════════════════════════

/**
 * fetch com JSON e token do admin. Se a API responder 401 (token
 * ausente/expirado), faz logout e mostra a tela de login.
 * @param {string} url  caminho da API (ex.: '/api/servicos')
 * @param {RequestInit} [opts]
 * @returns {Promise<Response>}
 */
async function apiFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (adminToken) headers['Authorization'] = 'Bearer ' + adminToken;

  const res = await fetch(API_BASE + url, { ...opts, headers });
  if (res.status === 401) {
    limparToken();
    showLoginScreen();
  }
  return res;
}

/** Carrega barbeiros, serviços e configurações públicas para o estado global. */
async function loadPublicData() {
  try {
    const [rb, rs, rc] = await Promise.all([
      apiFetch('/api/barbeiros').then(r => r.json()),
      apiFetch('/api/servicos').then(r => r.json()),
      apiFetch('/api/config').then(r => r.json()),
    ]);
    barbeiros  = Array.isArray(rb) ? rb : [];
    servicos   = Array.isArray(rs) ? rs : [];
    configData = rc || {};
  } catch (e) {
    console.error('[App] Erro ao carregar dados:', e);
  }
}

// ══════════════════════════════════════════════════════════════
//  Formatação
// ══════════════════════════════════════════════════════════════

/**
 * Escapa texto para inserir com segurança em innerHTML.
 * Obrigatório para qualquer dado digitado por clientes ou pelo admin
 * (nome, observação...): sem isso, um "nome" com HTML/JS seria executado
 * no painel e poderia roubar o login do admin.
 * @param {*} v
 * @returns {string}
 */
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapa e converte quebras de linha em <br> (textos de várias linhas). */
function escMultilinha(v) {
  return esc(v).replace(/\n/g, '<br>');
}

/** 35 → "R$ 35.00" */
function fmtPreco(v, casas = 2) {
  return 'R$ ' + parseFloat(v || 0).toFixed(casas);
}

/** "2026-09-23" → "23/09/2026" */
function dataBR(ds) {
  return ds ? ds.split('-').reverse().join('/') : '';
}

/** Rótulo e classe CSS (chip-c / chip-d / chip-x) de cada status de agendamento. */
function statusInfo(status) {
  if (status === 'confirmado') return { cls: 'c', txt: 'Confirmado' };
  if (status === 'concluido')  return { cls: 'd', txt: 'Concluído' };
  return { cls: 'x', txt: 'Cancelado' };
}

/**
 * Link para abrir conversa no WhatsApp. Aceita número com ou sem o
 * código do país (55); números com até 11 dígitos são tratados como
 * nacionais — mesma regra do backend (services/whatsapp.normalizarFone).
 * @param {string} fone
 * @param {string} [texto] mensagem pré-preenchida
 */
function linkWhatsApp(fone, texto) {
  let num = String(fone || '').replace(/\D/g, '');
  if (!num.startsWith('55') || num.length <= 11) num = '55' + num;
  return `https://wa.me/${num}` + (texto ? `?text=${encodeURIComponent(texto)}` : '');
}

/** Máscara "(34) 99999-9999" aplicada enquanto o usuário digita. */
function maskPhone(el) {
  let v = el.value.replace(/\D/g, '').substring(0, 11);
  if (v.length > 6)      v = '(' + v.substring(0, 2) + ') ' + v.substring(2, 7) + '-' + v.substring(7);
  else if (v.length > 2) v = '(' + v.substring(0, 2) + ') ' + v.substring(2);
  else if (v.length > 0) v = '(' + v;
  el.value = v;
}

// ══════════════════════════════════════════════════════════════
//  Datas
//  Datas trafegam como "YYYY-MM-DD" e horários como "HH:MM";
//  nesse formato, comparar strings equivale a comparar datas.
// ══════════════════════════════════════════════════════════════

/** Date → "YYYY-MM-DD" (campos locais). */
function fmt(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/** Date → "HH:MM" (campos locais). */
function fmtHoraLocal(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** Agora no horário de Brasília, independente do fuso do aparelho do cliente. */
function agoraBRT() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: FUSO }));
}

/** "YYYY-MM-DD" → Date local à meia-noite (evita o deslocamento de fuso do parse ISO). */
function parseData(ds) {
  const [a, m, d] = ds.split('-').map(Number);
  return new Date(a, m - 1, d);
}

/**
 * Horários de funcionamento configurados no painel:
 * { "0".."6": { ini, fim } | null } (0 = domingo, null = fechado).
 * @returns {object|null} null enquanto as configurações não carregaram
 */
function lerHorariosFuncionamento() {
  const hf = configData.horarios_funcionamento;
  if (!hf) return null;
  try { return typeof hf === 'string' ? JSON.parse(hf) : hf; } catch { return null; }
}

/** A barbearia está aberta agora? (usado no selo "Aberto Agora") */
function isOpen() {
  const agora = agoraBRT();
  const dow   = agora.getDay();
  const cfg   = lerHorariosFuncionamento();

  if (!cfg) {
    // Configurações ainda não carregaram: usa o horário padrão
    const h = agora.getHours();
    return (dow >= 1 && dow <= 5 && h >= 8 && h < 19) || (dow === 6 && h >= 8 && h < 17);
  }

  const dia  = cfg[String(dow)];
  const hora = fmtHoraLocal(agora);
  return !!dia && hora >= dia.ini && hora < dia.fim;
}

// ══════════════════════════════════════════════════════════════
//  Avisos
// ══════════════════════════════════════════════════════════════
let toastTimer;

/**
 * Mostra o aviso padrão no rodapé da tela.
 * @param {string} msg
 * @param {''|'ok'|'err'} [type] cor do aviso
 */
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

/**
 * Aviso flutuante rápido (2,5s) com cor própria — usado ao tocar em
 * horários indisponíveis. Não empilha: ignora se o mesmo já está visível.
 * @param {string} id  id do elemento (evita duplicar)
 * @param {string} msg
 * @param {string} cor cor de fundo
 */
function toastFlutuante(id, msg, cor) {
  if (document.getElementById(id)) return;
  const el = document.createElement('div');
  el.id = id;
  el.textContent = msg;
  el.style.cssText =
    'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);' +
    `background:${cor};color:#fff;padding:.65rem 1.4rem;border-radius:2rem;` +
    'font-size:.85rem;font-weight:600;z-index:9999;' +
    'box-shadow:0 4px 20px rgba(0,0,0,.4);animation:fadeInUp .2s ease';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

/**
 * Mensagem de resultado abaixo de um formulário (verde = ok, vermelho = erro).
 * @param {HTMLElement} el
 * @param {boolean} ok
 * @param {string} txt
 */
function setMsg(el, ok, txt) {
  el.style.color  = ok ? '#2ecc71' : '#e74c3c';
  el.textContent  = txt;
}

// ══════════════════════════════════════════════════════════════
//  Modais
// ══════════════════════════════════════════════════════════════
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}
