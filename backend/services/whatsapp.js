/**
 * services/whatsapp.js
 *
 * Integração com o WhatsApp via whatsapp-web.js — um Chromium headless
 * (Puppeteer) rodando o WhatsApp Web, conectado ao número da barbearia
 * como "aparelho conectado".
 *
 * Responsabilidades:
 *  1. Conexão   → pareamento por QR Code ou por código (número do celular),
 *                 sessão salva em disco (data/wwebjs_auth) e restaurada no boot
 *  2. Resiliência → heartbeat, watchdog e reconexão com backoff exponencial
 *  3. Envio     → fila única com limite por minuto, pausas aleatórias,
 *                 "digitando..." e deduplicação (reduz risco de ban)
 *  4. Recuperação → ao reconectar, reenvia confirmações/lembretes que
 *                 falharam enquanto estava offline
 *  5. Textos    → modelos das mensagens de confirmação e lembrete
 *
 * Estados expostos (getStatus): 'disconnected' | 'connecting' | 'connected'
 *
 * Ciclo de vida completo: docs/fluxo-whatsapp.md
 */

'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode       = require('qrcode');
const path         = require('path');
const fs           = require('fs');
const { execSync } = require('child_process');
const { agoraBRT, fmtData, fmtHora, dataBR } = require('../utils/datas');

// ═════════════════════════════════════════════════════════════
//  Configuração
// ═════════════════════════════════════════════════════════════

// ── Diretórios da sessão ──────────────────────────────────────
const DATA_DIR    = path.join(__dirname, '..', 'data');
const AUTH_DIR    = path.join(DATA_DIR, 'wwebjs_auth');   // credenciais do aparelho
const SESSION_DIR = path.join(AUTH_DIR, 'session');       // perfil do Chromium
const CACHE_DIR   = path.join(DATA_DIR, 'wwebjs_cache');  // cache da versão do WhatsApp Web

// ── Conexão ───────────────────────────────────────────────────
const RECONNECT_INICIAL = 5000;    // 1ª tentativa de reconexão após 5s…
const MAX_DELAY         = 120000;  // …dobrando até no máximo 2 min
const HEARTBEAT_INT     = 45000;   // confere o estado real a cada 45s
const WATCHDOG_INT      = 60000;   // confere se há conexão/reconexão a cada 1 min
const STUCK_MS          = 180000;  // 'connecting' sem QR/código por 3 min = travado

// ── Envio (anti-ban) ──────────────────────────────────────────
const MSG_DELAY_MIN = 2000;                // pausa mínima entre mensagens
const MSG_DELAY_MAX = 5000;                // pausa máxima entre mensagens
const MSG_PER_MIN   = 6;                   // teto de mensagens por minuto
const DEDUP_MS      = 6 * 60 * 60 * 1000;  // mesma chave só é enviada 1x a cada 6h

const MOTIVO_OFFLINE = 'WhatsApp não conectado';

// Erros do Puppeteer que indicam navegador morto/instável → reinicia o cliente
const BROWSER_ERRORS = [
  'detached Frame', 'Session closed', 'Target closed',
  'Protocol error', 'Connection closed', 'context was destroyed',
];

// ═════════════════════════════════════════════════════════════
//  Estado interno
// ═════════════════════════════════════════════════════════════

let client      = null;            // instância ativa do whatsapp-web.js
let status      = 'disconnected';
let currentQR   = null;            // QR Code atual (data URL) para o painel
let currentCode = null;            // código de pareamento atual (modo número)
let pairPhone   = null;            // número usado no modo código; null = modo QR
let _db         = null;            // conexão SQLite (injetada pelo server.js)

// Ciclo de vida
let heartbeatTimer   = null;
let watchdogTimer    = null;
let reconnectTimer   = null;
let reconnectDelay   = RECONNECT_INICIAL;
let connectingSince  = 0;
let isDestroying     = false;
let manualDisconnect = false;      // true quando o dono desconectou de propósito

// Fila de envio
const msgQueue         = [];
const enviadasRecentes = new Map(); // chave → timestamp do envio
let queueRunning       = false;
let msgCountWindow     = 0;
let windowResetTimer   = null;
let reenviando         = false;

// ═════════════════════════════════════════════════════════════
//  Acessores públicos
// ═════════════════════════════════════════════════════════════

