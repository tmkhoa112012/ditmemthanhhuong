const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'khoasieudzkkk888';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'images.json');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const loadDB = () => { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; } };
const saveDB = (d) => fs.writeFileSync(DB_FILE, JSON.stringify(d));

const sessions = new Set();
function getCookie(req, name) {
  const c = (req.headers.cookie || '').split(';').map(s => s.trim());
  for (const p of c) { const i = p.indexOf('='); if (p.slice(0, i) === name) return decodeURIComponent(p.slice(i + 1)); }
  return null;
}
const isAdmin = (req) => sessions.has(getCookie(req, 'admin_token'));

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + EXT[file.mimetype])
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, !!EXT[file.mimetype])
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', (req, res) => {
  if (req.body && req.body.password === ADMIN_PASSWORD) {
    const t = crypto.randomBytes(24).toString('hex');
    sessions.add(t);
    res.setHeader('Set-Cookie', `admin_token=${t}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'Sai mật khẩu' });
});

app.post('/api/logout', (req, res) => {
  sessions.delete(getCookie(req, 'admin_token'));
  res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ admin: isAdmin(req) }));

// scope=admin -> admin thấy tất cả; còn lại chỉ ảnh công khai
app.get('/api/images', (req, res) => {
  const all = loadDB();
  const list = (req.query.scope === 'admin' && isAdmin(req)) ? all : all.filter(i => i.visibility === 'public');
  res.json(list.slice().reverse());
});

app.post('/api/upload', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err || !req.file) return res.status(400).json({ error: 'Ảnh không hợp lệ (jpg/png/gif/webp, tối đa 10MB)' });
    const adminMode = req.body.mode === 'admin';
    if (adminMode && !isAdmin(req)) { fs.unlinkSync(req.file.path); return res.status(401).json({ error: 'Chưa đăng nhập admin' }); }
    const item = {
      id: crypto.randomBytes(8).toString('hex'),
      file: req.file.filename,
      caption: String(req.body.caption || '').slice(0, 200),
      visibility: adminMode ? 'admin' : 'public',
      time: Date.now()
    };
    const db = loadDB(); db.push(item); saveDB(db);
    res.json(item);
  });
});

app.delete('/api/images/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Cần quyền admin' });
  const db = loadDB();
  const it = db.find(i => i.id === req.params.id);
  if (!it) return res.status(404).json({ error: 'Không tìm thấy' });
  try { fs.unlinkSync(path.join(UPLOAD_DIR, it.file)); } catch {}
  saveDB(db.filter(i => i.id !== it.id));
  res.json({ ok: true });
});

// Ảnh chỉ-admin sẽ bị chặn nếu không đăng nhập admin
app.get('/img/:file', (req, res) => {
  const it = loadDB().find(i => i.file === req.params.file);
  if (!it) return res.sendStatus(404);
  if (it.visibility === 'admin' && !isAdmin(req)) return res.sendStatus(403);
  res.sendFile(path.join(UPLOAD_DIR, it.file));
});

app.listen(PORT, () => console.log('Server chạy ở cổng ' + PORT));
