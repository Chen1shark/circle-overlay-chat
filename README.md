# CiRCLE

CiRCLE 是一个 Windows 透明悬浮聊天工具。它适合多人一起看直播、看视频、打游戏或使用其他软件时，用一个置顶的小窗口进行实时聊天。

## 项目结构

```text
CiRCLE/
  client/   Electron + Vite + React + TypeScript 桌面客户端
  server/   Spring Boot WebSocket 服务端
```

## 功能特性

- Windows 透明无边框悬浮窗
- 窗口置顶、最小化、关闭、透明度调节
- 快捷键显示或隐藏窗口：`Ctrl + Alt + T`
- 固定单房间：客户端默认进入 `CiRCLE` 房间，不需要输入房间号
- 进入房间需要昵称和口令，同一房间昵称不能重复
- 在线人数和在线成员列表
- 文字消息、Unicode emoji 和图片消息
- 图片可从文件夹选择、截图粘贴、拖拽或客户端框选截图发送，发送前会先显示确认预览
- 图片发送前会在客户端压缩，默认最长边 `1920px`、目标约 `500KB`、最大约 `650KB`
- 输入 `@` 时弹出在线成员列表，选中后插入 `@昵称`
- 消息中 `@我的昵称` 会高亮显示
- 成员加入或离开时显示居中的系统提示
- 右键消息复制文本，触屏设备可长按复制
- 收到他人消息时，如果窗口最小化或不可见，会触发任务栏提醒
- 服务端保留内存短历史，默认每个房间最近 `200` 条消息
- 不保存永久聊天记录
- 暂不支持 GIF 动图、文件、自定义表情包

## 环境要求

服务端：

- JDK 21
- Maven 3.9+

客户端：

- Node.js 22+
- npm 10+
- Windows

## 配置说明

本项目把真实配置和示例配置分开管理。

| 用途 | 本地配置文件 | 示例配置文件 |
| --- | --- | --- |
| 桌面客户端 | `client/.env` | `client/.env.example` |
| 服务端 | `server/src/main/resources/application.yml` | `server/src/main/resources/application.yml.example` |

真实服务器 IP、真实口令和其他敏感配置只写在本地配置文件里。示例配置文件用于说明配置项格式。

首次运行前，可以从示例文件复制一份本地配置：

```powershell
Copy-Item client\.env.example client\.env
Copy-Item server\src\main\resources\application.yml.example server\src\main\resources\application.yml
```

## 客户端配置

`client/.env` 配置客户端连接的 WebSocket 地址：

```env
VITE_CIRCLE_SERVER_WS_URL=ws://127.0.0.1:8080/ws
```

如果服务端部署在云服务器：

```env
VITE_CIRCLE_SERVER_WS_URL=ws://你的服务器IP:8080/ws
```

如果服务端端口不是 `8080`，这里也要改成对应端口：

```env
VITE_CIRCLE_SERVER_WS_URL=ws://你的服务器IP:9090/ws
```

## 服务端配置

`server/src/main/resources/application.yml` 示例：

```yaml
server:
  port: 8080

chat:
  access-key: "replace-with-your-access-key"
  max-connections: 300
  max-rooms: 50
  max-users-per-room: 10
  history-limit: 200
  max-message-length: 500
  max-image-bytes: 665600
  websocket-message-buffer-bytes: 950000
  websocket-idle-timeout-ms: 90000
```

配置项说明：

- `server.port`：服务端监听端口，客户端 WebSocket 地址里的端口要与它一致
- `chat.access-key`：进入房间时需要输入的口令
- `chat.max-connections`：服务端允许同时保持的最大 WebSocket 连接数
- `chat.max-rooms`：服务端最多允许存在的房间数量，当前客户端固定使用一个房间
- `chat.max-users-per-room`：单个房间最多在线人数
- `chat.history-limit`：每个房间保留的最近消息条数，只保存在内存中
- `chat.max-message-length`：单条消息最大字符数
- `chat.max-image-bytes`：单张图片压缩后允许发送的最大字节数
- `chat.websocket-message-buffer-bytes`：WebSocket 单条消息缓冲区大小，图片会以 dataUrl 放在 JSON 中，需要大于图片 base64 体积
- `chat.websocket-idle-timeout-ms`：WebSocket 空闲超时时间，用于清理异常断开的连接

