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

let keepAliveInterval = null;
let connectionWatchdog = null;

let recoveryTimer = null;
let recoveryInProgress = false;

/*
 * Users currently known inside the room.
 */
let activeParticipants = new Set();

/*
 * Prevent duplicate Welcome messages.
 */
const welcomeCooldown = new Map();

/*
 * Connection state.
 */
let lastConnectedAt = 0;
let lastPresenceAt = 0;


/*
 * ========================================
 * CONNECT SKVIBEZ TO ROOM
 * ========================================
 */
function connectSocket(roomUid) {
  if (!roomUid) {
    throw new Error(
      "Room UID is missing."
    );
  }

  /*
   * Reset presence only when changing rooms.
   */
  if (currentRoomUid !== roomUid) {
    activeParticipants = new Set();
    welcomeCooldown.clear();
  }

  currentRoomUid = roomUid;

  /*
   * Existing healthy socket:
   * DO NOT create another socket.
   */
  if (
    socket &&
    socket.connected
  ) {
    console.log(
      "Socket is already connected."
    );

    startKeepAlive();
    startConnectionWatchdog();

    return socket;
  }

  /*
   * Existing Socket.IO socket that is
   * disconnected but still usable.
   *
   * Recover the SAME socket.
   */
  if (
    socket &&
    !socket.connected &&
    socket.active === false
  ) {
    console.log(
      "Existing Socket.IO socket found."
    );

    console.log(
      "Recovering existing Socket.IO socket..."
    );

    recoverSameSocket();

    startKeepAlive();
    startConnectionWatchdog();

    return socket;
  }

  /*
   * First connection only.
   */
  if (!socket) {
    createSocket();
  }

  startKeepAlive();
  startConnectionWatchdog();

  return socket;
}


/*
 * ========================================
 * CREATE SOCKET
 * ========================================
 *
 * This function should normally run only
 * once during the lifetime of the process.
 */
