const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'khoasieudzkkk888';
const SECRET = process.env.SESSION_SECRET || (ADMIN_PASSWORD + '::web-dang-anh');
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO;            // dạng: tenban/ten-repo-luu-anh
const BRANCH = process.env.GITHUB_BRANCH || 'main';
if (!TOKEN || !REPO) console.warn('⚠️ Thiếu GITHUB_TOKEN hoặc GITHUB_REPO – chưa thể lưu ảnh!');

/* ---------- GitHub làm kho lưu trữ ---------- */
async function gh(p, opt = {}) {
  return fetch('https://api.github.com/repos/' + REPO + p, {
    method: opt.method || 'GET',
    body: opt.body,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'User-Agent': 'web-dang-anh',
      'X-GitHub-Api-Version': '2022-11-28',
      Accept: opt.accept || 'application/vnd.github+json',
      ...(opt.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
}

let db = [], dbSha = null, dbAt = 0;
async function refreshDB(force) {
  if (!force && Date.now() - dbAt < 10000) return;
  const r = await gh('/contents/data/images.json?ref=' + BRANCH);
  if (r.status === 404) { db = []; dbSha = null; }
  else if (r.ok) {
    const j = await r.json();
    dbSha = j.sha;
    db = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
  } else throw new Error('GitHub lỗi ' + r.status + ' (kiểm tra token/repo)');
  dbAt = Date.now();
}
async function saveDB(newDb, msg) {
  const body = { message: msg, content: Buffer.from(JSON.stringify(newDb)).toString('base64'), branch: BRANCH };
  if (dbSha) body.sha = dbSha;
  const r = await gh('/contents/data/images.json', { method: 'PUT', body: JSON.stringify(body) });
  if (!r.ok) throw new Error('Không lưu được dữ liệu lên GitHub (' + r.status + ')');
  dbSha = (await r.json()).content.sha;
  db = newDb; dbAt = Date.now();
}
let chain = Promise.resolve();
const locked = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

/* ---------- Đăng nhập admin (token ký, không mất khi server khởi động lại) ---------- */
const sign = (exp) => crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex');
const makeToken = () => { const exp = Date.now() + 7 * 864e5; return exp + '.' + sign(exp); };
function getCookie(req, name) {
  for (const p of (req.headers.cookie || '').split(';').map(s => s.trim())) {
    const i = p.indexOf('=');
    if (p.slice(0, i) === name) return decodeURIComponent(p.slice(i + 1));
  }
  return null;
}
function isAdmin(req) {
  const t = getCookie(req, 'admin_token');
  if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!EXT[file.mimetype])
});

app.use(express.json());

app.get('/', (req, res) => {
  const a = path.join(__dirname, 'public', 'index.html');
  const b = path.join(__dirname, 'index.html');
  res.sendFile(fs.existsSync(a) ? a : b);
});

app.post('/api/login', (req, res) => {
  if (req.body && req.body.password === ADMIN_PASSWORD) {
    res.setHeader('Set-Cookie', `admin_token=${makeToken()}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Sai mật khẩu' });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ admin: isAdmin(req) }));

app.get('/api/images', async (req, res) => {
  try {
    await refreshDB();
    const list = (req.query.scope === 'admin' && isAdmin(req)) ? db : db.filter(i => i.visibility === 'public');
    res.json(list.slice().reverse());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/upload', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err || !req.file) return res.status(400).json({ error: 'Ảnh không hợp lệ (jpg/png/gif/webp, tối đa 10MB)' });
    const adminMode = req.body.mode === 'admin';
    if (adminMode && !isAdmin(req)) return res.status(401).json({ error: 'Chưa đăng nhập admin' });
    try {
      const item = await locked(async () => {
        await refreshDB(true);
        const file = crypto.randomBytes(12).toString('hex') + EXT[req.file.mimetype];
        const r = await gh('/contents/uploads/' + file, {
          method: 'PUT',
          body: JSON.stringify({ message: 'Thêm ảnh ' + file, content: req.file.buffer.toString('base64'), branch: BRANCH })
        });
        if (!r.ok) throw new Error('Không đẩy được ảnh lên GitHub (' + r.status + ')');
        const it = {
          id: crypto.randomBytes(8).toString('hex'), file,
          caption: String(req.body.caption || '').slice(0, 200),
          visibility: adminMode ? 'admin' : 'public', time: Date.now()
        };
        await saveDB([...db, it], 'Cập nhật danh sách ảnh');
        return it;
      });
      res.json(item);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

app.delete('/api/images/:id', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Cần quyền admin' });
  try {
    await locked(async () => {
      await refreshDB(true);
      const it = db.find(i => i.id === req.params.id);
      if (!it) throw new Error('Không tìm thấy ảnh');
      const m = await gh('/contents/uploads/' + it.file + '?ref=' + BRANCH);
      if (m.ok) {
        const sha = (await m.json()).sha;
        await gh('/contents/uploads/' + it.file, { method: 'DELETE', body: JSON.stringify({ message: 'Xóa ảnh ' + it.file, sha, branch: BRANCH }) });
      }
      await saveDB(db.filter(i => i.id !== it.id), 'Cập nhật danh sách ảnh');
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Ảnh được lấy từ repo GitHub (private) qua server; ảnh chỉ-admin bị chặn nếu chưa đăng nhập admin
app.get('/img/:file', async (req, res) => {
  try {
    await refreshDB();
    const it = db.find(i => i.file === req.params.file);
    if (!it) return res.sendStatus(404);
    if (it.visibility === 'admin' && !isAdmin(req)) return res.sendStatus(403);
    const r = await gh('/contents/uploads/' + it.file + '?ref=' + BRANCH, { accept: 'application/vnd.github.raw+json' });
    if (!r.ok) return res.sendStatus(404);
    res.set('Content-Type', MIME[path.extname(it.file)] || 'application/octet-stream');
    res.set('Cache-Control', it.visibility === 'public' ? 'public, max-age=86400' : 'private, max-age=3600');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.sendStatus(500); }
});

app.listen(PORT, () => console.log('Server chạy ở cổng ' + PORT));
