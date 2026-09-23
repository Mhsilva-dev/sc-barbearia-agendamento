/**
 * server.js — Entry point da aplicação SC Barbearia
 *
 * Responsabilidades:
 *  1. Configura e inicia o servidor Express
 *  2. Registra middlewares globais (CORS, JSON, arquivos estáticos)
 *  3. Monta as rotas da API em seus prefixos
 *  4. Inicia o serviço WhatsApp (restaura sessão salva)
 *  5. Inicia o Scheduler (CRON jobs)
 *
 * Diagrama de arquitetura: docs/arquitetura.md
 */

'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

// ── Banco de dados ────────────────────────────────────────────
const db = require('./config/database');

// ── Serviços ──────────────────────────────────────────────────
const waService           = require('./services/whatsapp');
const { iniciarScheduler } = require('./services/scheduler');

// ── Rotas ─────────────────────────────────────────────────────
const authRoutes         = require('./routes/auth');
const barbeirosRoutes    = require('./routes/barbeiros');
const servicosRoutes     = require('./routes/servicos');
const agendamentosRoutes = require('./routes/agendamentos');
const configRoutes       = require('./routes/config');
const bloqueiosRoutes    = require('./routes/bloqueios');
const whatsappRoutes     = require('./routes/whatsapp');

// ─────────────────────────────────────────────────────────────
//  Configuração do Express
// ─────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// Atrás do nginx: req.ip passa a ser o IP real do cliente (X-Forwarded-For)
app.set('trust proxy', 1);

// ── Middlewares globais ───────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Arquivos estáticos ────────────────────────────────────────
// Fotos dos barbeiros servidas diretamente
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Frontend SPA
app.use(express.static(path.join(__dirname, '..', 'frontend', 'public')));

// ─────────────────────────────────────────────────────────────
//  Rotas da API
//  Cada router define quais rotas são públicas e quais exigem login.
//  Barbeiros e serviços são montados em dois prefixos: o público
//  (/api/...) e o do painel (/api/admin/...).
//  Referência completa: docs/api-referencia.md
// ─────────────────────────────────────────────────────────────
app.use('/api/auth',                authRoutes);
app.use('/api/barbeiros',           barbeirosRoutes);
app.use('/api/admin/barbeiros',     barbeirosRoutes);
app.use('/api/servicos',            servicosRoutes);
app.use('/api/admin/servicos',      servicosRoutes);
app.use('/api/agendamentos',        agendamentosRoutes);
app.use('/api/config',              configRoutes);
app.use('/api/bloqueios',           bloqueiosRoutes);
app.use('/api/whatsapp',            whatsappRoutes);

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app:    'SC Barbearia',
    versao: '1.0.0',
    uptime: process.uptime().toFixed(0) + 's',
    env:    process.env.NODE_ENV || 'development',
  });
});

// ── SPA fallback ──────────────────────────────────────────────
// Qualquer rota não mapeada retorna o index.html (client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'index.html'));
});

// ─────────────────────────────────────────────────────────────
//  Encerramento limpo
//  No deploy/restart o pm2 envia SIGINT. Antes de sair, fecha o
//  Chromium do WhatsApp com calma para a sessão não se corromper
//  (o pm2 está configurado com kill_timeout de 10s; aqui o limite é 8s).
// ─────────────────────────────────────────────────────────────
let encerrando = false;

async function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  console.log(`[Server] ${sinal} recebido — encerrando WhatsApp...`);
  const limite = setTimeout(() => process.exit(0), 8000);
  try { await waService.shutdown(); } catch {}
  clearTimeout(limite);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────
//  Inicialização
// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n');
  console.log('  ✂  SC Barbearia — Backend Iniciado');
  console.log('  ─────────────────────────────────────');
  console.log(`  🌐  Site:   http://localhost:${PORT}`);
  console.log(`  🔌  API:    http://localhost:${PORT}/api`);
  console.log(`  ❤️   Health: http://localhost:${PORT}/api/health`);
  console.log('  ─────────────────────────────────────');
  console.log(`  Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log('\n');

  // O serviço WhatsApp usa o banco para reenviar pendentes ao reconectar
  waService.setDb(db);

  // Restaura a sessão WhatsApp salva em disco (ou fica aguardando QR/código)
  waService.initialize().catch(() => {});

  process.on('SIGINT',  () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));

  // CRON jobs (lembretes automáticos)
  iniciarScheduler(db, waService);
});

module.exports = app;
