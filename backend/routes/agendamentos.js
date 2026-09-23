/**
 * routes/agendamentos.js
 *
 * Agendamentos: criação pelo site (público) e gestão pelo painel admin.
 *
 * Rotas públicas:
 *  GET  /api/agendamentos/horarios-ocupados?barbeiro_id=&data= → horários indisponíveis
 *  POST /api/agendamentos                                     → cria agendamento
 *
 * Rotas admin 🔐:
 *  GET    /api/agendamentos/admin?data=&status=    → lista com filtros
 *  PATCH  /api/agendamentos/admin/:id              → altera status
 *  DELETE /api/agendamentos/admin/:id              → remove
 *  GET    /api/agendamentos/historico              → histórico agrupado por cliente
 *  GET    /api/agendamentos/stats                  → números do topo do painel
 *  GET    /api/agendamentos/relatorio?inicio=&fim= → relatório por período
 *
 * Fluxo completo: docs/fluxo-agendamento.md
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const auth    = require('../middleware/auth');
const { enviarMensagem, msgConfirmacao } = require('../services/whatsapp');
const {
  agoraBRT, fmtData, fmtHora, dataValida, horarioValido, diaDaSemana,
} = require('../utils/datas');

const STATUS_VALIDOS = ['confirmado', 'concluido', 'cancelado'];

// ─────────────────────────────────────────────────────────────
//  Regras de negócio
// ─────────────────────────────────────────────────────────────

/**
 * Confere se o horário está dentro do expediente do dia, conforme
 * configuracoes.horarios_funcionamento:
 *   { "0".."6": { ini: "HH:MM", fim: "HH:MM" } | null }   (0 = domingo, null = fechado)
 *
 * O atendimento precisa começar em [ini, fim) — mesma regra do
 * gerarSlots() do frontend, para site e servidor concordarem.
 *
 * @param {string} data    "YYYY-MM-DD"
 * @param {string} horario "HH:MM"
 * @returns {boolean}
 */
function horarioDentroDoFuncionamento(data, horario) {
  const row = db.prepare("SELECT valor FROM configuracoes WHERE chave = 'horarios_funcionamento'").get();
  if (!row) return true; // sem configuração: não restringe

  let cfg;
  try { cfg = JSON.parse(row.valor); } catch { return true; }

  const dia = cfg[String(diaDaSemana(data))];
  if (!dia || !dia.ini || !dia.fim) return false;
  return horario >= dia.ini && horario < dia.fim;
}

/**
 * Envia a confirmação pelo WhatsApp em segundo plano, sem atrasar a
 * resposta ao cliente. Se o WhatsApp estiver offline, a flag
 * confirmacao_enviada continua 0 e o serviço reenvia ao reconectar.
 * @param {object} agendamento linha da tabela agendamentos
 */
function enviarConfirmacaoEmSegundoPlano(agendamento) {
  setImmediate(async () => {
    try {
      const r = await enviarMensagem(
        agendamento.cliente_fone,
        msgConfirmacao(agendamento),
        `conf-${agendamento.id}`,
      );
      if (r.ok) {
        db.prepare('UPDATE agendamentos SET confirmacao_enviada = 1 WHERE id = ?').run(agendamento.id);
      }
    } catch (e) {
      console.error('[Agendamento] Erro ao enviar confirmação:', e.message);
    }
  });
}

/**
 * Soma quantidade e receita agrupando por uma coluna (ex.: servico_nome).
 * @param {object[]} lista agendamentos
 * @param {string}   campo coluna usada para agrupar
 * @returns {{ nome: string, count: number, receita: number }[]} do mais para o menos frequente
 */
function agruparPor(lista, campo) {
  const mapa = {};
  for (const a of lista) {
    const chave = a[campo];
    mapa[chave] = mapa[chave] || { nome: chave, count: 0, receita: 0 };
    mapa[chave].count++;
    mapa[chave].receita += parseFloat(a.preco || 0);
  }
  return Object.values(mapa).sort((a, b) => b.count - a.count);
}

// ─────────────────────────────────────────────────────────────
//  Rotas públicas
// ─────────────────────────────────────────────────────────────

