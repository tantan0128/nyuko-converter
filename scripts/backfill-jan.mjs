/* ワンショットスクリプト: A列JAN空欄の商品にB列コードからJANを自動補完
 * 対象: B列コードのハイフン後12桁+先頭0補完で13桁JANになり、チェックディジットOKのもの
 * 安全: 対象行のA列が空欄であることを確認してから書き込む
 */
import { google } from "googleapis";
import fs from "fs";

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || "";
const home = process.env.HOME || "/home/aiuser";
const tokenPath = `${home}/.hermes/google_token.json`;
const clientPath = `${home}/.hermes/google-oauth-client.json`;

const token = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
const client = JSON.parse(fs.readFileSync(clientPath, "utf8"));
const oauth = new google.auth.OAuth2(
  client.installed?.client_id || client.web?.client_id,
  client.installed?.client_secret || client.web?.client_secret,
  client.installed?.redirect_uris?.[0] || "http://localhost"
);
oauth.setCredentials({
  refresh_token: token.refresh_token,
  access_token: token.token,
  expiry_date: token.expiry ? new Date(token.expiry).getTime() : undefined,
  scope: (token.scopes || []).join(" "),
});
const sheets = google.sheets({ version: "v4", auth: oauth });

// 補完対象: code -> 補完JAN（チェックディジットOKのみ）
const TARGETS = {
  "sa-081492401315": "0081492401315",
  "sa-081492401308": "0081492401308",
  "sa-490359380210": "0490359380210",
  "sa-490359380227": "0490359380227",
  "sa-490359380319": "0490359380319",
  "sa-490359380326": "0490359380326",
  "yy-719812363912": "0719812363912",
  "yy-719812688510": "0719812688510",
};

async function main() {
  // 全行取得（A:E）— 行番号マップ構築
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "全商品取り扱いリスト!A2:E",
  });
  const rows = res.data.values || [];
  console.log(`全行: ${rows.length}`);

  const rowIndexByCode = new Map();
  rows.forEach((r, i) => {
    const code = String(r[1] || "").trim();
    if (code) rowIndexByCode.set(code, i + 2); // 1-indexed (ヘッダー行+1)
  });

  let updated = 0;
  let skipped = 0;
  for (const [code, jan] of Object.entries(TARGETS)) {
    const rowIndex = rowIndexByCode.get(code);
    if (!rowIndex) {
      console.log(`SKIP: ${code} がシートに見つからない`);
      skipped++;
      continue;
    }
    // A列の現値を確認（rowIndex-1 が rows の index）
    const idx = rowIndex - 2;
    const currentA = String(rows[idx]?.[0] || "").trim();
    if (currentA !== "") {
      console.log(`SKIP: ${code} のA列は既に「${currentA}」があるため変更しない`);
      skipped++;
      continue;
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `全商品取り扱いリスト!A${rowIndex}`,
      valueInputOption: "RAW",
      requestBody: { values: [[jan]] },
    });
    console.log(`OK: ${code} A${rowIndex} <- ${jan}`);
    updated++;
  }
  console.log(`\n完了: 更新${updated}件 / スキップ${skipped}件`);
}

main().catch((e) => {
  console.error("エラー:", e.message);
  process.exit(1);
});
