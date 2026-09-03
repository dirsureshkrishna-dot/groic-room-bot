const { refreshAccessToken } = require("./auth");
const { connectSocket } = require("./socket");

const {
  BOT_NAME
} = require("./config/env");

async function startBot() {
  try {
    console.log("================================");
    console.log("SKVIBEZ Groic Bot Starting...");
    console.log("================================");

    // Authenticate as SKVIBEZ
    await refreshAccessToken();

    // Use the room created by YESKING
    const roomUid = process.env.ROOM_UID;

    if (!roomUid) {
      throw new Error(
        "ROOM_UID is missing. Add the YESKING room UID in Railway Variables."
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

    // Connect SKVIBEZ to YESKING's room
    connectSocket(roomUid);

    console.log("");
    console.log("SKVIBEZ bot is running.");
    console.log("================================");

  } catch (error) {
    console.error("");
    console.error("SKVIBEZ bot failed to start.");

    console.error(
      error.response?.data ||
      error.message ||
      error
    );

    process.exit(1);
  }
}

startBot();
