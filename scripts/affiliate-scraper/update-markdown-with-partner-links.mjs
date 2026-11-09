import fs from 'node:fs/promises';

async function main() {
  const cats = JSON.parse(await fs.readFile('data/affiliate-watch/categories-summary.json', 'utf8'));
  const affs = JSON.parse(await fs.readFile('data/affiliate-watch/unique-affiliates.json', 'utf8'));
  const catToAff = JSON.parse(await fs.readFile('data/affiliate-watch/category-to-affiliates.json', 'utf8'));

  cats.sort((a, b) => b.count - a.count);

  const networkGroups = {};
  for (const a of affs) {
    const netName = (a.networks && a.networks.length > 0) ? a.networks[0].name : 'Independent (Tự vận hành / In-house)';
    if (!networkGroups[netName]) networkGroups[netName] = [];
    networkGroups[netName].push(a);
  }

  let md = `# DANH SÁCH TOÀN BỘ AFFILIATE PROGRAMS & LINK ĐĂNG KÝ CHI TIẾT\n\n`;
  md += `> Dữ liệu được crawl đầy đủ từ **https://affiliate.watch/categories** vào tháng 11/2026.\n`;
  md += `> Tổng số: **${cats.length} danh mục** và **${affs.length} chương trình affiliate độc nhất**.\n\n`;

  md += `## ❓ "INDEPENDENT" LÀ GÌ VÀ LINK ĐĂNG KÝ Ở ĐÂU?\n\n`;
  md += `Trong affiliate marketing, **"Independent" KHÔNG PHẢI là một công ty hay một website mạng lưới đơn lẻ**.\n\n`;
  md += `* **Ý nghĩa**: "Independent" (hoặc In-house / Direct) nghĩa là **chính công ty đó tự vận hành chương trình affiliate của riêng họ** trên website của họ (hoặc dùng phần mềm quản lý nội bộ như FirstPromoter, Rewardful, PostAffiliatePro, Tune, v.v.), chứ họ **không đưa lên các chợ trung gian** như Impact hay PartnerStack.\n`;
  md += `* **Link đăng ký**: Do đó, mỗi chương trình Independent sẽ có **một trang đăng ký riêng biệt tại website của chính họ** (thường nằm ở link chân trang như \`/affiliates\`, \`/partners\`, hoặc cổng đăng ký đối tác).\n`;
  md += `* **Đặc điểm**: Hoa hồng của nhóm Independent thường **rất cao** (có thể lên tới 50% - 60% trọn đời hoặc hàng trăm đô CPA) vì họ không phải cắt % phí trung gian cho các network.\n\n`;

  md += `Cột **"Link Đăng Ký Trực Tiếp"** bên dưới sẽ dẫn thẳng đến trang đăng ký đối tác (Partner/Join) của từng thương hiệu.\n\n`;
  md += `---\n\n`;

  md += `## 🚀 DANH SÁCH CÁC CHƯƠNG TRÌNH THEO NHÓM NETWORK\n\n`;

  const topNets = Object.entries(networkGroups).sort((a, b) => b[1].length - a[1].length);
  for (const [net, items] of topNets) {
    md += `### ${net} (${items.length} chương trình)\n`;
    if (net.includes('Independent')) {
      md += `* **Cách đăng ký**: Bấm vào link **"Đăng ký trực tiếp"** tại bảng bên dưới để mở thẳng trang đăng ký đối tác của từng công ty.\n`;
    } else if (net === 'PartnerStack') {
      md += `* **Cách đăng ký**: Đăng ký 1 tài khoản Publisher tại [PartnerStack Join](https://app.partnerstack.com/join), sau đó tìm tên chương trình để bấm Apply.\n`;
    } else if (net === 'Impact') {
      md += `* **Cách đăng ký**: Đăng ký 1 tài khoản Publisher tại [Impact Join](https://impact.com/join), sau đó tìm tên thương hiệu để Apply.\n`;
    } else if (net === 'Awin') {
      md += `* **Cách đăng ký**: Đăng ký tài khoản Publisher tại [Awin](https://www.awin.com).\n`;
    } else if (net === 'CJ') {
      md += `* **Cách đăng ký**: Đăng ký tài khoản Publisher tại [CJ Affiliate](https://www.cj.com).\n`;
    }

    md += `\n| Tên Chương Trình | Website | Hoa Hồng / Đãi Ngộ | Link Đăng Ký Trực Tiếp | Trang Đánh Giá |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;
    
    items.sort((a, b) => (parseFloat(b.rating_ai) || 0) - (parseFloat(a.rating_ai) || 0));
    for (const it of items) {
      const teaser = it.teaser_affiliate || it.teaser_company || 'N/A';
      const joinLink = it.goPartner || it.go || it.website;
      const reviewLink = `https://affiliate.watch/affiliate/${it.slug}`;
      md += `| **${it.name}** | [${it.website.replace(/^https?:\/\//, '')}](${it.website}) | ${teaser} | [👉 Đăng ký tại đây](${joinLink}) | [Xem review](${reviewLink}) |\n`;
    }
    md += `\n---\n\n`;
  }

  md += `## 📂 DANH SÁCH TOÀN BỘ CHƯƠNG TRÌNH THEO 41 DANH MỤC\n\n`;
  for (const cat of cats) {
    const list = catToAff[cat.slug] || [];
    md += `### ${cat.name} (${cat.count} Programs)\n`;
    md += `*Xem trên Affiliate.Watch*: [https://affiliate.watch/category/${cat.slug}](https://affiliate.watch/category/${cat.slug})\n\n`;
    md += `| # | Tên Chương Trình | Website | Hoa Hồng | Network | Link Đăng Ký |\n`;
    md += `| :---: | :--- | :--- | :--- | :--- | :--- |\n`;
    list.forEach((item, idx) => {
      const net = (item.networks && item.networks.length > 0) ? item.networks.map(n => n.name).join(', ') : 'Independent';
      const teaser = item.teaser_affiliate || item.teaser_company || 'N/A';
      const joinLink = item.goPartner || item.go || item.website;
      md += `| ${idx + 1} | **${item.name}** | [${item.website.replace(/^https?:\/\//, '')}](${item.website}) | ${teaser} | ${net} | [👉 Đăng ký](${joinLink}) |\n`;
    });
    md += `\n\n`;
  }

  await fs.writeFile('data/affiliate-watch/DANH_SACH_DANG_KY_AFFILIATE.md', md, 'utf8');
  console.log('✓ Successfully updated DANH_SACH_DANG_KY_AFFILIATE.md with direct join links!');
}

main().catch(console.error);
