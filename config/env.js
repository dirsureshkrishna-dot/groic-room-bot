require("dotenv").config();

const required = [
  "FIREBASE_API_KEY",
  "REFRESH_TOKEN"
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`${key} is missing from .env`);
  }
}

module.exports = {
  FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
  REFRESH_TOKEN: process.env.REFRESH_TOKEN,

  ROOM_NAME: "𝑺𝑲 𝑽𝑰𝑩𝑬𝒁 ⚡️ 𝒀𝑬𝑺𝑲𝑰𝑵𝑮",
  ROOM_DESC: "இசையுடன் 🦋 நான்",

  ROOM_GENRE: [
    "COUNTRY",
    "POPULAR"
  ],

  MAX_PARTICIPANTS: 100,

  OWNER_USERNAME: "YESKING",

  BOT_NAME: "SKVIBEZ",

  BOT_IMAGE_URL:
    process.env.BOT_IMAGE_URL || ""
};
