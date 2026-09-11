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
} = require("./core/humanBehavior");

const {
  generateReply
} = require("./core/chatBehavior");


/*
 * ========================================
 * CONFIG
 * ========================================
 */

const SOCKET_URL =
  "https://socket-v2.groic.in";

const BOT_NAME =
  "SK VIBEZ";

const BOT_USERNAME =
  "skvibez";


/*
 * ========================================
 * SOCKET STATE
 * ========================================
 */

let socket = null;

let currentRoomUid = null;

let keepAliveInterval = null;

let connectionWatchdog = null;

let recoveryTimer = null;

let recoveryInProgress = false;

let activeParticipants =
  new Set();


/*
 * ========================================
 * WELCOME STATE
 * ========================================
 */

const welcomeCooldown =
  new Map();


/*
 * ========================================
 * CONNECTION STATE
 * ========================================
 */

let lastConnectedAt = 0;

let lastPresenceAt = 0;


/*
 * ========================================
 * SEND CHAT
 * ========================================
 *
 * All SK VIBEZ messages go through
 * this function.
 * ========================================
 */

function sendChat(message) {

  const text =
    String(message || "").trim();

  if (!text) {

    console.log(
      "[SKVIBEZ] Empty chat ignored."
    );

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

    console.log(
      "[SKVIBEZ] Sending chat:",
      text
    );


    socket.emit(
      "sendChat",
      {
        message: text
      }
    );


    console.log(
      "[SKVIBEZ] Chat sent successfully:",
      text
    );


    return true;

  } catch (error) {

    console.error(
      "[SKVIBEZ] sendChat failed:",
      error?.message ||
      error
    );

    return false;
  }
}


/*
 * ========================================
 * NORMALIZE CHAT DATA
 * ========================================
 *
 * Groic may provide chat data as:
 *
 * 1. object
 * 2. [object]
 *
 * HumanBehavior expects the actual
 * message object.
 * ========================================
 */

function normalizeChatData(data) {

  if (
    Array.isArray(data)
  ) {

    if (
      data.length === 0
    ) {
      return null;
    }


    return data[0];
  }


  if (
    data &&
    typeof data === "object"
  ) {
    return data;
  }


  return null;
}


