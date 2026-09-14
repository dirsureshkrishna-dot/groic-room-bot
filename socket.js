"us strict";

const { io } = require("socket.io-client");

const {
  getToken,
  onTokenRefresh
} = require("./auth");

const SOCKET_URL =
  "https://socket-v2.groic.in";

const BOT_NAME =
  "SK VIBEZ";

let socket = null;
let currentRoomUid = null;

let keepAliveInterval = null;
let connectionWatchdog = null;

let recoveryTimer = null;
let recoveryInProgress = false;

let activeParticipants =
  new Set();

/*
 * Prevent duplicate Welcome messages.
 */
const welcomeCooldown =
  new Map();

/*
 * Connection state.
 */
let lastConnectedAt = 0;
let lastPresenceAt = 0;


/*
 * ============================================================
 * SEND CHAT
 * ============================================================
 */

function sendChat(message) {
  const text =
    String(message || "").trim();

  if (!text) {
    return false;
  }

  if (
    !socket ||
    !socket.connected
  ) {
    console.log(
      "[SKVIBEZ] Cannot send chat: socket is not connected."
    );

    return false;
  }

  try {
    socket.emit(
      "sendChat",
      {
        message: text
      }
    );

    console.log(
      "[SKVIBEZ] Welcome sent:",
      text
    );

    return true;

  } catch (error) {
    console.error(
      "[SKVIBEZ] sendChat failed:",
      error?.message || error
    );

    return false;
  }
}


/*
 * ============================================================
 * CONNECT SKVIBEZ
 * ============================================================
 */

function connectSocket(roomUid) {
  if (!roomUid) {
    throw new Error(
      "Room UID is missing."
    );
  }

  /*
   * Reset participant tracking
   * only when room changes.
   */
  if (
    currentRoomUid !== roomUid
  ) {
    activeParticipants =
      new Set();

    welcomeCooldown.clear();
  }

  currentRoomUid =
    roomUid;


  /*
   * Existing healthy socket.
   */
  if (
    socket &&
    socket.connected
  ) {
    console.log(
      "[SKVIBEZ] Socket is already connected."
    );

    startKeepAlive();
    startConnectionWatchdog();

    return socket;
  }


  /*
   * Existing disconnected socket.
   * Recover SAME socket.
   */
  if (
    socket &&
    !socket.connected &&
    socket.active === false
  ) {
    console.log(
      "[SKVIBEZ] Existing Socket.IO socket found."
    );

    recoverSameSocket();

    startKeepAlive();
    startConnectionWatchdog();

    return socket;
  }


  /*
   * First connection.
   */
  if (!socket) {
    createSocket();
  }

  startKeepAlive();
  startConnectionWatchdog();

  return socket;
}


/*
 * ============================================================
 * CREATE SOCKET
 * ============================================================
 */

