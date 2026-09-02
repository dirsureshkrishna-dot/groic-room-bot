const axios = require("axios");

async function inspectAuthFlow() {
  const url =
    "https://groic.in/_next/static/chunks/46be18a3-0ac10e7d693761bc.js";

  console.log("Inspecting Groic Firebase signInWithIdp response flow...");

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
      "/v1/accounts:signInWithIdp",
      "accounts:signInWithIdp",
      "refreshToken",
      "idToken",
      "accessToken"
    ];

    console.log("\n=== SIGN-IN RESPONSE FLOW ===");

    for (const keyword of keywords) {
      const position = text.indexOf(keyword);

      if (position === -1) {
        console.log(`NOT FOUND: ${keyword}`);
        continue;
      }

      console.log(`\n===== FOUND: ${keyword} =====`);

      const start = Math.max(0, position - 1500);
      const end = Math.min(text.length, position + 3000);

      console.log(text.slice(start, end));
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
