const axios = require("axios");

async function searchYouTube(query) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is missing.");
  }

  const response = await axios.get(
    "https://www.googleapis.com/youtube/v3/search",
    {
      params: {
        part: "snippet",
        q: query,
        type: "video",
        maxResults: 5,
        key: apiKey
      },
      timeout: 20000
    }
  );

  return response.data.items.map((item) => ({
    videoId: item.id.videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    url: `https://www.youtube.com/watch?v=${item.id.videoId}`
  }));
}

module.exports = {
  searchYouTube
};
