# 教师双图层时间轴桌面日历 v1.3.0（Windows 独立版 + 安卓 APK · 坚果云 WebDAV 自动同步）

专为教师与班主任设计的 **Apple Liquid Glass（苹果液态玻璃）** 双图层时间轴日历：
- **三档透明外观**：`☀️ 白天` / `🌙 黑夜` / `🌗 自动识别系统深浅色`，支持玻璃透明度自由调节；
- **窗口长宽高随意调整 + 右上角防误触固定锁**：自由拉长拉宽时内部方框、时间轴比例与文字自动匹配（最小限制 680×520 防拥挤）；点击右上角 **`🔒`** 即可固定窗口位置与尺寸并锁定课表/干活/新增/导入防误触，仅保留核心切换、设置与 **`🔓` 解锁** 可点；
- **双图层时间轴 + 互斥班主任班级课表**：底层课表（支持跳过课间的 **🧲 节次磁吸调课** 与跨周随机调课）+ 顶层干活事项（撞课透视标 `⚡`）；勾选 **`🏫 班主任班级课表`** 一键隐藏个人两层，纯净呈现全班课程；
- **周时间轴 / 日时间轴 / 月时间轴**：月时间轴每格自带微型纵向比例时间轴；配备独立 **`🌃 展示晚自习`** 与 **`📅 展示周末`** 按钮；
- **智能批量排作息 + 三合一导入**：双击最左侧时间轴批量推算全天作息与午休并自动顺移已有课表；支持 **Excel / Word (`.docx`) / 本地中文 OCR 拍照识别** 自动分配课表并校准左侧时间轴；
- **统一「⚙ 设置」**：内置 **☁ 坚果云 WebDAV 四文件免费自动同步** + **⬆ 在线检查更新与一键热更新** + **🖥 Windows 开机自启与局域网手机连接**。

---

## 一、Windows 绿色独立版直接使用

打开 `dist\TeacherLayerCalendar-win-x64\`，双击 **`教师双图层日历.exe`** 即可独立运行（无需安装 Node.js 或任何运行库；压缩包位于 `dist\TeacherLayerCalendar-v1.3.0-Windows-x64.zip`）。

## 二、一键上传到你的 GitHub（免装 Git，自动云端编译 Windows + Android APK）

1. 打开 [GitHub Token 生成页面](https://github.com/settings/tokens/new)，勾选 **`repo`** 和 **`workflow`**，生成一个 Token；
2. 在项目目录运行（或把 Token 交给助手代跑）：
   ```powershell
   node scripts/upload-to-github.js <你的GITHUB_TOKEN> teacher-layer-calendar
   ```
3. 脚本会自动创建仓库、推送全部源码并打 `v1.3.0` 标签，触发 GitHub Actions（`.github/workflows/release.yml`）在约 2 分钟内自动生成并发布：
   - **`TeacherLayerCalendar-v1.3.0-Windows-x64.zip`**（Windows 独立版）
   - **`TeacherLayerCalendar-v1.3.0-Android.apk`**（安卓原生安装包，含 4×2 桌面小组件 + 无跨域直连坚果云）
4. 在软件右上角 **「⚙ 设置 → ⬆ 在线检查更新」** 填入 `你的GitHub用户名/teacher-layer-calendar`，以后发新版本即可一键在线更新！
