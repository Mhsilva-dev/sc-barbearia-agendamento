/**
 * routes/config.js
 *
 * Configurações da barbearia (nome, endereço, horários, WhatsApp, mapa...).
 * Ficam na tabela `configuracoes` no formato chave → valor (texto).
 *
 * Rotas:
 *  GET /api/config          → leitura pública (exibida no site)
 *  GET /api/config/admin 🔐 → leitura pelo painel
 *  PUT /api/config/admin 🔐 → atualiza várias chaves de uma vez
 *
 * Lista de chaves: docs/banco-de-dados.md → "Configurações"
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const auth    = require('../middleware/auth');

/**
 * Lê todas as configurações como um objeto { chave: valor }.
 * @returns {Record<string, string>}
 */
function lerConfiguracoes() {
  const config = {};
  for (const r of db.prepare('SELECT chave, valor FROM configuracoes').all()) {
    config[r.chave] = r.valor;
  }
  return config;
}

// GET /api/config — configurações públicas (site)
router.get('/', (req, res) => {
  res.json(lerConfiguracoes());
});

// GET /api/config/admin — configurações (painel)
router.get('/admin', auth, (req, res) => {
  res.json(lerConfiguracoes());
});

// PUT /api/config/admin — grava as chaves enviadas no corpo.
// Só aceita texto e número; objetos (ex.: horarios_funcionamento) devem
// chegar já serializados em JSON pelo frontend.
router.put('/admin', auth, (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES (?,?)');

  const gravarTudo = db.transaction((dados) => {
    for (const [chave, valor] of Object.entries(dados)) {
      if (typeof valor === 'string' || typeof valor === 'number') {
        upsert.run(chave, String(valor));
      }
    }
  });

  gravarTudo(req.body);
  res.json({ sucesso: true });
});

module.exports = router;