// GET /api/agendamentos/horarios-ocupados
// Horários reservados + bloqueados de um barbeiro em um dia. Cada item traz
// o tipo ('agendamento' | 'bloqueio') e o serviço, para o calendário do site.
router.get('/horarios-ocupados', (req, res) => {
  const { barbeiro_id, data } = req.query;
  if (!barbeiro_id || !data) return res.json([]);

  const agendados = db.prepare(`
    SELECT horario, servico_nome AS servico
    FROM agendamentos
    WHERE barbeiro_id = ? AND data = ? AND status != 'cancelado'
  `).all(barbeiro_id, data).map(r => ({
    horario: r.horario,
    tipo:    'agendamento',
    servico: r.servico,
  }));

  const bloqueados = db.prepare(`
    SELECT horario FROM bloqueios
    WHERE tipo = 'horario'
      AND data = ?
      AND (barbeiro_id = ? OR barbeiro_id IS NULL)
      AND horario IS NOT NULL
  `).all(data, barbeiro_id).map(r => ({
    horario: r.horario,
    tipo:    'bloqueio',
    servico: null,
  }));

  // Mescla sem duplicatas — agendamento sobrescreve bloqueio no mesmo horário
  const mapa = new Map();
  [...bloqueados, ...agendados].forEach(s => mapa.set(s.horario, s));

  res.json([...mapa.values()]);
});

