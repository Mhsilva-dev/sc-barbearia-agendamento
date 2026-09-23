/**
 * utils/datas.js
 *
 * Helpers de data e hora usados pelo backend.
 *
 * O servidor pode rodar em qualquer fuso, mas a barbearia funciona no
 * horário de Brasília. Por isso toda comparação com "agora" passa por
 * agoraBRT(), e as datas trafegam sempre como texto:
 *   - data    → "YYYY-MM-DD"
 *   - horário → "HH:MM"
 * Nesse formato, comparar strings equivale a comparar datas/horários.
 */

'use strict';

const FUSO = 'America/Sao_Paulo';

/**
 * Data/hora atual no fuso de Brasília.
 * Os campos locais do objeto (getHours, getDate...) refletem o horário BRT.
 * @returns {Date}
 */
function agoraBRT() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: FUSO }));
}

/**
 * Formata uma Date como "YYYY-MM-DD" (usando os campos locais).
 * @param {Date} d
 * @returns {string}
 */
function fmtData(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/**
 * Formata uma Date como "HH:MM" (usando os campos locais).
 * @param {Date} d
 * @returns {string}
 */
function fmtHora(d) {
  return String(d.getHours()).padStart(2, '0') + ':' +
    String(d.getMinutes()).padStart(2, '0');
}

/**
 * Converte "YYYY-MM-DD" para "DD/MM/YYYY" (exibição).
 * @param {string} data
 * @returns {string}
 */
function dataBR(data) {
  return data.split('-').reverse().join('/');
}

/**
 * Valida se o texto está no formato "YYYY-MM-DD" e é uma data real
 * do calendário (rejeita, por exemplo, 2026-02-30).
 * @param {string} data
 * @returns {boolean}
 */
function dataValida(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return false;
  const [a, m, d] = data.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Valida horário no formato "HH:MM" (00:00 a 23:59).
 * @param {string} horario
 * @returns {boolean}
 */
function horarioValido(horario) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(horario);
}

/**
 * Dia da semana de uma data "YYYY-MM-DD" (0 = domingo … 6 = sábado).
 * Calculado em UTC para não depender do fuso do servidor.
 * @param {string} data
 * @returns {number}
 */
function diaDaSemana(data) {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

module.exports = {
  agoraBRT, fmtData, fmtHora, dataBR,
  dataValida, horarioValido, diaDaSemana,
};
