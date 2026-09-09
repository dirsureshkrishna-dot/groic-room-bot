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
let roomRejoinWatchdog = null;

let recoveryTimer = null;
let recoveryInProgress = false;
let roomJoinInProgress = false;

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
let lastRoomJoinAt = 0;


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
   * Reset room state only when
   * changing to another room.
   */
  if (currentRoomUid !== roomUid) {
    activeParticipants = new Set();
    welcomeCooldown.clear();
  }

  currentRoomUid = roomUid;

  /*
   * Existing healthy socket.
   */
  if (
    socket &&
    socket.connected
  ) {
    console.log(
      "[Socket] Already connected."
    );

    ensureRoomJoined();

    startKeepAlive();
    startConnectionWatchdog();
    startRoomRejoinWatchdog();

    return socket;
  }

  /*
   * Existing Socket.IO socket.
   * Reuse the SAME socket.
   */
  if (socket) {
    console.log(
      "[Socket] Existing socket found."
    );

    if (!socket.connected) {
      scheduleSameSocketRecovery();
    }

    startKeepAlive();
    startConnectionWatchdog();
    startRoomRejoinWatchdog();

    return socket;
  }

  /*
   * Create socket only once.
   */
  createSocket();

  startKeepAlive();
  startConnectionWatchdog();
  startRoomRejoinWatchdog();

  return socket;
}


/*
 * ========================================
 * CREATE SOCKET
 * ========================================
 */
