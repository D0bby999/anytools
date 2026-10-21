---
title: Chính sách bảo mật
description: Các công cụ chạy trong trình duyệt và không gửi gì cho chúng tôi. Ứng dụng học lưu những gì bạn chọn lưu, và chỉ gọi AI qua tài khoản bạn tự kết nối.
updated: 2026-10-21
---

## Tóm tắt

AnyTools có hai phần, và mỗi phần xử lý dữ liệu của bạn theo cách khác nhau.

- **Các công cụ** chạy trong trình duyệt của bạn. JSON bạn dán, file bạn mở, mật khẩu bạn tạo đều ở lại trên thiết bị. Không cần tài khoản, và những gì bạn nhập không đến tay chúng tôi, trừ hai ngoại lệ bên dưới.
- **Ứng dụng học** mở ra sau khi bạn đăng nhập bằng Google hoặc GitHub. Nó lưu những gì bạn chọn lưu, và chỉ gọi mô hình AI và tìm kiếm web qua tài khoản và khóa mà chính bạn kết nối.

Chúng tôi không chạy analytics, quảng cáo, trình theo dõi hay ghi lại phiên truy cập, ở cả hai phần.

## Các công cụ

Dữ liệu bạn nhập vào công cụ được xử lý bằng JavaScript trong trình duyệt. Chúng tôi không có bản sao của những gì bạn định dạng, chuyển đổi, tạo ra hay kiểm tra.

Có hai công cụ cần đến máy chủ:

- **công cụ chuyển curl thành code** gửi lệnh bạn dán đến máy chủ, máy chủ phân tích, trả về code rồi bỏ lệnh đi, không ghi log;
- **công cụ đổi tiền tệ** hỏi máy chủ tỷ giá. Yêu cầu chỉ nêu tên các loại tiền, còn số tiền của bạn ở lại trong trình duyệt. Máy chủ lấy tỷ giá từ Frankfurter, nơi công bố tỷ giá tham chiếu của Ngân hàng Trung ương châu Âu.

## Ứng dụng học

Khi bạn đăng nhập, chúng tôi lưu:

- địa chỉ email và tên hiển thị từ Google hoặc GitHub, để nhận ra bạn;
- những gì bạn thêm và tạo ra: tài liệu và file bạn tải lên, ghi chú, câu hỏi và câu trả lời của bạn, lịch sử ôn tập, phiếu bài tập, bản ghi âm và các tài liệu học khác;
- các kết nối AI và tìm kiếm bạn thêm vào. Khóa của chúng được mã hóa trước khi lưu, không bao giờ hiện lại đầy đủ cho bạn, và không nằm trong log.

File của bạn được lưu trên máy chủ của chúng tôi, hoặc trong Google Drive của chính bạn nếu bạn chọn như vậy trong phần Cài đặt.

Khi một tính năng cần mô hình hay tìm kiếm web, yêu cầu được gửi đến nhà cung cấp bạn đã kết nối, bằng khóa của bạn và theo điều khoản của nhà cung cấp đó. Phần tài liệu mà yêu cầu cần sẽ đi kèm. AnyTools không có khóa AI riêng và không gửi tài liệu của bạn cho nhà cung cấp nào khác.

Một số tính năng tải trang công khai khi bạn yêu cầu: trang web, video hay nguồn tin bạn thêm, thông tin bài báo từ OpenAlex, và mục trong thư viện Zotero của bạn khi bạn kết nối nó.

## Ứng dụng đã kết nối

Bạn tự chọn kết nối ứng dụng nào ở trang Ứng dụng học tập, và có thể ngắt từng ứng dụng ở đó bất cứ lúc nào. Ngắt kết nối sẽ thu hồi quyền của AnyLearn tại ứng dụng đó; những gì đã nhập vẫn nằm trong AnyLearn cho tới khi bạn xóa.

