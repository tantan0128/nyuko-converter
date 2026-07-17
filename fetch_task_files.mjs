/**
 * Manus APIでタスクのメッセージ一覧を取得してPDFファイルを探す
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL || "https://forge.manus.ai";
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;

// agent-default-main_task でメッセージ一覧を取得
const res = await fetch(`https://api.manus.im/v2/task.listMessages?task_id=agent-default-main_task&limit=100`, {
  headers: {
    "x-manus-api-key": FORGE_API_KEY,
    "Content-Type": "application/json"
  }
});

const data = await res.json();
console.log("Status:", res.status);
console.log("ok:", data.ok);

if (!data.ok) {
  console.log("Error:", JSON.stringify(data.error));
  process.exit(1);
}

console.log("\nメッセージ数:", data.data?.messages?.length || 0);

// PDFファイルを含むメッセージを探す
const messages = data.data?.messages || [];
for (const msg of messages) {
  if (msg.attachments && msg.attachments.length > 0) {
    for (const att of msg.attachments) {
      if (att.name?.endsWith('.pdf') || att.mime_type?.includes('pdf')) {
        console.log("\nPDF発見:", att.name, att.url || att.file_id);
      }
    }
  }
}
