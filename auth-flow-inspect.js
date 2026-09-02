const axios = require("axios");

async function inspectAuthFlow() {
  const url =
    "https://groic.in/_next/static/chunks/46be18a3-0ac10e7d693761bc.js";

  console.log("Inspecting Groic Firebase signInWithIdp flow...");

  try {
    const response = await axios.get(url, {
      timeout: 30000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Referer": "https://groic.in/"
      }
    });

    const text = response.data;

    const keywords = [
      "signInWithIdp",
      "getIdToken",
      "securetoken.googleapis.com",
      "identitytoolkit.googleapis.com",
      "accounts:signInWithIdp",
      "refreshToken"
    ];

    console.log("\n=== FIREBASE AUTH FLOW ===");

    for (const keyword of keywords) {
      let position = 0;
      let found = false;

      while (true) {
        position = text.indexOf(keyword, position);

        if (position === -1) break;

        found = true;

        console.log(`\nFOUND: ${keyword}`);
        console.log(
          text.slice(
            Math.max(0, position - 700),
            Math.min(text.length, position + 1800)
          )
        );

        position += keyword.length;

        if (keyword === "refreshToken") break;
      }

      if (!found) {
        console.log(`NOT FOUND: ${keyword}`);
      }
    }

    console.log("\nInspection completed.");

  } catch (error) {
    console.error("Inspection failed:");
    console.error(
      error.response?.status ||
      error.message
    );
  }
}

inspectAuthFlow();
