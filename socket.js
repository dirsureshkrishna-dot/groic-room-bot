"use strict";

const { io } = require("socket.io-client");

const {
  getToken,
  onTokenRefresh
} = require("./auth");

const { searchYouTube } = require("./music");

const {
  handleMessage,
  startIdleBehavior,
  stopIdleBehavior
} = require("./humanBehavior");

const {
  generateReply
} = require("./chatBehavior");


const SOCKET_URL =
  "https://socket-v2.groic.in";


const BOT_NAME = "SK VIBEZ";
const BOT_USERNAME = "skvibez";


let socket = null;
let currentRoomUid = null;

let keepAliveInterval = null;
let connectionWatchdog = null;

let recoveryTimer = null;
let recoveryInProgress = false;

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
 * SEND CHAT
 * ========================================
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
      "[SKVIBEZ] Chat sent:",
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

    startHumanBehavior();

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
    "Creating SKVIBEZ Socket.IO instance..."
  );


  socket =
    io(
      SOCKET_URL,
      {
        transports: [
          "websocket"
        ],

        /*
         * Authentication.
         */
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


        /*
         * Automatic reconnect.
         */
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


        /*
         * Engine heartbeat.
         */
        pingTimeout:
          60000,

        pingInterval:
          25000
      }
    );


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
        error?.message ||
        error
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
      lastConnectedAt =
        Date.now();

      recoveryInProgress =
        false;


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
       * Rejoin the SAME room.
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
        "Join room request sent."
      );


      console.log(
        "Room UID:",
        currentRoomUid
      );


      /*
       * Start human chat behavior.
       */
      startHumanBehavior();
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
       * Stop idle chat while disconnected.
       */
      stopIdleBehavior();


      /*
       * Transport close.
       *
       * Socket.IO normally reconnects.
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


        return;
      }


      /*
       * Server explicitly closed socket.
       *
       * Recover SAME socket.
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


      /*
       * Authentication/session error.
       */
      if (
        String(
          error?.message || ""
        )
          .toLowerCase()
          .includes(
            "unauthorized"
          )
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
          user?.username ||
          "";


        const participantName =
          user?.name ||
          username;


        if (!username) {
          continue;
        }


        const normalizedUsername =
          username.toLowerCase();


        /*
         * Protected bot accounts.
         *
         * Never welcome these bots.
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
          currentParticipants.add(
            normalizedUsername
          );


          console.log(
            "Welcome skipped (protected bot):",
            participantName
          );


          continue;
        }


        currentParticipants.add(
          normalizedUsername
        );


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
        String(message)
          .toLowerCase()
          .trim();


      /*
       * ====================================
       * !PLAY
       * ====================================
       *
       * Music command remains separate.
       *
       * We return after handling !play,
       * so the AI does not randomly reply
       * to the command itself.
       */

      if (
        normalizedMessage.startsWith(
          "!play "
        )
      ) {
        const query =
          String(message)
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
            error?.response?.data ||
            error?.message ||
            error
          );
        }


        return;
      }


      /*
       * ====================================
       * HUMAN BEHAVIOR
       * ====================================
       *
       * Every normal room chat message
       * reaches humanBehavior.
       *
       * humanBehavior decides:
       *
       * - Direct SK VIBEZ mention
       * - Casual participation
       * - Ignore
       *
       * Duplicate protection happens
       * before AI generation.
       */

      try {
        const result =
          await handleMessage(
            data,
            {
              botName:
                BOT_NAME,

              botUsername:
                BOT_USERNAME,


              /*
               * AI/context reply.
               */
              generateReply:
                async ({
                  message: incomingMessage,
                  reason
                }) => {

                  return generateReply({
                    message:
                      incomingMessage,

                    reason
                  });
                },


              /*
               * Actual Groic chat sender.
               */
              sendReply:
                async (reply) => {
                  return sendChat(
                    reply
                  );
                },


              /*
               * Typing events are intentionally
               * not supplied because the Groic
               * typing event name has not been
               * verified.
               */
              startTyping:
                undefined,

              stopTyping:
                undefined
            }
          );


        if (
          result?.replied
        ) {
          console.log(
            "[SKVIBEZ HumanBehavior] Reply completed:",
            result.reason
          );
        }

      } catch (error) {
        /*
         * Human behavior must NEVER crash
         * the socket.
         */
        console.error(
          "[SKVIBEZ HumanBehavior] Chat handling error:",
          error?.message ||
          error
        );
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


      if (
        args.length > 0
      ) {
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
 * START HUMAN BEHAVIOR
 * ========================================
 */
function startHumanBehavior() {
  try {

    startIdleBehavior({
      sendReply:
        async (message) => {
          return sendChat(
            message
          );
        },

      startTyping:
        undefined,

      stopTyping:
        undefined
    });

  } catch (error) {

    console.error(
      "[SKVIBEZ HumanBehavior] Start failed:",
      error?.message ||
      error
    );
  }
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


  if (
    socket.connected
  ) {
    console.log(
      "Socket already connected."
    );

    return;
  }


  if (
    recoveryInProgress
  ) {
    console.log(
      "Socket recovery already in progress."
    );

    return;
  }


  recoveryInProgress =
    true;


  console.log(
    "Recovering existing Socket.IO socket..."
  );


  try {

    /*
     * IMPORTANT:
     *
     * Reconnect SAME socket.
     *
     * Do NOT call io() again.
     */
    socket.connect();


    console.log(
      "Same Socket.IO socket reconnect requested."
    );

  } catch (error) {

    recoveryInProgress =
      false;


    console.error(
      "Same socket recovery failed:",
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
            "Socket does not exist."
          );

          return;
        }


        if (
          socket.connected
        ) {
          console.log(
            "Socket already recovered."
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
   * Avoid duplicate listeners.
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
      "Welcome skipped (protected account):",
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
      "Welcome skipped (duplicate):",
      participantName
    );

    return;
  }


  welcomeCooldown.set(
    normalizedUsername,
    now
  );


  /*
   * EXISTING WELCOME MESSAGE
   *
   * Do not change.
   */
  const welcomeMessage =
    `🎶 Welcome to Skvibez 🎼, ${participantName}`;


  console.log(
    "Sending welcome message:",
    welcomeMessage
  );


  sendChat(
    welcomeMessage
  );
}


/*
 * ========================================
 * TOKEN REFRESH
 * ========================================
 *
 * IMPORTANT:
 *
 * NEVER intentionally disconnect
 * the existing socket here.
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
     * Update current Socket.IO auth.
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
        socket.io.opts
          .extraHeaders
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
     * Current connection remains untouched.
     */
  }
);


/*
 * ========================================
 * KEEP ALIVE
 * ========================================
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
         * Socket.IO is already attempting
         * reconnection.
         */
        if (
          socket.active
        ) {

          console.log(
            "[Watchdog] Socket.IO is reconnecting..."
          );

          return;
        }


        /*
         * Manager inactive.
         *
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
