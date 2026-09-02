const { refreshAccessToken } = require("./auth");
const { createRoom } = require("./api");
const { connectSocket } = require("./socket");

const {
  ROOM_NAME,
  BOT_NAME
} = require("./config/env");

async function startBot() {
  try {
    console.log("================================");
    console.log("SKVIBEZ Groic Bot Starting...");
    console.log("================================");

    // Step 1: Firebase authentication
    await refreshAccessToken();

    // Step 2: Create Groic room
    const roomUid = await createRoom();

    console.log("");
    console.log("Room created successfully!");
    console.log("Room Name:", ROOM_NAME);
    console.log("Bot Name:", BOT_NAME);
    console.log("Room UID:", roomUid);

    console.log("");
    console.log(
      `Room Link: https://groic.in/room/${roomUid}?autoJoin=true`
    );

    // Step 3: Connect bot to the room
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
