const { getLatestImage } =
  require("./telegram");

module.exports =
  async function telegramImageHandler(
    req,
    res
  ) {
    try {
      const latest =
        await getLatestImage();

      res.setHeader(
        "Cache-Control",
        "public, max-age=60, s-maxage=60"
      );

      return res.json({
        success: true,

        channel:
          "@LoyaltySwift",

        postId:
          latest.postId,

        postUrl:
          latest.postUrl,

        imageUrl:
          latest.imageUrl,

        updatedAt:
          new Date().toISOString()
      });
    } catch (error) {
      console.error(
        error
      );

      return res.status(500).json({
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Не удалось получить картинку Telegram."
      });
    }
  };
