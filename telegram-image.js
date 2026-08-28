const { getLatestImage } = require("./telegram");

async function telegramImageHandler(req, res) {
  const latest = await getLatestImage();

  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=60"
  );

  res.json({
    success: true,
    channel: "@LoyaltySwift",
    postId: latest.postId,
    postUrl: latest.postUrl,
    imageUrl: latest.imageUrl,
    updatedAt: new Date().toISOString()
  });
}

module.exports = telegramImageHandler;
