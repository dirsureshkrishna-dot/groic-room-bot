const {
  refreshAccessToken,
  startTokenRefresh
} = require("./auth");

const {
  connectSocket,
  getSocket
} = require("./socket");

const {
  BOT_NAME
} = require("./config/env");

let watchdogTimer = null;
let restarting = false;

async function startBot() {
  if (restarting) {
    return;
  }

  restarting = true;

  try {
    console.log("================================");
    console.log("SKVIBEZ Groic Bot Starting...");
    console.log("================================");

    /*
     * Initial authentication
     */
    await refreshAccessToken();

    /*
     * Automatic Firebase token refresh
     */
    startTokenRefresh();

    /*
     * Use the room created by YESKING
     */
    const roomUid =
      process.env.ROOM_UID;

    if (!roomUid) {
      throw new Error(
        "ROOM_UID is missing. Add the YESKING room UID in Railway Variables."
      );
    }

    console.log("");
    console.log(
      "Using YESKING room."
    );

    console.log(
      "Room UID:",
      roomUid
    );

    console.log(
      "Bot Name:",
      BOT_NAME
    );

    console.log("");

    console.log(
      `Room Link: https://groic.in/room/${roomUid}?autoJoin=true`
    );

    /*
     * Connect SKVIBEZ
     */
    connectSocket(roomUid);

    /*
     * Start connection watchdog
     */
    startWatchdog();

    console.log("");
    console.log(
      "SKVIBEZ bot is running."
    );

    console.log(
      "================================"
    );

  } catch (error) {
    console.error("");
    console.error(
      "SKVIBEZ bot failed to start."
    );

    console.error(
      error.response?.data ||
      error.message ||
      error
    );

  } finally {
    restarting = false;
  }
}

/*
 * ========================================
 * CONNECTION WATCHDOG
 * ========================================
 *
 * Check the Socket every 30 seconds.
 *
 * If Socket.IO is completely disconnected
 * and is not actively reconnecting, create
 * a new connection.
 */
function startWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
  }

  watchdogTimer =
    setInterval(() => {
      try {
        const socket =
          getSocket();

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
         * Socket.IO may already be trying
         * to reconnect.
         */
        if (socket.active) {
          console.log(
            "[Watchdog] Socket is reconnecting..."
          );

          return;
        }

        /*
         * Socket is disconnected and
         * Socket.IO is not reconnecting.
         */
        console.log(
          "[Watchdog] Socket disconnected and not reconnecting."
        );

        console.log(
          "[Watchdog] Attempting full socket recovery..."
        );

        const roomUid =
          process.env.ROOM_UID;

        if (roomUid) {
          connectSocket(roomUid);
        }

      } catch (error) {
        console.error(
          "[Watchdog] Recovery error:",
          error.message
        );
      }
    }, 30000);

  console.log(
    "SKVIBEZ connection watchdog enabled."
  );
}

startBot();
