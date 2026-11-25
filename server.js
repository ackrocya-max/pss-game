const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS_PER_ROOM = 3;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Serve index.html and any static assets (like your bsnu photo)
const server = http.createServer((req, res) => {
  const cleanUrl = (req.url || '/').split('?')[0];
  let filePath = path.join(__dirname, cleanUrl === '/' ? 'index.html' : cleanUrl);

  // Prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html if file not found
      filePath = path.join(__dirname, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Server error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
});

// 3-Player Online Bathroom Room Manager
const wss = new WebSocketServer({ server });
// rooms: Map<roomId, Map<clientId, { ws, player }>>
const rooms = new Map();

function broadcastRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const playersList = Array.from(room.values()).map((entry) => entry.player);
  const payload = JSON.stringify({
    type: 'room_state_3p',
    roomId,
    maxPlayers: MAX_PLAYERS_PER_ROOM,
    players: playersList
  });

  for (const entry of room.values()) {
    if (entry.ws.readyState === 1) {
      entry.ws.send(payload);
    }
  }
}

function removeClientFromRooms(ws) {
  for (const [roomId, room] of rooms.entries()) {
    let changed = false;
    for (const [clientId, entry] of room.entries()) {
      if (entry.ws === ws) {
        room.delete(clientId);
        changed = true;
      }
    }
    if (room.size === 0) {
      rooms.delete(roomId);
    } else if (changed) {
      broadcastRoomState(roomId);
    }
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      return;
    }

    if (msg.type === 'join_3p' && msg.roomId && msg.player && msg.player.id) {
      const roomId = String(msg.roomId).trim().slice(0, 48) || 'bathroom-3p-1';
      removeClientFromRooms(ws);

      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Map());
      }
      const room = rooms.get(roomId);

      if (!room.has(msg.player.id) && room.size >= MAX_PLAYERS_PER_ROOM) {
        ws.send(JSON.stringify({
          type: 'room_full_3p',
          roomId,
          maxPlayers: MAX_PLAYERS_PER_ROOM
        }));
        return;
      }

      room.set(msg.player.id, {
        ws,
        player: { ...msg.player, updatedAt: Date.now() }
      });
      broadcastRoomState(roomId);
    } else if (msg.type === 'update_3p' && msg.roomId && msg.player && msg.player.id) {
      const room = rooms.get(String(msg.roomId).trim());
      if (!room || !room.has(msg.player.id)) return;

      room.set(msg.player.id, {
        ws,
        player: { ...msg.player, updatedAt: Date.now() }
      });
      broadcastRoomState(String(msg.roomId).trim());
    }
  });

  ws.on('close', () => {
    removeClientFromRooms(ws);
  });

  ws.on('error', () => {
    removeClientFromRooms(ws);
  });
});

server.listen(PORT, () => {
  console.log(`Sketchy Aim 3-Player Server listening on port ${PORT}`);
});
