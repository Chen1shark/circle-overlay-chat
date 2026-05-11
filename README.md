# CiRCLE

CiRCLE 是一个 Windows 透明悬浮聊天工具，适合两三个人一起看直播、看视频或使用其他软件时，用一个置顶悬浮窗聊天。

## 功能

- Windows 透明无边框悬浮窗
- 置顶、拖动、透明度调节
- 快捷键显示/隐藏窗口：`Ctrl + Alt + T`
- 多房间架构
- 进入房间需要昵称和口令，房间号由客户端固定使用同一个默认房间
- 同一房间昵称不能重复
- 显示在线人数和成员列表
- 支持文字和 Unicode emoji
- 服务端内存短历史，默认每个房间最近 `200` 条
- 不保存永久聊天记录
- 不支持图片、文件、GIF、自定义表情包

## 项目结构

```text
talk/
  server/   Spring Boot WebSocket 服务端
  client/   Electron + Vite + React + TypeScript 客户端
  app/      Capacitor + React + Vite 手机客户端
```

## 配置文件

真实口令和服务器 IP 不要提交到 GitHub。

前端本地配置：

```text
client/.env
```

前端上传模板：

```text
client/.env.example
```

手机端本地配置：

```text
app/.env
```

手机端上传模板：

```text
app/.env.example
```

后端本地配置：

```text
server/src/main/resources/application.yml
```

后端上传模板：

```text
server/src/main/resources/application.yml.example
```

初始化本地配置：

```powershell
Copy-Item client\.env.example client\.env
Copy-Item app\.env.example app\.env
Copy-Item server\src\main\resources\application.yml.example server\src\main\resources\application.yml
```

`client/.env`、`app/.env` 和 `server/src/main/resources/application.yml` 已经被 `.gitignore` 忽略。

## 本地启动服务端

要求：

- JDK 21
- Maven 3.9+

PowerShell：

```powershell
cd server
mvn spring-boot:run
```

健康检查：

```bash
curl http://127.0.0.1:8080/health
```

默认服务器 WebSocket 地址：

```text
ws://127.0.0.1:8080/ws
```

如果服务端改成别的端口，例如 `9090`，客户端的 `client/.env` 也要同步修改：

```text
VITE_CIRCLE_SERVER_WS_URL=ws://127.0.0.1:9090/ws
```

## 本地启动客户端

要求：

- Node.js 22+
- npm 10+

```bash
cd client
npm install
npm run dev
```

同一台电脑开第二个客户端测试：

```bash
cd client
npm run dev:second
```

两个窗口连接同一个服务器地址，但昵称必须不同。

## 配置服务器 IP

客户端没有服务器选择项，启动后会直接连接 `client/.env` 里的服务器地址：

```text
VITE_CIRCLE_SERVER_WS_URL=ws://你的服务器IP:8080/ws
```

示例：

```text
VITE_CIRCLE_SERVER_WS_URL=ws://1.2.3.4:8080/ws
```

如果服务器实际开放的是别的端口，就把地址里的端口一起改掉。

`client/.env` 不要提交到 GitHub。

## 服务器部署

构建 jar：

```bash
cd server
mvn clean package
```

Linux 启动：

```bash
java -Xms64m -Xmx256m -jar talk-server.jar
```

宝塔 Java 项目里直接使用 `server/src/main/resources/application.yml` 里的配置：

客户端进入房间时输入的口令必须和 `application.yml` 里的 `chat.access-key` 一致。

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

启动：

```bash
systemctl daemon-reload
systemctl enable circle-server
systemctl start circle-server
systemctl status circle-server
```

## 生成 Windows 客户端

先配置服务器 IP：

```text
client/.env
```

然后生成未压缩版：

```bash
cd client
npm install
npm run dist
```

输出目录：

```text
client/release/CiRCLE/
```

把整个 `client/release/CiRCLE/` 文件夹压缩后发给同学。同学解压后双击 `CiRCLE.exe`，不需要安装 Java、Node 或 Maven。

## 生成 Android 手机客户端

手机端前端会被打包进 App，手机只需要连接云服务器上的后端。

先配置服务器 IP：

```text
app/.env
```

示例：

```text
VITE_CIRCLE_SERVER_WS_URL=ws://你的服务器IP:8080/ws
```

第一次准备 Android 工程：

```bash
cd app
npm install
npm run cap:add:android
```

每次同步前端代码：

```bash
npm run cap:sync
```

打开 Android Studio：

```bash
npm run cap:open:android
```

然后在 Android Studio 里连接手机或模拟器运行。这个手机端是普通聊天 App，不支持像 Windows 客户端那样透明置顶覆盖其他 App。

## 默认限制

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

`chat.access-key` 没有改成真实口令时，别人无法用正确口令加入房间。
客户端每 20 秒发送一次心跳；如果连接断开后服务端在 `chat.websocket-idle-timeout-ms` 时间内收不到任何消息，会自动关闭并清理该连接。

## GitHub 注意事项

不要提交：

- `.env`
- `client/.env`
- `app/.env`
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
- 打包生成的 `release` 目录
- 自己压缩出来的 zip/exe

这些规则已经写入 `.gitignore`。
