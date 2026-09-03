const { io } = require("socket.io-client");
const { getToken } = require("./auth");

const SOCKET_URL = "https://socket-v2.groic.in";

let socket = null;
let currentRoomUid = null;
let reconnectTimer = null;

function connectSocket(roomUid) {
  currentRoomUid = roomUid;

  connect();

  return socket;
}

function connect() {
  const token = getToken();

  if (!token) {
    throw new Error("Authentication token is missing.");
  }

  if (socket) {
    try {
      socket.removeAllListeners();
      socket.disconnect();
    } catch (e) {}
  }

  console.log("Connecting to Groic Socket...");

  socket = io(SOCKET_URL, {
    transports: ["websocket"],

    auth: {
      Authorization: token
    },

    extraHeaders: {
      Origin: "https://groic.in",
      Referer: "https://groic.in/",
      Authorization: token,
      "x-app-version": "web",
      "x-device-type": "web"
    },

    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 3000,
    reconnectionDelayMax: 10000,

    timeout: 30000,

    pingTimeout: 60000,
    pingInterval: 25000
  });

  socket.on("connect", () => {
    console.log("Groic Socket connected.");
    console.log("Socket ID:", socket.id);

    if (currentRoomUid) {
      socket.emit("joinRoom", {
        roomUid: currentRoomUid,
        name: "SKVIBEZ",
        imageUrl: "",
        isBot: false
      });

      console.log("Join room request sent.");
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", reason);

    if (reason === "io server disconnect") {
      console.log(
        "Groic server disconnected the bot. Reconnecting..."
      );

      scheduleReconnect();
    }
  });

  socket.on("connect_error", (error) => {
  console.error("Socket connection error:");
  console.error("Message:", error.message);
  console.error("Description:", error.description);
  console.error("Context:", error.context);
  console.error("Type:", error.type);
});
  socket.on("reconnect", (attempt) => {
    console.log(
      "Socket reconnected. Attempt:",
      attempt
    );
  });

  socket.on("presenceUpdate", (data) => {
    console.log(
      "Presence update:",
      JSON.stringify(data)
    );
  });
  socket.on("chat", (data) => {
  console.log(
    "Chat message:",
    JSON.stringify(data)
  );
});
socket.onAny((event, ...args) => {
  console.log("Socket Event:", event);

  if (args.length > 0) {
    console.log(
      "Socket Data:",
      JSON.stringify(args)
    );
  }
});
  return socket;
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    console.log("Attempting socket reconnect...");

    try {
      connect();
    } catch (error) {
      console.error(
        "Reconnect failed:",
        error.message
      );

      scheduleReconnect();
    }
  }, 5000);
}

function getSocket() {
  return socket;
}

module.exports = {
  connectSocket,
  getSocket
};
