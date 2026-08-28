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
| Скачать изображение
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

  return Buffer.from(await response.arrayBuffer());
}


/*
|--------------------------------------------------------------------------
| Безопасный crop
|--------------------------------------------------------------------------
*/

async function recognizeCrop(worker, image, crop, name) {
  const metadata = await sharp(image).metadata();

  const imageWidth = metadata.width;
  const imageHeight = metadata.height;

  if (!imageWidth || !imageHeight) {
    throw new Error("Не удалось определить размер изображения.");
  }

  /*
   * Не позволяем crop выйти за границы картинки.
   */

  const left = Math.max(
    0,
    Math.min(crop.left, imageWidth - 1)
  );

  const top = Math.max(
    0,
    Math.min(crop.top, imageHeight - 1)
  );

  const width = Math.min(
    crop.width,
    imageWidth - left
  );

  const height = Math.min(
    crop.height,
    imageHeight - top
  );

  if (width <= 0 || height <= 0) {
    throw new Error(
      `Неверная область ${name}: ${left},${top},${width},${height}`
    );
  }

  console.log(
    `Crop ${name}: ${left}, ${top}, ${width}, ${height}`
  );

  const cropped = await sharp(image)
    .extract({
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(width),
      height: Math.round(height)
    })
    .resize({
      width: Math.round(width * 2)
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

  return Number.isFinite(result) ? result : 0;
}


/*
|--------------------------------------------------------------------------
| Поиск значения
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
| Нормализация OCR
|--------------------------------------------------------------------------
*/

function cleanText(text) {
  return String(text || "")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/,/g, ".")
    .trim();
}


/*
|--------------------------------------------------------------------------
| Распознавание
|--------------------------------------------------------------------------
*/

async function parseRatesFromImage(image) {
  const worker = await getWorker();

  const metadata = await sharp(image).metadata();

  console.log(
    `Размер изображения: ${metadata.width}x${metadata.height}`
  );


  /*
   * Реальная картинка:
   *
   * 957 x 1280
   *
   * Области рассчитаны именно под неё.
   */

  const crops = {

    korea: {
      left: 50,
      top: 300,
      width: 430,
      height: 140
    },

    aed: {
      left: 540,
      top: 300,
      width: 390,
      height: 140
    },

    jpyInternal: {
      left: 50,
      top: 455,
      width: 450,
      height: 145
    },

    usdSwift: {
      left: 540,
      top: 455,
      width: 390,
      height: 145
    },

    jpySwift: {
      left: 50,
      top: 625,
      width: 450,
      height: 145
    },

    china: {
      left: 540,
      top: 625,
      width: 390,
      height: 145
    },

    thailand: {
      left: 50,
      top: 795,
      width: 450,
      height: 145
    },

    idubid: {
      left: 540,
      top: 795,
      width: 390,
      height: 145
    },

    afaCash: {
      left: 50,
      top: 950,
      width: 450,
      height: 150
    },

    afaQr: {
      left: 540,
      top: 950,
      width: 390,
      height: 150
    }
  };


  const blocks = {};


  /*
   * OCR каждого блока.
   */

  for (const [name, crop] of Object.entries(crops)) {

    console.log("");
    console.log(`OCR BLOCK: ${name}`);

    try {

      blocks[name] = cleanText(
        await recognizeCrop(
          worker,
          image,
          crop,
          name
        )
      );

      console.log(
        `BLOCK OCR [${name}]: ${blocks[name]}`
      );

    } catch (error) {

      console.error(
        `Ошибка OCR блока ${name}:`,
        error.message
      );

      blocks[name] = "";
    }
  }


  /*
  |--------------------------------------------------------------------------
  | KRW
  |--------------------------------------------------------------------------
  */

  const krw = find(blocks.korea, [
    /1000\s*KRW\s*=?\s*([\d.]+)/i,
    /KRW\s*=?\s*([\d.]+)/i
  ]);


  /*
  |--------------------------------------------------------------------------
  | AED
  |--------------------------------------------------------------------------
  */

  const aed = find(blocks.aed, [
    /1\s*AED\s*=?\s*([\d.]+)/i,
    /AED\s*=?\s*([\d.]+)/i,
    /A[ЕE]D\s*=?\s*([\d.]+)/i,
    /АЕ[DPР]\s*=?\s*([\d.]+)/i
  ]);


  /*
  |--------------------------------------------------------------------------
  | JPY INTERNAL
  |--------------------------------------------------------------------------
  */

  const jpyInternal = find(blocks.jpyInternal, [
    /100\s*JPY\s*=?\s*([\d.]+)/i,
    /JPY\s*=?\s*([\d.]+)/i
  ]);


  /*
  |--------------------------------------------------------------------------
  | USD SWIFT
  |--------------------------------------------------------------------------
  */

  const usdSwift = find(blocks.usdSwift, [
    /1\s*USD\s*=?\s*([\d.]+)/i,
    /USD\s*=?\s*([\d.]+)/i,

    /*
     * Если USD OCR испортил,
     * ищем число после SWIFT.
     */

    /SWIFT[\s\S]{0,100}?([\d]{2,3}[.][\d]{2})/i
  ]);


  /*
  |--------------------------------------------------------------------------
  | JPY SWIFT
  |--------------------------------------------------------------------------
  */

  const jpySwift = find(blocks.jpySwift, [
    /100\s*JPY\s*=?\s*([\d.]+)/i,
    /JPY\s*=?\s*([\d.]+)/i
  ]);


  /*
  |--------------------------------------------------------------------------
  | CNY
  |--------------------------------------------------------------------------
  */

  const cny = find(blocks.china, [
    /1\s*CNY\s*=?\s*([\d.]+)/i,
    /CNY\s*=?\s*([\d.]+)/i,
    /CN[YV]\s*=?\s*([\d.]+)/i
  ]);


  /*
  |--------------------------------------------------------------------------
  | THB
  |--------------------------------------------------------------------------
  */

  const thb = find(blocks.thailand, [
    /1\s*THB\s*=?\s*([\d.]+)/i,
    /THB\s*=?\s*([\d.]+)/i,
    /T[HН]B\s*=?\s*([\d.]+)/i
  ]);


  /*
  |--------------------------------------------------------------------------
  | IDUBID USD
  |--------------------------------------------------------------------------
  */

  const usdIdubid = find(blocks.idubid, [
    /1\s*USD\s*=?\s*([\d.]+)/i,
    /USD\s*=?\s*([\d.]+)/i
  ]);


  /*
  |--------------------------------------------------------------------------
  | AFA CASH
  |--------------------------------------------------------------------------
  */

  const jpyCash = find(blocks.afaCash, [
    /1\s*JPY\s*=?\s*([\d.]+)/i,
    /JPY\s*=?\s*([\d.]+)/i
  ]);


  /*
  |--------------------------------------------------------------------------
  | AFA QR
  |--------------------------------------------------------------------------
  */

  const jpyQr = find(blocks.afaQr, [
    /1\s*JPY\s*=?\s*([\d.]+)/i,
    /JPY\s*=?\s*([\d.]+)/i
  ]);


  /*
  |--------------------------------------------------------------------------
  | Логи
  |--------------------------------------------------------------------------
  */

  console.log("");
  console.log("================================");
  console.log("РАСПОЗНАННЫЕ КУРСЫ");
  console.log("================================");

  console.log({
    KRW: krw,
    AED: aed,
    USD_SWIFT: usdSwift,
    JPY_INTERNAL: jpyInternal,
    JPY_SWIFT: jpySwift,
    CNY: cny,
    THB: thb,
    USD_IDUBID: usdIdubid,
    JPY_CASH: jpyCash,
    JPY_QR: jpyQr
  });

  console.log("================================");


  /*
  |--------------------------------------------------------------------------
  | Финальные значения
  |--------------------------------------------------------------------------
  */

  const rates = {

    /*
     * 100 JPY = 56.90
     * => 1 JPY = 0.569
     */

    JPY_INTERNAL:
      jpyInternal
        ? jpyInternal / 100
        : 0,

    JPY_SWIFT:
      jpySwift
        ? jpySwift / 100
        : 0,

    /*
     * Здесь уже формат:
     * 1 JPY = 57.30
     */

    JPY_CASH:
      jpyCash,

    JPY_QR:
      jpyQr,

    /*
     * 1000 KRW = 65.10
     */

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
    blocks
  };
}


/*
|--------------------------------------------------------------------------
| API
|--------------------------------------------------------------------------
*/

async function handler(req, res) {

  try {

    const latest =
      await getLatestImage();


    /*
     * Уже обрабатывали этот пост.
     */

    if (
      cachedPostId === latest.postId &&
      cachedResult
    ) {

      return res.json({
        success: true,
        cached: true,

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
          cachedResult.rates
      });
    }


    console.log(
      `Найден новый Telegram пост: ${latest.postId}`
    );


    /*
     * Скачиваем картинку.
     */

    const image =
      await downloadImage(
        latest.imageUrl
      );


    /*
     * Распознаём.
     */

    const parsed =
      await parseRatesFromImage(
        image
      );


    const rates =
      parsed.rates;


    /*
     * Обязательные курсы.
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


    const missing =
      required
        .filter(function (item) {
          return !item[1];
        })
        .map(function (item) {
          return item[0];
        });


    /*
     * Если всё найдено —
     * сохраняем.
     */

    if (missing.length === 0) {

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
    }


    /*
     * Не всё распознано.
     */

    console.error(
      "НЕ РАСПОЗНАНЫ:",
      missing
    );


    /*
     * Если есть старые рабочие данные,
     * отдаём их.
     */

    if (cachedResult) {

      return res.json({

        success: true,

        cached: true,

        warning:
          "Новый пост найден, но OCR не распознал все курсы. Используются последние рабочие данные.",

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


    /*
     * Первое распознавание не удалось.
     */

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


  } catch (error) {

    console.error(
      "RATES ERROR:",
      error
    );


    if (cachedResult) {

      return res.json({

        success: true,

        cached: true,

        warning:
          "Временная ошибка. Используются последние рабочие курсы.",

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
