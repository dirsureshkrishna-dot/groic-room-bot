const axios = require("axios");

async function inspectGroic() {
  console.log("Inspecting Groic Firebase authentication...");

  const response = await axios.get("https://groic.in", {
    timeout: 20000,
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const html = response.data;

  const scripts = [
    ...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)
  ].map(match => match[1]);

  const urls = scripts.map(src => {
    if (src.startsWith("http")) return src;
    if (src.startsWith("//")) return "https:" + src;
    return new URL(src, "https://groic.in").href;
  });

  console.log("\n=== FIREBASE AUTH SEARCH ===");

  const keywords = [
    "firebase",
    "signInWithPopup",
    "signInWithRedirect",
    "GoogleAuthProvider",
    "getAuth",
    "initializeAuth",
    "signInWithCredential",
    "GoogleAuthProvider.credential",
    "identitytoolkit",
    "securetoken",
    "accounts:signIn",
    "accounts:lookup",
    "accounts:signInWithIdp",
    "refreshToken"
  ];

  for (const url of urls) {
    try {
      const result = await axios.get(url, {
        timeout: 20000,
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      const text = result.data;

      const found = keywords.filter(keyword =>
        text.includes(keyword)
      );

      if (found.length > 0) {
        console.log("\nFOUND AUTH REFERENCES IN:");
        console.log(url);

        console.log("Keywords found:");
        console.log(found.join(", "));
      }

    } catch (error) {
      console.log("Could not inspect:", url);
    }
  }

  console.log("\nAuthentication inspection completed.");
}

inspectGroic().catch(error => {
  console.error("Inspection failed:");
  console.error(error.message);
});
