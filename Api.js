const axios = require("axios");

const { getToken } = require("./auth");

const {
  ROOM_NAME,
  ROOM_DESC,
  ROOM_GENRE,
  MAX_PARTICIPANTS
} = require("./config/env");

const BASE_URL = "https://api.groic.in/api";

function getHeaders() {
  return {
    accept: "application/json, text/plain, */*",
    authorization: getToken(),
    "content-type": "application/json",
    origin: "https://groic.in",
    referer: "https://groic.in/"
  };
}

async function createRoom() {
  const payload = {
    roomName: ROOM_NAME,
    roomDesc: ROOM_DESC,
    roomGenre: ROOM_GENRE,
    roomCountry: "IN",
    maxParticipants: MAX_PARTICIPANTS
  };

  console.log("Creating Groic room...");
  console.log("Room Name:", ROOM_NAME);
  console.log("Room Genre:", ROOM_GENRE);
  console.log("Max Participants:", MAX_PARTICIPANTS);

  const response = await axios.post(
    `${BASE_URL}/room/`,
    payload,
    {
      headers: getHeaders(),
      timeout: 20000
    }
  );

  console.log(
    "Room response:",
    JSON.stringify(response.data, null, 2)
  );

  const room =
    response.data?.data ||
    response.data;

  const roomUid =
    room?.roomUid ||
    room?.uid ||
    room?.id;

  if (!roomUid) {
    throw new Error(
      "Room created, but Room UID was not found."
    );
  }

  console.log("Room UID:", roomUid);

  return roomUid;
}

async function getRoomDetails(roomUid) {
  const response = await axios.get(
    `${BASE_URL}/room/${roomUid}`,
    {
      headers: getHeaders(),
      timeout: 20000
    }
  );

  return response.data;
}

module.exports = {
  createRoom,
  getRoomDetails
};
