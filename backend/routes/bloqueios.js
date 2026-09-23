/**
 * routes/bloqueios.js
 *
 * Gerenciamento de dias e horários bloqueados no calendário.
 * Bloqueios impedem novos agendamentos em datas/horários específicos.
 *
 * Rotas públicas (usadas pelo calendário do cliente):
 *  GET /api/bloqueios/dias?barbeiro_id=     → datas completamente bloqueadas
 *  GET /api/bloqueios/horarios?barbeiro_id=&data= → horários bloqueados
 *
 * Rotas admin 🔐:
 *  GET    /api/bloqueios          → lista todos
 *  POST   /api/bloqueios          → cria bloqueio (tipo: "dia" | "horario")
 *  DELETE /api/bloqueios/:id      → remove bloqueio
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const auth    = require('../middleware/auth');

// GET /api/bloqueios — lista todos
router.get('/', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, bar.nome as barbeiro_nome
    FROM bloqueios b
    LEFT JOIN barbeiros bar ON bar.id = b.barbeiro_id
    ORDER BY b.data ASC, b.horario ASC
  `).all();
  res.json(rows);
});

// GET /api/bloqueios/dias — dias completamente bloqueados (para o calendário público)
router.get('/dias', (req, res) => {
  const { barbeiro_id } = req.query;
  let rows;
  if (barbeiro_id) {
    rows = db.prepare(`
      SELECT DISTINCT data FROM bloqueios
      WHERE tipo = 'dia' AND (barbeiro_id IS NULL OR barbeiro_id = ?)
    `).all(barbeiro_id);
  } else {
    rows = db.prepare(`
      SELECT DISTINCT data FROM bloqueios WHERE tipo = 'dia' AND barbeiro_id IS NULL
    `).all();
  }
  res.json(rows.map(r => r.data));
});

// GET /api/bloqueios/horarios — horários bloqueados por barbeiro/data (para o público)
router.get('/horarios', (req, res) => {
  const { barbeiro_id, data } = req.query;
  if (!barbeiro_id || !data) return res.json([]);
  const rows = db.prepare(`
    SELECT horario FROM bloqueios
    WHERE tipo = 'horario' AND data = ? AND (barbeiro_id = ? OR barbeiro_id IS NULL)
  `).all(data, barbeiro_id);
  res.json(rows.map(r => r.horario));
});

// POST /api/bloqueios — cria bloqueio
router.post('/', auth, (req, res) => {
  const { tipo, data, horario, barbeiro_id, motivo } = req.body;
  if (!tipo || !data) return res.status(400).json({ erro: 'Tipo e data são obrigatórios' });
  if (tipo === 'horario' && !horario) return res.status(400).json({ erro: 'Horário é obrigatório para bloqueio de horário' });

  db.prepare(`
    INSERT INTO bloqueios (tipo, data, horario, barbeiro_id, motivo)
    VALUES (?, ?, ?, ?, ?)
  `).run(tipo, data, horario || null, barbeiro_id || null, motivo || '');

  res.json({ sucesso: true });
});

// DELETE /api/bloqueios/:id — remove bloqueio
router.delete('/:id', auth, (req, res) => {
  db.prepare('DELETE FROM bloqueios WHERE id = ?').run(req.params.id);
  res.json({ sucesso: true });
});

module.exports = router;
