const express = require("express");
const path = require("path");

const ratesHandler = require("./rates");
const imageHandler = require("./telegram-image");

const app = express();

const PORT =
  process.env.PORT || 10000;

app.disable("x-powered-by");

app.use(express.json());

/*
|--------------------------------------------------------------------------
| Статический сайт
|--------------------------------------------------------------------------
*/

app.use(
  express.static(
    path.join(__dirname, "public"),
    {
      maxAge: "1h"
    }
  )
);

/*
|--------------------------------------------------------------------------
| API
|--------------------------------------------------------------------------
*/

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      ok: true,
      service: "loyalty-swift",
      telegram:
        "https://t.me/LoyaltySwift",
      ocr: "local-tesseract",
      time:
        new Date().toISOString()
    });
  }
);

app.get(
  "/api/telegram-image",
  async (req, res) => {
    try {
      await imageHandler(
        req,
        res
      );
    } catch (error) {
      console.error(error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error:
            error.message ||
            "Telegram image error"
        });
      }
    }
  }
);

app.get(
  "/api/rates",
  async (req, res) => {
    try {
      await ratesHandler(
        req,
        res
      );
    } catch (error) {
      console.error(error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error:
            error.message ||
            "Rates error"
        });
      }
    }
  }
);

/*
|--------------------------------------------------------------------------
| Главная страница
|--------------------------------------------------------------------------
*/

app.get(
  "*",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/*
|--------------------------------------------------------------------------
| Запуск
|--------------------------------------------------------------------------
*/

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `LoyaltySwift server running on port ${PORT}`
    );
  }
);