function createSocket() {
  const token = getToken();

  if (!token) {
    throw new Error(
      "Authentication token is missing."
    );
  }

  console.log(
    "Creating SKVIBEZ Socket.IO instance..."
  );

  socket = io(SOCKET_URL, {
    /*
     * WebSocket only.
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

    /*
     * Socket.IO automatic reconnect.
     */
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 3000,
    reconnectionDelayMax: 10000,

    timeout: 30000,

    /*
     * Engine heartbeat.
     */
    pingTimeout: 60000,
    pingInterval: 25000
  });

  console.log(
    "SKVIBEZ Socket.IO instance created."
  );

  /*
   * ======================================
   * MANAGER EVENTS
   * ======================================
   */
  socket.io.on(
    "reconnect_attempt",
    (attempt) => {
      console.log(
        "Socket.IO reconnect attempt:",
        attempt
      );
    }
  );

  socket.io.on(
    "reconnect",
    (attempt) => {
      console.log(
        "Socket.IO reconnected after attempts:",
        attempt
      );
    }
  );

  socket.io.on(
    "reconnect_error",
    (error) => {
      console.error(
        "Socket.IO reconnect error:",
        error.message
      );
    }
  );

  socket.io.on(
    "reconnect_failed",
    () => {
      console.error(
        "Socket.IO reconnect failed."
      );
    }
  );


  /*
   * ======================================
   * CONNECT
   * ======================================
   */
  socket.on(
    "connect",
    () => {
      lastConnectedAt = Date.now();

      recoveryInProgress = false;

      console.log(
        "Groic Socket connected."
      );

      console.log(
        "Socket ID:",
        socket.id
      );

      console.log(
        "Socket.IO Manager active:",
        socket.active
      );

      if (!currentRoomUid) {
        console.log(
          "Room UID is missing."
        );

        return;
      }

      /*
       * Rejoin the SAME room after a real
       * server/transport reconnect.
       */
      socket.emit(
        "joinRoom",
        {
          roomUid: currentRoomUid,
          name: "SKVIBEZ",
          imageUrl:
            process.env.BOT_IMAGE_URL || "",
          isBot: false
        }
      );

      console.log(
        "Join room request sent."
      );

      console.log(
        "Room UID:",
        currentRoomUid
      );
    }
  );


  /*
   * ======================================
   * DISCONNECT
   * ======================================
   */
  socket.on(
    "disconnect",
    (reason) => {
      console.log(
        "Socket disconnected:",
        reason
      );

      console.log(
        "Socket active:",
        socket.active
      );

      console.log(
        "Socket connected:",
        socket.connected
      );

      console.log(
        "Socket ID at disconnect:",
        socket.id
      );

      /*
       * Transport close.
       *
       * IMPORTANT:
       * Do not create a new socket.
       */
      if (
        reason ===
        "transport close"
      ) {
        console.log(
          "Transport closed."
        );

        console.log(
          "Keeping the same Socket.IO instance."
        );

        /*
         * Socket.IO normally handles this
         * automatically.
         */
        return;
      }

      /*
       * Server explicitly closed the socket.
       *
       * Do NOT call createSocket().
       * Recover the same Socket.IO instance.
       */
      if (
        reason ===
        "io server disconnect"
      ) {
        console.log(
          "Groic server disconnected SKVIBEZ."
        );

        console.log(
          "Recovering using the SAME Socket.IO socket."
        );

        scheduleSameSocketRecovery();

        return;
      }

      /*
       * Any other disconnect reason.
       */
      console.log(
        "Unexpected socket disconnect."
      );
    }
  );


  /*
   * ======================================
   * CONNECTION ERROR
   * ======================================
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

      if (error.data) {
        console.error(
          "Error data:",
          JSON.stringify(error.data)
        );
      }

      /*
       * If authentication/session error
       * happens, the refreshed token will be
       * used for the next connection.
       */
      if (
        String(error.message || "")
          .toLowerCase()
          .includes("unauthorized")
      ) {
        console.log(
          "Authorization error detected."
        );

        scheduleSameSocketRecovery();
      }
    }
  );


  /*
   * ======================================
   * PRESENCE UPDATE
   * ======================================
   */
  socket.on(
    "presenceUpdate",
    (data) => {
      lastPresenceAt = Date.now();

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

      activeParticipants =
        currentParticipants;
    }
  );


  /*
   * ======================================
   * CHAT
   * ======================================
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
   * ======================================
   * SOCKET EVENTS
   * ======================================
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


  /*
   * ======================================
   * ENGINE DIAGNOSTICS
   * ======================================
   */
  attachEngineDiagnostics();
}


/*
 * ========================================
 * SAME SOCKET RECOVERY
 * ========================================
 */
function recoverSameSocket() {
  if (!socket) {
    console.log(
      "No existing socket available."
    );

    return;
  }

  if (socket.connected) {
    console.log(
      "Socket already connected."
    );

    return;
  }

  if (recoveryInProgress) {
    console.log(
      "Socket recovery already in progress."
    );

    return;
  }

  recoveryInProgress = true;

  console.log(
    "Recovering existing Socket.IO socket..."
  );

  try {
    /*
     * IMPORTANT:
     *
     * socket.connect() reconnects the SAME
     * Socket.IO object.
     *
     * We do NOT call io() again.
     */
    socket.connect();

    console.log(
      "Same Socket.IO socket reconnect requested."
    );

  } catch (error) {
    recoveryInProgress = false;

    console.error(
      "Same socket recovery failed:",
      error.message
    );

    scheduleSameSocketRecovery();
  }
}


/*
 * ========================================
 * SCHEDULE SAME SOCKET RECOVERY
 * ========================================
 */
function scheduleSameSocketRecovery() {
  if (recoveryTimer) {
    return;
  }

  recoveryTimer =
    setTimeout(
      () => {
        recoveryTimer = null;

        if (!socket) {
          console.log(
            "Socket does not exist."
          );

          return;
        }

        if (socket.connected) {
          console.log(
            "Socket already recovered."
          );

          recoveryInProgress = false;

          return;
        }

        recoverSameSocket();
      },
      5000
    );
}


