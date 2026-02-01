# 🚀 Hướng dẫn Build và Deploy để Auto-Update hoạt động

## 📌 Cơ chế phát hiện phiên bản mới

### 1️⃣ **Dựa vào Content Hash của Vite**

Mỗi lần build, Vite tự động tạo hash mới cho file JS/CSS:
```
dist/assets/index-abc123.js  → build lần 1
dist/assets/index-xyz789.js  → build lần 2 (hash khác)
```

**→ Service Worker tự động phát hiện file mới và trigger update!**

### 2️⃣ **Service Worker Cache Versioning**

Service Worker dùng timestamp/hash để tạo cache version:
```javascript
const CACHE_VERSION = Date.now(); // hoặc build timestamp
const CACHE_NAME = `live-meeting-notes-v${CACHE_VERSION}`;
```

Khi deploy bản mới:
- Cache cũ: `live-meeting-notes-v1234567890`
- Cache mới: `live-meeting-notes-v1234567999`
- → Service Worker xóa cache cũ và tải cache mới

---

## 🔧 Quy trình Build và Deploy

### **Bước 1: Build ứng dụng**

```bash
npm run build
```

**Điều gì xảy ra:**
- Vite compile TypeScript → JavaScript
- Tạo hash mới cho tất cả file (CSS, JS, assets)
- Output vào thư mục `dist/`
- Service Worker được copy vào `dist/sw.js`

### **Bước 2: Kiểm tra output**

```bash
ls dist/assets/
# Nên thấy:
# index-[HASH_MỚI].js
# index-[HASH_MỚI].css
```

**Lưu ý quan trọng:**
- ✅ Hash phải **khác** với build trước
- ✅ File `dist/sw.js` phải tồn tại
- ✅ File `dist/index.html` phải reference đúng hash mới

### **Bước 3: Deploy lên server**

#### **Option A: Deploy toàn bộ thư mục `dist/`**
```bash
# Upload toàn bộ dist/ lên server
scp -r dist/* user@server:/var/www/html/
```

#### **Option B: Deploy qua CI/CD (GitHub Actions, GitLab CI...)**
```yaml
# .github/workflows/deploy.yml
- name: Build
  run: npm run build
  
- name: Deploy
  run: |
    # Deploy script của bạn
```

### **Bước 4: Xác minh update hoạt động**

1. Mở DevTools → Application → Service Workers
2. Check "Update on reload" (để test nhanh)
3. Reload trang
4. Xem Console logs:
   ```
   [SW] Installing... Cache version: 1234567999
   [SW] Cleaning old caches except: live-meeting-notes-v1234567999
   [SW] Deleting old cache: live-meeting-notes-v1234567890
   ```

---

## ⚠️ Lưu ý quan trọng khi Build

### ❌ **KHÔNG NÊN:**

1. **Đừng cache `sw.js` trên server**
   ```nginx
   # ❌ SAI - Đừng cache service worker
   location /sw.js {
       add_header Cache-Control "public, max-age=31536000";
   }
   ```
   
   **→ Làm vậy user sẽ không nhận được update!**

2. **Đừng dùng hash cố định cho sw.js**
   ```
   ❌ sw.v1.js, sw.v2.js → Phải đổi tên trong code
   ✅ sw.js → Service Worker tự detect bằng nội dung
   ```

3. **Đừng skip build khi chỉ đổi nội dung**
   - Thay đổi CSS/HTML cũng cần build lại để update hash

### ✅ **NÊN LÀM:**

1. **Cache-Control cho Service Worker**
   ```nginx
   # ✅ ĐÚNG - Service Worker không cache
   location /sw.js {
       add_header Cache-Control "no-cache, no-store, must-revalidate";
       add_header Pragma "no-cache";
       add_header Expires "0";
   }
   ```

2. **Cache tối đa cho assets có hash**
   ```nginx
   # ✅ ĐÚNG - Assets có hash cache lâu dài
   location ~* ^/assets/.*\.(js|css)$ {
       add_header Cache-Control "public, max-age=31536000, immutable";
   }
   ```

3. **Verify hash thay đổi sau mỗi build**
   ```bash
   # Check hash trước build
   ls dist/assets/index-*.js
   
   # Build
   npm run build
   
   # Check hash sau build (phải khác)
   ls dist/assets/index-*.js
   ```

---

## 🔍 Troubleshooting

### **Vấn đề: User không nhận được update**

**Nguyên nhân có thể:**
1. Service Worker bị cache trên server
2. User tắt "Tự động cập nhật" trong Settings
3. User offline khi có update

**Giải pháp:**
```bash
# 1. Check header của sw.js
curl -I https://your-domain.com/sw.js
# → Phải thấy: Cache-Control: no-cache

# 2. Force update trong DevTools
# Application → Service Workers → Update

# 3. Hard reload
# Ctrl+Shift+R (Windows) / Cmd+Shift+R (Mac)
```

### **Vấn đề: Update check quá thường xuyên**

**Điều chỉnh trong Settings:**
- Mặc định: 30 phút
- Có thể tăng lên 1-2 giờ để giảm tải server

### **Vấn đề: Muốn force update tất cả users**

**Cách 1: Tăng tần suất check (server-side)**
```javascript
// Trong sw.js, giảm interval
setInterval(() => {
  registration.update();
}, 60000); // Check mỗi 1 phút
```

**Cách 2: Push notification (nâng cao)**
- Cần backend server để push
- Dùng Web Push API

---

## 📊 Best Practices

### **1. Versioning Strategy**

```json
// package.json
{
  "version": "1.2.3",
  "scripts": {
    "build": "tsc && vite build",
    "version": "npm version patch" // Tự động tăng version
  }
}
```

### **2. Build Script tự động**

```bash
#!/bin/bash
# build-and-deploy.sh

echo "🔨 Building..."
npm run build

echo "📝 Generating build info..."
echo "Build: $(date)" > dist/BUILD_INFO.txt
echo "Hash: $(git rev-parse --short HEAD)" >> dist/BUILD_INFO.txt

echo "🚀 Deploying..."
# Your deploy command here

echo "✅ Done!"
```

### **3. Monitoring**

Thêm logging để track update:
```javascript
// Trong updateManager.ts
console.log('Update detected at:', new Date().toISOString());
console.log('Old version:', oldVersion);
console.log('New version:', newVersion);
```

---

## 🎯 Tóm tắt

| Bước | Lệnh | Kết quả |
|------|------|---------|
| 1. Build | `npm run build` | Tạo hash mới cho assets |
| 2. Check | `ls dist/assets/` | Verify hash khác build trước |
| 3. Deploy | Upload `dist/*` | Service Worker phát hiện |
| 4. Verify | DevTools Console | Check SW logs |

**→ Không cần thay đổi code, không cần bump version manually!**

**→ Vite tự động tạo hash → Service Worker tự động phát hiện → User nhận thông báo update!**
