const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = '112012';

// Tạo thư mục lưu ảnh nếu chưa có
const userDir = path.join(__dirname, 'uploads/user');
const adminDir = path.join(__dirname, 'uploads/admin');
fs.mkdirSync(userDir, { recursive: true });
fs.mkdirSync(adminDir, { recursive: true });

app.use(express.json());
app.use(express.static('public'));
// Chỉ công khai thư mục ảnh của User
app.use('/uploads/user', express.static(userDir));

// Cấu hình lưu file
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.headers['x-upload-type'];
    cb(null, type === 'admin' ? adminDir : userDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({ storage });

// Middleware kiểm tra mật khẩu Admin
function checkAdmin(req, res, next) {
  if (req.headers['x-admin-pass'] === ADMIN_PASS) {
    next();
  } else {
    res.status(403).json({ error: 'Sai mật khẩu Admin!' });
  }
}

// API xác thực đăng nhập Admin
app.post('/api/login', (req, res) => {
  if (req.body.password === ADMIN_PASS) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

// API lấy danh sách ảnh User (ai cũng xem được)
app.get('/api/images/user', (req, res) => {
  const files = fs.readdirSync(userDir).map(f => `/uploads/user/${f}`);
  res.json(files);
});

// API lấy danh sách ảnh Admin (chỉ Admin xem được)
app.get('/api/images/admin', checkAdmin, (req, res) => {
  const files = fs.readdirSync(adminDir).map(f => `/api/admin-file/${f}?pass=${ADMIN_PASS}`);
  res.json(files);
});

// Route bảo vệ ảnh ẩn của Admin (người ngoài biết link cũng không xem được nếu thiếu pass)
app.get('/api/admin-file/:filename', (req, res) => {
  if (req.query.pass !== ADMIN_PASS) return res.status(403).send('Cấm truy cập');
  res.sendFile(path.join(adminDir, req.params.filename));
});

// API Upload ảnh (chỉ Admin mới được đăng)
app.post('/api/upload', checkAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Chưa chọn ảnh' });
  res.json({ success: true });
});

// API Xóa ảnh
app.delete('/api/delete', checkAdmin, (req, res) => {
  const { type, filename } = req.body;
  const targetDir = type === 'admin' ? adminDir : userDir;
  const filePath = path.join(targetDir, path.basename(filename));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));