function setDb(db)    { _db = db; }
function getStatus()  { return status; }
function getQR()      { return currentQR; }
function getCode()    { return currentCode; }
function getMode()    { return pairPhone ? 'codigo' : 'qr'; }
function _getClient() { return client; }

// ═════════════════════════════════════════════════════════════
//  Utilitários
// ═════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Soma até 30% de variação aleatória — evita intervalos com padrão robótico. */
function jitter(base) {
  return base + Math.floor(Math.random() * base * 0.3);
}

/** Pausa aleatória entre MSG_DELAY_MIN e MSG_DELAY_MAX. */
function randomDelay() {
  return MSG_DELAY_MIN + Math.floor(Math.random() * (MSG_DELAY_MAX - MSG_DELAY_MIN));
}

/** Sorteia um item da lista (variações de texto das mensagens). */
function escolher(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

/**
 * Normaliza um telefone para o formato internacional sem símbolos
 * (ex.: "(34) 91234-5678" → "5534912345678"). Números com até 11
 * dígitos são tratados como nacionais — inclusive os de DDD 55.
 * @param {string} numero
 * @returns {string}
 */
function normalizarFone(numero) {
  let fone = String(numero || '').replace(/\D/g, '');
  if (!fone.startsWith('55') || fone.length <= 11) fone = '55' + fone;
  return fone;
}

/**
 * User-agent com a mesma versão do Chromium que o Puppeteer realmente
 * usa. Um UA diferente do navegador de verdade é sinal fácil de automação.
 * @returns {string}
 */
function userAgentAtual() {
  let ver = '146.0.0.0';
  try {
    ver = require('puppeteer-core/lib/cjs/puppeteer/revisions.js').PUPPETEER_REVISIONS.chrome || ver;
  } catch {}
  const major = ver.split('.')[0];
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/**
 * Remove travas e processos Chromium que sobraram de uma execução
 * anterior (ex.: processo morto à força). Sem isso o Chromium novo
 * não abre o mesmo perfil ("SingletonLock").
 */
function cleanupChrome() {
  const lockFile = path.join(SESSION_DIR, 'SingletonLock');
  try {
    // O SingletonLock é um symlink "host-PID" apontando para o dono do perfil
    const pid = parseInt(fs.readlinkSync(lockFile).split('-').pop(), 10);
    if (pid && !isNaN(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  } catch {}

  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try { fs.unlinkSync(path.join(SESSION_DIR, f)); } catch {}
  }

  try {
    execSync('pkill -9 -f "wwebjs_auth" 2>/dev/null || true', { stdio: 'ignore', shell: true });
  } catch {}
}

// ═════════════════════════════════════════════════════════════
//  Resiliência — heartbeat, watchdog e reconexão
// ═════════════════════════════════════════════════════════════

/**
 * Heartbeat: enquanto conectado, pergunta ao WhatsApp Web o estado real.
 * Detecta conexões "zumbis" (status diz conectado, mas a página morreu).
 */
function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(async () => {
    if (!client || status !== 'connected') return;
    try {
      const state = await client.getState();
      if (state !== 'CONNECTED') {
        console.log(`[WhatsApp] ⚠️  Heartbeat: estado=${state} — reconectando`);
        await forceReconnect();
      }
    } catch (e) {
      console.log(`[WhatsApp] ⚠️  Heartbeat falhou (${e.message}) — reconectando`);
      await forceReconnect();
    }
  }, HEARTBEAT_INT);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

/**
 * Watchdog: garante que sempre exista um cliente ativo ou uma reconexão
 * agendada (exceto quando o dono desconectou de propósito) e reinicia
 * inicializações que travaram sem gerar QR/código.
 */
function startWatchdog() {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(async () => {
    if (manualDisconnect || isDestroying) return;

    if (!client && !reconnectTimer) {
      console.log('[WhatsApp] 🐕 Watchdog: sem cliente ativo — reconectando');
      scheduleReconnect();
      return;
    }

    const esperandoLeitura = currentQR || currentCode;
    if (status === 'connecting' && !esperandoLeitura &&
        connectingSince && Date.now() - connectingSince > STUCK_MS) {
      console.log('[WhatsApp] 🐕 Watchdog: inicialização travada — reiniciando');
      await forceReconnect();
    }
  }, WATCHDOG_INT);
}

/** Agenda uma nova tentativa com backoff exponencial + jitter. */
function scheduleReconnect() {
  if (manualDisconnect || reconnectTimer) return;

  const delay = jitter(reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);

  console.log(`[WhatsApp] 🔄 Reconectando em ${Math.round(delay / 1000)}s...`);
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await initialize();
  }, delay);
}

/** Descarta o cliente atual (fechando o Chromium) e agenda reconexão. */
async function forceReconnect() {
  if (isDestroying) return;
  isDestroying = true;

  stopHeartbeat();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  status      = 'disconnected';
  currentQR   = null;
  currentCode = null;

  if (client) {
    const antigo = client;
    client = null;
    try { await antigo.destroy(); } catch {}
  }

  isDestroying = false;
  scheduleReconnect();
}

// ═════════════════════════════════════════════════════════════
//  Inicialização do cliente
// ═════════════════════════════════════════════════════════════

/**
 * Cria o cliente do WhatsApp e conecta. Se já existir sessão salva,
 * ela é restaurada sem precisar de QR/código.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.pairPhone] número para parear por código
 *   (8 caracteres digitados no celular). null força o modo QR;
 *   omitido mantém o modo escolhido anteriormente.
 */
async function initialize(opts = {}) {
  if (opts.pairPhone !== undefined) {
    pairPhone = opts.pairPhone ? normalizarFone(opts.pairPhone) : null;
  }
  if (client || isDestroying) return;

  manualDisconnect = false;
  startWatchdog();
  cleanupChrome();

  status          = 'connecting';
  connectingSince = Date.now();
  currentQR       = null;
  currentCode     = null;

  const c = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
    puppeteer: {
      headless: true,
      userDataDir: SESSION_DIR,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-hang-monitor',
        '--disable-prompt-on-repost',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--safebrowsing-disable-auto-update',
        '--password-store=basic',
        '--use-mock-keychain',
        '--disable-blink-features=AutomationControlled', // oculta navigator.webdriver
        '--window-size=1280,800',
        '--lang=pt-BR',
        // Não usar --single-process: causa crashes do Chromium
      ],
    },
    userAgent: userAgentAtual(),
    // Nome exibido em "Aparelhos conectados" no celular
    deviceName:  'SC Barbearia',
    browserName: 'Chrome',
    qrMaxRetries: 0, // o QR renova sem limite enquanto ninguém escaneia
    ...(pairPhone ? {
      pairWithPhoneNumber: { phoneNumber: pairPhone, showNotification: true, intervalMs: 180000 },
    } : {}),
    webVersionCache: { type: 'local', path: CACHE_DIR },
  });
  client = c;

  // Os handlers só agem se `c` ainda for o cliente ativo: eventos atrasados
  // de um cliente já descartado não podem derrubar o cliente novo.
  const ativo = () => client === c;

  c.on('qr', async (qr) => {
    if (!ativo()) return;
    try {
      currentQR = await qrcode.toDataURL(qr);
      status    = 'connecting';
      console.log('[WhatsApp] 📱 QR Code gerado — escaneie no celular');
    } catch (e) {
      console.error('[WhatsApp] Erro ao gerar QR:', e.message);
    }
  });

  c.on('code', (code) => {
    if (!ativo()) return;
    currentCode = code;
    status      = 'connecting';
    console.log(`[WhatsApp] 🔢 Código de pareamento gerado para ${pairPhone}`);
  });

  c.on('authenticated', () => {
    if (!ativo()) return;
    currentQR   = null;
    currentCode = null;
    console.log('[WhatsApp] 🔐 Autenticado — sessão salva');
  });

  c.on('ready', () => {
    if (!ativo()) return;
    currentQR      = null;
    currentCode    = null;
    pairPhone      = null; // sessão salva: próximas conexões não precisam de código
    status         = 'connected';
    reconnectDelay = RECONNECT_INICIAL;
    console.log('[WhatsApp] ✅ Conectado e pronto!');
    startHeartbeat();
    reenviarPendentes();
  });

  c.on('auth_failure', (msg) => {
    if (!ativo()) return;
    console.log(`[WhatsApp] ❌ Falha na autenticação: ${msg}`);
    descartarCliente(c);
  });

  c.on('change_state', async (state) => {
    if (!ativo()) return;
    console.log(`[WhatsApp] 🔀 Estado interno: ${state}`);

    // Mesmo número aberto em outro WhatsApp Web: retoma a sessão aqui
    if (state === 'CONFLICT') {
      console.log('[WhatsApp] ⚔️  Conflito de sessão — assumindo controle...');
      try { await c.takeOver(); } catch (e) {
        console.log('[WhatsApp] Falha ao assumir sessão:', e.message);
        await forceReconnect();
      }
      return;
    }

    // Durante o pareamento o estado UNPAIRED é normal —
    // só reage quando já estava conectado
    if (status === 'connected' &&
        ['UNLAUNCHED', 'TIMEOUT', 'TOS_BLOCK', 'UNPAIRED'].includes(state)) {
      console.log(`[WhatsApp] ⚠️  Estado crítico (${state}) — reconectando`);
      await forceReconnect();
    }
  });

  c.on('disconnected', (reason) => {
    if (!ativo()) return;
    console.log(`[WhatsApp] 🔌 Desconectado: ${reason}`);
    descartarCliente(c);
  });

  try {
    await c.initialize();

    if (ativo() && c.pupBrowser) {
      c.pupBrowser.on('disconnected', async () => {
        if (manualDisconnect || !ativo()) return;
        console.log('[WhatsApp] 💥 Browser desconectado — reconectando');
        await forceReconnect();
      });
    }
  } catch (e) {
    if (!ativo()) return;
    console.error('[WhatsApp] Erro ao inicializar:', e.message);
    descartarCliente(c);
  }
}

