package com.talkoverlay.server.websocket;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.talkoverlay.server.config.ChatProperties;
import com.talkoverlay.server.model.ChatMessage;
import com.talkoverlay.server.model.ChatMessage.ImagePayload;
import com.talkoverlay.server.room.ConnectionLimiter;
import com.talkoverlay.server.room.MessageHistoryStore;
import com.talkoverlay.server.room.RoomRegistry;
import com.talkoverlay.server.room.RoomRegistry.JoinStatus;
import com.talkoverlay.server.room.RoomRegistry.RoomSnapshot;
import java.io.IOException;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * 聊天 WebSocket 消息处理器。
 *
 * <p>负责连接接入、加入房间、聊天消息广播、心跳响应和连接清理。
 * 业务状态本身由 {@link RoomRegistry} 与 {@link MessageHistoryStore} 维护。</p>
 */
@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private static final int MAX_ROOM_ID_LENGTH = 40;
    private static final int MAX_NICKNAME_LENGTH = 20;
    private static final String MESSAGE_TYPE_TEXT = "text";
    private static final String MESSAGE_TYPE_IMAGE = "image";
    private static final String SYSTEM_SENDER = "";
    private static final Set<String> ALLOWED_IMAGE_MIME_TYPES = Set.of(
        "image/webp",
        "image/jpeg",
        "image/png"
    );

    private final ObjectMapper objectMapper;
    private final ChatProperties properties;
    private final RoomRegistry roomRegistry;
    private final MessageHistoryStore historyStore;
    private final ConnectionLimiter connectionLimiter;
    private final Set<String> acceptedSessions = ConcurrentHashMap.newKeySet();

    public ChatWebSocketHandler(
        ObjectMapper objectMapper,
        ChatProperties properties,
        RoomRegistry roomRegistry,
        MessageHistoryStore historyStore,
        ConnectionLimiter connectionLimiter
    ) {
        this.objectMapper = objectMapper;
        this.properties = properties;
        this.roomRegistry = roomRegistry;
        this.historyStore = historyStore;
        this.connectionLimiter = connectionLimiter;
    }

    /**
     * WebSocket 握手成功后的回调。
     *
     * <p>这里先占用全局连接名额；如果连接数达到上限，就立即返回错误并关闭连接。</p>
     *
     * @param session 新建立的 WebSocket 会话
     */
    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        if (!connectionLimiter.tryAcquire()) {
            sendError(session, "server is full");
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }
        acceptedSessions.add(session.getId());
    }

    /**
     * 处理客户端发来的文本消息。
     *
     * <p>当前支持 {@code join}、{@code chat}、{@code ping} 三类消息。</p>
     *
     * @param session 消息所属 WebSocket 会话
     * @param message 客户端发送的文本消息
     */
    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode body;
        try {
            body = objectMapper.readTree(message.getPayload());
        } catch (IOException ex) {
            sendError(session, "invalid json");
            return;
        }

        String type = text(body, "type");
        switch (type) {
            case "join" -> handleJoin(session, body);
            case "chat" -> handleChat(session, body);
            case "ping" -> send(session, Map.of("type", "pong", "serverTime", System.currentTimeMillis()));
            default -> sendError(session, "unsupported message type");
        }
    }

    /**
     * WebSocket 连接正常关闭后的回调。
     *
     * @param session 已关闭的 WebSocket 会话
     * @param status 关闭状态
     */
    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        cleanupSession(session);
    }

    /**
     * WebSocket 传输异常回调。
     *
     * <p>异常路径也必须走完整清理逻辑，避免连接计数和房间成员泄漏。</p>
     *
     * @param session 发生异常的 WebSocket 会话
     * @param exception 底层传输异常
     */
    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        cleanupSession(session);
        if (session.isOpen()) {
            session.close(CloseStatus.SERVER_ERROR);
        }
    }

    /**
     * 幂等清理 WebSocket 会话。
     *
     * <p>{@code afterConnectionClosed} 与 {@code handleTransportError} 可能先后触发；
     * 通过 {@code acceptedSessions.remove(...)} 保证连接名额只释放一次。</p>
     */
    private void cleanupSession(WebSocketSession session) {
        leave(session);
        if (acceptedSessions.remove(session.getId())) {
            connectionLimiter.release();
        }
    }

    /**
     * 处理加入房间请求。
     *
     * <p>会依次校验服务端口令、客户端口令、房间号、昵称，然后把会话加入房间并广播在线成员。</p>
     */
    private void handleJoin(WebSocketSession session, JsonNode body) throws IOException {
        String roomId = text(body, "roomId").strip();
        String nickname = text(body, "nickname").strip();
        String accessKey = text(body, "accessKey");

        if (properties.getAccessKey() == null || properties.getAccessKey().isBlank()) {
            sendError(session, "server access key is not configured");
            return;
        }
        if (!properties.getAccessKey().equals(accessKey)) {
            sendError(session, "invalid accessKey");
            return;
        }
        if (!validRoomId(roomId)) {
            sendError(session, "invalid roomId");
            return;
        }
        if (!validNickname(nickname)) {
            sendError(session, "invalid nickname");
            return;
        }

        RoomRegistry.JoinResult result = roomRegistry.join(session.getId(), session, roomId, nickname);
        if (result.status() != JoinStatus.OK) {
            sendError(session, joinErrorMessage(result.status()));
            return;
        }

        send(session, Map.of(
            "type", "joined",
            "roomId", roomId,
            "online", result.snapshot().online()
        ));
        send(session, Map.of(
            "type", "history",
            "messages", historyStore.get(roomId)
        ));
        broadcastPresence(result.snapshot());
        broadcastSystemMessage(result.snapshot(), nickname + " 加入了房间");
    }

    /**
     * 处理聊天消息。
     *
     * <p>只有已经加入房间的会话可以发消息；消息会写入房间历史并广播给同房间所有成员。</p>
     */
    private void handleChat(WebSocketSession session, JsonNode body) throws IOException {
        RoomRegistry.ParticipantInfo participant = roomRegistry.participant(session.getId()).orElse(null);
        if (participant == null) {
            sendError(session, "join required");
            return;
        }

        String messageType = text(body, "messageType");
        if (messageType.isBlank()) {
            messageType = MESSAGE_TYPE_TEXT;
        }

        try {
            switch (messageType) {
                case MESSAGE_TYPE_TEXT -> handleTextChat(session, participant, body);
                case MESSAGE_TYPE_IMAGE -> handleImageChat(participant, body);
                default -> sendError(session, "unsupported messageType");
            }
        } catch (InvalidClientMessageException ex) {
            sendError(session, ex.getMessage());
        }
    }

    /**
     * 处理普通文本消息。
     */
    private void handleTextChat(WebSocketSession session, RoomRegistry.ParticipantInfo participant, JsonNode body) throws IOException {
        String content = text(body, "content");
        if (content.isBlank()) {
            sendError(session, "empty message");
            return;
        }
        if (content.codePointCount(0, content.length()) > properties.getMaxMessageLength()) {
            sendError(session, "message is too long");
            return;
        }

        ChatMessage chatMessage = new ChatMessage(
            UUID.randomUUID().toString(),
            participant.nickname(),
            content,
            System.currentTimeMillis(),
            MESSAGE_TYPE_TEXT,
            null
        );
        broadcastChatMessage(participant.roomId(), chatMessage);
    }

    /**
     * 处理图片消息。
     *
     * <p>客户端已经完成压缩；服务端仍会校验 MIME、dataUrl 和实际字节数，
     * 防止超大图片或伪造字段占用过多内存与带宽。</p>
     */
    private void handleImageChat(RoomRegistry.ParticipantInfo participant, JsonNode body) throws IOException {
        JsonNode imageNode = body.get("image");
        if (imageNode == null || !imageNode.isObject()) {
            throw new InvalidClientMessageException("invalid image");
        }

        String mimeType = text(imageNode, "mimeType");
        String dataUrl = text(imageNode, "dataUrl");
        int width = intValue(imageNode, "width");
        int height = intValue(imageNode, "height");

        if (!ALLOWED_IMAGE_MIME_TYPES.contains(mimeType)) {
            throw new InvalidClientMessageException("unsupported image type");
        }
        if (width <= 0 || height <= 0) {
            throw new InvalidClientMessageException("invalid image dimensions");
        }

        String prefix = "data:" + mimeType + ";base64,";
        if (!dataUrl.startsWith(prefix)) {
            throw new InvalidClientMessageException("invalid image data");
        }

        long actualSize = decodedImageSize(dataUrl.substring(prefix.length()));
        if (actualSize <= 0) {
            throw new InvalidClientMessageException("invalid image data");
        }
        if (actualSize > properties.getMaxImageBytes()) {
            throw new InvalidClientMessageException("image is too large");
        }

        ChatMessage chatMessage = new ChatMessage(
            UUID.randomUUID().toString(),
            participant.nickname(),
            "",
            System.currentTimeMillis(),
            MESSAGE_TYPE_IMAGE,
            new ImagePayload(mimeType, dataUrl, width, height, actualSize)
        );
        broadcastChatMessage(participant.roomId(), chatMessage);
    }

    /**
     * 写入历史并广播聊天消息。
     */
    private void broadcastChatMessage(String roomId, ChatMessage chatMessage) {
        historyStore.add(roomId, chatMessage);
        broadcast(roomRegistry.roomSessions(roomId), chatPayload(chatMessage));
    }

    /**
     * 将会话从房间中移除，并广播最新在线成员。
     *
     * <p>如果该会话离开后房间为空，会清理房间历史，不再广播 presence。</p>
     */
    private void leave(WebSocketSession session) {
        RoomRegistry.ParticipantInfo participant = roomRegistry.participant(session.getId()).orElse(null);
        RoomRegistry.LeaveResult result = roomRegistry.leave(session.getId());
        if (!result.joined()) {
            return;
        }
        if (result.roomRemoved()) {
            historyStore.clearRoom(result.roomId());
            return;
        }
        broadcastPresence(result.snapshot());
        if (participant != null) {
            broadcastSystemMessage(result.snapshot(), participant.nickname() + " 离开了房间");
        }
    }

    /**
     * 向房间内所有成员广播在线成员列表。
     */
    private void broadcastPresence(RoomSnapshot snapshot) {
        broadcast(snapshot.sessions(), Map.of(
            "type", "presence",
            "roomId", snapshot.roomId(),
            "online", snapshot.online(),
            "maxUsers", snapshot.maxUsers(),
            "members", snapshot.members()
        ));
    }

    /**
     * 向房间广播系统提示消息。
     *
     * <p>系统消息使用空 sender 标记，客户端据此渲染成居中的灰色小字。
     * 这类消息只实时广播，不写入历史，避免新用户进入时看到大量旧的加入/离开提示。</p>
     */
    private void broadcastSystemMessage(RoomSnapshot snapshot, String content) {
        broadcast(snapshot.sessions(), chatPayload(new ChatMessage(
            UUID.randomUUID().toString(),
            SYSTEM_SENDER,
            content,
            System.currentTimeMillis(),
            MESSAGE_TYPE_TEXT,
            null
        )));
    }

    /**
     * 生成发给客户端的聊天消息负载。
     */
    private Map<String, Object> chatPayload(ChatMessage chatMessage) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("type", "chat");
        payload.put("messageId", chatMessage.messageId());
        payload.put("sender", chatMessage.sender());
        payload.put("content", chatMessage.content());
        payload.put("serverTime", chatMessage.serverTime());
        payload.put("messageType", chatMessage.messageType());
        if (chatMessage.image() != null) {
            payload.put("image", chatMessage.image());
        }
        return payload;
    }

    /**
     * 向一组 WebSocket 会话广播同一份消息。
     *
     * <p>发送失败通常说明目标连接已经失效，最终会由关闭/异常回调完成清理。</p>
     */
    private void broadcast(List<WebSocketSession> sessions, Object payload) {
        for (WebSocketSession target : sessions) {
            try {
                send(target, payload);
            } catch (IOException ignored) {
                // Stale sessions are cleaned up by the WebSocket close callbacks.
            }
        }
    }

    /**
     * 向客户端发送标准错误消息。
     */
    private void sendError(WebSocketSession session, String message) throws IOException {
        send(session, Map.of("type", "error", "message", message));
    }

    /**
     * 序列化并发送服务端消息。
     *
     * <p>同一个 WebSocketSession 不允许多个线程同时写入，因此发送时对 session 加锁。</p>
     */
    private void send(WebSocketSession session, Object payload) throws IOException {
        if (!session.isOpen()) {
            return;
        }
        String json = objectMapper.writeValueAsString(payload);
        synchronized (session) {
            if (session.isOpen()) {
                session.sendMessage(new TextMessage(json));
            }
        }
    }

    /**
     * 从 JSON 消息中读取字符串字段。
     *
     * @return 字段不存在或不是字符串时返回空字符串，方便上层统一校验
     */
    private String text(JsonNode body, String fieldName) {
        JsonNode field = body.get(fieldName);
        if (field == null || !field.isTextual()) {
            return "";
        }
        return field.asText();
    }

    /**
     * 从 JSON 消息中读取整数字段。
     */
    private int intValue(JsonNode body, String fieldName) {
        JsonNode field = body.get(fieldName);
        if (field == null || !field.canConvertToInt()) {
            return 0;
        }
        return field.asInt();
    }

    /**
     * 解码 base64 图片并返回真实字节数。
     */
    private long decodedImageSize(String base64Data) {
        try {
            return Base64.getDecoder().decode(base64Data).length;
        } catch (IllegalArgumentException ex) {
            return -1;
        }
    }

    /**
     * 校验房间号格式。
     *
     * <p>只允许字母、数字、下划线和短横线，避免前端展示和日志排查时出现难处理字符。</p>
     */
    private boolean validRoomId(String roomId) {
        return !roomId.isBlank()
            && roomId.length() <= MAX_ROOM_ID_LENGTH
            && roomId.matches("[A-Za-z0-9_-]+");
    }

    /**
     * 校验昵称长度。
     *
     * <p>使用 code point 计数，避免 emoji 等非 BMP 字符被错误计算成两个字符。</p>
     */
    private boolean validNickname(String nickname) {
        return !nickname.isBlank()
            && nickname.codePointCount(0, nickname.length()) <= MAX_NICKNAME_LENGTH;
    }

    /**
     * 把加入房间状态转换成客户端可读的错误文案。
     */
    private String joinErrorMessage(JoinStatus status) {
        return switch (status) {
            case ALREADY_JOINED -> "already joined";
            case MAX_ROOMS_REACHED -> "max rooms reached";
            case ROOM_FULL -> "room is full";
            case NICKNAME_EXISTS -> "nickname already exists";
            case OK -> "joined";
        };
    }

    /**
     * 客户端消息校验失败。
     */
    private static class InvalidClientMessageException extends IOException {
        InvalidClientMessageException(String message) {
            super(message);
        }
    }
}
