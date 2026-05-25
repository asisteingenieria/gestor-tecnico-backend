const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

// Cargar variables de entorno
dotenv.config();

const app = express();
const server = http.createServer(app);

// Configurar CORS dinámicamente según el ambiente
const corsOrigins = process.env.NODE_ENV === 'production'
    ? [process.env.FRONTEND_URL, 'http://31.97.138.23:5173', 'http://31.97.138.23:5174']
    : [process.env.FRONTEND_URL, 'http://localhost:5173', 'http://localhost:5174'];

// Configurar Socket.IO
const io = new Server(server, {
    cors: {
        origin: corsOrigins,
        credentials: true
    }
});

// Middleware para hacer io accesible en las rutas
app.use((req, res, next) => {
    req.io = io;
    next();
});

// Middlewares
app.use(cors({
    origin: corsOrigins,
    credentials: true
})); // Permite peticiones desde el frontend
app.use(express.json()); // Para parsear el body de las peticiones como JSON

// Servir archivos estáticos (archivos adjuntos)
app.use('/api/files', express.static(path.join(__dirname, 'uploads')));

// Rutas de la API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/users', require('./routes/users'));
app.use('/api/workstations', require('./routes/workstations'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/activos', require('./routes/activos'));
app.use('/api/activos-tecnico', require('./routes/activosTecnico'));
app.use('/api/inventario-directivo', require('./routes/inventarioDirectivo'));
app.use('/api/auto-activos', require('./routes/autoActivos'));
app.use('/api/script-parser', require('./routes/scriptParser'));
app.use('/api/agentes', require('./routes/agentes'));
app.use('/api/disenos', require('./routes/disenos'));

app.get('/', (req, res) => {
  res.send('API del Call Center Support está funcionando!');
});

// Configuración de Socket.IO
const authenticatedUsers = new Map(); // userId -> socketId

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    // Manejar autenticación
    socket.on('authenticate', (userId) => {
        console.log(`Usuario ${userId} autenticado con socket ${socket.id}`);
        authenticatedUsers.set(userId.toString(), socket.id);
        socket.userId = userId;
    });

    // Manejar desconexión
    socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.id);
        if (socket.userId) {
            authenticatedUsers.delete(socket.userId.toString());
        }
    });
});

// Función helper para enviar mensajes a un usuario específico
global.sendMessageToUser = (userId, event, data) => {
    const socketId = authenticatedUsers.get(userId.toString());
    if (socketId) {
        io.to(socketId).emit(event, data);
        return true;
    }
    return false;
};

const PORT = process.env.PORT || 5001;

server.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));
