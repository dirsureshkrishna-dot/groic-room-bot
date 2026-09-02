const axios = require("axios");

const {
  FIREBASE_API_KEY,
  REFRESH_TOKEN
} = require("./config/env");

let TOKEN = "";

async function refreshAccessToken() {
  const url =
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;

  const params = new URLSearchParams();

  params.append("grant_type", "refresh_token");
  params.append("refresh_token", REFRESH_TOKEN);

  try {
    const response = await axios.post(
      url,
      params.toString(),
      {
        headers: {
          "content-type":
            "application/x-www-form-urlencoded"
        },
        timeout: 20000
      }
    );

    TOKEN =
      response.data.id_token ||
      response.data.access_token ||
      "";

    if (!TOKEN) {
      throw new Error(
        "Firebase did not return an access token."
      );
    }

    console.log(
      "Firebase authentication successful."
    );

    return TOKEN;

  } catch (error) {
    console.error(
      "Firebase authentication failed:"
    );

    console.error(
      error.response?.data ||
      error.message
    );

    throw error;
  }
}

function getToken() {
  return TOKEN;
}

module.exports = {
  refreshAccessToken,
  getToken
};
