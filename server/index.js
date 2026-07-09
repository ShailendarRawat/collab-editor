const http = require("http");
const WebSocket = require("ws");

const rooms = new Map();

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Collab Editor Server running!");
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {
  const roomName = req.url?.slice(1) || "default";

  if (!rooms.has(roomName)) {
    rooms.set(roomName, {
      clients: new Map(),
      updates: [],
    });
  }

  const room = rooms.get(roomName);
  const clientId = Math.random().toString(36).slice(2);
  
  // Register client with NO user info yet
  room.clients.set(clientId, { ws, user: null });
  console.log(`Client joined — total: ${room.clients.size}`);

  // Send existing Yjs updates
  room.updates.forEach((update) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "yjs-update", data: Array.from(update) }));
    }
  });

  // Send ONLY currently connected users as presence list
  const presentUsers = [];
  room.clients.forEach((client, id) => {
    if (id !== clientId && client.user !== null) {
      presentUsers.push({ id, ...client.user });
    }
  });
  ws.send(JSON.stringify({ type: "presence-list", users: presentUsers }));

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === "yjs-update") {
        const update = new Uint8Array(msg.data);
        room.updates.push(update);
        room.clients.forEach((client, id) => {
          if (id !== clientId && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({
              type: "yjs-update",
              data: Array.from(update),
            }));
          }
        });

      } else if (msg.type === "presence-join") {
        // Only process if this client has no user yet
        if (room.clients.get(clientId).user === null) {
          room.clients.get(clientId).user = msg.user;
          room.clients.forEach((client, id) => {
            if (id !== clientId && client.ws.readyState === WebSocket.OPEN) {
              client.ws.send(JSON.stringify({
                type: "presence-join",
                id: clientId,
                user: msg.user,
              }));
            }
          });
        }
      }

    } catch (err) {
      console.error("Error:", err.message);
    }
  });

  ws.on("close", () => {
    // Broadcast departure to everyone
    room.clients.forEach((client, id) => {
      if (id !== clientId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({
          type: "presence-leave",
          id: clientId,
        }));
      }
    });
    room.clients.delete(clientId);
    console.log(`Client left — remaining: ${room.clients.size}`);
  });
});

server.listen(1234, () => {
  console.log("WebSocket server running on port 1234");
});