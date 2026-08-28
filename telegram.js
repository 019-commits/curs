const cheerio = require('cheerio');

const CHANNEL = 'LoyaltySwift';
const TELEGRAM_PAGE = `https://t.me/s/${CHANNEL}`;

function extractImageUrl(style) {
  const match = String(style || '').match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
  if (!match) return null;
  let url = match[2];
  if (url.startsWith('//')) url = `https:${url}`;
  return url;
}

async function getLatestImage() {
  const response = await fetch(TELEGRAM_PAGE, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8'
    },
    cache: 'no-store'
  });

  if (!response.ok) throw new Error(`Telegram returned HTTP ${response.status}`);

  const html = await response.text();
  const $ = cheerio.load(html);
  const posts = $('.tgme_widget_message');

  if (!posts.length) {
    throw new Error('Telegram did not return public channel posts. Check that @LoyaltySwift is public.');
  }

  for (let i = posts.length - 1; i >= 0; i--) {
    const post = posts.eq(i);
    const dataPost = post.attr('data-post') || '';
    const postId = dataPost.split('/').pop();
    if (!postId) continue;

    const photo = post.find('.tgme_widget_message_photo_wrap').first();
    if (!photo.length) continue;

    const imageUrl = extractImageUrl(photo.attr('style'));
    if (!imageUrl) continue;

    return {
      channel: CHANNEL,
      postId,
      postUrl: `https://t.me/${CHANNEL}/${postId}`,
      imageUrl
    };
  }

  throw new Error('No photo was found in the public Telegram channel page.');
}

module.exports = { CHANNEL, TELEGRAM_PAGE, getLatestImage };