- **Google Drive** (`drive.file`): AnyLearn chỉ mở các tệp bạn chọn trong trình chọn của chính Google và các tệp nó tạo cho bạn (tệp lưu trữ, bản xuất, tài liệu cho NotebookLM). Nó không thấy phần còn lại của Drive.
- **Google Lịch** (`calendar.app.created`): AnyLearn tạo một lịch riêng tên AnyLearn và ghi giờ ôn, ngày học vào đó. Nó không đọc được các lịch khác của bạn.
- **Google Classroom** (chỉ đọc: lớp học, tài liệu lớp, bài tập của chính bạn và thông báo): AnyLearn liệt kê một lớp khi bạn mở nó và chỉ nhập những mục bạn đánh dấu. Nó không bao giờ đăng, nộp hay sửa gì trong Classroom.
- **Google Photos** (chỉ trình chọn): AnyLearn chỉ nhận những ảnh bạn chọn trong trình chọn của Google, một lần, và đọc chúng như ảnh trang.
- **Google Forms và Sheets**: qua quyền Drive ở trên, AnyLearn chỉ mở form hoặc bảng tính bạn chọn, và chỉ tạo form khi bạn yêu cầu.
- **Nhận email**: thư bạn gửi hoặc chuyển tiếp tới địa chỉ AnyLearn của bạn trở thành tài liệu. AnyLearn không bao giờ đọc hộp thư của bạn và không xin quyền Gmail nào.
- **Canva** và **Notion**: AnyLearn chỉ đọc những thiết kế bạn chọn và những trang bạn chia sẻ với nó trong Notion, và chỉ ghi những gì bạn gửi sang.

Việc AnyLearn sử dụng và chuyển giao sang ứng dụng khác thông tin nhận được từ Google API tuân thủ [Chính sách dữ liệu người dùng của Google API Services](https://developers.google.com/terms/api-services-user-data-policy), bao gồm các yêu cầu Limited Use. Dữ liệu từ Google, Canva và Notion chỉ được dùng để cung cấp các tính năng bạn đã bật: không bán, không dùng cho quảng cáo, không dùng để huấn luyện mô hình AI, và không ai đọc trừ khi để sửa lỗi bạn báo, với sự đồng ý của bạn. Token của các ứng dụng này được mã hóa trước khi lưu.

## Cookie và lưu trữ

Các công cụ không đặt cookie nào. Lựa chọn giao diện sáng hay tối được lưu trong bộ nhớ cục bộ của trình duyệt.

Ứng dụng học đặt một cookie phiên khi bạn đăng nhập, và một cookie ngắn hạn trong lúc đăng nhập. Cả hai đều cần để ứng dụng hoạt động, và không cookie nào theo dõi bạn ở nơi khác.

## Xóa dữ liệu

Cài đặt → Tài khoản xóa tài khoản của bạn và mọi thứ trong đó. Quyền truy cập Google Drive bạn đã cấp sẽ bị thu hồi trước. File trong Google Drive của bạn vẫn ở đó: chúng là của bạn, và chúng tôi không xóa.

## Bên thứ ba

Lưu trữ máy chủ: Hetzner (Đức, EU). Mạng và DNS: Cloudflare. Đăng nhập: Google và GitHub. AI và tìm kiếm: chỉ những nhà cung cấp bạn kết nối. Ứng dụng học tập: Google, Canva và Notion, chỉ những ứng dụng bạn kết nối; thư gửi đến đi qua Cloudflare Email Routing. Mỗi bên hoạt động theo chính sách bảo mật riêng.

## Quyền của bạn

Bạn có thể yêu cầu bản sao dữ liệu chúng tôi giữ về bạn, yêu cầu sửa hoặc xóa, bằng cách viết đến support@anytools.world. Chúng tôi trả lời trong 30 ngày. Người ở EU có thêm quyền theo GDPR, người ở Việt Nam theo luật bảo vệ dữ liệu cá nhân, và người ở California theo CCPA.

## Trẻ em

AnyTools không hướng đến trẻ em dưới 13 tuổi, và chúng tôi không cố ý thu thập dữ liệu của trẻ em. Nếu bạn tin rằng một đứa trẻ đã cung cấp thông tin cho chúng tôi, hãy liên hệ để chúng tôi xóa.

## Thay đổi

Chúng tôi cập nhật chính sách này khi sản phẩm thay đổi. Ngày ở đầu trang cho biết lần thay đổi gần nhất.

## Liên hệ

Email: support@anytools.world.

AnyTools do Cassau, LLC vận hành, một công ty trách nhiệm hữu hạn tại Delaware. Đại diện đăng ký: Legalinc Corporate Services Inc., 131 Continental Dr, Suite 305, Newark, DE 19713, USA.
