// Vercel Function: PDF を Google Drive にアップロード
// OAuth2 リフレッシュトークン方式（個人Googleアカウント対応）

async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('token_error: ' + JSON.stringify(data));
  return { access_token: data.access_token, folderId: process.env.GOOGLE_DRIVE_FOLDER_ID };
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

    const safeSite = (siteName || '不明').slice(0, 50);
    const safeDate = date || new Date().toISOString().slice(0, 10);

    const siteFolder = await getOrCreateFolder(access_token, safeSite, folderId);
    const kyFolder = await getOrCreateFolder(access_token, 'KY記録', siteFolder);
    const dateFolder = await getOrCreateFolder(access_token, safeDate, kyFolder);

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const metadata = JSON.stringify({ name: fileName, parents: [dateFolder] });
    const boundary = 'ky_boundary_v2';

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
    console.error('upload error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function getOrCreateFolder(token, name, parentId) {
  const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`);
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { files } = await searchRes.json();
  if (files && files.length > 0) return files[0].id;

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const folder = await createRes.json();
  return folder.id;
}
