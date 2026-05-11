# CiRCLE

CiRCLE 是一个 Windows 透明悬浮聊天工具。它适合几个人一起看直播、看视频、打游戏或开其他软件时，用一个置顶的小窗口进行实时聊天。

当前项目包含两个部分：

```text
CiRCLE/
  client/   Electron + Vite + React + TypeScript 桌面客户端
  server/   Spring Boot WebSocket 服务端
```

## 功能

- Windows 透明无边框悬浮窗
- 窗口置顶、最小化、关闭、透明度调节
- 快捷键显示或隐藏窗口：`Ctrl + Alt + T`
- 固定单房间：客户端默认进入 `CiRCLE` 房间，不再输入房间号
- 进入房间需要昵称和口令，同一房间昵称不能重复
- 在线人数和成员列表展示
- 文字消息、Unicode emoji
- 输入 `@` 可弹出在线成员列表，选中后插入 `@昵称`
- 消息里 `@我的昵称` 会高亮
- 成员加入或离开时显示居中的系统提示
- 右键消息可复制，触屏长按消息也可复制
- 收到别人消息时，如果窗口最小化或不可见，会触发任务栏提醒
- 服务端只保留内存短历史，默认每个房间最近 `200` 条
- 不保存永久聊天记录
- 暂不支持图片、文件、GIF、自定义表情包

## 环境要求

服务端：

- JDK 21
- Maven 3.9+

客户端：

- Node.js 22+
- npm 10+
- Windows 系统

## 配置文件

真实服务器 IP 和真实口令不要提交到 GitHub。

客户端本地配置：

```text
client/.env
```

客户端上传到 GitHub 的模板：

```text
client/.env.example
```

后端本地配置：

```text
server/src/main/resources/application.yml
```

后端上传到 GitHub 的模板：

```text
server/src/main/resources/application.yml.example
```

第一次拉取项目后，可以从模板复制本地配置：

```powershell
Copy-Item client\.env.example client\.env
Copy-Item server\src\main\resources\application.yml.example server\src\main\resources\application.yml
```

## 客户端配置

`client/.env` 只需要配置服务端 WebSocket 地址：

```env
VITE_CIRCLE_SERVER_WS_URL=ws://127.0.0.1:8080/ws
```

如果后端部署在云服务器：

```env
VITE_CIRCLE_SERVER_WS_URL=ws://你的服务器IP:8080/ws
```

如果后端端口不是 `8080`，这里的端口也要一起改。例如后端运行在 `9090`：

```env
VITE_CIRCLE_SERVER_WS_URL=ws://你的服务器IP:9090/ws
```

## 后端配置

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
  websocket-idle-timeout-ms: 90000
```

参数说明：

- `server.port`：后端 HTTP 和 WebSocket 监听端口
- `chat.access-key`：进入房间时需要输入的口令
- `chat.max-connections`：服务端允许同时保持的最大 WebSocket 连接数
- `chat.max-rooms`：服务端最多允许存在的房间数量，当前客户端固定使用一个房间
- `chat.max-users-per-room`：单个房间最多在线人数
- `chat.history-limit`：每个房间保留的最近消息条数，只在内存里保存
- `chat.max-message-length`：单条消息最大字符数
- `chat.websocket-idle-timeout-ms`：WebSocket 空闲超时时间，断线后用于清理僵尸连接

客户端每 `20` 秒发送一次 `ping` 心跳。服务端如果在空闲超时时间内没有收到任何消息，会自动关闭并清理连接。

## 本地运行

先启动服务端：

```powershell
cd F:\java_file\CiRCLE\server
mvn spring-boot:run
```

健康检查：

```powershell
curl http://127.0.0.1:8080/health
```

再启动第一个客户端：

```powershell
cd F:\java_file\CiRCLE\client
npm install
npm run dev
```

如果要在同一台电脑上开第二个客户端测试：

```powershell
cd F:\java_file\CiRCLE\client
npm run dev:second
```

两个客户端会连接同一个服务端和同一个固定房间，但昵称必须不同。

## 服务器部署

在本地或服务器上构建后端 jar：

```bash
cd server
mvn clean package
```

构建产物：

```text
server/target/talk-server.jar
```

把 `talk-server.jar` 和你的 `application.yml` 放到服务器同一个目录，例如：

```text
/opt/circle/
  talk-server.jar
  application.yml
```

启动：

```bash
cd /opt/circle
java -Xms64m -Xmx256m -jar talk-server.jar
```

服务器安全组、防火墙、宝塔面板都要放行 `application.yml` 里配置的端口。默认是 `8080`。

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

先确认 `client/.env` 已经写成云服务器 WebSocket 地址，例如：

```env
VITE_CIRCLE_SERVER_WS_URL=ws://你的服务器IP:8080/ws
```

然后打包：

```powershell
cd F:\java_file\CiRCLE\client
npm install
npm run dist
```

输出目录：

```text
client/release/CiRCLE/
```

把整个 `client/release/CiRCLE/` 文件夹压缩后发给别人。对方解压后双击 `CiRCLE.exe` 即可使用，不需要安装 Java、Node.js 或 Maven。

## GitHub 注意事项

不要提交这些文件或目录：

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

这些规则已经写入 `.gitignore`。提交到 GitHub 时，保留 `.env.example` 和 `application.yml.example`，让别人按模板复制自己的本地配置。

## 常见问题

### 前端一般用哪个配置文件？

本项目统一使用：

```text
client/.env
```

上传 GitHub 时只提交：

```text
client/.env.example
```

### 后端读哪个配置文件？

后端读取：

```text
server/src/main/resources/application.yml
```

上传 GitHub 时只提交：

```text
server/src/main/resources/application.yml.example
```

### 为什么手机不能像桌面端一样透明置顶？

当前仓库的客户端是 Windows Electron 桌面应用。手机浏览器或普通手机 App 通常不能像 Windows 桌面窗口一样透明置顶覆盖其他 App；Android 需要额外的悬浮窗权限和原生实现，iOS 基本不支持这种系统级覆盖。
