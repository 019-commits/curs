const {
  getLatestImage
} = require("./telegram");

const {
  createWorker
} = require("tesseract.js");


/*
=========================================================
  НАСТРОЙКИ
=========================================================
*/

const CACHE_TIME =
  5 * 60 * 1000;


/*
=========================================================
  ПАМЯТЬ ПОСЛЕДНИХ КУРСОВ
=========================================================

  Это очень важно.

  Если Telegram временно недоступен
  или OCR не смог прочитать картинку,
  сайт не ломается.

  Используются последние успешные курсы.
*/

let cache = {
  postId: null,
  imageUrl: null,
  postUrl: null,
  rates: null,
  rawText: null,
  updatedAt: null,
  expiresAt: 0
};


/*
=========================================================
  ЧИСЛО
=========================================================
*/

function number(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  const normalized =
    String(value)
      .replace(",", ".")
      .replace(/[^0-9.]/g, "");

  const result =
    Number(normalized);

  return Number.isFinite(result)
    ? result
    : 0;
}


/*
=========================================================
  ПОИСК ЧИСЛА
=========================================================
*/

function firstMatch(text, patterns) {

  for (const pattern of patterns) {

    const match =
      text.match(pattern);

    if (match) {
      return number(match[1]);
    }
  }

  return 0;
}


/*
=========================================================
  НОРМАЛИЗАЦИЯ OCR
=========================================================
*/

function normalizeText(rawText) {

  return String(rawText || "")
    .replace(/\u00a0/g, " ")

    /*
      OCR иногда путает:
      O → 0
      I → 1
    */

    .replace(/O(?=\d)/gi, "0")
    .replace(/(?<=\d)O/gi, "0")

    /*
      Разные варианты тире.
    */

    .replace(/[–—−]/g, "-")

    /*
      Убираем лишние пробелы.
    */

    .replace(/\s+/g, " ")

    .trim();
}


/*
=========================================================
  РАСПОЗНАВАНИЕ КУРСОВ
=========================================================
*/

function parseRates(rawText) {

  const text =
    normalizeText(rawText);


  /*
  -------------------------------------------------------
    JPY
  -------------------------------------------------------
  */

  const jpy =
    firstMatch(text, [

      /100\s*JPY\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,

      /JPY[^0-9]{0,40}=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]);


  /*
  -------------------------------------------------------
    KRW
  -------------------------------------------------------
  */

  const krw =
    firstMatch(text, [

      /1000\s*KRW\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,

      /KRW[^0-9]{0,40}=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]);


  /*
  -------------------------------------------------------
    CNY
  -------------------------------------------------------
  */

  const cny =
    firstMatch(text, [

      /1\s*(?:CNY|RMB)\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,

      /(?:CNY|RMB)[^0-9]{0,40}=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]);


  /*
  -------------------------------------------------------
    AED
  -------------------------------------------------------
  */

  const aed =
    firstMatch(text, [

      /1\s*AED\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,

      /AED[^0-9]{0,40}=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]);


  /*
  -------------------------------------------------------
    THB
  -------------------------------------------------------
  */

  const thb =
    firstMatch(text, [

      /1\s*THB\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,

      /THB[^0-9]{0,40}=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]);


  /*
  -------------------------------------------------------
    USD
  -------------------------------------------------------
  */

  const usd =
    firstMatch(text, [

      /1\s*USD\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,

      /USD[^0-9]{0,40}=\s*([0-9]+(?:[.,][0-9]+)?)/i
    ]);


  /*
  -------------------------------------------------------
    IDUBID USD
  -------------------------------------------------------
  */

  const usdIdubid =
    firstMatch(text, [

      /IDUBID[^0-9]{0,100}1\s*USD\s*=\s*([0-9]+(?:[.,][0-9]+)?)/i,

      /IDUBID[^0-9]{0,100}USD[^0-9]{0,30}([0-9]+(?:[.,][0-9]+)?)/i
    ]);


  /*
  -------------------------------------------------------
    JPY → RUB за 1 JPY
  -------------------------------------------------------

    Telegram:
      100 JPY = 56.90

    Калькулятор:
      1 JPY = 0.569 RUB
  -------------------------------------------------------
  */

  const jpyPerOne =
    jpy
      ? jpy / 100
      : 0;


  /*
  -------------------------------------------------------
    KRW → RUB за 1 KRW
  -------------------------------------------------------
  */

  const krwPerOne =
    krw
      ? krw / 1000
      : 0;


  /*
  -------------------------------------------------------
    Результат
  -------------------------------------------------------
  */

  const rates = {

    JPY_INTERNAL:
      jpyPerOne,

    JPY_SWIFT:
      jpyPerOne,

    JPY_CASH:
      jpyPerOne,

    JPY_QR:
      jpyPerOne,

    KRW:
      krwPerOne,

    CNY:
      cny,

    AED:
      aed,

    THB:
      thb,

    USD_SWIFT:
      usd,

    USD_IDUBID:
      usdIdubid || usd
  };


  /*
  -------------------------------------------------------
    Проверяем обязательные значения
  -------------------------------------------------------
  */

  const required = [
    "JPY_SWIFT",
    "CNY",
    "KRW",
    "AED",
    "THB",
    "USD_SWIFT"
  ];


  const missing =
    required.filter(
      key => !rates[key]
    );


  return {
    rates,
    missing,
    rawText: text
  };
}