// POST /api/agendamentos — cria o agendamento feito pelo cliente no site
router.post('/', (req, res) => {
  const { cliente_nome, cliente_fone, observacao, barbeiro_id, servico_id, data, horario } = req.body;

  // 1. Campos obrigatórios e formatos
  if (!cliente_nome || !cliente_fone || !barbeiro_id || !servico_id || !data || !horario) {
    return res.status(400).json({ erro: 'Preencha todos os campos obrigatórios' });
  }
  const fone = String(cliente_fone).replace(/\D/g, '');
  if (!/^\d{10,11}$/.test(fone)) {
    return res.status(400).json({ erro: 'Número de WhatsApp inválido' });
  }
  if (!dataValida(data) || !horarioValido(horario)) {
    return res.status(400).json({ erro: 'Data ou horário inválido' });
  }

  // 2. Não aceita horários que já passaram (fuso de Brasília)
  const agora = agoraBRT();
  const hoje  = fmtData(agora);
  if (data < hoje || (data === hoje && horario <= fmtHora(agora))) {
    return res.status(400).json({ erro: 'Não é possível agendar para horários que já passaram' });
  }

  // 3. Precisa estar dentro do expediente do dia
  if (!horarioDentroDoFuncionamento(data, horario)) {
    return res.status(400).json({ erro: 'A barbearia não atende neste dia/horário' });
  }

  // 4. Bloqueio de dia inteiro ou do horário específico
  const bloqueio = db.prepare(`
    SELECT id FROM bloqueios
    WHERE data = ?
      AND (barbeiro_id IS NULL OR barbeiro_id = ?)
      AND (tipo = 'dia' OR (tipo = 'horario' AND horario = ?))
  `).get(data, barbeiro_id, horario);
  if (bloqueio) return res.status(409).json({ erro: 'Este horário está bloqueado' });

  // 5. Conflito com outro agendamento do mesmo barbeiro
  const conflito = db.prepare(`
    SELECT id FROM agendamentos
    WHERE barbeiro_id = ? AND data = ? AND horario = ? AND status != 'cancelado'
  `).get(barbeiro_id, data, horario);
  if (conflito) return res.status(409).json({ erro: 'Este horário já está ocupado' });

  // 6. Barbeiro e serviço precisam existir e estar ativos
  const barbeiro = db.prepare('SELECT nome FROM barbeiros WHERE id = ? AND ativo = 1').get(barbeiro_id);
  const servico  = db.prepare('SELECT nome, preco FROM servicos WHERE id = ? AND ativo = 1').get(servico_id);
  if (!barbeiro) return res.status(404).json({ erro: 'Barbeiro não encontrado' });
  if (!servico)  return res.status(404).json({ erro: 'Serviço não encontrado' });

  // Nome e preço são copiados para o agendamento: o histórico não muda
  // se o barbeiro ou o serviço forem editados depois
  const result = db.prepare(`
    INSERT INTO agendamentos
      (cliente_nome, cliente_fone, observacao, barbeiro_id, barbeiro_nome,
       servico_id, servico_nome, preco, data, horario)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    cliente_nome,
    fone,
    observacao || '',
    barbeiro_id, barbeiro.nome,
    servico_id,  servico.nome, servico.preco,
    data, horario,
  );

  const agendamento = db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(result.lastInsertRowid);
  enviarConfirmacaoEmSegundoPlano(agendamento);

  res.status(201).json({ sucesso: true, agendamento });
});

// ─────────────────────────────────────────────────────────────
//  Rotas admin 🔐
// ─────────────────────────────────────────────────────────────

// GET /api/agendamentos/admin — lista com filtros opcionais de data e status
router.get('/admin', auth, (req, res) => {
  const { data, status } = req.query;
  let sql      = 'SELECT * FROM agendamentos WHERE 1=1';
  const params = [];
  if (data)   { sql += ' AND data = ?';   params.push(data); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY data DESC, horario ASC';
  res.json(db.prepare(sql).all(...params));
});

// PATCH /api/agendamentos/admin/:id — altera o status
router.patch('/admin/:id', auth, (req, res) => {
  const { status } = req.body;
  if (!STATUS_VALIDOS.includes(status)) {
    return res.status(400).json({ erro: 'Status inválido' });
  }
  const atual = db.prepare('SELECT id FROM agendamentos WHERE id = ?').get(req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Agendamento não encontrado' });

  db.prepare('UPDATE agendamentos SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ sucesso: true });
});

// DELETE /api/agendamentos/admin/:id — remove definitivamente
router.delete('/admin/:id', auth, (req, res) => {
  const atual = db.prepare('SELECT id FROM agendamentos WHERE id = ?').get(req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Agendamento não encontrado' });

  db.prepare('DELETE FROM agendamentos WHERE id = ?').run(req.params.id);
  res.json({ sucesso: true });
});

// GET /api/agendamentos/historico — um registro por cliente (telefone)
router.get('/historico', auth, (req, res) => {
  const hist = db.prepare(`
    SELECT
      cliente_nome,
      cliente_fone,
      COUNT(*)          AS visitas,
      MAX(servico_nome) AS ultimo_servico,
      MAX(data)         AS ultima_visita,
      SUM(CASE WHEN status != 'cancelado' THEN preco ELSE 0 END) AS total_gasto
    FROM agendamentos
    GROUP BY cliente_fone
    ORDER BY visitas DESC
  `).all();
  res.json(hist);
});

// GET /api/agendamentos/stats — contadores do topo do painel
router.get('/stats', auth, (req, res) => {
  const hoje = fmtData(agoraBRT());
  const mes  = hoje.slice(0, 7); // "YYYY-MM"

  res.json({
    hoje:     db.prepare('SELECT COUNT(*) AS c FROM agendamentos WHERE data = ?').get(hoje).c,
    mes:      db.prepare('SELECT COUNT(*) AS c FROM agendamentos WHERE data LIKE ?').get(mes + '%').c,
    clientes: db.prepare('SELECT COUNT(DISTINCT cliente_fone) AS c FROM agendamentos').get().c,
    receita:  db.prepare("SELECT COALESCE(SUM(preco),0) AS t FROM agendamentos WHERE status != 'cancelado'").get().t,
  });
});

// GET /api/agendamentos/relatorio — métricas e lista do período [inicio, fim]
router.get('/relatorio', auth, (req, res) => {
  const { inicio, fim } = req.query;
  if (!inicio || !fim) return res.status(400).json({ erro: 'Informe inicio e fim' });

  const lista = db.prepare(`
    SELECT * FROM agendamentos
    WHERE data >= ? AND data <= ?
    ORDER BY data ASC, horario ASC
  `).all(inicio, fim);

  // "Confirmados" no relatório = tudo que não foi cancelado (inclui concluídos)
  const validos = lista.filter(a => a.status !== 'cancelado');
  const receita = validos.reduce((s, a) => s + parseFloat(a.preco || 0), 0);

  res.json({
    periodo:         { inicio, fim },
    total:           lista.length,
    confirmados:     validos.length,
    cancelados:      lista.length - validos.length,
    receita,
    ticket_medio:    validos.length ? receita / validos.length : 0,
    clientes_unicos: new Set(validos.map(a => a.cliente_fone)).size,
    top_servicos:    agruparPor(validos, 'servico_nome'),
    top_barbeiros:   agruparPor(validos, 'barbeiro_nome'),
    agendamentos:    lista,
  });
});

module.exports = router;
