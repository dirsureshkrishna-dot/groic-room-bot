const { io } = require("socket.io-client");
const { getToken } = require("./auth");
const { searchYouTube } = require("./music");

const SOCKET_URL = "https://socket-v2.groic.in";

let socket = null;
let currentRoomUid = null;
let reconnectTimer = null;

/*
 * Current participants in the room
 *
 * ஒருவர் room-ல் இருக்கும் வரை இங்கே இருப்பார்.
 * வெளியே சென்றால் அடுத்த presenceUpdate-ல் Set-ல் இருந்து நீக்கப்படுவார்.
 * மீண்டும் வந்தால் புதிய participant ஆக கருதப்பட்டு Welcome வரும்.
 */
let activeParticipants = new Set();

function connectSocket(roomUid) {
  currentRoomUid = roomUid;

  /*
   * New connection என்றால் participant tracking-ஐ reset செய்கிறோம்.
   */
  activeParticipants = new Set();

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

  /*
   * Socket connected
   */
  socket.on("connect", () => {
    console.log("Groic Socket connected.");
    console.log("Socket ID:", socket.id);

    /*
     * New socket connection.
     * Current participant list will be rebuilt from presenceUpdate.
     */
    activeParticipants = new Set();

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

  /*
   * Socket disconnected
   */
  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected:", reason);

    if (reason === "io server disconnect") {
      console.log(
        "Groic server disconnected the bot. Reconnecting..."
      );

      scheduleReconnect();
    }
  });

  /*
   * Connection error
   */
  socket.on("connect_error", (error) => {
    console.error("Socket connection error:");
    console.error("Message:", error.message);
    console.error("Description:", error.description);
    console.error("Context:", error.context);
    console.error("Type:", error.type);
  });

  /*
   * Reconnected
   */
  socket.on("reconnect", (attempt) => {
    console.log(
      "Socket reconnected. Attempt:",
      attempt
    );
  });

  /*
   * Presence / participants
   */
  socket.on("presenceUpdate", (data) => {
    console.log(
      "Presence update:",
      JSON.stringify(data)
    );

    const users =
      data?.activeUsers ||
      data?.[0]?.activeUsers ||
      [];

    if (!Array.isArray(users)) {
      return;
    }

    /*
     * Participants currently present in this update.
     */
    const currentParticipants = new Set();

    for (const user of users) {
      const username = user?.username || "";
      const participantName =
        user?.name || username;

      if (!username) {
        continue;
      }

      const normalizedUsername =
        username.toLowerCase();

      /*
       * Never welcome SKVIBEZ itself.
       */
      if (normalizedUsername === "skvibez") {
        currentParticipants.add(
          normalizedUsername
        );

        continue;
      }

      /*
       * Keep track of everyone currently inside.
       */
      currentParticipants.add(
        normalizedUsername
      );

      /*
       * If this username was NOT in the previous
       * participant list, they have newly joined.
       */
      if (!activeParticipants.has(normalizedUsername)) {
        console.log(
          "New participant:",
          participantName
        );

        sendWelcomeMessage(participantName);
      }
    }

    /*
     * IMPORTANT:
     *
     * Replace the old list with the current list.
     *
     * Therefore:
     *
     * Malar enters  -> Welcome
     * Malar stays   -> No duplicate
     * Malar leaves  -> Removed from Set
     * Malar enters  -> Welcome again
     */
    activeParticipants = currentParticipants;
  });

  /*
   * Chat messages
   */
  socket.on("chat", async (data) => {
    console.log(
      "Chat message:",
      JSON.stringify(data)
    );

    const message =
      data?.message ||
      data?.[0]?.message ||
      "";

    if (!message) {
      return;
    }

    /*
     * !play command
     */
    if (
      message
        .toLowerCase()
        .startsWith("!play ")
    ) {
      const query = message
        .slice(6)
        .trim();

      if (!query) {
        return;
      }

      try {
        console.log(
          "YouTube search:",
          query
        );

        const results =
          await searchYouTube(query);

        console.log(
          "YouTube results:",
          JSON.stringify(
            results,
            null,
            2
          )
        );
      } catch (error) {
        console.error(
          "YouTube search failed:",
          error.response?.data ||
          error.message
        );
      }
    }
  });

  /*
   * Welcome message
   */
  function sendWelcomeMessage(participantName) {
    if (!participantName) {
      return;
    }

    const welcomeMessage =
      `👋 Welcome, ${participantName} to 𝑺𝑲 𝑽𝑰𝑩𝑬𝒁 ⚡️ 𝒀𝑬𝑺𝑲𝑰𝑵𝑮\n` +
      `SKVIBEZ Music க்கு வரவேற்கிறோம்😍`;

    console.log(
      "Sending welcome message:",
      welcomeMessage
    );

    /*
     * Current outgoing chat payload.
     *
     * We are keeping this unchanged for now.
     * The next step will be testing whether Groic
     * actually accepts this payload.
     */
    socket.emit("sendChat", {
  message: welcomeMessage
});

    console.log(
      "Welcome message emit completed."
    );
  }

  /*
   * Log all socket events
   */
  socket.onAny((event, ...args) => {
    console.log(
      "Socket Event:",
      event
    );

    if (args.length > 0) {
      console.log(
        "Socket Data:",
        JSON.stringify(args)
      );
    }
  });

  return socket;
}

/*
 * Reconnect
 */
function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    console.log(
      "Attempting socket reconnect..."
    );

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
