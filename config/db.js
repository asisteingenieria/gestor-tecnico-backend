const mysql = require('mysql2');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+00:00'
});

// Forzar UTC en cada conexión para que NOW() y CURRENT_TIMESTAMP devuelvan UTC
pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
});

module.exports = pool.promise();