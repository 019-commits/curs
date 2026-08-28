const { getLatestImage } = require("./telegram");
const { createWorker } = require("tesseract.js");

let workerPromise = null;

let cachedResult = null;
let cachedPostId = null;

async function getWorker() {
  if (!workerPromise) {
    console.log("Запускаю Tesseract...");

    workerPromise = createWorker(["eng", "rus"], 1, {
      logger: function (message) {
        if (message.status === "recognizing text") {
          const percent = Math.round(
            (message.progress || 0) * 100
          );

          console.log(`OCR: ${percent}%`);
        }
      }
    });
  }

  return workerPromise;
}

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

  const arrayBuffer = await response.arrayBuffer();

  return Buffer.from(arrayBuffer);
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/(\d),(\d)/g, "$1.$2")
    .trim();
}

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

function find(text, regexes) {
  for (const regex of regexes) {
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

function parseRates(rawText) {
  const text = normalizeText(rawText);

  console.log("========== OCR TEXT ==========");
  console.log(text);
  console.log("===============================");

  /*
   * USD
   *
   * OCR у нас сейчас читает:
   *
   * a AoE ыы 150 = 90.00
   *
   * Поэтому ищем не только USD,
   * но и характерную конструкцию:
   *
   * число = 90.00
   */

  let usd = find(text, [
    /1\s*USD\s*=?\s*([\d.,]+)/i,
    /USD[\s:=\-]+([\d.,]+)/i,
    /SWIFT[\s\S]{0,150}?=\s*([\d.,]+)/i
  ]);

  /*
   * В твоей картинке SWIFT USD = 90.00.
   *
   * Если OCR совсем испортил USD,
   * берём число после SWIFT.
   */

  if (!usd) {
    const swiftMatch = text.match(
      /SWIFT[\s\S]{0,150}?(\d{2,3}[.,]\d{2})/i
    );

    if (swiftMatch) {
      usd = number(swiftMatch[1]);
    }
  }

  /*
   * JPY
   *
   * 100 JPY = 56.90
   */

  let jpy = find(text, [
    /100\s*JPY\s*=?\s*([\d.,]+)/i,
    /JPY[\s:=\-]+([\d.,]+)/i
  ]);

  /*
   * Если JPY написан нормально —
   * это наш основной курс.
   */

  if (!jpy) {
    const jpyMatch = text.match(
      /100\s*J[PJYI]\s*=?\s*([\d.,]+)/i
    );

    if (jpyMatch) {
      jpy = number(jpyMatch[1]);
    }
  }

  /*
   * KRW
   *
   * 1000 KRW = 65.10
   */

  let krw = find(text, [
    /1000\s*KRW\s*=?\s*([\d.,]+)/i,
    /KRW[\s:=\-]+([\d.,]+)/i
  ]);

  /*
   * Иногда OCR путает KRW.
   * Но 1000 + число курса встречается
   * очень характерно.
   */

  if (!krw) {
    const krwMatch = text.match(
      /1000\s*[KК][RЯ][WШ]\s*=?\s*([\d.,]+)/i
    );

    if (krwMatch) {
      krw = number(krwMatch[1]);
    }
  }

  /*
   * CNY
   *
   * OCR может вообще потерять CNY.
   *
   * На картинке рядом есть:
   *
   * КИТАЙ
   *
   * Поэтому сначала ищем CNY/RMB,
   * затем КИТАЙ и ближайшее число.
   */

  let cny = find(text, [
    /1\s*CNY\s*=?\s*([\d.,]+)/i,
    /CNY[\s:=\-]+([\d.,]+)/i,
    /RMB[\s:=\-]+([\d.,]+)/i
  ]);

  if (!cny) {
    const chinaMatch = text.match(
      /КИТАЙ[\s\S]{0,150}?(\d{1,3}[.,]\d{2})/i
    );

    if (chinaMatch) {
      cny = number(chinaMatch[1]);
    }
  }

  /*
   * AED
   *
   * OCR в нашем случае:
   *
   * 1АЕр = 23.60
   *
   * Поэтому разрешаем:
   *
   * AED
   * AЕD
   * АЕр
   * AEP
   * и другие близкие варианты.
   */

  let aed = find(text, [
    /1\s*AED\s*=?\s*([\d.,]+)/i,
    /AED[\s:=\-]+([\d.,]+)/i,
    /АЕ[DPР]\s*=?\s*([\d.,]+)/i,
    /AЕ[DPР]\s*=?\s*([\d.,]+)/i
  ]);

  /*
   * Самый надёжный вариант для этой картинки:
   *
   * АЕр = 23.60
   */

  if (!aed) {
    const aedMatch = text.match(
      /АЕ[DPР]\s*=?\s*(\d{1,3}[.,]\d{2})/i
    );

    if (aedMatch) {
      aed = number(aedMatch[1]);
    }
  }

  /*
   * THB
   */

  let thb = find(text, [
    /1\s*THB\s*=?\s*([\d.,]+)/i,
    /THB[\s:=\-]+([\d.,]+)/i
  ]);

  /*
   * OCR иногда превращает THB
   * в похожие символы.
   */

  if (!thb) {
    const thbMatch = text.match(
      /1\s*T[HН][BВ8]\s*=?\s*([\d.,]+)/i
    );

    if (thbMatch) {
      thb = number(thbMatch[1]);
    }
  }

  /*
   * Выводим найденные значения в лог.
   */

  console.log("PARSED RATES:");
  console.log({
    USD: usd,
    JPY: jpy,
    KRW: krw,
    CNY: cny,
    AED: aed,
    THB: thb
  });

  /*
   * Для JPY:
   *
   * 100 JPY = 56.90
   *
   * значит:
   *
   * 1 JPY = 0.569
   */

  const rates = {
    JPY_INTERNAL: jpy
      ? jpy / 100
      : 0,

    JPY_SWIFT: jpy
      ? jpy / 100
      : 0,

    JPY_CASH: jpy
      ? jpy / 100
      : 0,

    JPY_QR: jpy
      ? jpy / 100
      : 0,

    /*
     * 1000 KRW = 65.10
     *
     * 1 KRW = 0.0651
     */

    KRW: krw
      ? krw / 1000
      : 0,

    CNY: cny,

    AED: aed,

    THB: thb,

    USD_SWIFT: usd,

    USD_IDUBID: usd
  };

  return rates;
}

async function handler(req, res) {
  try {
    const latest = await getLatestImage();

    /*
     * Если этот пост уже распознавали —
     * отдаём сохранённый результат.
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

    const image = await downloadImage(
      latest.imageUrl
    );

    const worker = await getWorker();

    const result = await worker.recognize(image);

    const text =
      result &&
      result.data &&
      result.data.text
        ? result.data.text
        : "";

    if (!text.trim()) {
      throw new Error(
        "Tesseract не распознал текст."
      );
    }

    const rates = parseRates(text);

    /*
     * Проверяем основные курсы.
     */
    const required = [
      ["USD_SWIFT", rates.USD_SWIFT],
      ["JPY_SWIFT", rates.JPY_SWIFT],
      ["KRW", rates.KRW],
      ["CNY", rates.CNY],
      ["AED", rates.AED],
      ["THB", rates.THB]
    ];

    const missing = required
      .filter(function (item) {
        return !item[1];
      })
      .map(function (item) {
        return item[0];
      });

    if (missing.length > 0) {
      /*
       * Если старые курсы есть —
       * продолжаем работать на них.
       */
      if (cachedResult) {
        return res.json({
          success: true,
          cached: true,
          warning:
            "Новая картинка найдена, но OCR не смог прочитать все курсы. Используются последние рабочие курсы.",
          source:
            "Telegram @LoyaltySwift",
          postId: cachedResult.postId,
          postUrl: cachedResult.postUrl,
          imageUrl: cachedResult.imageUrl,
          updatedAt: cachedResult.updatedAt,
          rates: cachedResult.rates
        });
      }

      return res.status(502).json({
        success: false,
        error:
          "OCR не смог распознать: " +
          missing.join(", "),
        postId: latest.postId,
        rawText: text
      });
    }

    /*
     * Сохраняем успешно распознанные курсы.
     */
    cachedPostId = latest.postId;

    cachedResult = {
      postId: latest.postId,
      postUrl: latest.postUrl,
      imageUrl: latest.imageUrl,
      updatedAt: new Date().toISOString(),
      rates: rates
    };

    res.setHeader(
      "Cache-Control",
      "public, max-age=60, s-maxage=60"
    );

    return res.json({
      success: true,
      cached: false,
      source: "Telegram @LoyaltySwift",
      postId: latest.postId,
      postUrl: latest.postUrl,
      imageUrl: latest.imageUrl,
      updatedAt: cachedResult.updatedAt,
      rates: rates
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
          "Временная ошибка обновления. Используются последние рабочие курсы.",
        source:
          "Telegram @LoyaltySwift",
        postId: cachedResult.postId,
        postUrl: cachedResult.postUrl,
        imageUrl: cachedResult.imageUrl,
        updatedAt: cachedResult.updatedAt,
        rates: cachedResult.rates
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