function createSocket() {
  const token =
    getToken();

  if (!token) {
    throw new Error(
      "Authentication token is missing."
    );
  }

  console.log(
    "[SKVIBEZ] Creating Socket.IO instance..."
  );


  socket =
    io(
      SOCKET_URL,
      {
        transports: [
          "websocket"
        ],

        auth: {
          Authorization:
            token
        },

        extraHeaders: {
          Origin:
            "https://groic.in",

          Referer:
            "https://groic.in/",

          Authorization:
            token,

          "x-app-version":
            "web",

          "x-device-type":
            "web"
        },

        reconnection:
          true,

        reconnectionAttempts:
          Infinity,

        reconnectionDelay:
          3000,

        reconnectionDelayMax:
          10000,

        timeout:
          30000,

        pingTimeout:
          60000,

        pingInterval:
          25000
      }
    );


  console.log(
    "[SKVIBEZ] Socket.IO instance created."
  );


  /*
   * ==========================================================
   * MANAGER EVENTS
   * ==========================================================
   */

  socket.io.on(
    "reconnect_attempt",
    (attempt) => {
      console.log(
        "[SKVIBEZ] Reconnect attempt:",
        attempt
      );
    }
  );


  socket.io.on(
    "reconnect",
    (attempt) => {
      console.log(
        "[SKVIBEZ] Reconnected after attempts:",
        attempt
      );
    }
  );


  socket.io.on(
    "reconnect_error",
    (error) => {
      console.error(
        "[SKVIBEZ] Reconnect error:",
        error?.message ||
        error
      );
    }
  );


  socket.io.on(
    "reconnect_failed",
    () => {
      console.error(
        "[SKVIBEZ] Reconnect failed."
      );
    }
  );


  /*
   * ==========================================================
   * CONNECT
   * ==========================================================
   */

  socket.on(
    "connect",
    () => {
      lastConnectedAt =
        Date.now();

      recoveryInProgress =
        false;

      console.log(
        "[SKVIBEZ] Groic Socket connected."
      );

      console.log(
        "[SKVIBEZ] Socket ID:",
        socket.id
      );

      console.log(
        "[SKVIBEZ] Socket active:",
        socket.active
      );


      if (!currentRoomUid) {
        console.log(
          "[SKVIBEZ] Room UID is missing."
        );

        return;
      }


      /*
       * Join SAME room.
       */
      socket.emit(
        "joinRoom",
        {
          roomUid:
            currentRoomUid,

          name:
            BOT_NAME,

          imageUrl:
            process.env.BOT_IMAGE_URL ||
            "",

          isBot:
            false
        }
      );


      console.log(
        "[SKVIBEZ] Join room request sent."
      );

      console.log(
        "[SKVIBEZ] Room UID:",
        currentRoomUid
      );

      /*
       * IMPORTANT:
       *
       * NO humanBehavior.
       * NO chatBehavior.
       * NO AI.
       * NO idle chat.
       *
       * SK VIBEZ is Welcome-only.
       */
    }
  );


  /*
   * ==========================================================
   * DISCONNECT
   * ==========================================================
   */

  socket.on(
    "disconnect",
    (reason) => {
      console.log(
        "[SKVIBEZ] Socket disconnected:",
        reason
      );

      console.log(
        "[SKVIBEZ] Socket active:",
        socket.active
      );

      console.log(
        "[SKVIBEZ] Socket connected:",
        socket.connected
      );

      console.log(
        "[SKVIBEZ] Socket ID:",
        socket.id
      );


      /*
       * Transport close.
       */
      if (
        reason ===
        "transport close"
      ) {
        console.log(
          "[SKVIBEZ] Transport closed."
        );

        console.log(
          "[SKVIBEZ] Keeping same Socket.IO instance."
        );

        return;
      }


      /*
       * Server disconnect.
       */
      if (
        reason ===
        "io server disconnect"
      ) {
        console.log(
          "[SKVIBEZ] Groic server disconnected."
        );

        console.log(
          "[SKVIBEZ] Recovering same socket."
        );

        scheduleSameSocketRecovery();

        return;
      }


      console.log(
        "[SKVIBEZ] Unexpected disconnect."
      );
    }
  );


  /*
   * ==========================================================
   * CONNECTION ERROR
   * ==========================================================
   */

  socket.on(
    "connect_error",
    (error) => {
      console.error(
        "[SKVIBEZ] Socket connection error."
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
          JSON.stringify(
            error.data
          )
        );
      }


      const errorMessage =
        String(
          error?.message || ""
        ).toLowerCase();


      if (
        errorMessage.includes(
          "unauthorized"
        )
      ) {
        console.log(
          "[SKVIBEZ] Authorization error detected."
        );

        scheduleSameSocketRecovery();
      }
    }
  );


  /*
   * ==========================================================
   * PRESENCE UPDATE
   *
   * ONLY purpose:
   * Detect new users and send Welcome.
   *
   * NO CHAT REPLY.
   * ==========================================================
   */

  socket.on(
    "presenceUpdate",
    (data) => {
      lastPresenceAt =
        Date.now();

      console.log(
        "[SKVIBEZ] Presence update received."
      );


      const users =
        data?.activeUsers ||
        data?.[0]?.activeUsers ||
        [];


      if (
        !Array.isArray(users)
      ) {
        return;
      }


      const currentParticipants =
        new Set();


      for (
        const user of users
      ) {
        const username =
          String(
            user?.username || ""
          ).trim();


        const participantName =
          String(
            user?.name ||
            username
          ).trim();


        if (!username) {
          continue;
        }


        const normalizedUsername =
          username.toLowerCase();


        /*
         * Protected bot accounts.
         *
         * Never send Welcome to bots.
         */
        const protectedBots =
          new Set([
            "skvibez",
            "groic_explore",
            "groicai",
            "groic_music"
          ]);


        currentParticipants.add(
          normalizedUsername
        );


        if (
          protectedBots.has(
            normalizedUsername
          )
        ) {
          console.log(
            "[SKVIBEZ] Welcome skipped (protected bot):",
            participantName
          );

          continue;
        }


        /*
         * New normal participant.
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
   * ==========================================================
   * CHAT EVENT
   *
   * IMPORTANT:
   *
   * We intentionally DO NOTHING here.
   *
   * This means:
   *
   * skvibez hi       -> NO reply
   * skvibez saptiya  -> NO reply
   * normal chat      -> NO reply
   * !play            -> NO reply
   * ==========================================================
   */

  socket.on(
    "chat",
    (data) => {
      console.log(
        "[SKVIBEZ] Room chat observed."
      );

      /*
       * Intentionally no reply.
       */
    }
  );


  /*
   * ==========================================================
   * SOCKET EVENT DIAGNOSTICS
   * ==========================================================
   */

  socket.onAny(
    (event, ...args) => {
      console.log(
        "[SKVIBEZ] Socket Event:",
        event
      );

      /*
       * Do not print chat payloads unnecessarily.
       */
      if (
        event !== "chat" &&
        args.length > 0
      ) {
        console.log(
          "[SKVIBEZ] Socket Data:",
          JSON.stringify(args)
        );
      }
    }
  );


  /*
   * ==========================================================
   * ENGINE DIAGNOSTICS
   * ==========================================================
   */

  attachEngineDiagnostics();
}


/*
 * ============================================================
 * WELCOME MESSAGE
 * ============================================================
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
    String(
      username
    ).toLowerCase();


  /*
   * Protected accounts.
   */
  const protectedBots =
    new Set([
      "skvibez",
      "groic_explore",
      "groicai",
      "groic_music"
    ]);


  if (
    protectedBots.has(
      normalizedUsername
    )
  ) {
    console.log(
      "[SKVIBEZ] Welcome skipped (protected account):",
      participantName
    );

    return;
  }


  /*
   * Duplicate protection.
   */
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
      "[SKVIBEZ] Welcome skipped (duplicate):",
      participantName
    );

    return;
  }


  welcomeCooldown.set(
    normalizedUsername,
    now
  );


  /*
   * EXISTING WELCOME MESSAGE.
   *
   * DO NOT CHANGE.
   */
  const welcomeMessage =
    `🎶 Welcome to yesherif world 🎼, ${participantName}`;


  console.log(
    "[SKVIBEZ] Sending welcome message:",
    welcomeMessage
  );


  sendChat(
    welcomeMessage
  );
}