/**
 * Tira o cliente de uso, fecha o Chromium dele e agenda reconexão.
 * Fechar o Chromium aqui é essencial: se ele ficasse aberto, o
 * cleanupChrome() da próxima tentativa o mataria e o evento
 * 'Browser desconectado' atrasado derrubaria o cliente novo.
 * @param {Client} c
 */
function descartarCliente(c) {
  stopHeartbeat();
  status      = 'disconnected';
  currentQR   = null;
  currentCode = null;
  client      = null;
  c.destroy().catch(() => {});
  scheduleReconnect();
}

// ═════════════════════════════════════════════════════════════
//  Envio de mensagens
// ═════════════════════════════════════════════════════════════

/**
 * Enfileira uma mensagem. Todas as mensagens passam por uma única fila
 * que respeita o limite por minuto e as pausas aleatórias.
 *
 * @param {string} numero   telefone do cliente (qualquer formato)
 * @param {string} mensagem texto a enviar
 * @param {string} [chave]  identifica a mensagem (ex.: 'conf-12'); a mesma
 *                          chave para o mesmo número não é reenviada em 6h
 * @returns {Promise<{ ok: boolean, motivo?: string, duplicada?: boolean }>}
 */
function enviarMensagem(numero, mensagem, chave) {
  chave = normalizarFone(numero) + '|' + (chave || mensagem);

  const agora = Date.now();
  for (const [k, t] of enviadasRecentes) {
    if (agora - t > DEDUP_MS) enviadasRecentes.delete(k);
  }
  if (enviadasRecentes.has(chave)) {
    console.log('[WhatsApp] ⏭️  Mensagem repetida ignorada');
    return Promise.resolve({ ok: true, duplicada: true });
  }

  return new Promise(resolve => {
    msgQueue.push({ numero, mensagem, chave, resolve });
    processQueue();
  });
}

