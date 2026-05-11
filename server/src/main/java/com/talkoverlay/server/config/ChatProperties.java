package com.talkoverlay.server.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 聊天服务配置项。
 *
 * <p>这些字段会从 {@code application.yml} 的 {@code chat} 节点绑定进来，
 * 用于控制访问口令、连接数量、房间数量、消息长度和 WebSocket 空闲超时。</p>
 */
@ConfigurationProperties(prefix = "chat")
public class ChatProperties {

    /** 客户端加入房间时必须提交的口令。 */
    private String accessKey = "";

    /** 服务端允许同时保持的最大 WebSocket 连接数。 */
    private int maxConnections = 300;

    /** 服务端允许同时存在的最大房间数。 */
    private int maxRooms = 50;

    /** 单个房间允许同时在线的最大用户数。 */
    private int maxUsersPerRoom = 10;

    /** 每个房间最多保留的历史消息条数。 */
    private int historyLimit = 200;

    /** 单条聊天消息允许的最大字符数。 */
    private int maxMessageLength = 500;

    /** WebSocket 连接无消息读入时的最大空闲时间，单位毫秒。 */
    private long websocketIdleTimeoutMs = 90_000;

    public String getAccessKey() {
        return accessKey;
    }

    public void setAccessKey(String accessKey) {
        this.accessKey = accessKey;
    }

    public int getMaxConnections() {
        return maxConnections;
    }

    public void setMaxConnections(int maxConnections) {
        this.maxConnections = maxConnections;
    }

    public int getMaxRooms() {
        return maxRooms;
    }

    public void setMaxRooms(int maxRooms) {
        this.maxRooms = maxRooms;
    }

    public int getMaxUsersPerRoom() {
        return maxUsersPerRoom;
    }

    public void setMaxUsersPerRoom(int maxUsersPerRoom) {
        this.maxUsersPerRoom = maxUsersPerRoom;
    }

    public int getHistoryLimit() {
        return historyLimit;
    }

    public void setHistoryLimit(int historyLimit) {
        this.historyLimit = historyLimit;
    }

    public int getMaxMessageLength() {
        return maxMessageLength;
    }

    public void setMaxMessageLength(int maxMessageLength) {
        this.maxMessageLength = maxMessageLength;
    }

    public long getWebsocketIdleTimeoutMs() {
        return websocketIdleTimeoutMs;
    }

    public void setWebsocketIdleTimeoutMs(long websocketIdleTimeoutMs) {
        this.websocketIdleTimeoutMs = websocketIdleTimeoutMs;
    }
}