/*
 * ============================================================
 * TOKEN REFRESH
 * ============================================================
 *
 * NEVER intentionally disconnect the socket.
 * ============================================================
 */

onTokenRefresh(
  async (newToken) => {
    console.log(
      "[SKVIBEZ] New token received."
    );


    if (!newToken) {
      console.log(
        "[SKVIBEZ] Empty token received."
      );

      return;
    }


    if (!socket) {
      console.log(
        "[SKVIBEZ] Socket does not exist."
      );

      return;
    }


    /*
     * Update Socket.IO authentication.
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
        socket.io.opts
          .extraHeaders
          .Authorization =
          newToken;
      }


      if (
        socket.io.opts.auth
      ) {
        socket.io.opts.auth
          .Authorization =
          newToken;
      }
    }


    console.log(
      "[SKVIBEZ] Socket authentication updated."
    );


    /*
     * IMPORTANT:
     *
     * No disconnect().
     * No connect().
     */
  }
);


/*
 * ============================================================
 * SAME SOCKET RECOVERY
 * ============================================================
 */

function recoverSameSocket() {
  if (!socket) {
    console.log(
      "[SKVIBEZ] No existing socket."
    );

    return;
  }


  if (
    socket.connected
  ) {
    console.log(
      "[SKVIBEZ] Socket already connected."
    );

    return;
  }


  if (
    recoveryInProgress
  ) {
    console.log(
      "[SKVIBEZ] Recovery already in progress."
    );

    return;
  }


  recoveryInProgress =
    true;


  console.log(
    "[SKVIBEZ] Recovering existing Socket.IO socket..."
  );


  try {
    socket.connect();

    console.log(
      "[SKVIBEZ] Same socket reconnect requested."
    );

  } catch (error) {

    recoveryInProgress =
      false;

    console.error(
      "[SKVIBEZ] Same socket recovery failed:",
      error?.message ||
      error
    );

    scheduleSameSocketRecovery();
  }
}