/** Consome a fila, uma mensagem por vez, respeitando MSG_PER_MIN. */
async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;

  while (msgQueue.length > 0) {
    if (msgCountWindow >= MSG_PER_MIN) {
      console.log('[WhatsApp] ⏳ Rate limit atingido — aguardando janela resetar...');
      await sleep(5000);
      continue;
    }

    const { numero, mensagem, chave, resolve } = msgQueue.shift();
    const result = await _enviar(numero, mensagem);
    if (result.ok) enviadasRecentes.set(chave, Date.now());

    // Falha por estar offline não chega ao WhatsApp — não conta no limite
    if (result.motivo === MOTIVO_OFFLINE) {
      resolve(result);
      continue;
    }

    // Janela de 1 minuto iniciada pela primeira mensagem enviada nela
    msgCountWindow++;
    if (!windowResetTimer) {
      windowResetTimer = setTimeout(() => {
        msgCountWindow   = 0;
        windowResetTimer = null;
      }, 60000);
    }

    resolve(result);

    if (msgQueue.length > 0) await sleep(randomDelay());
  }

  queueRunning = false;
}

/**
 * Envia de fato uma mensagem (chamado só pela fila).
 * Resolve o número no WhatsApp — tentando também a versão com o 9º
 * dígito para celulares antigos — e simula a digitação antes de enviar.
 * @returns {Promise<{ ok: boolean, motivo?: string }>}
 */
