/**
 * routes/servicos.js
 *
 * CRUD de serviços oferecidos pela barbearia.
 *
 * Rotas públicas:
 *  GET  /api/servicos              → lista serviços ativos
 *
 * Rotas admin 🔐:
 *  POST   /api/admin/servicos       → cria serviço
 *  PUT    /api/admin/servicos/:id   → atualiza serviço
 *  DELETE /api/admin/servicos/:id   → desativa (soft delete)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const auth    = require('../middleware/auth');

// GET /api/servicos — Lista serviços ativos (público)
router.get('/', (req, res) => {
  const servicos = db.prepare('SELECT * FROM servicos WHERE ativo = 1 ORDER BY id').all();
  res.json(servicos);
});

// POST /api/admin/servicos — Cria serviço (admin)
router.post('/', auth, (req, res) => {
  const { nome, preco, duracao, icone } = req.body;
  if (!nome || preco == null || !duracao) {
    return res.status(400).json({ erro: 'Nome, preço e duração são obrigatórios' });
  }
  const r = db.prepare(
    'INSERT INTO servicos (nome, preco, duracao, icone) VALUES (?,?,?,?)'
  ).run(nome, parseFloat(preco), parseInt(duracao), icone || '✂');

  res.status(201).json(db.prepare('SELECT * FROM servicos WHERE id = ?').get(r.lastInsertRowid));
});

// PUT /api/admin/servicos/:id — Atualiza serviço (admin)
router.put('/:id', auth, (req, res) => {
  const atual = db.prepare('SELECT * FROM servicos WHERE id = ?').get(req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Serviço não encontrado' });

  const { nome, preco, duracao, icone } = req.body;
  db.prepare('UPDATE servicos SET nome=?, preco=?, duracao=?, icone=? WHERE id=?').run(
    nome    || atual.nome,
    preco   != null ? parseFloat(preco)   : atual.preco,
    duracao != null ? parseInt(duracao)   : atual.duracao,
    icone   || atual.icone,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM servicos WHERE id = ?').get(req.params.id));
});

// DELETE /api/admin/servicos/:id — Desativa serviço (admin)
router.delete('/:id', auth, (req, res) => {
  const atual = db.prepare('SELECT * FROM servicos WHERE id = ?').get(req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Serviço não encontrado' });

  db.prepare('UPDATE servicos SET ativo = 0 WHERE id = ?').run(req.params.id);
  res.json({ sucesso: true });
});

module.exports = router;