/*
=========================================================
  СКАЧИВАНИЕ КАРТИНКИ TELEGRAM
=========================================================
*/

async function downloadImage(url) {

  const response =
    await fetch(url, {

      headers: {
        "User-Agent":
          "Mozilla/5.0"
      },

      cache: "no-store"
    });


  if (!response.ok) {

    throw new Error(
      `Ошибка загрузки изображения Telegram: HTTP ${response.status}`
    );
  }


  const arrayBuffer =
    await response.arrayBuffer();


  return Buffer.from(
    arrayBuffer
  );
}


/*
=========================================================
  OCR
=========================================================
*/

async function ocrImage(imageBuffer) {

  console.log(
    "Запускаем локальный OCR..."
  );


  /*
    Создаём worker.

    Язык:
      rus + eng

    Нам нужны одновременно
    русские названия и валюты:
      USD
      JPY
      KRW
      CNY
      AED
      THB
  */

  const worker =
    await createWorker(
      "rus+eng"
    );


  try {

    const result =
      await worker.recognize(
        imageBuffer
      );


    const text =
      result?.data?.text || "";


    if (!text.trim()) {

      throw new Error(
        "OCR не распознал текст на изображении."
      );
    }


    console.log(
      "OCR результат:",
      text
    );


    return text;

  } finally {

    await worker.terminate();
  }
}


/*
=========================================================
  ПОЛУЧЕНИЕ КУРСОВ
=========================================================
*/

async function getRates() {


  /*
  -------------------------------------------------------
    Если кэш ещё актуален,
    не обращаемся к Telegram.
  -------------------------------------------------------
  */

  if (
    cache.rates &&
    Date.now() < cache.expiresAt
  ) {

    return {
      success: true,

      source:
        "Telegram @LoyaltySwift",

      cached: true,

      postId:
        cache.postId,

      postUrl:
        cache.postUrl,

      imageUrl:
        cache.imageUrl,

      updatedAt:
        cache.updatedAt,

      rates:
        cache.rates
    };
  }


  /*
  -------------------------------------------------------
    Получаем последнюю картинку.
  -------------------------------------------------------
  */

  const latest =
    await getLatestImage();


  /*
  -------------------------------------------------------
    Если это тот же пост,
    не делаем OCR повторно.
  -------------------------------------------------------
  */

  if (
    cache.rates &&
    cache.postId === latest.postId
  ) {

    cache.expiresAt =
      Date.now() + CACHE_TIME;


    return {

      success: true,

      source:
        "Telegram @LoyaltySwift",

      cached: true,

      postId:
        cache.postId,

      postUrl:
        cache.postUrl,

      imageUrl:
        cache.imageUrl,

      updatedAt:
        cache.updatedAt,

      rates:
        cache.rates
    };
  }


  /*
  -------------------------------------------------------
    Новый пост.
    Скачиваем новую картинку.
  -------------------------------------------------------
  */

  const image =
    await downloadImage(
      latest.imageUrl
    );


  /*
  -------------------------------------------------------
    OCR
  -------------------------------------------------------
  */

  const rawText =
    await ocrImage(image);


  /*
  -------------------------------------------------------
    Парсим курсы.
  -------------------------------------------------------
  */

  const parsed =
    parseRates(rawText);


  /*
  -------------------------------------------------------
    Если не смогли найти
    необходимые курсы —
    НЕ уничтожаем старый кэш.
  -------------------------------------------------------
  */

  if (
    parsed.missing.length
  ) {

    console.error(
      "Не распознаны:",
      parsed.missing
    );

    console.error(
      "OCR TEXT:",
      rawText
    );


    /*
      Если старые курсы есть,
      продолжаем работать на них.
    */

    if (cache.rates) {

      return {

        success: true,

        source:
          "Telegram @LoyaltySwift",

        cached: true,

        ocrError: true,

        warning:
          "Новый курс не удалось распознать. Используются последние корректные значения.",

        postId:
          cache.postId,

        postUrl:
          cache.postUrl,

        imageUrl:
          cache.imageUrl,

        updatedAt:
          cache.updatedAt,

        rates:
          cache.rates
      };
    }


    throw new Error(
      "Не удалось распознать необходимые курсы: " +
      parsed.missing.join(", ")
    );
  }


  /*
  -------------------------------------------------------
    Сохраняем новый кэш.
  -------------------------------------------------------
  */

  cache = {

    postId:
      latest.postId,

    imageUrl:
      latest.imageUrl,

    postUrl:
      latest.postUrl,

    rates:
      parsed.rates,

    rawText:
      rawText,

    updatedAt:
      new Date().toISOString(),

    expiresAt:
      Date.now() + CACHE_TIME
  };


  return {

    success: true,

    source:
      "Telegram @LoyaltySwift",

    cached: false,

    postId:
      latest.postId,

    postUrl:
      latest.postUrl,

    imageUrl:
      latest.imageUrl,

    updatedAt:
      cache.updatedAt,

    rates:
      cache.rates
  };
}


/*
=========================================================
  RENDER HANDLER
=========================================================
*/

module.exports =
  async function handler(
    req,
    res
  ) {

    try {

      const result =
        await getRates();


      res.setHeader(
        "Content-Type",
        "application/json; charset=utf-8"
      );


      /*
        Кэш браузера/прокси —
        60 секунд.
      */

      res.setHeader(
        "Cache-Control",
        "public, max-age=60, stale-while-revalidate=300"
      );


      res.status(200
