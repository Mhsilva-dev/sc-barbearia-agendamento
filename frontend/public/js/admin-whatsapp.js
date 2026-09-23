/* ══════════════════════════════════════════════════════════════
   SC Barbearia — admin-whatsapp.js
   Aba "WhatsApp" do painel: status da conexão e pareamento do
   número da barbearia, por QR Code ou por código (número do celular).

   Enquanto não conecta, a aba consulta a API a cada 3s para mostrar
   o QR/código atualizado; ao conectar ou desconectar, a consulta para.
══════════════════════════════════════════════════════════════ */

'use strict';

const WAPP_POLL_MS = 3000;
let wappPollTimer  = null;

function iniciarPollingWapp() {
  if (!wappPollTimer) wappPollTimer = setInterval(atualizarWapp, WAPP_POLL_MS);
}
function pararPollingWapp() {
  clearInterval(wappPollTimer);
  wappPollTimer = null;
}

/** Ao abrir a aba: mostra o estado atual e começa a acompanhar. */
async function loadWappStatus() {
  pararPollingWapp();
  await atualizarWapp();
  iniciarPollingWapp();
}

/**
 * Busca o estado na API e ajusta a tela:
 *  connected    → confirmação + botões Desconectar / Trocar Número
 *  connecting   → código de pareamento, QR Code ou "preparando..."
 *  disconnected → opções de conexão (QR ou número)
 */
async function atualizarWapp() {
  try {
    const d = await (await apiFetch('/api/whatsapp/qr')).json();

    const el = id => document.getElementById(id);
    const paineis = ['wapp-qr-wrap', 'wapp-code-wrap', 'wapp-loading', 'wapp-metodos', 'wapp-connected-info'];

    /** Deixa visível só o painel `id`. */
    const mostrar = (id) => paineis.forEach(p => { el(p).style.display = p === id ? 'block' : 'none'; });

    /** Visibilidade dos botões de ação. */
    const botoes = (cancelar, desconectar, trocar) => {
      el('wapp-btn-cancelar').style.display    = cancelar    ? 'inline-flex' : 'none';
      el('wapp-btn-desconectar').style.display = desconectar ? 'inline-flex' : 'none';
      el('wapp-btn-trocar').style.display      = trocar      ? 'inline-flex' : 'none';
    };

    /** Selo de status no topo (texto, cor RGB do fundo, cor do texto). */
    const selo = (txt, rgb, cor) => {
      const b = el('wapp-status-badge');
      b.textContent      = txt;
      b.style.background = `rgba(${rgb},.2)`;
      b.style.color      = cor;
    };

    if (d.status === 'connected') {
      selo('🟢 Conectado', '46,204,113', '#2ecc71');
      mostrar('wapp-connected-info');
      botoes(false, true, true);
      pararPollingWapp();
      return;
    }

    if (d.status === 'connecting') {
      if (d.code) {
        selo('🟡 Aguardando código no celular', '241,196,15', '#f1c40f');
        // "ABCD1234" → "ABCD-1234" (mais fácil de digitar)
        el('wapp-code').textContent = d.code.length === 8 ? d.code.slice(0, 4) + '-' + d.code.slice(4) : d.code;
        mostrar('wapp-code-wrap');
      } else if (d.qr) {
        selo('🟡 Aguardando leitura do QR', '241,196,15', '#f1c40f');
        el('wapp-qr-img').src = d.qr;
        mostrar('wapp-qr-wrap');
      } else {
        selo('🟡 Conectando...', '241,196,15', '#f1c40f');
        mostrar('wapp-loading');
      }
      botoes(!!(d.code || d.qr), false, false);
      iniciarPollingWapp(); // continua acompanhando até conectar
      return;
    }

    selo('🔴 Desconectado', '231,76,60', '#e74c3c');
    mostrar('wapp-metodos');
    botoes(false, false, false);
    pararPollingWapp();
  } catch {}
}

/**
 * Inicia o pareamento.
 * @param {'qr'|'codigo'} metodo 'codigo' usa o número digitado no campo
 */
async function conectarWhatsapp(metodo = 'qr') {
  const body = { metodo };
  if (metodo === 'codigo') {
    body.telefone = document.getElementById('wapp-fone').value.replace(/\D/g, '');
    if (body.telefone.length < 10) { showToast('⚠️ Informe o número com DDD', 'err'); return; }
  }

  const r = await apiFetch('/api/whatsapp/connect', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    showToast('❌ ' + (e.erro || 'Erro ao conectar'), 'err');
    return;
  }

  showToast(metodo === 'codigo' ? '🔢 Gerando código...' : '📱 Gerando QR Code...', 'ok');
  pararPollingWapp();
  iniciarPollingWapp();
  await atualizarWapp();
}

/** Desconecta (mantém a sessão salva). Também usado para trocar a forma de conexão. */
async function desconectarWhatsapp() {
  await apiFetch('/api/whatsapp/disconnect', { method: 'POST' });
  showToast('🔴 WhatsApp desconectado', 'ok');
  pararPollingWapp();
  await atualizarWapp();
}

/** Desconecta e apaga a sessão salva, para conectar outro número. */
async function trocarNumeroWhatsapp() {
  if (!confirm('Isso vai desconectar o número atual e apagar a sessão.\nDepois você conecta o novo número (QR Code ou código).\n\nContinuar?')) return;

  const r = await apiFetch('/api/whatsapp/trocar-numero', { method: 'POST' });
  if (r.ok) showToast('🔄 Sessão apagada! Clique em Conectar para o novo número.', 'ok');
  else      showToast('❌ Erro ao trocar número', 'err');

  pararPollingWapp();
  await atualizarWapp();
}