async function _enviar(numero, mensagem) {
  if (!client || status !== 'connected') {
    return { ok: false, motivo: MOTIVO_OFFLINE };
  }
  try {
    let fone     = normalizarFone(numero);
    let numberId = await client.getNumberId(fone);

    // Número salvo sem o 9 (DDD + 8 dígitos): tenta com o 9 na frente
    if (!numberId) {
      const nacional = fone.slice(2);
      if (nacional.length === 10) {
        const foneCom9 = '55' + nacional.slice(0, 2) + '9' + nacional.slice(2);
        numberId = await client.getNumberId(foneCom9);
        if (numberId) fone = foneCom9;
      }
    }

    if (!numberId) {
      console.log(`[WhatsApp] ⚠️  Número não encontrado no WhatsApp: ${fone}`);
      return { ok: false, motivo: 'Número não encontrado no WhatsApp' };
    }

    // "digitando..." por um tempo proporcional ao tamanho do texto
    try {
      const chat = await client.getChatById(numberId._serialized);
      await chat.sendStateTyping();
      await sleep(Math.min(1500 + mensagem.length * 25, 6000));
      await chat.clearState();
    } catch {}

    await client.sendMessage(numberId._serialized, mensagem);
    console.log(`[WhatsApp] ✅ Mensagem enviada para ${fone}`);
    return { ok: true };
  } catch (e) {
    console.error('[WhatsApp] ❌ Erro ao enviar:', e.message);
    if (BROWSER_ERRORS.some(err => e.message?.includes(err))) {
      console.log('[WhatsApp] 🔄 Erro crítico no browser — reiniciando...');
      forceReconnect();
    }
    return { ok: false, motivo: e.message };
  }
}

// ═════════════════════════════════════════════════════════════
//  Recuperação após reconexão
// ═════════════════════════════════════════════════════════════

/**
 * Reenvia o que falhou enquanto o WhatsApp estava offline:
 *  1. confirmações não enviadas de agendamentos de hoje em diante
 *  2. lembretes perdidos de agendamentos de hoje que ainda não aconteceram
 *
 * O evento 'ready' pode disparar várias vezes seguidas; a trava
 * `reenviando` impede enfileirar o mesmo agendamento mais de uma vez.
 */
async function reenviarPendentes() {
  if (!_db || reenviando) return;
  reenviando = true;

  await sleep(5000); // deixa a conexão estabilizar antes de enviar
  try {
    const agora   = agoraBRT();
    const hoje    = fmtData(agora);
    const agoraHM = fmtHora(agora);

    const confirmacoes = _db.prepare(`
      SELECT * FROM agendamentos
      WHERE confirmacao_enviada = 0
        AND status != 'cancelado'
        AND data >= ?
    `).all(hoje);

    if (confirmacoes.length > 0) {
      console.log(`[WhatsApp] 🔄 Reenviando ${confirmacoes.length} confirmação(ões) pendente(s)...`);
      for (const ag of confirmacoes) {
        const r = await enviarMensagem(ag.cliente_fone, msgConfirmacao(ag), `conf-${ag.id}`);
        if (r.ok) {
          _db.prepare('UPDATE agendamentos SET confirmacao_enviada = 1 WHERE id = ?').run(ag.id);
          console.log(`[WhatsApp] ✅ Confirmação reenviada → ${ag.cliente_nome} (id ${ag.id})`);
        }
      }
    }

    const lembretes = _db.prepare(`
      SELECT * FROM agendamentos
      WHERE lembrete_enviado = 0
        AND status = 'confirmado'
        AND data = ?
        AND horario > ?
    `).all(hoje, agoraHM);

    if (lembretes.length > 0) {
      console.log(`[WhatsApp] 🔄 Reenviando ${lembretes.length} lembrete(s) perdido(s)...`);
      for (const ag of lembretes) {
        const r = await enviarMensagem(ag.cliente_fone, msgLembrete(ag), `lemb-${ag.id}`);
        if (r.ok) {
          _db.prepare('UPDATE agendamentos SET lembrete_enviado = 1 WHERE id = ?').run(ag.id);
          console.log(`[WhatsApp] ✅ Lembrete reenviado → ${ag.cliente_nome} (${ag.data} ${ag.horario})`);
        }
      }
    }
  } catch (e) {
    console.error('[WhatsApp] Erro ao reenviar pendentes:', e.message);
  } finally {
    reenviando = false;
  }
}

