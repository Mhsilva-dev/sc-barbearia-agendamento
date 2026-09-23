/**
 * services/scheduler.js
 *
 * Tarefas automáticas (CRON jobs).
 *
 * Hoje há um único job: enviar pelo WhatsApp o lembrete de cada
 * agendamento cerca de 2h antes do horário marcado.
 *
 * Diagrama: docs/fluxo-agendamento.md → "Fluxo de Lembrete Automático"
 */

'use strict';

const cron = require('node-cron');
const { agoraBRT, fmtData, fmtHora } = require('../utils/datas');

/** Intervalo do job de lembretes, em minutos (precisa dividir 60). */
const JANELA_MIN = 15;

/** Antecedência do lembrete, em minutos. */
const ANTECEDENCIA_MIN = 120;

// ─────────────────────────────────────────────────────────────
//  Job: lembretes de WhatsApp
// ─────────────────────────────────────────────────────────────

/**
 * Envia o lembrete dos agendamentos confirmados que começam na janela
 * (agora + 1h45, agora + 2h], no fuso de Brasília.
 *
 * Como o job roda a cada JANELA_MIN minutos, janelas consecutivas se
 * encaixam sem buracos nem sobreposição: qualquer horário (não só os
 * "redondos") cai em exatamente uma execução. A flag lembrete_enviado
 * evita reenvio caso o mesmo agendamento seja visto de novo.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Function} enviarMensagem services/whatsapp.enviarMensagem
 * @param {Function} msgLembrete    services/whatsapp.msgLembrete
 */
async function jobLembretes(db, enviarMensagem, msgLembrete) {
  const agora  = agoraBRT();
  const inicio = new Date(agora.getTime() + (ANTECEDENCIA_MIN - JANELA_MIN) * 60 * 1000);
  const fim    = new Date(agora.getTime() + ANTECEDENCIA_MIN * 60 * 1000);
  const ini    = fmtData(inicio) + ' ' + fmtHora(inicio);
  const ate    = fmtData(fim)    + ' ' + fmtHora(fim);

  // "YYYY-MM-DD HH:MM" concatenado permite comparar data+hora como texto
  const pendentes = db.prepare(`
    SELECT * FROM agendamentos
    WHERE data || ' ' || horario >  ?
      AND data || ' ' || horario <= ?
      AND status   = 'confirmado'
      AND lembrete_enviado = 0
  `).all(ini, ate);

  if (pendentes.length === 0) return;

  console.log(`[CRON] 🕐 ${pendentes.length} lembrete(s) entre ${ini} e ${ate}`);

  for (const ag of pendentes) {
    try {
      const r = await enviarMensagem(ag.cliente_fone, msgLembrete(ag), `lemb-${ag.id}`);
      if (r.ok) {
        db.prepare('UPDATE agendamentos SET lembrete_enviado = 1 WHERE id = ?').run(ag.id);
        console.log(`[CRON] ✅ Lembrete → ${ag.cliente_nome} (${ag.data} ${ag.horario})`);
      } else {
        // Se o WhatsApp estava offline, o lembrete é recuperado na
        // reconexão (services/whatsapp.reenviarPendentes)
        console.warn(`[CRON] ⚠️  Lembrete não enviado → ${ag.cliente_nome}: ${r.motivo}`);
      }
    } catch (e) {
      console.error(`[CRON] ❌ Erro no lembrete de ${ag.cliente_nome}:`, e.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  Inicialização
// ─────────────────────────────────────────────────────────────

/**
 * Registra todos os CRON jobs da aplicação. Chamado uma vez pelo server.js.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ enviarMensagem: Function, msgLembrete: Function }} waService
 */
function iniciarScheduler(db, waService) {
  const { enviarMensagem, msgLembrete } = waService;

  cron.schedule(`*/${JANELA_MIN} * * * *`, () => {
    jobLembretes(db, enviarMensagem, msgLembrete).catch(e => {
      console.error('[CRON] Falha no job de lembretes:', e.message);
    });
  });

  console.log(`[Scheduler] ✅ CRON jobs registrados (lembretes a cada ${JANELA_MIN} min)`);
}

module.exports = { iniciarScheduler };
