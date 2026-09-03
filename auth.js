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

let refreshTimer = null;

const refreshListeners = new Set();

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

/*
 * Refresh SKVIBEZ token
 */
async function refreshAccessToken() {
  if (!REFRESH_TOKEN) {
    throw new Error(
      "REFRESH_TOKEN is missing from Railway Variables."
    );
  }

  const token = await refreshToken(
    REFRESH_TOKEN,
    "skvibez"
  );

  /*
   * Tell socket.js that the token changed.
   */
  for (const listener of refreshListeners) {
    try {
      await listener(token);
    } catch (error) {
      console.error(
        "Token refresh listener error:",
        error.message
      );
    }
  }

  return token;
}

/*
 * Refresh YESKING token
 */
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

/*
 * Start automatic SKVIBEZ token refresh.
 *
 * Firebase ID tokens normally have a limited lifetime.
 * Refresh before expiry to avoid Unauthorized disconnects.
 */
function startTokenRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  /*
   * Refresh every 50 minutes.
   */
  refreshTimer = setInterval(
    async () => {
      console.log(
        "Refreshing SKVIBEZ Firebase token..."
      );

      try {
        await refreshAccessToken();

        console.log(
          "SKVIBEZ Firebase token refreshed."
        );

      } catch (error) {
        console.error(
          "Automatic token refresh failed:",
          error.response?.data ||
          error.message
        );
      }
    },
    50 * 60 * 1000
  );

  console.log(
    "Automatic token refresh enabled."
  );
}

/*
 * Allow socket.js to receive refreshed tokens.
 */
function onTokenRefresh(listener) {
  if (typeof listener !== "function") {
    return;
  }

  refreshListeners.add(listener);

  return () => {
    refreshListeners.delete(listener);
  };
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
  startTokenRefresh,
  onTokenRefresh,
  getToken,
  getYeskingToken
};
