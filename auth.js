const axios = require("axios");

const {
  FIREBASE_API_KEY,
  REFRESH_TOKEN,
  YESKING_REFRESH_TOKEN
} = require("./config/env");

let TOKENS = {
  skvibez: "",
  yesking: ""
};

async function refreshToken(refreshToken, accountName) {
  const url =
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;

  const params = new URLSearchParams();

  params.append("grant_type", "refresh_token");
  params.append("refresh_token", refreshToken);

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

    const token =
      response.data.id_token ||
      response.data.access_token ||
      "";

    if (!token) {
      throw new Error(
        `${accountName} Firebase token was not returned.`
      );
    }

    TOKENS[accountName] = token;

    console.log(
      `${accountName.toUpperCase()} authentication successful.`
    );

    return token;

  } catch (error) {
    console.error(
      `${accountName.toUpperCase()} authentication failed:`
    );

    console.error(
      error.response?.data ||
      error.message
    );

    throw error;
  }
}

async function refreshAccessToken() {
  if (!REFRESH_TOKEN) {
    throw new Error(
      "REFRESH_TOKEN is missing from Railway Variables."
    );
  }

  return refreshToken(
    REFRESH_TOKEN,
    "skvibez"
  );
}

async function refreshYeskingAccessToken() {
  if (!YESKING_REFRESH_TOKEN) {
    throw new Error(
      "YESKING_REFRESH_TOKEN is missing from Railway Variables."
    );
  }

  return refreshToken(
    YESKING_REFRESH_TOKEN,
    "yesking"
  );
}

function getToken() {
  return TOKENS.skvibez;
}

function getYeskingToken() {
  return TOKENS.yesking;
}

module.exports = {
  refreshAccessToken,
  refreshYeskingAccessToken,
  getToken,
  getYeskingToken
};
