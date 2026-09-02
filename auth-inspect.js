const axios = require("axios");

const URL = "https://groic.in";

async function inspectAuth() {
  console.log("Checking Groic login page...");

  try {
    const response = await axios.get(`${URL}/login`, {
      timeout: 20000,
      headers: {
        accept: "text/html,application/xhtml+xml"
      }
    });

    const html = response.data;

    console.log("Login page loaded.");
    console.log("Page size:", html.length);

    const patterns = [
      "firebase",
      "google",
      "password",
      "signInWith",
      "auth",
      "identitytoolkit",
      "securetoken"
    ];

    console.log("=== AUTH REFERENCES ===");

    for (const pattern of patterns) {
      if (html.toLowerCase().includes(pattern.toLowerCase())) {
        console.log(`FOUND: ${pattern}`);
      }
    }

    console.log("Auth inspection completed.");

  } catch (error) {
    console.error("Auth inspection failed:");
    console.error(error.response?.status || error.message);
  }
}

inspectAuth();