/*
 * ============================================================
 * SCHEDULE RECOVERY
 * ============================================================
 */

function scheduleSameSocketRecovery() {
  if (
    recoveryTimer
  ) {
    return;
  }


  recoveryTimer =
    setTimeout(
      () => {

        recoveryTimer =
          null;


        if (!socket) {
          console.log(
            "[SKVIBEZ] Socket does not exist."
          );

          return;
        }


        if (
          socket.connected
        ) {
          console.log(
            "[SKVIBEZ] Socket already recovered."
          );

          recoveryInProgress =
            false;

          return;
        }


        recoverSameSocket();

      },
      5000
    );
}


/*
 * ============================================================
 * ENGINE DIAGNOSTICS
 * ============================================================
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


  if (
    engine.__skvibezDiagnosticsAttached
  ) {
    return;
  }


  engine.__skvibezDiagnosticsAttached =
    true;


  console.log(
    "[SKVIBEZ] Groic Engine diagnostics enabled."
  );


  engine.on(
    "close",
    (reason) => {
      console.log(
        "[SKVIBEZ] Groic Engine closed:",
        reason
      );
    }
  );


  engine.on(
    "error",
    (error) => {
      console.error(
        "[SKVIBEZ] Groic Engine error:",
        error?.message ||
        error
      );
    }
  );
}


/*
 * ============================================================
 * KEEP ALIVE
 * ============================================================
 */

function startKeepAlive() {
  if (
    keepAliveInterval
  ) {
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
            "[SKVIBEZ] Sending Groic room sync..."
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
    "[SKVIBEZ] 10-second keep-alive enabled."
  );
}


/*
 * ============================================================
 * CONNECTION WATCHDOG
 * ============================================================
 */

function startConnectionWatchdog() {
  if (
    connectionWatchdog
  ) {
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


        if (
          socket.connected
        ) {
          console.log(
            "[SKVIBEZ Watchdog] Socket is connected."
          );

          return;
        }


        console.log(
          "[SKVIBEZ Watchdog] Socket is disconnected."
        );


        console.log(
          "[SKVIBEZ Watchdog] Socket active:",
          socket.active
        );


        /*
         * Socket.IO is already reconnecting.
         */
        if (
          socket.active
        ) {
          console.log(
            "[SKVIBEZ Watchdog] Socket.IO is reconnecting..."
          );

          return;
        }


        /*
         * Manager inactive.
         */
        console.log(
          "[SKVIBEZ Watchdog] Starting same-socket recovery..."
        );


        scheduleSameSocketRecovery();

      },
      15000
    );


  console.log(
    "[SKVIBEZ] Connection watchdog enabled."
  );
}


/*
 * ============================================================
 * GET SOCKET
 * ============================================================
 */

function getSocket() {
  return socket;
}


/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */

module.exports = {
  connectSocket,
  getSocket
};
