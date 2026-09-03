const { io } = require("socket.io-client");
const { getToken } = require("./auth");
const { searchYouTube } = require("./music");

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
