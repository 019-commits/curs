const { getLatestImage } = require('./telegram');

const OCR_ENDPOINT = 'https://api.ocr.space/parse/imageurl';

function number(value) {
  if (value == null) return 0;
  const normalized = String(value).replace(',', '.').replace(/[^0-9.]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return number(match[1]);
  }
  return 0;
}

function parseRates(rawText) {
  // OCR can produce Cyrillic/Latin variations and arbitrary line breaks.
  const text = String(rawText || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[|]/g, 'I')
    .replace(/O(?=\d)/g, '0')
    .replace(/(?<=\d)O/g, '0')
    .replace(/\s+/g, ' ')
    .trim();

  const rates = {
    JPY_INTERNAL: firstMatch(text, [
      /ЯПОНИЯ[^0-9]{0,80}(?:100\s*JPY|JPY)[^0-9]{0,20}=\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /100\s*JPY\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]),
    JPY_SWIFT: firstMatch(text, [
      /ЯПОНИЯ[^0-9]{0,120}SWIFT[^0-9]{0,50}(?:100\s*JPY|JPY)[^0-9]{0,20}=\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /SWIFT[^0-9]{0,50}100\s*JPY\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]),
    JPY_CASH: firstMatch(text, [
      /AFA\s*TRADING[^0-9]{0,100}(?:наличные|cash)[^0-9]{0,80}(?:100\s*JPY|JPY)[^0-9]{0,20}=\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /наличные[^0-9]{0,60}100\s*JPY\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]),
    JPY_QR: firstMatch(text, [
      /AFA\s*TRADING[^0-9]{0,100}(?:QR|QR-code|QR.code)[^0-9]{0,80}(?:100\s*JPY|JPY)[^0-9]{0,20}=\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /QR[^0-9]{0,60}100\s*JPY\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]),
    KRW: firstMatch(text, [
      /(?:ЮЖНАЯ\s*КОРЕЯ|KOREA)[^0-9]{0,80}1000\s*KRW\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /1000\s*KRW\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]),
    AED: firstMatch(text, [
      /(?:ОАЭ|UAE)[^0-9]{0,80}1\s*AED\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /1\s*AED\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]),
    USD_SWIFT: firstMatch(text, [
      /SWIFT[^0-9]{0,80}1\s*USD\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /1\s*USD\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]),
    CNY: firstMatch(text, [
      /(?:КИТАЙ|CHINA)[^0-9]{0,80}1\s*(?:CNY|RMB)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /1\s*(?:CNY|RMB)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]),
    THB: firstMatch(text, [
      /(?:ТАИЛАНД|THAILAND)[^0-9]{0,80}1\s*THB\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,
      /1\s*THB\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]),
    USD_IDUBID: firstMatch(text, [
      /IDUBID[^0-9]{0,80}1\s*USD\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ])
  };

  // The calculator stores JPY as RUB per 1 JPY and KRW as RUB per 1 KRW.
  const normalized = {
    JPY_INTERNAL: rates.JPY_INTERNAL ? rates.JPY_INTERNAL / 100 : 0,
    JPY_SWIFT: rates.JPY_SWIFT ? rates.JPY_SWIFT / 100 : 0,
    JPY_CASH: rates.JPY_CASH ? rates.JPY_CASH / 100 : 0,
    JPY_QR: rates.JPY_QR ? rates.JPY_QR / 100 : 0,
    KRW: rates.KRW ? rates.KRW / 1000 : 0,
    CNY: rates.CNY,
    AED: rates.AED,
    THB: rates.THB,
    USD_SWIFT: rates.USD_SWIFT,
    USD_IDUBID: rates.USD_IDUBID
  };

  const required = ['JPY_SWIFT', 'CNY', 'KRW', 'AED', 'THB', 'USD_SWIFT'];
  const missing = required.filter((key) => !normalized[key]);

  return { rates: normalized, missing, rawText: text };
}

async function ocrImage(imageUrl) {
  const apiKey = process.env.OCR_API_KEY;
  if (!apiKey) {
    throw new Error('OCR_API_KEY is not configured in Vercel Environment Variables.');
  }

  const url = new URL(OCR_ENDPOINT);
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('url', imageUrl);
  url.searchParams.set('language', 'rus');
  url.searchParams.set('isOverlayRequired', 'false');
  url.searchParams.set('detectOrientation', 'true');
  url.searchParams.set('scale', 'true');
  url.searchParams.set('OCREngine', '2');

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store'
  });

  if (!response.ok) throw new Error(`OCR service returned HTTP ${response.status}`);

  const data = await response.json();
  if (data.IsErroredOnProcessing) {
    throw new Error((data.ErrorMessage || ['OCR processing failed']).join('; '));
  }

  const parsed = (data.ParsedResults || []).map((item) => item.ParsedText || '').join('\n');
  if (!parsed.trim()) throw new Error('OCR returned empty text.');
  return parsed;
}

module.exports = async function handler(req, res) {
  try {
    const latest = await getLatestImage();
    const rawText = await ocrImage(latest.imageUrl);
    const parsed = parseRates(rawText);

    if (parsed.missing.length) {
      console.error('OCR text:', rawText);
      throw new Error(`Не удалось распознать курсы: ${parsed.missing.join(', ')}`);
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json({
      success: true,
      source: 'Telegram @LoyaltySwift',
      postId: latest.postId,
      postUrl: latest.postUrl,
      imageUrl: latest.imageUrl,
      updatedAt: new Date().toISOString(),
      rates: parsed.rates
    });
  } catch (error) {
    console.error(error);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({
      success: false,
      error: error instanceof Error ? error.message : 'Rates parser failed'
    });
  }
};
