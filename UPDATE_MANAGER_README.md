# Update Manager Implementation

## ✅ Đã hoàn thành

Đã bổ sung chức năng kiểm tra và cập nhật phiên bản mới cho ứng dụng với các tính năng:

### 1. **Service quản lý update** (`updateManager.ts`)
- Kiểm tra phiên bản mới qua Service Worker
- Chỉ check khi có kết nối Internet
- Hỗ trợ auto-update và manual update
- Kiểm tra định kỳ theo cấu hình

### 2. **Component thông báo** (`UpdateNotification.tsx`)
- Hiển thị thông báo slide-in khi có update
- Nút "Cập nhật ngay" để apply update
- Nút "Để sau" để đóng thông báo
- UI đẹp với animation

### 3. **Cấu hình trong Settings**
- Thêm section "Cài đặt Cập nhật Ứng dụng" trong TranscriptionConfig
- Switch bật/tắt tự động cập nhật
- Chọn tần suất kiểm tra: 15 phút, 30 phút, 1 giờ, 2 giờ
- Lưu cấu hình vào localStorage

### 4. **Service Worker** (`sw.js`)
- Cache ứng dụng để hoạt động offline
- Lắng nghe SKIP_WAITING message để apply update
- Thông báo clients khi có update

### 5. **Tích hợp vào App**
- Initialize update manager khi app load
- Hiển thị UpdateNotification khi có bản mới
- Truyền updateConfig vào TranscriptionConfig

## 🎯 Cách hoạt động

1. **Kiểm tra tự động** (nếu bật):
   - Check theo tần suất đã cấu hình (mặc định: 30 phút)
   - Chỉ check khi online

2. **Khi phát hiện update**:
   - Hiển thị notification ở góc trên phải
   - Người dùng chọn "Cập nhật ngay" hoặc "Để sau"

3. **Apply update**:
   - Service worker skip waiting
   - Reload trang tự động
   - Ứng dụng chạy phiên bản mới

## 📝 Cấu hình mặc định

```typescript
{
  autoUpdate: true,        // Bật tự động cập nhật
  checkInterval: 30        // Kiểm tra mỗi 30 phút
}
```

## 🔧 Lưu ý

- Chỉ check update khi online để đảm bảo offline vẫn hoạt động
- Cấu hình được lưu trong localStorage
- Service Worker cần được registered trong index.tsx
- Update notification có animation smooth

## 🚀 Test

1. Build project: `npm run build`
2. Deploy lên server
3. Sau đó build lại với thay đổi
4. Deploy phiên bản mới
5. Ứng dụng cũ sẽ tự động phát hiện và thông báo update
