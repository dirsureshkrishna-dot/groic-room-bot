const {
  refreshAccessToken,
  startTokenRefresh
} = require("./auth");

const {
  connectSocket,
  getSocket
} = require("./socket");

const {
  inspectRoomTheme
} = require("./roomTheme");

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

    await refreshAccessToken();

    startTokenRefresh();

    const roomUid =
      process.env.ROOM_UID;

    if (!roomUid) {
      throw new Error(
        "ROOM_UID is missing from Railway Variables."
      );
    }

    console.log("");
    console.log("Using YESKING room.");
    console.log("Room UID:", roomUid);
    console.log("Bot Name:", BOT_NAME);

    console.log("");
    console.log(
      `Room Link: https://groic.in/room/${roomUid}?autoJoin=true`
    );

    // --------------------------------
    // Inspect room theme / appearance
    // --------------------------------

    console.log("");
    console.log(
      "Inspecting Groic room theme..."
    );

    try {

      await inspectRoomTheme(roomUid);

      console.log(
        "Room theme inspection completed."
      );

    } catch (error) {

      console.error(
        "Room theme inspection failed:"
      );

      console.error(
        error.response?.data ||
        error.message
      );

      console.log(
        "Continuing SKVIBEZ bot normally..."
      );
    }

    // --------------------------------
    // Connect SKVIBEZ
    // --------------------------------

    connectSocket(roomUid);

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


// --------------------------------
// Connection watchdog
// --------------------------------

function startWatchdog() {

  if (watchdogTimer) {
    clearInterval(
      watchdogTimer
    );
  }

  watchdogTimer =
    setInterval(
      () => {

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

          if (socket.active) {

            console.log(
              "[Watchdog] Socket is reconnecting..."
            );

            return;
          }

          console.log(
            "[Watchdog] Socket disconnected and not reconnecting."
          );

          const roomUid =
            process.env.ROOM_UID;

          if (roomUid) {

            console.log(
              "[Watchdog] Attempting socket recovery..."
            );

            connectSocket(
              roomUid
            );

          }

        } catch (error) {

          console.error(
            "[Watchdog] Recovery error:",
            error.message
          );

        }

      },
      30000
    );

  console.log(
    "SKVIBEZ connection watchdog enabled."
  );
}

startBot();
