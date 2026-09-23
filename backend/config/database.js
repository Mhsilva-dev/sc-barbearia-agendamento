/**
 * config/database.js
 *
 * Abre o banco SQLite (backend/data/barbearia.db), cria as tabelas que
 * ainda não existem e insere os dados iniciais na primeira execução.
 *
 * Exporta uma única conexão (better-sqlite3, síncrona) compartilhada
 * por todas as rotas e serviços.
 *
 * ⚠️  O banco roda em modo WAL: para backup use `sqlite3 barbearia.db ".backup ..."`
 *     ou db.backup() — copiar só o .db pode perder dados recentes.
 *
 * Diagrama das tabelas: docs/banco-de-dados.md
 */

'use strict';

const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');
const fs       = require('fs');

const DB_DIR  = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'barbearia.db');

// Garante que a pasta data existe
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// WAL: leituras não bloqueiam escritas; NORMAL é seguro com WAL e mais rápido
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// ─────────────────────────────────────────────────────────────
//  Schema — tabelas (idempotente: só cria o que não existe)
// ─────────────────────────────────────────────────────────────
//  barbeiros / servicos → soft delete via ativo = 0
//  agendamentos         → guarda cópia de nome/preço do barbeiro e serviço;
//                         confirmacao_enviada / lembrete_enviado são flags 0/1
//  configuracoes        → chave/valor em texto (ver routes/config.js)
//  bloqueios            → tipo 'dia' (dia inteiro) ou 'horario';
//                         barbeiro_id NULL = vale para todos
db.exec(`
  CREATE TABLE IF NOT EXISTS barbeiros (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nome          TEXT    NOT NULL,
    especialidade TEXT    DEFAULT '',
    emoji         TEXT    DEFAULT '💈',
    foto          TEXT    DEFAULT '',
    ativo         INTEGER DEFAULT 1,
    criado_em     TEXT    DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS servicos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nome      TEXT    NOT NULL,
    preco     REAL    NOT NULL,
    duracao   INTEGER NOT NULL DEFAULT 30,
    icone     TEXT    DEFAULT '✂',
    ativo     INTEGER DEFAULT 1,
    criado_em TEXT    DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS agendamentos (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_nome          TEXT    NOT NULL,
    cliente_fone          TEXT    NOT NULL,
    observacao            TEXT    DEFAULT '',
    barbeiro_id           INTEGER,
    barbeiro_nome         TEXT,
    servico_id            INTEGER,
    servico_nome          TEXT,
    preco                 REAL,
    data                  TEXT    NOT NULL,
    horario               TEXT    NOT NULL,
    status                TEXT    DEFAULT 'confirmado',
    confirmacao_enviada   INTEGER DEFAULT 0,
    lembrete_enviado      INTEGER DEFAULT 0,
    criado_em             TEXT    DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (barbeiro_id) REFERENCES barbeiros(id),
    FOREIGN KEY (servico_id)  REFERENCES servicos(id)
  );

  CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT
  );

  CREATE TABLE IF NOT EXISTS admins (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT UNIQUE NOT NULL,
    hash TEXT        NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bloqueios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo        TEXT    NOT NULL DEFAULT 'dia',
    data        TEXT    NOT NULL,
    horario     TEXT    DEFAULT NULL,
    barbeiro_id INTEGER DEFAULT NULL,
    motivo      TEXT    DEFAULT '',
    criado_em   TEXT    DEFAULT (datetime('now','localtime'))
  );
`);

// Índices das consultas mais frequentes (calendário, painel e CRON de lembretes)
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_agend_data     ON agendamentos(data);
  CREATE INDEX IF NOT EXISTS idx_agend_barbeiro  ON agendamentos(barbeiro_id);
  CREATE INDEX IF NOT EXISTS idx_agend_status    ON agendamentos(status);
  CREATE INDEX IF NOT EXISTS idx_agend_lembrete  ON agendamentos(lembrete_enviado, status, data);
