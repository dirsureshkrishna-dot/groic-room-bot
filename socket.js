const { io } = require("socket.io-client");
const { getToken } = require("./auth");

const SOCKET_URL = "https://socket-v2.groic.in";

let socket = null;

function connectSocket(roomUid) {
  const token = getToken();

  if (!token) {
    throw new Error("Authentication token is missing.");
  }

  socket = io(SOCKET_URL, {
    transports: ["websocket", "polling"],

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
    timeout: 30000,

    pingTimeout: 60000,
    pingInterval: 25000
  });

  socket.on("connect", () => {
    console.log("Groic Socket connected.");
    console.log("Socket ID:", socket.id);

    socket.emit("joinRoom", {
      roomUid: roomUid,
      name: "SKVIBEZ",
      imageUrl: "",
      isBot: false
    });

    console.log("Join room request sent.");
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", reason);
  });

  socket.on("connect_error", (error) => {
    console.error(
      "Socket connection error:",
      error.message
    );
  });

  socket.on("presenceUpdate", (data) => {
    console.log(
      "Presence update:",
      JSON.stringify(data)
    );
  });

  return socket;
}

function getSocket() {
  return socket;
}

module.exports = {
  connectSocket,
  getSocket
};
