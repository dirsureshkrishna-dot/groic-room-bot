const { io } = require("socket.io-client");
const { getToken } = require("./auth");
const { searchYouTube } = require("./music");

const SOCKET_URL = "https://socket-v2.groic.in";

let socket = null;
let currentRoomUid = null;
let reconnectTimer = null;

// Track participants already seen
let knownParticipants = new Set();
let presenceInitialized = false;

function connectSocket(roomUid) {
  currentRoomUid = roomUid;

  // Reset participant tracking on a fresh connection
  knownParticipants = new Set();
  presenceInitialized = false;

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

    // Reset presence tracking after reconnect
    knownParticipants = new Set();
    presenceInitialized = false;

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

  // ==============================
  // WELCOME MESSAGE
  // ==============================

  socket.on("presenceUpdate", (data) => {
    console.log(
      "Presence update:",
      JSON.stringify(data)
    );

    const activeUsers =
      data?.activeUsers ||
      data?.[0]?.activeUsers ||
      [];

    if (!Array.isArray(activeUsers)) {
      return;
    }

    const currentParticipants = new Set();

    for (const user of activeUsers) {
      const username = String(
        user?.username || ""
      ).toLowerCase();

      const name =
        user?.name ||
        user?.username ||
        "";

      if (!username) {
        continue;
      }

      currentParticipants.add(username);

      // Never welcome the bot itself
      if (username === "skvibez") {
        continue;
      }

      // First presence update only establishes
      // who is already inside the room.
      if (!presenceInitialized) {
        continue;
      }

      // New participant detected
      if (!knownParticipants.has(username)) {
        const welcomeMessage =
          `👋 Welcome, ${name} to 𝑺𝑲 𝑽𝑰𝑩𝑬𝒁 ⚡️ 𝒀𝑬𝑺𝑲𝑰𝑵𝑮\n` +
          `SKVIBEZ Music க்கு வரவேற்கிறோம்😍`;

        console.log(
          "New participant:",
          name
        );

        console.log(
          "Sending welcome message:",
          welcomeMessage
        );

        socket.emit("chat", {
          message: welcomeMessage
        });
      }
    }

    knownParticipants = currentParticipants;

    // First presence update completed
    if (!presenceInitialized) {
      presenceInitialized = true;

      console.log(
        "Initial participant list initialized."
      );
    }
  });

  // ==============================
  // CHAT / YOUTUBE
  // ==============================

  socket.on("chat", async (data) => {
    console.log(
      "Chat message:",
      JSON.stringify(data)
    );

    const message =
      data?.message ||
      data?.[0]?.message ||
      "";

    if (!message.toLowerCase().startsWith("!play ")) {
      return;
    }

    const query = message.slice(6).trim();

    if (!query) {
      return;
    }

    try {
      console.log("YouTube search:", query);

      const results = await searchYouTube(query);

      console.log(
        "YouTube results:",
        JSON.stringify(results, null, 2)
      );

    } catch (error) {
      console.error(
        "YouTube search failed:",
        error.response?.data ||
        error.message
      );
    }
  });

  // ==============================
  // ALL SOCKET EVENTS
  // ==============================

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
