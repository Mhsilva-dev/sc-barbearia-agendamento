/**
 * routes/barbeiros.js
 *
 * CRUD de barbeiros, com upload de foto.
 *
 * Montado em dois prefixos no server.js (/api/barbeiros e
 * /api/admin/barbeiros); as rotas de escrita exigem login.
 *
 * Rotas públicas:
 *  GET  /api/barbeiros                             → lista barbeiros ativos
 *
 * Rotas admin 🔐:
 *  POST   /api/admin/barbeiros                     → cria barbeiro
 *  PUT    /api/admin/barbeiros/:id                 → atualiza barbeiro
 *  DELETE /api/admin/barbeiros/:id                 → desativa (soft delete)
 *  POST   /api/admin/barbeiros/:id/foto            → upload via multipart
 *  POST   /api/admin/barbeiros/:id/foto-base64     → upload via base64 (usado pelo painel)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('../config/database');
const auth    = require('../middleware/auth');

const UPLOAD_DIR   = path.join(__dirname, '..', 'uploads');
const MAX_FOTO_MB  = 5;

// ─────────────────────────────────────────────────────────────
//  Upload de fotos
// ─────────────────────────────────────────────────────────────

/** Garante que a pasta de uploads exista. */
function garantirPastaUploads() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      garantirPastaUploads();
      cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `barbeiro_${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FOTO_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são permitidas'));
  },
});

/**
 * Apaga do disco a foto atual do barbeiro (se for um arquivo enviado).
 * Falhas são ignoradas: uma foto órfã não deve impedir a troca.
 * @param {{ foto?: string }} barbeiro
 */
function removerFotoAntiga(barbeiro) {
  if (!barbeiro.foto || !barbeiro.foto.startsWith('/uploads/')) return;
  try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(barbeiro.foto))); } catch {}
}

/** @returns {object|undefined} barbeiro pelo id (ativo ou não) */
function buscarBarbeiro(id) {
  return db.prepare('SELECT * FROM barbeiros WHERE id = ?').get(id);
}

// ─────────────────────────────────────────────────────────────
//  Rotas
// ─────────────────────────────────────────────────────────────

// GET /api/barbeiros — lista barbeiros ativos (público)
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM barbeiros WHERE ativo = 1 ORDER BY id').all());
});

// POST /api/admin/barbeiros — cria barbeiro
router.post('/', auth, (req, res) => {
  const { nome, especialidade, emoji } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome é obrigatório' });

  const r = db.prepare('INSERT INTO barbeiros (nome, especialidade, emoji) VALUES (?,?,?)')
    .run(nome, especialidade || '', emoji || '💈');

  res.status(201).json(buscarBarbeiro(r.lastInsertRowid));
});

// PUT /api/admin/barbeiros/:id — atualiza; campos omitidos mantêm o valor atual
router.put('/:id', auth, (req, res) => {
  const atual = buscarBarbeiro(req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Barbeiro não encontrado' });

  const { nome, especialidade, emoji } = req.body;
  db.prepare('UPDATE barbeiros SET nome=?, especialidade=?, emoji=? WHERE id=?').run(
    nome || atual.nome,
    especialidade !== undefined ? especialidade : atual.especialidade,
    emoji || atual.emoji,
    req.params.id,
  );
  res.json(buscarBarbeiro(req.params.id));
});

// DELETE /api/admin/barbeiros/:id — soft delete: some do site, mas o
// histórico de agendamentos continua apontando para ele
router.delete('/:id', auth, (req, res) => {
  if (!buscarBarbeiro(req.params.id)) return res.status(404).json({ erro: 'Barbeiro não encontrado' });

  db.prepare('UPDATE barbeiros SET ativo = 0 WHERE id = ?').run(req.params.id);
  res.json({ sucesso: true });
});

// POST /api/admin/barbeiros/:id/foto — upload de arquivo (multipart, campo "foto")
router.post('/:id/foto', auth, upload.single('foto'), (req, res) => {
  const atual = buscarBarbeiro(req.params.id);
  if (!atual)    return res.status(404).json({ erro: 'Barbeiro não encontrado' });
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma foto enviada' });

  removerFotoAntiga(atual);

  const url = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE barbeiros SET foto = ? WHERE id = ?').run(url, req.params.id);
  res.json({ sucesso: true, url });
});

// POST /api/admin/barbeiros/:id/foto-base64 — upload como data URL
// ("data:image/png;base64,....") — é o formato que o painel envia
router.post('/:id/foto-base64', auth, (req, res) => {
  const { fotoBase64 } = req.body;
  if (!fotoBase64) return res.status(400).json({ erro: 'Foto não fornecida' });

  const partes = fotoBase64.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!partes) return res.status(400).json({ erro: 'Formato de imagem inválido' });

  const atual = buscarBarbeiro(req.params.id);
  if (!atual) return res.status(404).json({ erro: 'Barbeiro não encontrado' });

  removerFotoAntiga(atual);

  const [, ext, base64] = partes;
  const filename = `barbeiro_${req.params.id}_${Date.now()}.${ext}`;
  garantirPastaUploads();
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(base64, 'base64'));

  const url = `/uploads/${filename}`;
  db.prepare('UPDATE barbeiros SET foto = ? WHERE id = ?').run(url, req.params.id);
  res.json({ sucesso: true, url });
});

module.exports = router;
