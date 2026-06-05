// Vercel Function: PDF を Google Drive にアップロード
// 環境変数: GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_DRIVE_FOLDER_ID

import crypto from 'crypto';

// RSA-SHA256でJWTを署名してアクセストークンを取得
async function getAccessToken() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  // crypto.sign() はPKCS#8形式のキーを直接受け取れる（Node.js 12+）
  const signature = crypto.sign(
    'sha256',
    Buffer.from(`${header}.${payload}`),
    { key: rawKey, padding: crypto.constants.RSA_PKCS1_PADDING }
  ).toString('base64url');
  const jwt = `${header}.${payload}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) throw new Error(`token_error: ${await tokenRes.text()}`);
  const { access_token } = await tokenRes.json();
  return { access_token, folderId };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { pdfBase64, fileName, siteName, date } = req.body;

    const { access_token, folderId } = await getAccessToken();

    // フォルダ構成: KY記録/{現場名}/{YYYY-MM-DD}/
    // Google DriveはAPIで階層を自動作成できないため、フォルダを逐次作成する
    const safeSite = (siteName || '不明').slice(0, 50);
    const safeDate = date || new Date().toISOString().slice(0, 10);

    // 現場名フォルダを作成または取得
    const siteFolder = await getOrCreateFolder(access_token, safeSite, folderId);
    // 日付フォルダを作成または取得
    const dateFolder = await getOrCreateFolder(access_token, safeDate, siteFolder);

    // PDF をアップロード
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const metadata = JSON.stringify({ name: fileName, parents: [dateFolder] });
    const boundary = 'boundary_ky_upload';

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
      Buffer.from(metadata),
      Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`),
      pdfBuffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
          'Content-Length': body.length,
        },
        body,
      }
    );

    if (!uploadRes.ok) throw new Error(`drive_error(${uploadRes.status}): ${await uploadRes.text()}`);
    const result = await uploadRes.json();

    return res.status(200).json({ success: true, fileId: result.id, fileName: result.name });

  } catch (err) {
    console.error('upload-ky error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// フォルダを取得 or 作成
async function getOrCreateFolder(token, name, parentId) {
  // 既存フォルダを検索
  const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`);
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { files } = await searchRes.json();
  if (files && files.length > 0) return files[0].id;

  // なければ作成
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const folder = await createRes.json();
  return folder.id;
}
