package com.talkoverlay.server.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 聊天服务配置项。
 *
 * <p>这些字段会从 {@code application.yml} 的 {@code chat} 节点绑定进来，
 * 用于控制访问口令、连接数量、房间数量、消息长度、图片大小和 WebSocket 空闲超时。</p>
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

    /** 单张图片压缩后允许发送的最大字节数。 */
    private int maxImageBytes = 665_600;

    /** WebSocket 单条文本消息缓冲区大小，必须大于图片 dataUrl 序列化后的 JSON 大小。 */
    private int websocketMessageBufferBytes = 950_000;

    /** WebSocket 连接无消息读入时的最大空闲时间，单位毫秒。 */
    private long websocketIdleTimeoutMs = 90_000;

    /** AI 虚拟成员配置，默认关闭。 */
    private Ai ai = new Ai();

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

    public int getMaxImageBytes() {
        return maxImageBytes;
    }

    public void setMaxImageBytes(int maxImageBytes) {
        this.maxImageBytes = maxImageBytes;
    }

    public int getWebsocketMessageBufferBytes() {
        return websocketMessageBufferBytes;
    }

    public void setWebsocketMessageBufferBytes(int websocketMessageBufferBytes) {
        this.websocketMessageBufferBytes = websocketMessageBufferBytes;
    }

    public long getWebsocketIdleTimeoutMs() {
        return websocketIdleTimeoutMs;
    }

    public void setWebsocketIdleTimeoutMs(long websocketIdleTimeoutMs) {
        this.websocketIdleTimeoutMs = websocketIdleTimeoutMs;
    }

    public Ai getAi() {
        return ai;
    }

    public void setAi(Ai ai) {
        this.ai = ai == null ? new Ai() : ai;
    }

    /**
     * 聊天房间 AI 虚拟成员配置。
     *
     * <p>真实密钥、模型地址和角色提示词只应写在本地 {@code application.yml} 中，
     * 不应提交到 Git 仓库。</p>
     */
    public static class Ai {
        /** 是否启用 AI 虚拟成员。 */
        private boolean enabled = false;

        /** AI 在房间成员列表和消息中的显示名称。 */
        private String name = "";

        /** 发送给模型的 system prompt，用于定义角色和回复风格。 */
        private String prompt = "";

        /** OpenAI 兼容接口地址，可填写根地址或完整 chat/completions 地址。 */
        private String baseUrl = "";

        /** OpenAI 兼容接口密钥。 */
        private String apiKey = "";

        /** 模型名称。 */
        private String model = "";

        /** 回复随机性，值越高越发散。 */
        private double temperature = 0.7;

        /** 单次回复的最大输出 token 数。 */
        private int maxOutputTokens = 800;

        /** AI 请求超时时间，单位毫秒。 */
        private long timeoutMs = 30_000;

        /** 是否在请求体中关闭模型思考模式。 */
        private boolean thinkingDisabled = true;

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public String getName() {
            return name;
        }

        public void setName(String name) {
            this.name = name == null ? "" : name;
        }

        public String getPrompt() {
            return prompt;
        }

        public void setPrompt(String prompt) {
            this.prompt = prompt == null ? "" : prompt;
        }

        public String getBaseUrl() {
            return baseUrl;
        }

        public void setBaseUrl(String baseUrl) {
            this.baseUrl = baseUrl == null ? "" : baseUrl;
        }

        public String getApiKey() {
            return apiKey;
        }

        public void setApiKey(String apiKey) {
            this.apiKey = apiKey == null ? "" : apiKey;
        }

        public String getModel() {
            return model;
        }

        public void setModel(String model) {
            this.model = model == null ? "" : model;
        }

        public double getTemperature() {
            return temperature;
        }

        public void setTemperature(double temperature) {
            this.temperature = temperature;
        }

        public int getMaxOutputTokens() {
            return maxOutputTokens;
        }

        public void setMaxOutputTokens(int maxOutputTokens) {
            this.maxOutputTokens = maxOutputTokens;
        }

        public long getTimeoutMs() {
            return timeoutMs;
        }

        public void setTimeoutMs(long timeoutMs) {
            this.timeoutMs = timeoutMs;
        }

        public boolean isThinkingDisabled() {
            return thinkingDisabled;
        }

        public void setThinkingDisabled(boolean thinkingDisabled) {
            this.thinkingDisabled = thinkingDisabled;
        }
    }
}
