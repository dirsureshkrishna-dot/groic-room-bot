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
let watchdogInterval = null;

let socketConnectionCount = 0;
let currentSocketInstanceId = null;

let lastConnectedAt = null;
let lastDisconnectAt = null;
let lastPresenceAt = null;
let lastSyncAt = null;

let activeParticipants = new Set();

const welcomeCooldown = new Map();


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
   * Reset participant tracking only
   * when changing rooms.
   */
  if (currentRoomUid !== roomUid) {
    activeParticipants = new Set();
    welcomeCooldown.clear();
  }

  currentRoomUid = roomUid;


  /*
   * Existing socket is already connected.
   */
  if (
    socket &&
    socket.connected
  ) {
    console.log(
      "Socket is already connected."
    );

    console.log(
      "Active Socket instance:",
      currentSocketInstanceId
    );

    startKeepAlive();
    startConnectionWatchdog();

    return socket;
  }


  /*
   * Existing socket is currently
   * reconnecting.
   */
  if (
    socket &&
    socket.active
  ) {
    console.log(
      "Existing Socket.IO connection is reconnecting."
    );

    console.log(
      "Socket instance:",
      currentSocketInstanceId
    );

    startKeepAlive();
    startConnectionWatchdog();

    return socket;
  }


  /*
   * First connection.
   */
  connect();

  startKeepAlive();
  startConnectionWatchdog();

  return socket;
}