/*
 * ========================================
 * ENGINE DIAGNOSTICS
 * ========================================
 */
function attachEngineDiagnostics() {
  if (
    !socket ||
    !socket.io ||
    !socket.io.engine
  ) {
    return;
  }

  const engine =
    socket.io.engine;

  /*
   * Avoid attaching duplicate listeners
   * to the same Engine instance.
   */
  if (
    engine.__skvibezDiagnosticsAttached
  ) {
    return;
  }

  engine.__skvibezDiagnosticsAttached =
    true;

  console.log(
    "Groic Engine diagnostics enabled."
  );

  engine.on(
    "close",
    (reason) => {
      console.log(
        "Groic Engine closed:",
        reason
      );
    }
  );

  engine.on(
    "error",
    (error) => {
      console.error(
        "Groic Engine error:",
        error?.message ||
        error
      );
    }
  );
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
        message:
          welcomeMessage
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
 * NEVER intentionally disconnect the
 * existing socket here.
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
     * Update current Socket.IO authentication.
     */
    socket.auth = {
      Authorization:
        newToken
    };

    if (
      socket.io &&
      socket.io.opts
    ) {
      /*
       * Update extraHeaders.
       */
      if (
        socket.io.opts.extraHeaders
      ) {
        socket.io.opts
          .extraHeaders
          .Authorization =
          newToken;
      }

      /*
       * Update Manager auth.
       */
      if (
        socket.io.opts.auth
      ) {
        socket.io.opts.auth
          .Authorization =
          newToken;
      }
    }

    console.log(
      "Groic Socket authentication updated."
    );

    /*
     * IMPORTANT:
     *
     * No disconnect().
     * No connect().
     *
     * The current connection remains
     * untouched.
     */
  }
);


/*
 * ========================================
 * KEEP ALIVE
 * ========================================
 */
function startKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(
      keepAliveInterval
    );
  }

  keepAliveInterval =
    setInterval(
      () => {
        if (
          socket &&
          socket.connected &&
          currentRoomUid
        ) {
          console.log(
            "Sending Groic room sync..."
          );

          socket.emit(
            "requestSync",
            {
              roomUid:
                currentRoomUid
            }
          );
        }
      },
      10000
    );

  console.log(
    "Groic 10-second keep-alive enabled."
  );
}


/*
 * ========================================
 * CONNECTION WATCHDOG
 * ========================================
 *
 * Checks every 15 seconds.
 *
 * If the Socket.IO Manager is no longer
 * active, recover the SAME socket.
 */
function startConnectionWatchdog() {
  if (connectionWatchdog) {
    clearInterval(
      connectionWatchdog
    );
  }

  connectionWatchdog =
    setInterval(
      () => {
        if (!socket) {
          return;
        }

        if (socket.connected) {
          console.log(
            "[Watchdog] Socket is connected."
          );

          return;
        }

        console.log(
          "[Watchdog] Socket is disconnected."
        );

        console.log(
          "[Watchdog] Socket active:",
          socket.active
        );

        /*
         * If Socket.IO is already attempting
         * reconnection, do nothing.
         */
        if (socket.active) {
          console.log(
            "[Watchdog] Socket.IO is reconnecting..."
          );

          return;
        }

        /*
         * Manager is inactive.
         * Recover SAME socket.
         */
        console.log(
          "[Watchdog] Starting same-socket recovery..."
        );

        scheduleSameSocketRecovery();

      },
      15000
    );

  console.log(
    "SKVIBEZ connection watchdog enabled."
  );
}


/*
 * ========================================
 * GET SOCKET
 * ========================================
 */
function getSocket() {
  return socket;
}


/*
 * ========================================
 * EXPORTS
 * ========================================
 */
module.exports = {
  connectSocket,
  getSocket
};
