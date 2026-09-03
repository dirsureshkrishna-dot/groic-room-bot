const { io } = require("socket.io-client");
const { getToken } = require("./auth");
const { searchYouTube } = require("./music");

const SOCKET_URL = "https://socket-v2.groic.in";

let socket = null;
let currentRoomUid = null;
let reconnectTimer = null;

/*
 * Participants currently inside the room
 */
let activeParticipants = new Set();

/*
 * Prevent duplicate Welcome messages
 */
const welcomeCooldown = new Map();

/*
 * Connect SKVIBEZ to the room
 */
function connectSocket(roomUid) {
  currentRoomUid = roomUid;

  activeParticipants = new Set();
  welcomeCooldown.clear();

  connect();

  return socket;
}

/*
 * Create socket connection
 */
function connect() {
  const token = getToken();

  if (!token) {
    throw new Error(
      "Authentication token is missing."
    );
  }

  /*
   * Close old socket
   */
  if (socket) {
    try {
      socket.removeAllListeners();
      socket.disconnect();
    } catch (e) {}
  }

  console.log(
    "Connecting to Groic Socket..."
  );

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
   * ========================================
   * SEND WELCOME MESSAGE
   * ========================================
   */
  function sendWelcomeMessage(
    participantName,
    username
  ) {
    if (!participantName || !username) {
      return;
    }

    const normalizedUsername =
      username.toLowerCase();

    /*
     * Never Welcome SKVIBEZ itself
     */
    if (
      normalizedUsername === "skvibez"
    ) {
      return;
    }

    /*
     * Prevent duplicate Welcome messages
     * caused by repeated presenceUpdate events.
     */
    const now = Date.now();

    const lastWelcome =
      welcomeCooldown.get(
        normalizedUsername
      ) || 0;

    /*
     * Ignore duplicate event within 15 seconds.
     */
    if (now - lastWelcome < 15000) {
      console.log(
        "Welcome skipped (duplicate):",
        participantName
      );

      return;
    }

    welcomeCooldown.set(
      normalizedUsername,
      now
    );

    const welcomeMessage =
      `🦋Welcome to 🎶 𝑺𝑲 𝑽𝑰𝑩𝑬𝒁 🎶 , ${participantName}!💥\n` +
      `அன்புடன்! 𝙮𝙚𝙨𝙠𝙞𝙣𝙜 🦋`;

    console.log(
      "Sending welcome message:",
      welcomeMessage
    );

    /*
     * Groic outgoing chat event
     */
    socket.emit("sendChat", {
      message: welcomeMessage
    });

    console.log(
      "Welcome message sent."
    );
  }

  /*
   * ========================================
   * SOCKET CONNECTED
   * ========================================
   */
  socket.on("connect", () => {
    console.log(
      "Groic Socket connected."
    );

    console.log(
      "Socket ID:",
      socket.id
    );

    /*
     * New connection.
     */
    activeParticipants =
      new Set();

    if (currentRoomUid) {
      socket.emit("joinRoom", {
        roomUid: currentRoomUid,
        name: "SKVIBEZ",
        imageUrl:
          process.env.BOT_IMAGE_URL || "",
        isBot: false
      });

      console.log(
        "Join room request sent."
      );
    }
  });

  /*
   * ========================================
   * DISCONNECTED
   * ========================================
   */
  socket.on("disconnect", (reason) => {
    console.log(
      "Socket disconnected:",
      reason
    );

    if (
      reason ===
      "io server disconnect"
    ) {
      console.log(
        "Groic server disconnected the bot."
      );

      scheduleReconnect();
    }
  });

  /*
   * ========================================
   * CONNECTION ERROR
   * ========================================
   */
  socket.on(
    "connect_error",
    (error) => {
      console.error(
        "Socket connection error:"
      );

      console.error(
        "Message:",
        error.message
      );

      console.error(
        "Description:",
        error.description
      );

      console.error(
        "Context:",
        error.context
      );

      console.error(
        "Type:",
        error.type
      );
    }
  );

  /*
   * ========================================
   * RECONNECTED
   * ========================================
   */
  socket.on(
    "reconnect",
    (attempt) => {
      console.log(
        "Socket reconnected. Attempt:",
        attempt
      );
    }
  );

  /*
   * ========================================
   * PRESENCE UPDATE
   * ========================================
   */
  socket.on(
    "presenceUpdate",
    (data) => {
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
       * Participants in the current update
       */
      const currentParticipants =
        new Set();

      for (const user of users) {
        const username =
          user?.username || "";

        const participantName =
          user?.name ||
          username;

        if (!username) {
          continue;
        }

        const normalizedUsername =
          username.toLowerCase();

        /*
         * SKVIBEZ itself
         */
        if (
          normalizedUsername ===
          "skvibez"
        ) {
          currentParticipants.add(
            normalizedUsername
          );

          continue;
        }

        /*
         * Add participant
         */
        currentParticipants.add(
          normalizedUsername
        );

        /*
         * New participant
         */
        if (
          !activeParticipants.has(
            normalizedUsername
          )
        ) {
          console.log(
            "New participant:",
            participantName
          );

          sendWelcomeMessage(
            participantName,
            normalizedUsername
          );
        }
      }

      /*
       * Save current room participants
       *
       * If someone leaves, they are removed.
       * If they return later, Welcome will be sent.
       */
      activeParticipants =
        currentParticipants;
    }
  );

  /*
   * ========================================
   * CHAT MESSAGES
   * ========================================
   */
  socket.on(
    "chat",
    async (data) => {
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

      const normalizedMessage =
        message
          .toLowerCase()
          .trim();

      /*
       * ====================================
       * !play COMMAND
       * ====================================
       */
      if (
        normalizedMessage.startsWith(
          "!play "
        )
      ) {
        const query =
          message
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
            await searchYouTube(
              query
            );

          console.log(
            "YouTube results:",
            JSON.stringify(
              results,
              null,
              2
            )
          );

          /*
           * Groic handles the actual
           * music playback.
           *
           * We only perform YouTube search
           * here for the bot integration.
           */
          if (
            results &&
            results.length > 0
          ) {
            console.log(
              "YouTube result found:",
              results[0].title
            );
          }
        } catch (error) {
          console.error(
            "YouTube search failed:",
            error.response?.data ||
            error.message
          );
        }

        return;
      }
    }
  );

  /*
   * ========================================
   * LOG ALL SOCKET EVENTS
   * ========================================
   */
  socket.onAny(
    (event, ...args) => {
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
    }
  );

  return socket;
}

/*
 * ========================================
 * RECONNECT
 * ========================================
 */
function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer =
    setTimeout(() => {
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

/*
 * Get current socket
 */
function getSocket() {
  return socket;
}

module.exports = {
  connectSocket,
  getSocket
};
