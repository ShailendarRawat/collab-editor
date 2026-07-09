import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import "./App.css";

const COLORS = ["#e74c3c","#3498db","#2ecc71","#f39c12","#9b59b6","#1abc9c"];
const NAMES = ["Alice","Bob","Charlie","Diana","Eve","Frank","Grace","Henry"];
const MY_NAME = NAMES[Math.floor(Math.random() * NAMES.length)] + 
  " " + Math.floor(Math.random() * 100);
const MY_COLOR = COLORS[Math.floor(Math.random() * COLORS.length)];

function App() {
  const [text, setText] = useState("");
  const [connected, setConnected] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState(0);
  const [usersMap, setUsersMap] = useState(new Map());

  const ydocRef = useRef(null);
  const wsRef = useRef(null);
  const pendingUpdates = useRef([]);
  const isConnecting = useRef(false); // ← prevents double connections

  const addUser = (id, user) => {
    setUsersMap((prev) => {
      const next = new Map(prev);
      next.set(id, user);
      return next;
    });
  };

  const removeUser = (id) => {
    setUsersMap((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const setAllUsers = (users) => {
    const next = new Map();
    users.forEach((u) => next.set(u.id, u));
    setUsersMap(next);
  };

  useEffect(() => {
    // Create Yjs doc once
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("editor");
    ydocRef.current = { ydoc, ytext };

    // When local doc changes send to server
    ydoc.on("update", (update) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "yjs-update",
          data: Array.from(update),
        }));
      } else {
        pendingUpdates.current.push(update);
        setOfflineQueue(pendingUpdates.current.length);
      }
    });

    const observer = () => setText(ytext.toString());
    ytext.observe(observer);

    // Connect once
    connectWS();

    return () => {
      ytext.unobserve(observer);
      isConnecting.current = false;
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on unmount
        wsRef.current.close();
      }
      ydoc.destroy();
    };
  }, []);

  function connectWS() {
    // Guard: don't connect if already connecting or connected
    if (isConnecting.current) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    isConnecting.current = true;
    console.log("Connecting... my name:", MY_NAME);

    const ws = new WebSocket("ws://localhost:1234/my-doc");
    wsRef.current = ws;

    ws.onopen = () => {
      isConnecting.current = false;
      setConnected(true);
      console.log("Connected!");

      // Announce presence
      ws.send(JSON.stringify({
        type: "presence-join",
        user: { name: MY_NAME, color: MY_COLOR },
      }));

      // Flush offline queue
      if (pendingUpdates.current.length > 0) {
        pendingUpdates.current.forEach((update) => {
          ws.send(JSON.stringify({
            type: "yjs-update",
            data: Array.from(update),
          }));
        });
        pendingUpdates.current = [];
        setOfflineQueue(0);
      }
    };

    ws.onclose = () => {
      isConnecting.current = false;
      setConnected(false);
      setAllUsers([]);
      console.log("Disconnected. Reconnecting in 3s...");
      setTimeout(connectWS, 3000);
    };

    ws.onerror = () => {
      isConnecting.current = false;
      ws.close();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "yjs-update") {
          try {
            Y.applyUpdate(
              ydocRef.current.ydoc,
              new Uint8Array(msg.data)
            );
          } catch (err) {
            console.error("Yjs error:", err);
          }

        } else if (msg.type === "presence-list") {
          setAllUsers(msg.users);

        } else if (msg.type === "presence-join") {
          addUser(msg.id, msg.user);

        } else if (msg.type === "presence-leave") {
          removeUser(msg.id);
        }

      } catch (err) {
        console.error("Message error:", err);
      }
    };
  }

  const handleChange = (e) => {
    const { ydoc, ytext } = ydocRef.current;
    const newText = e.target.value;
    ydoc.transact(() => {
      ytext.delete(0, ytext.length);
      ytext.insert(0, newText);
    });
  };

  const users = Array.from(usersMap.values());

  return (
    <div className="editor-container">
      <div className="header">
        <h1>Collab Editor</h1>
        <div className={`status ${connected ? "online" : "offline"}`}>
          {connected
            ? "🟢 Connected"
            : `🔴 Offline${offlineQueue > 0 ? ` (${offlineQueue} pending)` : ""}`}
        </div>
      </div>

      <div className="presence-bar">
        <div className="presence-you" style={{ backgroundColor: MY_COLOR }}>
          {MY_NAME} (you)
        </div>
        {users.map((user) => (
          <div
            key={user.id}
            className="presence-user"
            style={{ backgroundColor: user.color }}
          >
            {user.name}
          </div>
        ))}
      </div>

      {!connected && (
        <div className="offline-banner">
          ✍️ You're offline — keep typing! Changes will sync when you reconnect.
        </div>
      )}

      <p className="subtitle">Stage 5 — Offline support + reconciliation</p>
      <textarea
        className="editor"
        value={text}
        onChange={handleChange}
        placeholder="Open two tabs — see who's here!"
      />
      <div className="word-count">Characters: {text.length}</div>
    </div>
  );
}

export default App;