// ═════════════════════════════════════════════════════════════
//  Desconexão e encerramento
// ═════════════════════════════════════════════════════════════

/** Fecha o cliente atual, se houver, aguardando o Chromium encerrar. */
async function fecharCliente() {
  if (!client) return;
  const antigo = client;
  client = null;
  try { await antigo.destroy(); } catch {}
}

/**
 * Desconexão pedida pelo dono no painel. Mantém a sessão salva
 * (a próxima conexão não pede QR) e desliga a reconexão automática.
 */
async function disconnect() {
  manualDisconnect = true;
  stopHeartbeat();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  await fecharCliente();
  status      = 'disconnected';
  currentQR   = null;
  currentCode = null;
  console.log('[WhatsApp] 🔴 Desconectado manualmente');
}

/**
 * Encerramento do processo (deploy / restart do pm2). Fecha o Chromium
 * com calma para a sessão ser gravada em disco e não se corromper.
 */
async function shutdown() {
  manualDisconnect = true;
  stopHeartbeat();
  if (watchdogTimer)  { clearInterval(watchdogTimer); watchdogTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  await fecharCliente();
}

/** Apaga a sessão salva — permite conectar outro número. */
async function limparSessao() {
  try { fs.rmSync(AUTH_DIR,  { recursive: true, force: true }); } catch {}
  try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }); } catch {}
  console.log('[WhatsApp] 🗑️  Sessão apagada — pronto para novo número');
}

// ═════════════════════════════════════════════════════════════
//  Modelos de mensagem
//  Pequenas variações de texto: mensagens 100% idênticas em série
//  são um dos sinais que o WhatsApp usa para identificar spam.
// ═════════════════════════════════════════════════════════════

/** Mensagem enviada logo após o agendamento. */
function msgConfirmacao(ag) {
  const nome = ag.cliente_nome;
  return (
    escolher(['✅ *Agendamento Confirmado!*', '✅ *Horário confirmado!*', '✅ *Tudo certo com seu agendamento!*']) + '\n\n' +
    escolher([`Olá *${nome}*! ✂`, `Oi *${nome}*! ✂`, `Fala, *${nome}*! ✂`]) + '\n\n' +
    `👤 Barbeiro: ${ag.barbeiro_nome}\n` +
    `💈 Serviço: ${ag.servico_nome}\n` +
    `📅 Data: ${dataBR(ag.data)}\n` +
    `⏰ Horário: ${ag.horario}\n` +
    `💰 Valor: R$ ${parseFloat(ag.preco).toFixed(2)}\n\n` +
    '📍 Serra do Salitre - MG\n' +
    escolher(['_Qualquer dúvida é só falar! 😊_', '_Se precisar remarcar, é só responder aqui! 😊_', '_Qualquer coisa, chama aqui! 😊_'])
  );
}

/** Mensagem enviada ~2h antes do horário (services/scheduler.js). */
function msgLembrete(ag) {
  const nome = ag.cliente_nome;
  return (
    '⏰ *Lembrete — SC Barbearia!*\n\n' +
    escolher([
      `Olá *${nome}*! Passando para lembrar do seu horário de hoje.`,
      `Oi *${nome}*! Só lembrando do seu horário hoje.`,
      `Fala, *${nome}*! Seu horário é hoje, hein!`,
    ]) + '\n\n' +
    `👤 Barbeiro: ${ag.barbeiro_nome}\n` +
    `💈 Serviço: ${ag.servico_nome}\n` +
    `📅 ${dataBR(ag.data)} às *${ag.horario}*\n\n` +
    escolher(['Te esperamos! ✂💈', 'Até já! ✂💈', 'Nos vemos lá! ✂💈'])
  );
}

module.exports = {
  // conexão
  initialize, disconnect, shutdown, limparSessao,
  getStatus, getQR, getCode, getMode, setDb, _getClient,
  // envio
  enviarMensagem, msgConfirmacao, msgLembrete, normalizarFone,
};
