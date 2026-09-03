const { io } = require("socket.io-client");

const {
  getToken,
  onTokenRefresh
} = require("./auth");

const { searchYouTube } = require("./music");

const SOCKET_URL =
  "https://socket-v2.groic.in";

let socket = null;
let currentRoomUid = null;
let reconnectTimer = null;
let keepAliveInterval = null;

/*
 * Users currently known to be inside the room.
 */
let activeParticipants = new Set();

/*
 * Prevent duplicate Welcome messages.
 */
const welcomeCooldown = new Map();

/*
 * ========================================
 * CONNECT SKVIBEZ TO ROOM
 * ========================================
 */
function connectSocket(roomUid) {
  currentRoomUid = roomUid;

  activeParticipants = new Set();
  welcomeCooldown.clear();

  connect();

  startKeepAlive();

  return socket;
}

/*
 * ========================================
 * CREATE SOCKET CONNECTION
 * ========================================
 */
function connect() {
  const token = getToken();

  if (!token) {
    throw new Error(
      "Authentication token is missing."
    );
  }

  /*
   * Only create a new socket when necessary.
   *
   * Token refresh should NOT call this function.
   * This is important because calling connect()
   * would disconnect the current socket.
   */
  if (socket) {
    try {
      socket.removeAllListeners();
      socket.disconnect();
    } catch (e) {}

    socket = null;
  }

  console.log(
    "Connecting to Groic Socket..."
  );

  socket = io(SOCKET_URL, {
    /*
     * WebSocket only.
     *
     * Polling previously caused connection errors.
     */
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

    if (!currentRoomUid) {
      return;
    }

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
  });

  /*
   * ========================================
   * DISCONNECTED
   * ========================================
   */
  socket.on(
    "disconnect",
    (reason) => {
      console.log(
        "Socket disconnected:",
        reason
      );

      /*
       * Socket.IO normally reconnects automatically.
       *
       * If the server explicitly disconnects us,
       * schedule an additional recovery attempt.
       */
      if (
        reason ===
        "io server disconnect"
      ) {
        console.log(
          "Groic server disconnected SKVIBEZ."
        );

        scheduleReconnect();
      }
    }
  );

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
        "Type:",
        error.type
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
         * Never Welcome SKVIBEZ.
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

        currentParticipants.add(
          normalizedUsername
        );

        /*
         * New participant.
         */
        if (
          !activeParticipants.has(
            normalizedUsername
          )
        ) {
          sendWelcomeMessage(
            participantName,
            normalizedUsername
          );
        }
      }

      /*
       * Save current presence.
       *
       * If a user leaves, they are removed.
       * If they return later, Welcome is sent again.
       */
      activeParticipants =
        currentParticipants;
    }
  );

  /*
   * ========================================
   * CHAT
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
       * !PLAY
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

          if (
            results &&
            results.length > 0
          ) {
            console.log(
              "YouTube result found:",
              results[0].title
            );

            /*
             * Groic handles playback.
             */
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
   * LOG SOCKET EVENTS
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
 * WELCOME MESSAGE
 * ========================================
 */
function sendWelcomeMessage(
  participantName,
  username
) {
  if (
    !participantName ||
    !username
  ) {
    return;
  }

  const normalizedUsername =
    username.toLowerCase();

  /*
   * Never Welcome SKVIBEZ.
   */
  if (
    normalizedUsername ===
    "skvibez"
  ) {
    return;
  }

  /*
   * Duplicate protection.
   */
  const now = Date.now();

  const lastWelcome =
    welcomeCooldown.get(
      normalizedUsername
    ) || 0;

  if (
    now - lastWelcome <
    15000
  ) {
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

  if (
    socket &&
    socket.connected
  ) {
    socket.emit(
      "sendChat",
      {
        message: welcomeMessage
      }
    );

    console.log(
      "Welcome message sent."
    );
  }
}

/*
 * ========================================
 * TOKEN REFRESH
 * ========================================
 *
 * IMPORTANT:
 *
 * Do NOT call connect() here.
 *
 * Calling connect() would disconnect the
 * existing socket and create the exact
 * left -> joined behaviour we are trying
 * to avoid.
 */
onTokenRefresh(
  async (newToken) => {
    console.log(
      "New SKVIBEZ token received."
    );

    if (!newToken) {
      console.log(
        "Empty token received."
      );

      return;
    }

    if (!socket) {
      console.log(
        "Socket does not exist yet."
      );

      return;
    }

    /*
     * Update Socket.IO authentication
     * information without intentionally
     * disconnecting the current socket.
     */
    socket.auth = {
      Authorization: newToken
    };

    if (
      socket.io &&
      socket.io.opts
    ) {
      if (
        socket.io.opts.extraHeaders
      ) {
        socket.io.opts.extraHeaders.Authorization =
          newToken;
      }

      if (
        socket.io.opts.auth
      ) {
        socket.io.opts.auth.Authorization =
          newToken;
      }
    }

    console.log(
      "Groic Socket authentication updated with new token."
    );
  }
);

/*
 * ========================================
 * KEEP ALIVE
 * ========================================
 */
function startKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }

  keepAliveInterval = setInterval(() => {
    if (
      socket &&
      socket.connected &&
      currentRoomUid
    ) {
      console.log(
        "Sending Groic room sync..."
      );

      socket.emit("requestSync", {
        roomUid: currentRoomUid
      });
    }
  }, 10000);

  console.log(
    "Groic 10-second keep-alive enabled."
  );
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
        "Attempting socket recovery..."
      );

      try {
        /*
         * If Socket.IO already reconnected,
         * don't create another connection.
         */
        if (
          socket &&
          socket.connected
        ) {
          console.log(
            "Socket is already connected."
          );

          return;
        }

        connect();
      } catch (error) {
        console.error(
          "Socket recovery failed:",
          error.message
        );

        scheduleReconnect();
      }
    }, 5000);
}

/*
 * ========================================
 * GET SOCKET
 * ========================================
 */
function getSocket() {
  return socket;
}

module.exports = {
  connectSocket,
  getSocket
};