function createSocket() {
  const token = getToken();

  if (!token) {
    throw new Error(
      "Authentication token is missing."
    );
  }

  console.log(
    "[Socket] Creating SKVIBEZ Socket.IO instance..."
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

    /*
     * Automatic Socket.IO reconnect.
     */
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 3000,
    reconnectionDelayMax: 15000,
    randomizationFactor: 0.5,

    timeout: 30000,

    /*
     * Engine heartbeat.
     */
    pingTimeout: 60000,
    pingInterval: 25000
  });

  console.log(
    "[Socket] SKVIBEZ Socket.IO instance created."
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
        "[Reconnect] Attempt:",
        attempt
      );
    }
  );

  socket.io.on(
    "reconnect",
    (attempt) => {
      console.log(
        "[Reconnect] Successfully reconnected after:",
        attempt,
        "attempt(s)"
      );

      recoveryInProgress = false;

      /*
       * connect event normally performs
       * the actual room join.
       */
      setTimeout(
        () => {
          ensureRoomJoined();
        },
        1000
      );
    }
  );

  socket.io.on(
    "reconnect_error",
    (error) => {
      console.error(
        "[Reconnect] Error:",
        error?.message ||
        error
      );
    }
  );

  socket.io.on(
    "reconnect_failed",
    () => {
      console.error(
        "[Reconnect] Failed."
      );

      /*
       * Do not create another socket.
       * Watchdog will continue monitoring
       * the existing socket.
       */
      scheduleSameSocketRecovery();
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
        "========================================"
      );

      console.log(
        "GROIC SKVIBEZ CONNECTED"
      );

      console.log(
        "Socket ID:",
        socket.id
      );

      console.log(
        "Transport:",
        socket.io?.engine?.transport?.name
      );

      console.log(
        "Socket active:",
        socket.active
      );

      console.log(
        "Room UID:",
        currentRoomUid
      );

      console.log(
        "========================================"
      );

      ensureRoomJoined();
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
        "[Socket] Disconnected:",
        reason
      );

      console.log(
        "[Socket] active:",
        socket?.active
      );

      console.log(
        "[Socket] connected:",
        socket?.connected
      );

      /*
       * Normal transport/network disconnect.
       *
       * Socket.IO should automatically
       * reconnect.
       */
      if (
        reason ===
        "transport close"
      ) {
        console.log(
          "[Recovery] Transport closed."
        );

        console.log(
          "[Recovery] Waiting for Socket.IO automatic reconnect..."
        );

        return;
      }

      /*
       * Server-side disconnect.
       *
       * Socket.IO automatic reconnect is not
       * always triggered for io server disconnect,
       * so explicitly recover the SAME socket.
       */
      if (
        reason ===
        "io server disconnect"
      ) {
        console.log(
          "[Recovery] Groic server disconnected SKVIBEZ."
        );

        scheduleSameSocketRecovery();

        return;
      }

      /*
       * Other disconnect reasons.
       */
      console.log(
        "[Recovery] Unexpected disconnect."
      );

      /*
       * If Socket.IO is not already active,
       * request same-socket recovery.
       */
      if (
        socket &&
        !socket.active
      ) {
        scheduleSameSocketRecovery();
      }
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
        "[Socket] Connection error:"
      );

      console.error(
        "Message:",
        error?.message
      );

      console.error(
        "Description:",
        error?.description
      );

      console.error(
        "Type:",
        error?.type
      );

      if (error?.data) {
        console.error(
          "Error data:",
          JSON.stringify(error.data)
        );
      }

      const errorMessage =
        String(
          error?.message || ""
        ).toLowerCase();

      if (
        errorMessage.includes(
          "unauthorized"
        ) ||
        errorMessage.includes(
          "authentication"
        ) ||
        errorMessage.includes(
          "token"
        )
      ) {
        console.log(
          "[Auth] Authentication-related connection error detected."
        );

        /*
         * Do not create a new socket.
         * Token refresh will update the
         * existing socket configuration.
         */
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
        "[Presence] Update received."
      );

      console.log(
        "[Presence] Data:",
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
         * Never welcome SKVIBEZ itself.
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
        "[Chat]",
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
            "[Music] YouTube search:",
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
              "[Music] YouTube result:",
              results[0].title
            );

            /*
             * Groic handles playback.
             *
             * No unverified playback event
             * is emitted here.
             */
          }
        } catch (error) {
          console.error(
            "[Music] YouTube search failed:",
            error?.response?.data ||
            error?.message ||
            error
          );
        }

        return;
      }
    }
  );


  /*
   * ======================================
   * ALL SOCKET EVENTS
   * ======================================
   *
   * Useful for discovering new Groic
   * events without changing existing logic.
   */
  socket.onAny(
    (event, ...args) => {
      console.log(
        "[Socket Event]",
        event
      );

      if (args.length > 0) {
        try {
          console.log(
            "[Socket Data]",
            JSON.stringify(args)
          );
        } catch {
          console.log(
            "[Socket Data] Unable to stringify."
          );
        }
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
 * ENSURE ROOM JOINED
 * ========================================
 *
 * Sends joinRoom only when connected.
 *
 * Duplicate join requests are prevented
 * for a short period.
 */
function ensureRoomJoined() {
  if (
    !socket ||
    !socket.connected
  ) {
    return;
  }

  if (!currentRoomUid) {
    console.log(
      "[Room] Room UID is missing."
    );

    return;
  }

  if (roomJoinInProgress) {
    console.log(
      "[Room] Join already in progress."
    );

    return;
  }

  const now = Date.now();

  /*
   * Avoid repeatedly sending joinRoom
   * every second.
   */
  if (
    lastRoomJoinAt &&
    now - lastRoomJoinAt < 5000
  ) {
    return;
  }

  roomJoinInProgress = true;
  lastRoomJoinAt = now;

  console.log(
    "[Room] Joining room:",
    currentRoomUid
  );

  try {
    socket.emit(
      "joinRoom",
      {
        roomUid:
          currentRoomUid,

        name:
          "SKVIBEZ",

        imageUrl:
          process.env.BOT_IMAGE_URL || "",

        isBot: false
      }
    );

    console.log(
      "[Room] joinRoom request sent."
    );
  } catch (error) {
    console.error(
      "[Room] joinRoom failed:",
      error?.message ||
      error
    );
  }

  /*
   * This is only a local protection flag.
   * It is cleared shortly after the request.
   */
  setTimeout(
    () => {
      roomJoinInProgress = false;
    },
    2000
  );
}


/*
 * ========================================
 * SAME SOCKET RECOVERY
 * ========================================
 */
function recoverSameSocket() {
  if (!socket) {
    console.log(
      "[Recovery] No existing socket."
    );

    return;
  }

  if (socket.connected) {
    console.log(
      "[Recovery] Socket already connected."
    );

    ensureRoomJoined();

    recoveryInProgress = false;

    return;
  }

  if (recoveryInProgress) {
    console.log(
      "[Recovery] Already in progress."
    );

    return;
  }

  recoveryInProgress = true;

  console.log(
    "[Recovery] Recovering SAME Socket.IO instance..."
  );

  try {
    /*
     * IMPORTANT:
     *
     * Reuse the SAME socket.
     *
     * Never call io() again here.
     */
    socket.connect();

    console.log(
      "[Recovery] socket.connect() requested."
    );

  } catch (error) {
    recoveryInProgress = false;

    console.error(
      "[Recovery] Same socket recovery failed:",
      error?.message ||
      error
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
            "[Recovery] Socket does not exist."
          );

          return;
        }

        if (socket.connected) {
          console.log(
            "[Recovery] Socket already recovered."
          );

          recoveryInProgress = false;

          ensureRoomJoined();

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
   * Prevent duplicate diagnostics.
   */
  if (
    engine.__skvibezDiagnosticsAttached
  ) {
    return;
  }

  engine.__skvibezDiagnosticsAttached =
    true;

  console.log(
    "[Engine] Diagnostics enabled."
  );

  engine.on(
    "close",
    (reason) => {
      console.log(
        "[Engine] Closed:",
        reason
      );

      /*
       * Socket.IO will normally reconnect.
       * Watchdogs also continue monitoring.
       */
    }
  );

  engine.on(
    "error",
    (error) => {
      console.error(
        "[Engine] Error:",
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
   * Never welcome SKVIBEZ.
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
    `🎶 Welcome to Skvibez 🎼, ${participantName}`;

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
 */
onTokenRefresh(
  async (newToken) => {
    console.log(
      "[Auth] New SKVIBEZ token received."
    );

    if (!newToken) {
      console.log(
        "[Auth] Empty token received."
      );

      return;
    }

    if (!socket) {
      console.log(
        "[Auth] Socket does not exist yet."
      );

      return;
    }

    /*
     * Update Socket.IO auth.
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
       * Update extra headers.
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
       * Update auth options.
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
      "[Auth] Socket authentication updated."
    );

    /*
     * IMPORTANT:
     *
     * We intentionally do NOT call
     * disconnect() here.
     *
     * We also do NOT create another
     * Socket.IO instance.
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
            "[KeepAlive] Sending room sync..."
          );

          try {
            socket.emit(
              "requestSync",
              {
                roomUid:
                  currentRoomUid
              }
            );
          } catch (error) {
            console.error(
              "[KeepAlive] Failed:",
              error?.message ||
              error
            );
          }
        }
      },
      10000
    );

  console.log(
    "[KeepAlive] 10-second room sync enabled."
  );
}


/*
 * ========================================
 * CONNECTION WATCHDOG
 * ========================================
 *
 * Checks every 15 seconds.
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
            "[Watchdog] Socket connected."
          );

          return;
        }

        console.log(
          "[Watchdog] Socket disconnected."
        );

        console.log(
          "[Watchdog] Socket active:",
          socket.active
        );

        /*
         * Socket.IO is already reconnecting.
         */
        if (socket.active) {
          console.log(
            "[Watchdog] Socket.IO is reconnecting..."
          );

          return;
        }

        /*
         * Manager is inactive.
         * Recover the SAME socket.
         */
        console.log(
          "[Watchdog] Starting same-socket recovery..."
        );

        scheduleSameSocketRecovery();

      },
      15000
    );

  console.log(
    "[Watchdog] SKVIBEZ connection watchdog enabled."
  );
}


/*
 * ========================================
 * ROOM REJOIN WATCHDOG
 * ========================================
 *
 * Makes sure a connected socket continues
 * trying to establish the room membership.
 *
 * This does NOT create a new socket.
 */
function startRoomRejoinWatchdog() {
  if (roomRejoinWatchdog) {
    clearInterval(
      roomRejoinWatchdog
    );
  }

  roomRejoinWatchdog =
    setInterval(
      () => {
        if (
          !socket ||
          !socket.connected ||
          !currentRoomUid
        ) {
          return;
        }

        /*
         * If presence has not been received
         * for a long time, send a controlled
         * room join request.
         */
        const now = Date.now();

        const connectedFor =
          lastConnectedAt
            ? now - lastConnectedAt
            : 0;

        const presenceAge =
          lastPresenceAt
            ? now - lastPresenceAt
            : 0;

        /*
         * Give the server some time after
         * initial connection before checking.
         */
        if (
          connectedFor < 30000
        ) {
          return;
        }

        /*
         * If no presence event has been seen
         * for 60 seconds, ensure room join.
         */
        if (
          !lastPresenceAt ||
          presenceAge > 60000
        ) {
          console.log(
            "[RoomWatchdog] Room presence is stale."
          );

          console.log(
            "[RoomWatchdog] Ensuring room join..."
          );

          ensureRoomJoined();
        }
      },
      30000
    );

  console.log(
    "[RoomWatchdog] Room rejoin watchdog enabled."
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