/*
 * ========================================
 * CONNECT SKVIBEZ
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
   * changing rooms.
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

    startHumanBehavior();


    return socket;
  }


  /*
   * Existing disconnected socket.
   *
   * Recover the SAME socket.
   */
  if (
    socket &&
    !socket.connected &&
    socket.active === false
  ) {

    console.log(
      "[SKVIBEZ] Existing Socket.IO socket found."
    );


    console.log(
      "[SKVIBEZ] Recovering existing socket..."
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
    "[SKVIBEZ] Creating Socket.IO instance..."
  );


  socket =
    io(
      SOCKET_URL,
      {

        transports: [
          "websocket"
        ],


        /*
         * Firebase token.
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
         * Reconnection.
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
    "[SKVIBEZ] Socket.IO instance created."
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
       * Rejoin room.
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
       * Start human behavior.
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
       * Stop idle chat while offline.
       */
      stopIdleBehavior();


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
       * Server-side disconnect.
       */
      if (
        reason ===
        "io server disconnect"
      ) {

        console.log(
          "[SKVIBEZ] Groic server disconnected the bot."
        );


        console.log(
          "[SKVIBEZ] Scheduling same-socket recovery."
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
   * ======================================
   * CONNECTION ERROR
   * ======================================
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
          "[SKVIBEZ] Authorization error detected."
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
        "[SKVIBEZ] Presence update:",
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


      const protectedBots =
        new Set([
          "skvibez",
          "groic_explore",
          "groicai",
          "groic_music"
        ]);


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
          username
            .toLowerCase();


        currentParticipants.add(
          normalizedUsername
        );


        /*
         * Never welcome bots.
         */
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
        "[SKVIBEZ] Chat event received."
      );


      console.log(
        "[SKVIBEZ] Raw chat data:",
        JSON.stringify(data)
      );


      /*
       * Normalize object/array payload.
       */
      const chatData =
        normalizeChatData(
          data
        );


      if (!chatData) {

        console.log(
          "[SKVIBEZ] Chat payload could not be normalized."
        );

        return;
      }


      const message =
        String(
          chatData?.message ||
          chatData?.text ||
          chatData?.content ||
          ""
        ).trim();


      if (!message) {

        console.log(
          "[SKVIBEZ] Chat message text is empty."
        );

        return;
      }


      console.log(
        "[SKVIBEZ] Incoming message:",
        message
      );


      const normalizedMessage =
        message
          .toLowerCase()
          .trim();


      /*
       * ====================================
       * !PLAY
       * ====================================
       *
       * Keep existing music behavior.
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
            "[SKVIBEZ] YouTube search:",
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
              "[SKVIBEZ] YouTube result found:",
              results[0].title
            );


            /*
             * Groic handles playback.
             */
          }

        } catch (error) {

          console.error(
            "[SKVIBEZ] YouTube search failed:",
            error?.response?.data ||
            error?.message ||
            error
          );
        }


        /*
         * Do not send AI reply to !play.
         */
        return;
      }


      /*
       * ====================================
       * HUMAN BEHAVIOR
       * ====================================
       */

      try {

        console.log(
          "[SKVIBEZ HumanBehavior] Processing room message..."
        );


        const result =
          await handleMessage(
            chatData,
            {

              botName:
                BOT_NAME,

              botUsername:
                BOT_USERNAME,


              /*
               * AI reply generator.
               */
              generateReply:
                async ({
                  message:
                    incomingMessage,

                  reason,

                  sender
                }) => {

                  console.log(
                    "[SKVIBEZ AI] Generating reply..."
                  );


                  console.log(
                    "[SKVIBEZ AI] Reason:",
                    reason
                  );


                  console.log(
                    "[SKVIBEZ AI] Incoming:",
                    incomingMessage?.message ||
                    incomingMessage?.text ||
                    ""
                  );


                  const reply =
                    await generateReply({
                      message:
                        incomingMessage,

                      reason,

                      sender:
                        sender ||
                        incomingMessage?.user?.username ||
                        incomingMessage?.username ||
                        ""
                    });


                  console.log(
                    "[SKVIBEZ AI] Generated reply:",
                    reply
                  );


                  return reply;
                },


              /*
               * Actual Groic sender.
               */
              sendReply:
                async (reply) => {

                  console.log(
                    "[SKVIBEZ HumanBehavior] sendReply called."
                  );


                  console.log(
                    "[SKVIBEZ HumanBehavior] Reply:",
                    reply
                  );


                  const sent =
                    sendChat(
                      reply
                    );


                  console.log(
                    "[SKVIBEZ HumanBehavior] sendChat result:",
                    sent
                  );


                  return sent;
                },


              /*
               * Groic typing event is not
               * verified, so intentionally
               * disabled.
               */
              startTyping:
                undefined,

              stopTyping:
                undefined
            }
          );


        console.log(
          "[SKVIBEZ HumanBehavior] Result:",
          JSON.stringify(
            result
          )
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

        console.error(
          "[SKVIBEZ HumanBehavior] Chat handling error:",
          error?.stack ||
          error?.message ||
          error
        );
      }
    }
  );


  /*
   * ======================================
   * SOCKET EVENT DIAGNOSTICS
   * ======================================
   */

  socket.onAny(
    (event, ...args) => {

      console.log(
        "[SKVIBEZ] Socket Event:",
        event
      );


      if (
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

          console.log(
            "[SKVIBEZ HumanBehavior] Idle message:"
          );


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
    "[SKVIBEZ] Recovering SAME Socket.IO socket..."
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
 * ========================================
 * SCHEDULE RECOVERY
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
    `🎶 Welcome to Skvibez 🎼, ${participantName}`;


  console.log(
    "[SKVIBEZ] Sending welcome message:",
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
 * Do NOT disconnect the socket.
 * ========================================
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
        "[SKVIBEZ] Socket does not exist yet."
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
    "[SKVIBEZ] Groic 10-second keep-alive enabled."
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
         * Socket.IO reconnecting.
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
