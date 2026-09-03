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
 * ========================================
 * SOCKET DIAGNOSTICS
 * ========================================
 *
 * Never log tokens or secrets.
 */
let socketConnectionCount = 0;
let currentSocketInstanceId = null;


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
  if (!roomUid) {
    throw new Error(
      "Room UID is missing."
    );
  }

  /*
   * Only reset participant tracking when
   * connecting to a different room.
   */
  if (currentRoomUid !== roomUid) {
    activeParticipants = new Set();
    welcomeCooldown.clear();
  }

  currentRoomUid = roomUid;

  /*
   * Never create another socket if the
   * existing socket is already connected.
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

    return socket;
  }

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
   * If an existing socket is already
   * connected, never replace it.
   */
  if (
    socket &&
    socket.connected
  ) {
    console.log(
      "Existing Groic Socket is already connected."
    );

    console.log(
      "Active Socket instance:",
      currentSocketInstanceId
    );

    return socket;
  }


  /*
   * Clean up an old disconnected socket
   * before creating a new one.
   */
  if (socket) {
    try {
      console.log(
        "Cleaning up old disconnected socket:",
        currentSocketInstanceId
      );

      socket.removeAllListeners();
      socket.disconnect();

    } catch (error) {
      console.log(
        "Old socket cleanup:",
        error.message
      );
    }

    socket = null;
  }


  /*
   * Create a new diagnostic instance ID.
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
     * Automatic reconnect.
     */
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 3000,
    reconnectionDelayMax: 10000,

    timeout: 30000,

    /*
     * Socket.IO heartbeat.
     */
    pingTimeout: 60000,
    pingInterval: 25000
  });


  /*
   * ========================================
   * SOCKET.IO MANAGER DIAGNOSTICS
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
   * SOCKET CONNECTED
   * ========================================
   */

  socket.on(
    "connect",
    () => {
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


      /*
       * Attach Engine diagnostics for
       * this socket connection.
       */
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
       * Join the current YESKING room.
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
      console.log(
        "Socket disconnected:",
        reason
      );

      console.log(
        "Socket instance at disconnect:",
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

      console.log(
        "Total Socket instances created:",
        socketConnectionCount
      );


      /*
       * Transport close.
       *
       * Socket.IO should automatically
       * reconnect.
       */
      if (
        reason ===
        "transport close"
      ) {
        console.log(
          "Transport closed."
        );

        console.log(
          "Socket.IO automatic reconnect will handle recovery."
        );

        return;
      }


      /*
       * Server explicitly disconnected us.
       */
      if (
        reason ===
        "io server disconnect"
      ) {
        console.log(
          "Groic server disconnected SKVIBEZ."
        );

        scheduleReconnect();

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

      console.error(
        "Socket instance:",
        currentSocketInstanceId
      );


      if (error.data) {
        console.error(
          "Error data:",
          JSON.stringify(
            error.data
          )
        );
      }


      if (error.response) {
        console.error(
          "Error response:",
          JSON.stringify(
            error.response
          )
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
 * ENGINE DIAGNOSTICS
 * ========================================
 *
 * Attached separately to each newly
 * created Socket.IO engine.
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
 * Do NOT call connect() here.
 *
 * Update authentication without
 * intentionally disconnecting the
 * current Socket.
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
 * RECONNECT
 * ========================================
 */

function scheduleReconnect() {
  if (reconnectTimer) {
    console.log(
      "Reconnect already scheduled."
    );

    return;
  }


  reconnectTimer =
    setTimeout(
      () => {
        reconnectTimer =
          null;


        console.log(
          "Attempting socket recovery..."
        );


        try {
          /*
           * Already connected.
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


          /*
           * Socket.IO is already actively
           * reconnecting.
           */
          if (
            socket &&
            socket.active
          ) {
            console.log(
              "Socket.IO is already reconnecting."
            );

            return;
          }


          /*
           * Create a new socket only when
           * the existing one is not active.
           */
          connect();

        } catch (error) {
          console.error(
            "Socket recovery failed:",
            error.message
          );

          scheduleReconnect();
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
