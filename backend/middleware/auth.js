/**
 * middleware/auth.js
 *
 * Middleware de autenticação JWT.
 * Usado em todas as rotas do painel admin (🔐).
 *
 * Fluxo:
 *  1. Extrai token do header "Authorization: Bearer <token>"
 *  2. Verifica assinatura e expiração via jwt.verify
 *  3. Injeta req.admin = { id, user } para uso nas rotas
 *
 * Retorna 401 em caso de token ausente, expirado ou inválido.
 */

'use strict';

const jwt = require('jsonwebtoken');

/**
 * @param {import('express').Request}      req
 * @param {import('express').Response}     res
 * @param {import('express').NextFunction} next
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token de acesso não fornecido' });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
    }
    return res.status(401).json({ erro: 'Token inválido' });
  }
}

module.exports = authMiddleware;