/*
 * ========================================
 * CREATE FIRST SOCKET
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
   * NEVER create another socket if the
   * existing one is connected.
   */
  if (
    socket &&
    socket.connected
  ) {
    console.log(
      "Existing Groic Socket is already connected."
    );

    return socket;
  }


  /*
   * If an existing socket is active,
   * let Socket.IO reconnect it.
   */
  if (
    socket &&
    socket.active
  ) {
    console.log(
      "Existing Socket.IO socket is already active."
    );

    return socket;
  }


  /*
   * Only clean up an old socket when
   * it is completely inactive.
   */
  if (socket) {
    try {
      console.log(
        "Cleaning up inactive socket:",
        currentSocketInstanceId
      );

      socket.removeAllListeners();
      socket.disconnect();

    } catch (error) {
      console.log(
        "Inactive socket cleanup:",
        error.message
      );
    }

    socket = null;
  }


  /*
   * Create a diagnostic instance ID.
   */
  socketConnectionCount++;

  currentSocketInstanceId =
    `SKVIBEZ-${socketConnectionCount}-${Date.now()}`;

  console.log(
    "Creating Socket instance:",
    currentSocketInstanceId
  );


  console.log(
    "Connecting to Groic Socket..."
  );


  socket = io(SOCKET_URL, {
    /*
     * WebSocket only.
     *
     * Polling previously caused errors.
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
     * Engine.IO heartbeat configuration.
     */
    pingTimeout: 60000,
    pingInterval: 25000
  });


  /*
   * ========================================
   * MANAGER RECONNECT DIAGNOSTICS
   * ========================================
   */

  socket.io.on(
    "reconnect_attempt",
    (attempt) => {
      console.log(
        "Socket.IO reconnect attempt:",
        attempt
      );

      console.log(
        "Socket instance:",
        currentSocketInstanceId
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

      console.log(
        "Socket instance:",
        currentSocketInstanceId
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

      console.error(
        "Socket instance:",
        currentSocketInstanceId
      );
    }
  );


  socket.io.on(
    "reconnect_failed",
    () => {
      console.error(
        "Socket.IO reconnect failed."
      );

      console.error(
        "Socket instance:",
        currentSocketInstanceId
      );
    }
  );


  /*
   * ========================================
   * CONNECTED
   * ========================================
   */

  socket.on(
    "connect",
    () => {
      lastConnectedAt =
        Date.now();

      console.log(
        "Groic Socket connected."
      );

      console.log(
        "Socket ID:",
        socket.id
      );

      console.log(
        "Active Socket instance:",
        currentSocketInstanceId
      );

      console.log(
        "Socket.IO Manager active:",
        socket.active
      );


      attachEngineDiagnostics(
        socket,
        currentSocketInstanceId
      );


      if (!currentRoomUid) {
        console.log(
          "Room UID is missing."
        );

        return;
      }


      /*
       * Rejoin only after an actual
       * connection/reconnection.
       */
      socket.emit(
        "joinRoom",
        {
          roomUid:
            currentRoomUid,

          name:
            "SKVIBEZ",

          imageUrl:
            process.env.BOT_IMAGE_URL || "",

          isBot:
            false
        }
      );


      console.log(
        "Join room request sent."
      );

      console.log(
        "Room UID:",
        currentRoomUid
      );

      console.log(
        "Socket instance:",
        currentSocketInstanceId
      );
    }
  );


  /*
   * ========================================
   * DISCONNECTED
   * ========================================
   */

  socket.on(
    "disconnect",
    (reason) => {
      lastDisconnectAt =
        Date.now();

      console.log(
        "Socket disconnected:",
        reason
      );

      console.log(
        "Socket instance:",
        currentSocketInstanceId
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
       * IMPORTANT:
       *
       * For transport close, DO NOT create
       * another socket.
       *
       * Socket.IO automatic reconnect
       * should reuse the same socket.
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

        console.log(
          "Automatic reconnect will handle recovery."
        );

        return;
      }


      /*
       * Server explicitly disconnected
       * the Socket.IO socket.
       *
       * In this case Socket.IO sets
       * socket.active = false.
       *
       * We recover using the SAME socket
       * instead of creating a new io().
       */
      if (
        reason ===
        "io server disconnect"
      ) {
        console.log(
          "Groic server disconnected SKVIBEZ."
        );

        console.log(
          "Attempting recovery using the same Socket.IO socket."
        );

        scheduleSameSocketReconnect();

        return;
      }


      /*
       * Other disconnect reasons.
       */
      console.log(
        "Disconnect reason:",
        reason
      );
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

      /*
       * Never print authentication
       * tokens.
       */
      if (error.data) {
        console.error(
          "Error data:",
          JSON.stringify(error.data)
        );
      }
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
      lastPresenceAt =
        Date.now();

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
   * SOCKET EVENT LOGGING
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
 * ENGINE DIAGNOSTICS
 * ========================================
 */

function attachEngineDiagnostics(
  socketInstance,
  instanceId
) {
  if (
    !socketInstance ||
    !socketInstance.io ||
    !socketInstance.io.engine
  ) {
    console.log(
      "Groic Engine is not available yet."
    );

    return;
  }


  const engine =
    socketInstance.io.engine;


  /*
   * Prevent duplicate listeners on the
   * same Engine instance.
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


  console.log(
    "Engine Socket instance:",
    instanceId
  );


  engine.on(
    "close",
    (reason) => {
      console.log(
        "Groic Engine closed:",
        reason
      );

      console.log(
        "Engine closed for Socket instance:",
        instanceId
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

      console.error(
        "Engine error for Socket instance:",
        instanceId
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


  const now =
    Date.now();


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
 * Never intentionally disconnect the
 * current socket during token refresh.
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
     * for future reconnection.
     */
    socket.auth = {
      Authorization:
        newToken
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
      "Groic Socket authentication updated."
    );


    console.log(
      "Token updated for Socket instance:",
      currentSocketInstanceId
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
          lastSyncAt =
            Date.now();


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
 * This watchdog DOES NOT create a new
 * socket while Socket.IO is already
 * reconnecting.
 */
function startConnectionWatchdog() {
  if (watchdogInterval) {
    clearInterval(
      watchdogInterval
    );
  }


  watchdogInterval =
    setInterval(
      () => {
        if (!socket) {
          console.log(
            "[Watchdog] Socket object missing."
          );

          return;
        }


        if (socket.connected) {
          console.log(
            "[Watchdog] Socket is connected."
          );

          return;
        }


        /*
         * Socket.IO is reconnecting.
         */
        if (socket.active) {
          console.log(
            "[Watchdog] Socket.IO is reconnecting..."
          );

          return;
        }


        /*
         * Socket is disconnected and
         * inactive.
         *
         * Reuse the SAME Socket.IO socket.
         */
        console.log(
          "[Watchdog] Socket inactive. Recovering same socket..."
        );


        scheduleSameSocketReconnect();

      },
      30000
    );


  console.log(
    "SKVIBEZ connection watchdog enabled."
  );
}


/*
 * ========================================
 * SAME SOCKET RECONNECT
 * ========================================
 *
 * IMPORTANT:
 *
 * Do NOT call io() here.
 * Do NOT create another Socket instance.
 *
 * Reuse the existing Socket.IO socket.
 */
function scheduleSameSocketReconnect() {
  if (reconnectTimer) {
    return;
  }


  reconnectTimer =
    setTimeout(
      () => {
        reconnectTimer =
          null;


        if (!socket) {
          console.log(
            "No existing socket available for recovery."
          );

          try {
            connect();
          } catch (error) {
            console.error(
              "New socket recovery failed:",
              error.message
            );

            scheduleSameSocketReconnect();
          }

          return;
        }


        if (socket.connected) {
          console.log(
            "Socket already connected. Recovery cancelled."
          );

          return;
        }


        if (socket.active) {
          console.log(
            "Socket.IO is already reconnecting."
          );

          return;
        }


        console.log(
          "Recovering existing Socket.IO socket..."
        );


        try {
          /*
           * Reuse the SAME Socket.IO socket.
           */
          socket.connect();

          console.log(
            "Same Socket.IO socket reconnect requested."
          );

        } catch (error) {
          console.error(
            "Same-socket recovery failed:",
            error.message
          );

          /*
           * Only if the existing socket itself
           * cannot recover do we create a fresh
           * socket as a last resort.
           */
          try {
            console.log(
              "Falling back to new Socket instance."
            );

            socket.removeAllListeners();
            socket.disconnect();

          } catch (cleanupError) {
            console.log(
              "Socket cleanup:",
              cleanupError.message
            );
          }


          socket = null;


          try {
            connect();
          } catch (connectError) {
            console.error(
              "Fallback socket creation failed:",
              connectError.message
            );

            scheduleSameSocketReconnect();
          }
        }

      },
      5000
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
