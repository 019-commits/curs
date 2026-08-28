const { getLatestImage } = require("./telegram");
const { createWorker } = require("tesseract.js");
const sharp = require("sharp");

let workerPromise = null;

let cachedResult = null;
let cachedPostId = null;


/*
|--------------------------------------------------------------------------
| Tesseract
|--------------------------------------------------------------------------
*/

async function getWorker() {
  if (!workerPromise) {
    console.log("Запускаю Tesseract...");

    workerPromise = createWorker(["eng", "rus"], 1, {
      logger: function (message) {
        if (message.status === "recognizing text") {
          console.log(
            `OCR: ${Math.round((message.progress || 0) * 100)}%`
          );
        }
      }
    });
  }

  return workerPromise;
}


/*
|--------------------------------------------------------------------------
| Скачать картинку
|--------------------------------------------------------------------------
*/

async function downloadImage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Ошибка загрузки картинки: HTTP ${response.status}`
    );
  }

  return Buffer.from(
    await response.arrayBuffer()
  );
}


/*
|--------------------------------------------------------------------------
| OCR отдельной области
|--------------------------------------------------------------------------
*/

async function recognizeCrop(worker, image, crop) {
  const cropped = await sharp(image)
    .extract({
      left: crop.left,
      top: crop.top,
      width: crop.width,
      height: crop.height
    })
    .resize({
      width: crop.width * 2
    })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();

  const result = await worker.recognize(cropped);

  return result?.data?.text || "";
}


/*
|--------------------------------------------------------------------------
| Число
|--------------------------------------------------------------------------
*/

function number(value) {
  if (!value) {
    return 0;
  }

  const cleaned = String(value)
    .replace(",", ".")
    .replace(/[^\d.]/g, "");

  const result = parseFloat(cleaned);

  return Number.isFinite(result)
    ? result
    : 0;
}


/*
|--------------------------------------------------------------------------
| Найти число по шаблонам
|--------------------------------------------------------------------------
*/

function find(text, patterns) {
  for (const regex of patterns) {
    const match = text.match(regex);

    if (match && match[1]) {
      const value = number(match[1]);

      if (value > 0) {
        return value;
      }
    }
  }

  return 0;
}


/*
|--------------------------------------------------------------------------
| Парсинг конкретных блоков
|--------------------------------------------------------------------------
*/

function parseBlock(text) {
  const normalized = String(text || "")
    .replace(/\n+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/,/g, ".")
    .trim();

  console.log("BLOCK OCR:", normalized);

  return normalized;
}


/*
|--------------------------------------------------------------------------
| Основной парсер
|--------------------------------------------------------------------------
*/

async function parseRatesFromImage(image) {
  const worker = await getWorker();

  /*
   * Размер исходной картинки:
   *
   * примерно 957 x 1280
   *
   * Берём области с запасом.
   */

  const crops = {
    korea: {
      left: 100,
      top: 300,
      width: 430,
      height: 150
    },

    aed: {
      left: 560,
      top: 300,
      width: 350,
      height: 150
    },

    usdSwift: {
      left: 550,
      top: 450,
      width: 370,
      height: 160
    },

    jpyInternal: {
      left: 100,
      top: 450,
      width: 400,
      height: 160
    },

    jpySwift: {
      left: 100,
      top: 630,
      width: 430,
      height: 160
    },

    china: {
      left: 550,
      top: 630,
      width: 370,
      height: 170
    },

    thailand: {
      left: 100,
      top: 800,
      width: 430,
      height: 160
    },

    idubid: {
      left: 550,
      top: 800,
      width: 370,
      height: 170
    },

    afaCash: {
      left: 80,
      top: 950,
      width: 420,
      height: 170
    },

    afaQr: {
      left: 550,
      top: 950,
      width: 370,
      height: 170
    }
  };


  /*
   * Распознаём блоки.
   */

  const results = {};

  for (const [name, crop] of Object.entries(crops)) {
    console.log(`\nOCR BLOCK: ${name}`);

    results[name] = parseBlock(
      await recognizeCrop(
        worker,
        image,
        crop
      )
    );
  }


  /*
   * Показываем все блоки в Render Log.
   */

  console.log("\n================================");
  console.log("РАСПОЗНАННЫЕ БЛОКИ");
  console.log("================================");

  for (const [name, text] of Object.entries(results)) {
    console.log(`${name}: ${text}`);
  }

  console.log("================================");


  /*
   * KRW
   *
   * 1000 KRW = 65.10
   */

  let krw = find(results.korea, [
    /1000\s*KRW\s*=?\s*([\d.]+)/i,
    /KRW\s*=?\s*([\d.]+)/i,
    /1000\s*[\w]{2,4}\s*=?\s*([\d.]+)/
  ]);


  /*
   * AED
   *
   * 1 AED = 23.60
   */

  let aed = find(results.aed, [
    /1\s*AED\s*=?\s*([\d.]+)/i,
    /AED\s*=?\s*([\d.]+)/i,
    /1\s*A[ЕE]D\s*=?\s*([\d.]+)/i
  ]);


  /*
   * USD SWIFT
   *
   * 1 USD = 90.00
   */

  let usdSwift = find(results.usdSwift, [
    /1\s*USD\s*=?\s*([\d.]+)/i,
    /USD\s*=?\s*([\d.]+)/i
  ]);


  /*
   * JPY internal
   *
   * 100 JPY = 56.90
   */

  let jpyInternal = find(results.jpyInternal, [
    /100\s*JPY\s*=?\s*([\d.]+)/i,
    /JPY\s*=?\s*([\d.]+)/i
  ]);


  /*
   * JPY SWIFT
   *
   * 100 JPY = 56.90
   */

  let jpySwift = find(results.jpySwift, [
    /100\s*JPY\s*=?\s*([\d.]+)/i,
    /JPY\s*=?\s*([\d.]+)/i
  ]);


  /*
   * CNY
   *
   * 1 CNY = 13.45
   */

  let cny = find(results.china, [
    /1\s*CNY\s*=?\s*([\d.]+)/i,
    /CNY\s*=?\s*([\d.]+)/i,
    /1\s*CN[YV]\s*=?\s*([\d.]+)/i
  ]);


  /*
   * THB
   *
   * 1 THB = 2.74
   */

  let thb = find(results.thailand, [
    /1\s*THB\s*=?\s*([\d.]+)/i,
    /THB\s*=?\s*([\d.]+)/i,
    /1\s*T[HН]B\s*=?\s*([\d.]+)/i
  ]);


  /*
   * USD IDUBID
   *
   * 1 USD = 91.50
   */

  let usdIdubid = find(results.idubid, [
    /1\s*USD\s*=?\s*([\d.]+)/i,
    /USD\s*=?\s*([\d.]+)/i
  ]);


  /*
   * JPY AFA CASH
   *
   * 1 JPY = 57.30
   */

  let jpyCash = find(results.afaCash, [
    /1\s*JPY\s*=?\s*([\d.]+)/i,
    /JPY\s*=?\s*([\d.]+)/i
  ]);


  /*
   * JPY AFA QR
   *
   * 1 JPY = 56.90
   */

  let jpyQr = find(results.afaQr, [
    /1\s*JPY\s*=?\s*([\d.]+)/i,
    /JPY\s*=?\s*([\d.]+)/i
  ]);


  /*
   * Результаты
   */

  console.log("\n================================");
  console.log("ИТОГ");
  console.log("================================");

  console.log({
    krw,
    aed,
    usdSwift,
    jpyInternal,
    jpySwift,
    cny,
    thb,
    usdIdubid,
    jpyCash,
    jpyQr
  });

  console.log("================================");


  /*
   * Конвертация:
   *
   * 1000 KRW = 65.10
   * => 1 KRW = 0.06510
   *
   * 100 JPY = 56.90
   * => 1 JPY = 0.569
   */

  const rates = {
    JPY_INTERNAL:
      jpyInternal
        ? jpyInternal / 100
        : 0,

    JPY_SWIFT:
      jpySwift
        ? jpySwift / 100
        : 0,

    JPY_CASH:
      jpyCash
        ? jpyCash
        : 0,

    JPY_QR:
      jpyQr
        ? jpyQr
        : 0,

    KRW:
      krw
        ? krw / 1000
        : 0,

    CNY:
      cny,

    AED:
      aed,

    THB:
      thb,

    USD_SWIFT:
      usdSwift,

    USD_IDUBID:
      usdIdubid
  };


  return {
    rates,
    blocks: results
  };
}


/*
|--------------------------------------------------------------------------
| API /api/rates
|--------------------------------------------------------------------------
*/

async function handler(req, res) {
  try {
    const latest = await getLatestImage();

    /*
     * Если пост уже обработан —
     * не запускаем OCR повторно.
     */

    if (
      cachedPostId === latest.postId &&
      cachedResult
    ) {
      return res.json({
        success: true,
        cached: true,
        source: "Telegram @LoyaltySwift",
        postId: latest.postId,
        postUrl: latest.postUrl,
        imageUrl: latest.imageUrl,
        updatedAt: cachedResult.updatedAt,
        rates: cachedResult.rates
      });
    }


    console.log(
      `Найден новый Telegram пост: ${latest.postId}`
    );


    /*
     * Скачиваем изображение
     */

    const image =
      await downloadImage(
        latest.imageUrl
      );


    /*
     * OCR по блокам
     */

    const parsed =
      await parseRatesFromImage(
        image
      );


    const rates =
      parsed.rates;


    /*
     * Проверяем обязательные значения.
     */

    const required = [
      ["KRW", rates.KRW],
      ["AED", rates.AED],
      ["USD_SWIFT", rates.USD_SWIFT],
      ["JPY_SWIFT", rates.JPY_SWIFT],
      ["CNY", rates.CNY],
      ["THB", rates.THB],
      ["USD_IDUBID", rates.USD_IDUBID],
      ["JPY_CASH", rates.JPY_CASH],
      ["JPY_QR", rates.JPY_QR]
    ];


    const missing = required
      .filter(function (item) {
        return !item[1];
      })
      .map(function (item) {
        return item[0];
      });


    /*
     * Если чего-то не хватает —
     * не заменяем рабочие данные.
     */

    if (missing.length > 0) {
      console.error(
        "НЕ РАСПОЗНАНЫ:",
        missing
      );


      if (cachedResult) {
        return res.json({
          success: true,
          cached: true,

          warning:
            "Новый пост найден, но OCR не смог распознать все курсы. Используются последние рабочие курсы.",

          source:
            "Telegram @LoyaltySwift",

          postId:
            cachedResult.postId,

          postUrl:
            cachedResult.postUrl,

          imageUrl:
            cachedResult.imageUrl,

          updatedAt:
            cachedResult.updatedAt,

          rates:
            cachedResult.rates
        });
      }


      return res.status(502).json({
        success: false,

        error:
          "OCR не смог распознать: " +
          missing.join(", "),

        postId:
          latest.postId,

        rates:
          rates,

        blocks:
          parsed.blocks
      });
    }


    /*
     * Сохраняем результат.
     */

    cachedPostId =
      latest.postId;


    cachedResult = {
      postId:
        latest.postId,

      postUrl:
        latest.postUrl,

      imageUrl:
        latest.imageUrl,

      updatedAt:
        new Date().toISOString(),

      rates:
        rates
    };


    res.setHeader(
      "Cache-Control",
      "public, max-age=60, s-maxage=60"
    );


    return res.json({
      success: true,

      cached: false,

      source:
        "Telegram @LoyaltySwift",

      postId:
        latest.postId,

      postUrl:
        latest.postUrl,

      imageUrl:
        latest.imageUrl,

      updatedAt:
        cachedResult.updatedAt,

      rates:
        rates
    });


  } catch (error) {
    console.error(
      "RATES ERROR:",
      error
    );


    /*
     * Если есть старые рабочие данные,
     * сайт не ломаем.
     */

    if (cachedResult) {
      return res.json({
        success: true,

        cached: true,

        warning:
          "Временная ошибка обновления. Используются последние рабочие курсы.",

        source:
          "Telegram @LoyaltySwift",

        postId:
          cachedResult.postId,

        postUrl:
          cachedResult.postUrl,

        imageUrl:
          cachedResult.imageUrl,

        updatedAt:
          cachedResult.updatedAt,

        rates:
          cachedResult.rates
      });
    }


    return res.status(500).json({
      success: false,

      error:
        error.message ||
        "Ошибка получения курсов."
    });
  }
}


module.exports = handler;