`);

// ─────────────────────────────────────────────────────────────
//  Seed — dados iniciais
//  Cada bloco só roda se a tabela/chave ainda estiver vazia, então
//  nunca sobrescreve o que o dono já configurou pelo painel.
// ─────────────────────────────────────────────────────────────
const seed = db.transaction(() => {
  // Barbeiros
  const countBarb = db.prepare('SELECT COUNT(*) as c FROM barbeiros').get();
  if (countBarb.c === 0) {
    const ins = db.prepare('INSERT INTO barbeiros (nome, especialidade, emoji) VALUES (?,?,?)');
    ins.run('Carlos',  'Degradê & Risquinho', '💈');
    ins.run('Mateus',  'Corte Clássico',      '✂');
    ins.run('Diego',   'Barba & Navalha',     '🪒');
    console.log('[DB] Barbeiros iniciais criados');
  }

  // Serviços
  const countSvc = db.prepare('SELECT COUNT(*) as c FROM servicos').get();
  if (countSvc.c === 0) {
    const ins = db.prepare('INSERT INTO servicos (nome, preco, duracao, icone) VALUES (?,?,?,?)');
    ins.run('Corte Simples',  35, 30, '✂');
    ins.run('Corte + Barba',  55, 50, '💈');
    ins.run('Barba',          30, 25, '🪒');
    ins.run('Degradê',        45, 40, '🎨');
    ins.run('Pezinho',        20, 15, '✦');
    ins.run('Sobrancelha',    15, 10, '👁');
    console.log('[DB] Serviços iniciais criados');
  }

  // Configurações
  const countCfg = db.prepare('SELECT COUNT(*) as c FROM configuracoes').get();
  if (countCfg.c === 0) {
    const ins = db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?,?)');
    ins.run('barbearia_nome',  process.env.BARBEARIA_NOME  || 'SC Barbearia');
    ins.run('endereco',        'Serra do Salitre, Minas Gerais');
    ins.run('horarios',        'Seg – Sex: 08h às 19h\nSábado: 08h às 17h\nDomingo: Fechado');
    ins.run('whatsapp',        process.env.BARBEARIA_WHATSAPP || '5534999999999');
    ins.run('como_chegar',     'Fácil acesso pelo centro da cidade. Estacionamento disponível na frente.');
    ins.run('maps_embed',      '');
    console.log('[DB] Configurações iniciais criadas');
  }

  // Horários de funcionamento por dia da semana: "0" = domingo … "6" = sábado,
  // null = fechado. Chave criada à parte porque surgiu depois das demais.
  const hfExiste = db.prepare("SELECT chave FROM configuracoes WHERE chave = 'horarios_funcionamento'").get();
  if (!hfExiste) {
    const padrao = {
      "0": null,
      "1": { ini: "08:00", fim: "17:30" },
      "2": { ini: "08:00", fim: "17:30" },
      "3": { ini: "08:00", fim: "17:30" },
      "4": { ini: "08:00", fim: "17:30" },
      "5": { ini: "08:00", fim: "17:30" },
      "6": { ini: "08:00", fim: "13:00" }
    };
    db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?,?)').run('horarios_funcionamento', JSON.stringify(padrao));
    console.log('[DB] Horários de funcionamento iniciais criados');
  }

  // Admin inicial — usuário/senha do .env (troque a senha pelo painel depois)
  const countAdm = db.prepare('SELECT COUNT(*) as c FROM admins').get();
  if (countAdm.c === 0) {
    const user = process.env.ADMIN_USER || 'admin';
    const pass = process.env.ADMIN_PASS || '1234';
    const hash = bcrypt.hashSync(pass, 12);
    db.prepare('INSERT INTO admins (user, hash) VALUES (?,?)').run(user, hash);
    console.log(`[DB] Admin criado → usuário: ${user}`);
  }
});

seed();
console.log(`[DB] SQLite pronto → ${DB_PATH}`);

module.exports = db;
