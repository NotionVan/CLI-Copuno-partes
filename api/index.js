// Wrapper serverless: con el formato `functions` de vercel.json, Vercel solo
// construye funciones bajo /api (zero-config). server.js exporta la app
// Express sin abrir listen() cuando se importa (guard require.main).
module.exports = require('../server.js')