客户端每 `20` 秒发送一次 `ping` 心跳。连接异常断开后，如果服务端在空闲超时时间内收不到任何消息，会自动关闭并清理该连接。

图片只做临时聊天传递：压缩发生在客户端，服务端只校验和转发，不保存到磁盘。图片和文字消息共用内存历史，服务端重启后都会丢失。

## 本地运行

启动服务端：

```powershell
cd server
mvn spring-boot:run
```

健康检查：

```powershell
curl http://127.0.0.1:8080/health
```

启动第一个客户端：

```powershell
cd client
npm install
npm run dev
```

在同一台电脑上启动第二个客户端用于测试：

```powershell
cd client
npm run dev:second
```

两个客户端会连接同一个服务端和同一个固定房间，但昵称必须不同。

## 服务端部署

构建服务端 jar：

```bash
cd server
mvn clean package
```

构建产物：

```text
server/target/talk-server.jar
```

部署时建议把 `talk-server.jar` 和生产环境的 `application.yml` 放在同一个目录：

```text
/opt/circle/
  talk-server.jar
  application.yml
```

启动服务：

```bash
cd /opt/circle
java -Xms64m -Xmx256m -jar talk-server.jar
```

服务器安全组、防火墙或面板配置中，需要放行 `server.port` 对应的端口。默认端口是 `8080`。

## systemd 示例

创建 `/etc/systemd/system/circle-server.service`：

```ini
[Unit]
Description=CiRCLE WebSocket Server
After=network.target

[Service]
WorkingDirectory=/opt/circle
ExecStart=/usr/bin/java -Xms64m -Xmx256m -jar /opt/circle/talk-server.jar
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

启动并设置开机自启：

```bash
systemctl daemon-reload
systemctl enable circle-server
systemctl start circle-server
systemctl status circle-server
```

查看日志：

```bash
journalctl -u circle-server -f
```

## 打包 Windows 客户端

打包前确认 `client/.env` 已经指向实际服务端：

```env
VITE_CIRCLE_SERVER_WS_URL=ws://你的服务器IP:8080/ws
```

执行打包：

```powershell
cd client
npm install
npm run dist
```

输出目录：

```text
client/release/CiRCLE/
```

把整个 `client/release/CiRCLE/` 文件夹压缩后分发即可。使用者解压后双击 `CiRCLE.exe`，不需要安装 Java、Node.js 或 Maven。

## 版本控制说明

以下内容不应提交到仓库：

- `.env`
- `client/.env`
- `server/src/main/resources/application.yml`
- 真实服务器 IP
- 真实房间口令
- `node_modules`
- `target`
- `dist`
- `dist-electron`
- `release`
- `.electron-cache`
- `.electron-builder-cache`
- 自己压缩出来的 `.zip`、`.exe`、`.msi`

示例配置文件需要保留：

- `client/.env.example`
- `server/src/main/resources/application.yml.example`

相关忽略规则已经写入 `.gitignore`。

## 常见问题

### 前端使用哪个配置文件？

桌面客户端读取：

```text
client/.env
```

其中 `VITE_CIRCLE_SERVER_WS_URL` 决定客户端连接哪个服务端。

### 后端使用哪个配置文件？

服务端读取：

```text
server/src/main/resources/application.yml
```

其中 `server.port` 决定服务端端口，`chat.access-key` 决定进入房间时需要输入的口令。

### 手机能不能像桌面端一样透明置顶？

当前客户端是 Windows Electron 桌面应用。手机浏览器或普通手机 App 通常不能像 Windows 桌面窗口一样透明置顶覆盖其他 App。Android 需要额外的悬浮窗权限和原生实现，iOS 基本不支持这种系统级覆盖。
