/**
 * routes/auth.js
 *
 * Autenticação do painel admin.
 *
 * Rotas:
 *  POST /api/auth/login      → retorna token JWT (24h)
 *  PUT  /api/auth/senha  🔐  → troca senha do admin
 *  PUT  /api/auth/usuario 🔐 → troca nome de usuário do admin
 *
 * Referência completa: docs/api-referencia.md → "Autenticação"
 */

'use strict';

const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../config/database');
const auth    = require('../middleware/auth');

// ── Proteção contra força bruta no login ──────────────────────
// Máximo de MAX_FALHAS tentativas erradas por IP a cada JANELA_MS.
const MAX_FALHAS = 5;
const JANELA_MS  = 15 * 60 * 1000;
const falhas     = new Map(); // ip → { count, desde }

function bloqueadoAte(ip) {
  const f = falhas.get(ip);
  if (!f) return 0;
  if (Date.now() - f.desde > JANELA_MS) { falhas.delete(ip); return 0; }
  return f.count >= MAX_FALHAS ? f.desde + JANELA_MS : 0;
}

function registrarFalha(ip) {
  const f = falhas.get(ip);
  if (!f || Date.now() - f.desde > JANELA_MS) falhas.set(ip, { count: 1, desde: Date.now() });
  else f.count++;
}

// Limpa entradas expiradas para o Map não crescer indefinidamente
setInterval(() => {
  const agora = Date.now();
  for (const [ip, f] of falhas) if (agora - f.desde > JANELA_MS) falhas.delete(ip);
}, JANELA_MS).unref();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { user, pass } = req.body;

  if (!user || !pass) {
    return res.status(400).json({ erro: 'Usuário e senha são obrigatórios' });
  }

  const ate = bloqueadoAte(req.ip);
  if (ate) {
    const min = Math.ceil((ate - Date.now()) / 60000);
    return res.status(429).json({ erro: `Muitas tentativas. Tente novamente em ${min} min.` });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE user = ?').get(user);
  if (!admin || !bcrypt.compareSync(pass, admin.hash)) {
    registrarFalha(req.ip);
    return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
  }

  falhas.delete(req.ip);

  const token = jwt.sign(
    { id: admin.id, user: admin.user },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ token, user: admin.user, expira: '24h' });
});

// PUT /api/auth/senha — Troca senha admin
router.put('/senha', auth, (req, res) => {
  const { senhaAtual, novaSenha } = req.body;

  if (!senhaAtual || !novaSenha) {
    return res.status(400).json({ erro: 'Preencha a senha atual e a nova senha' });
  }
  if (novaSenha.length < 6) {
    return res.status(400).json({ erro: 'A nova senha deve ter pelo menos 6 caracteres' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!bcrypt.compareSync(senhaAtual, admin.hash)) {
    return res.status(401).json({ erro: 'Senha atual incorreta' });
  }

  const novoHash = bcrypt.hashSync(novaSenha, 12);
  db.prepare('UPDATE admins SET hash = ? WHERE id = ?').run(novoHash, req.admin.id);
  res.json({ sucesso: true, mensagem: 'Senha alterada com sucesso' });
});

// PUT /api/auth/usuario — Troca usuário admin
router.put('/usuario', auth, (req, res) => {
  const { novoUsuario, senhaAtual } = req.body;

  if (!novoUsuario || !senhaAtual) {
    return res.status(400).json({ erro: 'Preencha o novo usuário e a senha atual' });
  }
  if (novoUsuario.length < 3) {
    return res.status(400).json({ erro: 'O usuário deve ter pelo menos 3 caracteres' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!bcrypt.compareSync(senhaAtual, admin.hash)) {
    return res.status(401).json({ erro: 'Senha atual incorreta' });
  }

  const existe = db.prepare('SELECT id FROM admins WHERE user = ? AND id != ?').get(novoUsuario, req.admin.id);
  if (existe) {
    return res.status(400).json({ erro: 'Este usuário já está em uso' });
  }

  db.prepare('UPDATE admins SET user = ? WHERE id = ?').run(novoUsuario, req.admin.id);
  res.json({ sucesso: true, mensagem: 'Usuário alterado com sucesso' });
});

module.exports = router;
