const axios = require("axios");

const { getToken } = require("./auth");

const {
  ROOM_NAME,
  ROOM_DESC,
  ROOM_GENRE,
  MAX_PARTICIPANTS,
  OWNER_USERNAME,
  USER_ID
} = require("./config/env");

const BASE_URL =
  "https://api.groic.in/api";


/*
 * ========================================
 * GROIC API HEADERS
 * ========================================
 */
function getHeaders() {
  return {
    accept:
      "application/json, text/plain, */*",

    authorization:
      getToken(),

    "content-type":
      "application/json",

    origin:
      "https://groic.in",

    referer:
      "https://groic.in/",

    "accept-language":
      "en-US,en;q=0.9",

    "cache-control":
      "no-cache",

    pragma:
      "no-cache",

    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",

    "x-device-type":
      "android"
  };
}


/*
 * ========================================
 * CREATE ROOM
 * ========================================
 */
async function createRoom() {

  const payload = {
    username:
      OWNER_USERNAME,

    roomOwner:
      USER_ID,

    roomName:
      ROOM_NAME,

    roomDesc:
      ROOM_DESC,

    roomGenre:
      ROOM_GENRE,

    roomCountry:
      "IN",

    maxParticipants:
      MAX_PARTICIPANTS,

    isPublicRoom:
      true
  };


  console.log(
    "Creating Groic room..."
  );

  console.log(
    "Room Name:",
    ROOM_NAME
  );

  console.log(
    "Room Genre:",
    ROOM_GENRE
  );

  console.log(
    "Max Participants:",
    MAX_PARTICIPANTS
  );


  try {

    const response =
      await axios.post(
        `${BASE_URL}/room/`,
        payload,
        {
          headers:
            getHeaders(),

          timeout:
            30000,

          proxy:
            false,

          validateStatus:
            () => true
        }
      );


    console.log(
      "Groic API Status:",
      response.status
    );


    console.log(
      "Groic API Content-Type:",
      response.headers[
        "content-type"
      ]
    );


    /*
     * Cloudflare protection check.
     */
    if (
      typeof response.data ===
        "string" &&
      response.data.includes(
        "Just a moment"
      )
    ) {

      throw new Error(
        "Groic API returned a Cloudflare challenge instead of JSON."
      );

    }


    /*
     * Print complete room creation
     * response.
     */
    console.log(
      "Room response:"
    );

    console.log(
      JSON.stringify(
        response.data,
        null,
        2
      )
    );


    if (
      response.status < 200 ||
      response.status >= 300
    ) {

      throw new Error(
        `Groic API returned HTTP ${response.status}`
      );

    }


    const room =
      response.data?.data ||
      response.data;


    const roomUid =
      room?.roomUid ||
      room?.uid ||
      room?.id;


    if (!roomUid) {

      throw new Error(
        "Room created, but roomUid was not found."
      );

    }


    console.log(
      "Room UID:",
      roomUid
    );


    return roomUid;


  } catch (error) {

    console.error(
      "Groic room creation failed:"
    );

    console.error(
      error.response?.data ||
      error.message
    );

    throw error;
  }
}


/*
 * ========================================
 * GET ROOM DETAILS
 * ========================================
 *
 * This section is temporarily enhanced
 * to inspect ALL room fields returned
 * by Groic.
 *
 * We are specifically looking for:
 *
 * color
 * background
 * theme
 * image
 * cover
 * gradient
 * appearance
 *
 * DO NOT add a colour field ourselves
 * until we know Groic supports it.
 *
 * ========================================
 */
async function getRoomDetails(roomUid) {

  if (!roomUid) {

    throw new Error(
      "Room UID is missing."
    );

  }


  console.log(
    "================================"
  );

  console.log(
    "Inspecting Groic Room Data..."
  );

  console.log(
    "Room UID:",
    roomUid
  );

  console.log(
    "================================"
  );


  try {

    const response =
      await axios.get(
        `${BASE_URL}/room/${roomUid}`,
        {
          headers:
            getHeaders(),

          timeout:
            30000,

          proxy:
            false,

          validateStatus:
            () => true
        }
      );


    console.log(
      "Groic Room API Status:",
      response.status
    );


    console.log(
      "Groic Room API Content-Type:",
      response.headers[
        "content-type"
      ]
    );


    /*
     * Print complete room data.
     */
    console.log(
      "========== ROOM DATA =========="
    );

    console.log(
      JSON.stringify(
        response.data,
        null,
        2
      )
    );

    console.log(
      "======== END ROOM DATA ========="
    );


    /*
     * Try to locate possible appearance
     * fields automatically.
     */
    const data =
      response.data?.data ||
      response.data;


    if (data) {

      console.log(
        "========== POSSIBLE COLOUR / APPEARANCE FIELDS =========="
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


      let foundField =
        false;


      for (
        const field
        of possibleFields
      ) {

        if (
          Object.prototype.hasOwnProperty.call(
            data,
            field
          )
        ) {

          console.log(
            `${field}:`,
            JSON.stringify(
              data[field]
            )
          );

          foundField =
            true;
        }
      }


      if (!foundField) {

        console.log(
          "No obvious colour/background field found."
        );

      }


      console.log(
        "=========================================================="
      );

    }


    console.log(
      "================================"
    );


    return response.data;


  } catch (error) {

    console.error(
      "Groic room details failed:"
    );

    console.error(
      error.response?.data ||
      error.message
    );

    throw error;
  }
}


/*
 * ========================================
 * EXPORTS
 * ========================================
 */
module.exports = {
  createRoom,
  getRoomDetails
};
