// 現場名リスト管理API
// GET  /api/sites  → 現場名配列を返す
// POST /api/sites  → { password, sites } で更新

const CONFIG_FILE_NAME = '_sites_config.json';

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
  return data.access_token;
}

async function findConfigFile(token, folderId) {
  const q = encodeURIComponent(
    `name='${CONFIG_FILE_NAME}' and '${folderId}' in parents and trashed=false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const { files } = await res.json();
  return files && files.length > 0 ? files[0].id : null;
}

async function readConfigFile(token, fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.json();
}

async function getOrCreateFolder(token, name, parentId) {
  const q = encodeURIComponent(
    `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const { files } = await searchRes.json();
  if (files && files.length > 0) return files[0].id;

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  if (!createRes.ok) throw new Error(`folder_create_error(${createRes.status})`);
  const folder = await createRes.json();
  return folder.id;
}

async function writeConfigFile(token, folderId, sites, existingFileId) {
  const content = JSON.stringify({ sites }, null, 2);
  const metadata = JSON.stringify(
    existingFileId ? {} : { name: CONFIG_FILE_NAME, parents: [folderId] }
  );
  const boundary = 'sites_boundary';
  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    metadata,
    `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ].join('');

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  const res = await fetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`drive_write_error(${res.status}): ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  try {
    if (req.method === 'GET') {
      const token = await getAccessToken();
      const fileId = await findConfigFile(token, folderId);
      if (!fileId) {
        // 設定ファイルが存在しない場合は空配列を返す（初期状態）
        return res.status(200).json({ sites: [] });
      }
      const config = await readConfigFile(token, fileId);
      return res.status(200).json({ sites: config.sites || [] });
    }

    if (req.method === 'POST') {
      const { password, sites } = req.body;
      if (!password || password !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'パスワードが正しくありません' });
      }
      if (!Array.isArray(sites)) {
        return res.status(400).json({ error: '現場名リストが不正です' });
      }
      const token = await getAccessToken();
      const existingFileId = await findConfigFile(token, folderId);

      // 既存の現場名を取得して新規追加分のフォルダを作成
      let existingSites = [];
      if (existingFileId) {
        const config = await readConfigFile(token, existingFileId);
        existingSites = config.sites || [];
      }
      const newSites = sites.filter(s => !existingSites.includes(s));
      for (const site of newSites) {
        const siteFolder = await getOrCreateFolder(token, site.slice(0, 50), folderId);
        await getOrCreateFolder(token, 'KY記録', siteFolder);
      }

      await writeConfigFile(token, folderId, sites, existingFileId);
      return res.status(200).json({ success: true, count: sites.length, foldersCreated: newSites.length });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });

  } catch (err) {
    console.error('sites api error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
