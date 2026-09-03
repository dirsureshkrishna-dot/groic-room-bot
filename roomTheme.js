const axios = require("axios");

const { getToken } = require("./auth");

const BASE_URL =
  "https://api.groic.in/api";

async function inspectRoomTheme(roomUid) {
  if (!roomUid) {
    throw new Error(
      "Room UID is missing."
    );
  }

  const response =
    await axios.get(
      `${BASE_URL}/room/${roomUid}`,
      {
        headers: {
          accept:
            "application/json, text/plain, */*",
          authorization:
            getToken(),
          origin:
            "https://groic.in",
          referer:
            "https://groic.in/",
          "x-device-type":
            "android"
        },
        timeout: 30000,
        proxy: false,
        validateStatus:
          () => true
      }
    );

  console.log(
    "Groic Room Status:",
    response.status
  );

  const room =
    response.data?.data ||
    response.data;

  console.log(
    "Room theme/appearance fields:"
  );

  const possibleFields = [
    "color",
    "colour",
    "background",
    "backgroundColor",
    "backgroundColour",
    "theme",
    "themeColor",
    "themeColour",
    "accentColor",
    "roomColor",
    "roomColour",
    "roomBackground",
    "roomBackgroundColor",
    "cover",
    "coverImage",
    "coverUrl",
    "image",
    "imageUrl",
    "roomImage",
    "roomImageUrl",
    "gradient",
    "gradientColor",
    "appearance"
  ];

  let found = false;

  for (const field of possibleFields) {
    if (
      Object.prototype.hasOwnProperty.call(
        room || {},
        field
      )
    ) {
      console.log(
        `${field}:`,
        JSON.stringify(room[field])
      );

      found = true;
    }
  }

  if (!found) {
    console.log(
      "No room-specific colour/theme field found."
    );
  }

  return room;
}

module.exports = {
  inspectRoomTheme
};
