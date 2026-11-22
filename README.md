# Voltaro — 跨境电商独立站（欧洲市场）

参考 Anker 独立站风格构建的纯静态电商前端，面向欧盟市场销售消费电子（充电宝/GaN 充电器/TWS 耳机/太阳能板等）。

## 在线预览

仓库开启 GitHub Pages 后即可直接访问（Settings → Pages → 分支 `main` / 目录 `/ (root)`）。

本地预览：

```bash
python3 -m http.server 8080
# 打开 http://localhost:8080
```

## 页面结构

| 文件 | 说明 |
|---|---|
| `index.html` | 首页：Hero、分类、Best Sellers、信任区块、评价、订阅 |
| `products.html` | 商品列表：分类/价格筛选、排序、搜索（URL 参数支持直达分类） |
| `product.html?id=xxx` | 商品详情：规格、卖点、加购/立即购买 |
| `cart.html` | 购物车（localStorage 持久化，免邮门槛提示） |
| `checkout.html` | 结算页：欧盟收货信息、Klarna/PayPal/iDEAL 等支付方式（演示） |
| `about.html` / `support.html` | 品牌介绍 / 物流·退换·保修·FAQ |
| `privacy.html` / `terms.html` | GDPR 隐私政策 / 服务条款 + Imprint（模板，上线前需法律审查） |

## 针对欧洲市场的合规与体验设计

- **GDPR Cookie 同意横幅**（essential / all 两档授权，localStorage 记忆）
- **价格含 VAT**（欧盟 OSS 一站式申报），页面标注 "incl. 20% VAT"
- **欧盟消费者权益**：14 天法定撤回权 + 30 天免费退货、2 年法定保修 + 18 个月商家保修
- **欧洲本地支付**：Visa/Mastercard/PayPal/Klarna/Apple Pay/G Pay/iDEAL
- **NL 仓发货**：2–4 个工作日送达、免邮门槛 €50、无 EU 境内关税
- 支持 Imprint（德国市场要求）、WEEE 电池运输提示

## 自定义

- 品牌/价格/汇率等：编辑 `js/data.js` 顶部 `VOLTARO_CONFIG`
- 商品数据：编辑 `js/data.js` 的 `PRODUCTS` 数组（8 个示例 SKU，含 SVG 插图）
- 主题色/圆角等：编辑 `css/style.css` 顶部 CSS 变量

## 技术栈

纯 HTML/CSS/JS，无构建、无依赖；购物车与 Cookie 授权用 `localStorage`；可直接部署到 GitHub Pages / Netlify / Cloudflare Pages / 任意静态托管。
