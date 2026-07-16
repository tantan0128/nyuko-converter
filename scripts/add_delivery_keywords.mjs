import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
try {
  await conn.execute("ALTER TABLE products ADD COLUMN deliveryKeywords text NULL");
  console.log('OK: deliveryKeywords column added');
} catch(e) {
  if (e.code === 'ER_DUP_FIELDNAME') {
    console.log('Column already exists, skipping');
  } else {
    console.error('Error:', e.message);
  }
} finally {
  await conn.end();
}
