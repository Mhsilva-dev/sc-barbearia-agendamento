/**
 * routes/whatsapp.js
 *
 * Rotas de controle e monitoramento do WhatsApp.
 *
 * Rotas públicas:
 *  GET /api/whatsapp/validar?fone= → verifica se número existe no WhatsApp
 *
 * Rotas admin 🔐:
 *  GET  /api/whatsapp/status       → estado atual (connected|connecting|disconnected)
 *  GET  /api/whatsapp/qr           → QR Code em base64 ou código de pareamento
 *  POST /api/whatsapp/connect      → inicia conexão { metodo: 'qr'|'codigo', telefone }
 *  POST /api/whatsapp/disconnect   → desconecta manualmente
 *
 * Diagrama do ciclo de vida: docs/fluxo-whatsapp.md
 */

'use strict';

const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const wa      = require('../services/whatsapp');

// GET /api/whatsapp/validar?fone=xxx — verifica se número existe no WhatsApp (público)
router.get('/validar', async (req, res) => {
  const { fone } = req.query;
  if (!fone) return res.status(400).json({ erro: 'Informe o número' });

  if (wa.getStatus() !== 'connected') {
    // WhatsApp desconectado: não bloqueia, deixa passar
    return res.json({ valido: true, aviso: 'WhatsApp offline — número não verificado' });
  }

  try {
    let num = wa.normalizarFone(fone);

    const client = wa._getClient ? wa._getClient() : null;
    if (!client) return res.json({ valido: true });

    let numberId = await client.getNumberId(num);
    if (!numberId) {
      const semCountry = num.slice(2);
      if (semCountry.length === 10) {
        const com9 = '55' + semCountry.slice(0, 2) + '9' + semCountry.slice(2);
        numberId = await client.getNumberId(com9);
      }
    }

    if (!numberId) {
      return res.status(400).json({ erro: 'Número não encontrado no WhatsApp. Verifique e tente novamente.' });
    }
    res.json({ valido: true });
  } catch (e) {
    // Em caso de erro interno, não bloqueia o agendamento
    res.json({ valido: true });
  }
});

// GET /api/whatsapp/status
router.get('/status', auth, (req, res) => {
  res.json({ status: wa.getStatus() });
});

// GET /api/whatsapp/qr
router.get('/qr', auth, (req, res) => {
  res.json({ qr: wa.getQR(), code: wa.getCode(), modo: wa.getMode(), status: wa.getStatus() });
});

// POST /api/whatsapp/connect
router.post('/connect', auth, async (req, res) => {
  const { metodo = 'qr', telefone } = req.body || {};

  if (wa.getStatus() === 'connected') {
    return res.status(400).json({ erro: 'WhatsApp já está conectado.' });
  }

  let pairPhone = null;
  if (metodo === 'codigo') {
    const digitos = String(telefone || '').replace(/\D/g, '');
    if (digitos.length < 10 || digitos.length > 13) {
      return res.status(400).json({ erro: 'Informe o número com DDD (ex.: 34 99999-9999).' });
    }
    pairPhone = digitos;
  }

  try {
    // Troca de método no meio do pareamento: reinicia o cliente
    if (wa.getStatus() === 'connecting') await wa.disconnect();
    wa.initialize({ pairPhone });
    res.json({ ok: true, mensagem: 'Iniciando conexão...' });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// POST /api/whatsapp/disconnect
router.post('/disconnect', auth, async (req, res) => {
  try {
    await wa.disconnect();
    res.json({ ok: true, mensagem: 'Desconectado com sucesso.' });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

// POST /api/whatsapp/trocar-numero — desconecta e apaga a sessão salva
router.post('/trocar-numero', auth, async (req, res) => {
  try {
    await wa.disconnect();
    await wa.limparSessao();
    res.json({ ok: true, mensagem: 'Sessão apagada. Conecte um novo número.' });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
