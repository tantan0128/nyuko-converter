import { google } from 'googleapis';

const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheets = google.sheets({ version: 'v4', auth });

const r = await sheets.spreadsheets.values.get({
  spreadsheetId: process.env.SPREADSHEET_ID,
  range: '全商品取り扱いリスト!A:C'
});

const rows = r.data.values || [];
// JANが数字でないsd-商品（fuzokuhinなど）
const sdNoJan = rows.filter(row => row[1] && row[1].startsWith('sd-') && !(/^\d{8,}/.test(row[1].replace('sd-',''))));
console.log('sd-JANなし商品: ' + sdNoJan.length + '件');
sdNoJan.forEach(row => console.log('  ' + JSON.stringify(row)));
