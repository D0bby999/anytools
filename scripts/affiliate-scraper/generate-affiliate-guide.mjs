import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const cats = JSON.parse(await fs.readFile('data/affiliate-watch/categories-summary.json', 'utf8'));
  const affs = JSON.parse(await fs.readFile('data/affiliate-watch/unique-affiliates.json', 'utf8'));
  const catToAff = JSON.parse(await fs.readFile('data/affiliate-watch/category-to-affiliates.json', 'utf8'));

  // Sort categories by priority/count
  cats.sort((a, b) => b.count - a.count);

  // Group affiliate programs by network
  const networkGroups = {};
  for (const a of affs) {
    const netName = (a.networks && a.networks.length > 0) ? a.networks[0].name : 'Direct / In-house';
    if (!networkGroups[netName]) networkGroups[netName] = [];
    networkGroups[netName].push(a);
  }

  // Create a structured Markdown file for easy registration
  let md = `# DANH SÁCH TOÀN BỘ AFFILIATE PROGRAMS & HƯỚNG DẪN ĐĂNG KÝ\n\n`;
  md += `> Dữ liệu được crawl đầy đủ từ **https://affiliate.watch/categories** vào tháng 11/2026.\n`;
  md += `> Tổng số: **${cats.length} danh mục** và **${affs.length} chương trình affiliate độc nhất**.\n\n`;

  md += `## 🚀 CHIẾN LƯỢC ĐĂNG KÝ NHANH NHẤT (Theo Affiliate Network)\n`;
  md += `Thay vì đăng ký lẻ tẻ từng web, hãy tạo tài khoản trên các **Affiliate Network lớn trước**. Sau khi được duyệt tài khoản network, bạn có thể bấm **Apply hàng trăm chương trình cùng lúc** chỉ bằng 1 cú click:\n\n`;

  const topNets = Object.entries(networkGroups).sort((a, b) => b[1].length - a[1].length);
  for (const [net, items] of topNets) {
    md += `### ${net} (${items.length} chương trình)\n`;
    if (net === 'PartnerStack') {
      md += `* **Đặc thù**: Network số 1 cho SaaS, B2B, AI tools, developer tools. Hoa hồng cao (20% - 50% recurring hàng tháng).\n`;
      md += `* **Đăng ký Publisher**: [https://app.partnerstack.com/join](https://app.partnerstack.com/join)\n`;
    } else if (net === 'Impact') {
      md += `* **Đặc thù**: Network lớn nhất cho Tech, VPN, Hosting, SaaS và Enterprise (Canva, Hostinger, Namecheap, v.v.).\n`;
      md += `* **Đăng ký Publisher**: [https://impact.com/join](https://impact.com/join)\n`;
    } else if (net === 'Awin') {
      md += `* **Đặc thù**: Phổ biến ở Châu Âu, eCommerce, Hosting, Travel.\n`;
      md += `* **Đăng ký Publisher**: [https://www.awin.com](https://www.awin.com)\n`;
    } else if (net === 'CJ') {
      md += `* **Đặc thù**: Commission Junction (CJ) lâu đời, nhiều thương hiệu lớn về phần mềm và dịch vụ mạng.\n`;
      md += `* **Đăng ký Publisher**: [https://www.cj.com](https://www.cj.com)\n`;
    } else if (net === 'Direct / In-house') {
      md += `* **Đặc thù**: Các chương trình tự chạy qua FirstPromoter, Rewardful, RewardHub hoặc hệ thống riêng của web.\n`;
    }
    md += `\n| Tên Chương Trình | Website | Hoa Hồng / Đãi Ngộ | Link Đăng Ký / Chi Tiết |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    
    // Sort items by AI Rating or SimilarWeb rank
    items.sort((a, b) => (parseFloat(b.rating_ai) || 0) - (parseFloat(a.rating_ai) || 0));
    for (const it of items.slice(0, 20)) {
      const teaser = it.teaser_affiliate || it.teaser_company || 'N/A';
      const affLink = `https://affiliate.watch/affiliate/${it.slug}`;
      md += `| **${it.name}** | [${it.website.replace(/^https?:\/\//, '')}](${it.website}) | ${teaser} | [Xem & Đăng ký](${affLink}) |\n`;
    }
    if (items.length > 20) {
      md += `| *... và còn ${items.length - 20} chương trình khác thuộc ${net}* | | | |\n`;
    }
    md += `\n---\n\n`;
  }

  md += `## 📂 TỔNG HỢP THEO DANH MỤC (Sắp xếp theo độ lớn & tiềm năng cho AnyTools)\n\n`;
  for (const cat of cats) {
    const list = catToAff[cat.slug] || [];
    md += `### ${cat.name} (${cat.count} Programs)\n`;
    md += `*Link gốc*: [https://affiliate.watch/category/${cat.slug}](https://affiliate.watch/category/${cat.slug})\n\n`;
    md += `| # | Tên Chương Trình | Website | Hoa Hồng | Network | Link Chi Tiết |\n`;
    md += `| :---: | :--- | :--- | :--- | :--- | :--- |\n`;
    list.forEach((item, idx) => {
      const net = (item.networks && item.networks.length > 0) ? item.networks.map(n => n.name).join(', ') : 'Direct';
      const teaser = item.teaser_affiliate || item.teaser_company || 'N/A';
      md += `| ${idx + 1} | **${item.name}** | [${item.website.replace(/^https?:\/\//, '')}](${item.website}) | ${teaser} | ${net} | [Chi tiết](https://affiliate.watch/affiliate/${item.slug}) |\n`;
    });
    md += `\n\n`;
  }

  await fs.writeFile('data/affiliate-watch/DANH_SACH_DANG_KY_AFFILIATE.md', md, 'utf8');
  console.log('✓ Generated DANH_SACH_DANG_KY_AFFILIATE.md');
}

main().catch(console.error);
