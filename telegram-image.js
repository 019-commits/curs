const { getLatestImage } = require('./telegram');

module.exports = async function handler(req, res) {
  try {
    const latest = await getLatestImage();

    const imageResponse = await fetch(latest.imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store'
    });

    if (!imageResponse.ok) {
      throw new Error(`Telegram image returned HTTP ${imageResponse.status}`);
    }

    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await imageResponse.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.setHeader('X-Telegram-Post-Id', latest.postId);
    res.setHeader('X-Telegram-Post-Url', latest.postUrl);
    res.status(200).send(buffer);
  } catch (error) {
    console.error(error);
    res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : 'Telegram image parser failed'
    });
  }
};
