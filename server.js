const express = require('express');
const path = require('path');
const ratesHandler = require('./rates');
const imageHandler = require('./telegram-image');

const app = express();
const PORT = process.env.PORT || 10000;
app.disable('x-powered-by');
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

function runHandler(handler, req, res) {
  return Promise.resolve(handler(req, res)).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.status(500).json({success:false,error:e.message});
  });
}

app.get('/api/telegram-image', (req, res) => runHandler(imageHandler, req, res));
app.get('/api/rates', (req, res) => runHandler(ratesHandler, req, res));

app.get('/api/health', (req,res) => res.json({ok:true, time:new Date().toISOString()}));
app.get(/.*/, (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`Server listening on ${PORT}`));
