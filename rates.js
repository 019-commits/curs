const { getLatestImage } = require("./telegram");
const { createWorker } = require("tesseract.js");
const sharp = require("sharp");

let workerPromise = null;

let cachedResult = null;
let cachedPostId = null;


/* ============================================================
   TESSERACT
============================================================ */

async function getWorker() {
  if (!workerPromise) {
    console.log("Запускаю Tesseract...");

    workerPromise = createWorker(["eng", "rus"], 1, {
      logger: (message) => {
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


/* ============================================================
   DOWNLOAD IMAGE
============================================================ */

async function downloadImage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(
      `Не удалось скачать изображение: HTTP ${response.status}`
    );
  }

  return Buffer.from(await response.arrayBuffer());
}


/* ============================================================
   CLEAN OCR TEXT
============================================================ */

function cleanText(text) {
  return String(text || "")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/,/g, ".")
    .trim();
}


/* ============================================================
   EXTRACT NUMBER
============================================================ */

function number(value) {
  if (!value) {
    return 0;
  }

  let text = String(value)
    .replace(",", ".")
    .replace(/O/gi, "0")
    .replace(/[^\d.]/g, "");

  /*
   * Иногда OCR делает:
   *
   * 13.45
   * 13.4S
   * 13,45
   */

  const result = parseFloat(text);

  return Number.isFinite(result) ? result : 0;
}


/* ============================================================
   FIND RATE
============================================================ */

function findRate(text, patterns) {
  if (!text) {
    return 0;
  }

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


/* ============================================================
   SAFE CROP
============================================================ */

async function recognizeCrop(worker, image, crop, name) {
  const metadata = await sharp(image).metadata();

  const imageWidth = metadata.width;
  const imageHeight = metadata.height;

  if (!imageWidth || !imageHeight) {
    throw new Error("Не удалось определить размер изображения");
  }

  let left = Math.round(crop.left);
  let top = Math.round(crop.top);
  let width = Math.round(crop.width);
  let height = Math.round(crop.height);

  /*
   * Защита от выхода за пределы картинки.
   */

  left = Math.max(0, Math.min(left, imageWidth - 1));
  top = Math.max(0, Math.min(top, imageHeight - 1));

  width = Math.min(width, imageWidth - left);
  height = Math.min(height, imageHeight - top);

  if (width <= 2 || height <= 2) {
    throw new Error(
      `Crop ${name} слишком маленький: ${width}x${height}`
    );
  }

  console.log(
    `Crop ${name}: ${left}, ${top}, ${width}, ${height}`
  );

  /*
   * Увеличиваем область перед OCR.
   */

  const enlargedWidth = Math.max(
    900,
    width * 3
  );

  const cropped = await sharp(image)
    .extract({
      left,
      top,
      width,
      height
    })
    .resize({
      width: enlargedWidth,
      withoutEnlargement: false
    })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();

  const result = await worker.recognize(cropped);

  return result?.data?.text || "";
}


/* ============================================================
   PARSE RATES
============================================================ */

async function parseRatesFromImage(image) {
  const worker = await getWorker();

  const metadata = await sharp(image).metadata();

  const imageWidth = metadata.width;
  const imageHeight = metadata.height;

  console.log("");
  console.log("================================");
  console.log(
    `Размер изображения: ${imageWidth}x${imageHeight}`
  );
  console.log("================================");


  /*
   * ==========================================================
   * БАЗОВОЙ РАЗМЕР ТВОЕЙ КАРТИНКИ
   * ==========================================================
   *
   * 957 x 1280
   *
   * Если Telegram отдаст:
   *
   * 598 x 800
   *
   * координаты автоматически уменьшатся.
   */

  const BASE_WIDTH = 957;
  const BASE_HEIGHT = 1280;

  const scaleX = imageWidth / BASE_WIDTH;
  const scaleY = imageHeight / BASE_HEIGHT;


  /*
   * ==========================================================
   * ОБЛАСТИ НА ТВОЕЙ КАРТИНКЕ
   * ==========================================================
   */

  const baseCrops = {

    /*
     * ЮЖНАЯ КОРЕЯ
     *
     * 1000 KRW = 65.10
     */

    korea: {
      left: 55,
      top: 310,
      width: 405,
      height: 105
    },


    /*
     * ОАЭ
     *
     * 1 AED = 23.60
     */

    aed: {
      left: 535,
      top: 310,
      width: 390,
      height: 105
    },


    /*
     * ЯПОНИЯ
     *
     * внутренний перевод
     *
     * 100 JPY = 56.90
     */

    jpyInternal: {
      left: 55,
      top: 475,
      width: 405,
      height: 115
    },


    /*
     * SWIFT
     *
     * 1 USD = 90.00
     */

    usdSwift: {
      left: 535,
      top: 475,
      width: 390,
      height: 115
    },


    /*
     * ЯПОНИЯ SWIFT
     *
     * 100 JPY = 56.90
     */

    jpySwift: {
      left: 55,
      top: 645,
      width: 405,
      height: 120
    },


    /*
     * КИТАЙ
     *
     * 1 CNY = 13.45
     */

    china: {
      left: 535,
      top: 645,
      width: 390,
      height: 120
    },


    /*
     * ТАИЛАНД
     *
     * 1 THB = 2.74
     */

    thailand: {
      left: 55,
      top: 810,
      width: 405,
      height: 125
    },


    /*
     * IDUBID
     *
     * 1 USD = 91.50
     */

    idubid: {
      left: 535,
      top: 810,
      width: 390,
      height: 125
    },


    /*
     * AFA TRADING
     *
     * наличные
     *
     * 1 JPY = 57.30
     */

    afaCash: {
      left: 55,
      top: 965,
      width: 405,
      height: 145
    },


    /*
     * AFA TRADING
     *
     * QR-code
     *
     * 1 JPY = 56.90
     */

    afaQr: {
      left: 535,
      top: 965,
      width: 390,
      height: 145
    }
  };


  /*
   * ==========================================================
   * МАСШТАБИРОВАНИЕ КООРДИНАТ
   * ==========================================================
   */

  const crops = {};

  for (const [name, crop] of Object.entries(baseCrops)) {
    crops[name] = {
      left: Math.round(crop.left * scaleX),
      top: Math.round(crop.top * scaleY),
      width: Math.round(crop.width * scaleX),
      height: Math.round(crop.height * scaleY)
    };
  }


  /*
   * ==========================================================
   * OCR БЛОКОВ
   * ==========================================================
   */

  const blocks = {};

  for (const [name, crop] of Object.entries(crops)) {

    console.log("");
    console.log(`OCR BLOCK: ${name}`);

    try {

      const text = await recognizeCrop(
        worker,
        image,
        crop,
        name
      );

      blocks[name] = cleanText(text);

      console.log(
        `BLOCK OCR [${name}]: ${blocks[name]}`
      );

    } catch (error) {

      console.error(
        `OCR ERROR [${name}]:`,
        error.message
      );

      blocks[name] = "";
    }
  }


  /*
   * ==========================================================
   * KRW
   * ==========================================================
   *
   * На картинке:
   *
   * 1000 KRW = 65.10
   */

  const krw = findRate(blocks.korea, [

    /1000\s*KRW\s*=?\s*([\d.]+)/i,

    /1000\s*K[RЯ]W\s*=?\s*([\d.]+)/i,

    /KRW\s*=?\s*([\d.]+)/i,

    /K[RЯ]W\s*=?\s*([\d.]+)/i
  ]);


  /*
   * ==========================================================
   * AED
   * ==========================================================
   *
   * На картинке:
   *
   * 1 AED = 23.60
   */

  const aed = findRate(blocks.aed, [

    /1\s*AED\s*=?\s*([\d.]+)/i,

    /AED\s*=?\s*([\d.]+)/i,

    /1\s*A[ЕE]D\s*=?\s*([\d.]+)/i,

    /A[ЕE]D\s*=?\s*([\d.]+)/i,

    /1\s*АЕ[DPР]\s*=?\s*([\d.]+)/i,

    /АЕ[DPР]\s*=?\s*([\d.]+)/i
  ]);


  /*
   * ==========================================================
   * JPY INTERNAL
   * ==========================================================
   *
   * На картинке:
   *
   * 100 JPY = 56.90
   */

  const jpyInternal = findRate(
    blocks.jpyInternal,
    [

      /100\s*JPY\s*=?\s*([\d.]+)/i,

      /100\s*JP[YV]\s*=?\s*([\d.]+)/i,

      /JPY\s*=?\s*([\d.]+)/i
    ]
  );


  /*
   * ==========================================================
   * USD SWIFT
   * ==========================================================
   *
   * На картинке:
   *
   * 1 USD = 90.00
   */

  const usdSwift = findRate(
    blocks.usdSwift,
    [

      /1\s*USD\s*=?\s*([\d.]+)/i,

      /USD\s*=?\s*([\d.]+)/i,

      /1\s*US[D0O]\s*=?\s*([\d.]+)/i,

      /*
       * Запасной вариант:
       * если SWIFT распознался,
       * но USD нет.
       */

      /SWIFT.{0,80}?(\d{2,3}\.\d{2})/i
    ]
  );


  /*
   * ==========================================================
   * JPY SWIFT
   * ==========================================================
   *
   * На картинке:
   *
   * 100 JPY = 56.90
   */

  const jpySwift = findRate(
    blocks.jpySwift,
    [

      /100\s*JPY\s*=?\s*([\d.]+)/i,

      /100\s*JP[YV]\s*=?\s*([\d.]+)/i,

      /JPY\s*=?\s*([\d.]+)/i
    ]
  );


  /*
   * ==========================================================
   * CNY
   * ==========================================================
   *
   * На картинке:
   *
   * 1 CNY = 13.45
   */

  const cny = findRate(
    blocks.china,
    [

      /1\s*CNY\s*=?\s*([\d.]+)/i,

      /CNY\s*=?\s*([\d.]+)/i,

      /CN[YV]\s*=?\s*([\d.]+)/i,

      /1\s*CN[YWV]\s*=?\s*([\d.]+)/i
    ]
  );


  /*
   * ==========================================================
   * THB
   * ==========================================================
   *
   * На картинке:
   *
   * 1 THB = 2.74
   */

  const thb = findRate(
    blocks.thailand,
    [

      /1\s*THB\s*=?\s*([\d.]+)/i,

      /THB\s*=?\s*([\d.]+)/i,

      /1\s*T[HН]B\s*=?\s*([\d.]+)/i,

      /T[HН]B\s*=?\s*([\d.]+)/i
    ]
  );


  /*
   * ==========================================================
   * USD IDUBID
   * ==========================================================
   *
   * На картинке:
   *
   * 1 USD = 91.50
   */

  const usdIdubid = findRate(
    blocks.idubid,
    [

      /1\s*USD\s*=?\s*([\d.]+)/i,

      /USD\s*=?\s*([\d.]+)/i,

      /1\s*US[D0O]\s*=?\s*([\d.]+)/i
    ]
  );


  /*
   * ==========================================================
   * AFA CASH
   * ==========================================================
   *
   * На картинке:
   *
   * 1 JPY = 57.30
   */

  const jpyCash = findRate(
    blocks.afaCash,
    [

      /1\s*JPY\s*=?\s*([\d.]+)/i,

      /JPY\s*=?\s*([\d.]+)/i
    ]
  );


  /*
   * ==========================================================
   * AFA QR
   * ==========================================================
   *
   * На картинке:
   *
   * 1 JPY = 56.90
   */

  const jpyQr = findRate(
    blocks.afaQr,
    [

      /1\s*JPY\s*=?\s*([\d.]+)/i,

      /JPY\s*=?\s*([\d.]+)/i
    ]
  );


  /*
   * ==========================================================
   * ЛОГ
   * ==========================================================
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
   * ==========================================================
   * ФИНАЛЬНЫЕ ЗНАЧЕНИЯ
   * ==========================================================
   *
   * ВАЖНО:
   *
   * На картинке:
   *
   * 100 JPY = 56.90
   *
   * Поэтому для внутреннего расчёта:
   *
   * 1 JPY = 0.569
   *
   * Но мы также сохраняем оригинальные
   * значения JPY выше.
   */

  const rates = {

    /*
     * 100 JPY = 56.90
     */

    JPY_INTERNAL:
      jpyInternal
        ? jpyInternal / 100
        : 0,

    /*
     * 100 JPY = 56.90
     */

    JPY_SWIFT:
      jpySwift
        ? jpySwift / 100
        : 0,

    /*
     * 1 JPY = 57.30
     */

    JPY_CASH:
      jpyCash,

    /*
     * 1 JPY = 56.90
     */

    JPY_QR:
      jpyQr,

    /*
     * 1000 KRW = 65.10
     *
     * 1 KRW = 0.0651
     */

    KRW:
      krw
        ? krw / 1000
        : 0,

    /*
     * 1 CNY = 13.45
     */

    CNY:
      cny,

    /*
     * 1 AED = 23.60
     */

    AED:
      aed,

    /*
     * 1 THB = 2.74
     */

    THB:
      thb,

    /*
     * 1 USD = 90.00
     */

    USD_SWIFT:
      usdSwift,

    /*
     * 1 USD = 91.50
     */

    USD_IDUBID:
      usdIdubid
  };


  return {
    rates,
    blocks
  };
}


/* ============================================================
   API HANDLER
============================================================ */

async function handler(req, res) {

  try {

    /*
     * Получаем самый свежий пост
     * из Telegram.
     */

    const latest = await getLatestImage();

    if (!latest) {
      throw new Error(
        "Telegram не вернул новый пост"
      );
    }


    console.log("");
    console.log(
      `Найден Telegram пост: ${latest.postId}`
    );


    /*
     * Если этот пост уже обрабатывали,
     * не запускаем OCR повторно.
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


    /*
     * ========================================================
     * СКАЧИВАЕМ КАРТИНКУ
     * ========================================================
     */

    const image = await downloadImage(
      latest.imageUrl
    );


    /*
     * ========================================================
     * OCR
     * ========================================================
     */

    const parsed =
      await parseRatesFromImage(
        image
      );

    const rates =
      parsed.rates;


    /*
     * ========================================================
     * ПРОВЕРЯЕМ ОБЯЗАТЕЛЬНЫЕ КУРСЫ
     * ========================================================
     */

    const required = [

      ["KRW", rates.KRW],

      ["AED", rates.AED],

      ["USD_SWIFT", rates.USD_SWIFT],

      ["JPY_INTERNAL", rates.JPY_INTERNAL],

      ["JPY_SWIFT", rates.JPY_SWIFT],

      ["CNY", rates.CNY],

      ["THB", rates.THB],

      ["USD_IDUBID", rates.USD_IDUBID],

      ["JPY_CASH", rates.JPY_CASH],

      ["JPY_QR", rates.JPY_QR]
    ];


    const missing =
      required
        .filter(
          ([name, value]) => !value
        )
        .map(
          ([name]) => name
        );


    /*
     * ========================================================
     * ВСЁ РАСПОЗНАНО
     * ========================================================
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


      console.log("");
      console.log(
        "КУРСЫ УСПЕШНО ОБНОВЛЕНЫ"
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
    }


    /*
     * ========================================================
     * ЧАСТЬ КУРСОВ НЕ РАСПОЗНАНА
     * ========================================================
     */

    console.log("");
    console.log(
      "НЕ РАСПОЗНАНЫ:",
      missing
    );


    /*
     * Если ранее были рабочие курсы,
     * НЕ ломаем сайт.
     *
     * Оставляем предыдущие значения.
     */

    if (cachedResult) {

      return res.json({

        success: true,

        cached: true,

        warning:
          "Новый пост найден, но OCR не смог распознать все курсы. Используются последние корректные курсы.",

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
     * ========================================================
     * ПЕРВЫЙ ПОСТ И OCR НЕ СПРАВИЛСЯ
     * ========================================================
     */

    return res.status(502).json({

      success: false,

      error:
        "OCR не смог распознать: " +
        missing.join(", "),

      postId:
        latest.postId,

      imageUrl:
        latest.imageUrl,

      rates:
        rates,

      blocks:
        parsed.blocks
    });


  } catch (error) {

    console.error("");
    console.error(
      "RATES ERROR:",
      error
    );


    /*
     * Если есть старые рабочие данные,
     * сайт продолжает работать.
     */

    if (cachedResult) {

      return res.json({

        success: true,

        cached: true,

        warning:
          "Временная ошибка получения нового курса. Используются последние рабочие данные.",

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
     * Если рабочих данных ещё нет.
     */

    return res.status(500).json({

      success: false,

      error:
        error.message ||
        "Ошибка получения курсов из Telegram."
    });
  }
}


/* ============================================================
   EXPORT
============================================================ */

module.exports = handler;
