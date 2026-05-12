package com.talkoverlay.server.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.talkoverlay.server.ai.AiResponder;
import com.talkoverlay.server.config.ChatProperties;
import com.talkoverlay.server.model.ChatMessage;
import com.talkoverlay.server.room.ConnectionLimiter;
import com.talkoverlay.server.room.MessageHistoryStore;
import com.talkoverlay.server.room.RoomRegistry;
import java.io.IOException;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.function.Predicate;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

/**
 * {@link ChatWebSocketHandler} 的连接生命周期测试。
 */
class ChatWebSocketHandlerTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 传输异常必须释放连接计数，并且后续关闭回调不能重复释放。
     */
    @Test
    void transportErrorReleasesAcceptedConnectionOnce() throws Exception {
        ChatProperties properties = defaultProperties();
        properties.setMaxConnections(1);
        ConnectionLimiter limiter = new ConnectionLimiter(properties);
        ChatWebSocketHandler handler = newHandler(properties, limiter);
        WebSocketSession first = session("s1");
        WebSocketSession second = session("s2");

        handler.afterConnectionEstablished(first);
        assertThat(limiter.activeConnections()).isEqualTo(1);

        handler.handleTransportError(first, new IOException("network broken"));

        assertThat(limiter.activeConnections()).isZero();
        verify(first).close(CloseStatus.SERVER_ERROR);

        handler.afterConnectionClosed(first, CloseStatus.SERVER_ERROR);
        assertThat(limiter.activeConnections()).isZero();

        handler.afterConnectionEstablished(second);
        assertThat(limiter.activeConnections()).isEqualTo(1);
    }

    /**
     * 用户加入房间后，服务端要广播 sender 为空的系统提示消息。
     */
    @Test
    void broadcastsSystemMessageWhenUserJoinsRoom() throws Exception {
        ChatProperties properties = defaultProperties();
        ConnectionLimiter limiter = new ConnectionLimiter(properties);
        ChatWebSocketHandler handler = newHandler(properties, limiter);
        WebSocketSession session = session("s1");

        handler.afterConnectionEstablished(session);
        handler.handleTextMessage(session, new TextMessage("""
            {"type":"join","roomId":"live001","nickname":"alice","accessKey":"test-key"}
            """));

        ArgumentCaptor<TextMessage> captor = ArgumentCaptor.forClass(TextMessage.class);
        verify(session, atLeastOnce()).sendMessage(captor.capture());

        boolean hasSystemJoinMessage = false;
        for (TextMessage sentMessage : captor.getAllValues()) {
            JsonNode body = objectMapper.readTree(sentMessage.getPayload());
            if ("chat".equals(body.path("type").asText())
                && "".equals(body.path("sender").asText())
                && "alice 加入了房间".equals(body.path("content").asText())) {
                hasSystemJoinMessage = true;
                break;
            }
        }

        assertThat(hasSystemJoinMessage).isTrue();
    }

    /**
     * 合法图片消息要能广播，并且新用户加入时可以从内存历史中收到该图片。
     */
    @Test
    void broadcastsImageMessageAndKeepsItInHistory() throws Exception {
        ChatProperties properties = defaultProperties();
        ConnectionLimiter limiter = new ConnectionLimiter(properties);
        ChatWebSocketHandler handler = newHandler(properties, limiter);
        WebSocketSession alice = session("s1");
        WebSocketSession bob = session("s2");

        handler.afterConnectionEstablished(alice);
        handler.handleTextMessage(alice, new TextMessage("""
            {"type":"join","roomId":"live001","nickname":"alice","accessKey":"test-key"}
            """));
        handler.handleTextMessage(alice, new TextMessage("""
            {
              "type":"chat",
              "messageType":"image",
              "content":"",
              "image":{
                "mimeType":"image/png",
                "dataUrl":"data:image/png;base64,AQID",
                "width":1,
                "height":1,
                "size":3
              }
            }
            """));

        JsonNode imageBroadcast = sentMessages(alice).stream()
            .filter(body -> "chat".equals(body.path("type").asText()))
            .filter(body -> "image".equals(body.path("messageType").asText()))
            .findFirst()
            .orElseThrow();

        assertThat(imageBroadcast.path("sender").asText()).isEqualTo("alice");
        assertThat(imageBroadcast.path("image").path("mimeType").asText()).isEqualTo("image/png");
        assertThat(imageBroadcast.path("image").path("size").asLong()).isEqualTo(3);

        handler.afterConnectionEstablished(bob);
        handler.handleTextMessage(bob, new TextMessage("""
            {"type":"join","roomId":"live001","nickname":"bob","accessKey":"test-key"}
            """));

        boolean historyContainsImage = false;
        for (JsonNode body : sentMessages(bob)) {
            if (!"history".equals(body.path("type").asText())) {
                continue;
            }
            for (JsonNode message : body.path("messages")) {
                if ("image".equals(message.path("messageType").asText())
                    && "data:image/png;base64,AQID".equals(message.path("image").path("dataUrl").asText())) {
                    historyContainsImage = true;
                    break;
                }
            }
        }

        assertThat(historyContainsImage).isTrue();
    }

    /**
     * 图片真实解码后的字节数超过限制时要拒绝。
     */
    @Test
    void rejectsImageMessageWhenDecodedBytesExceedLimit() throws Exception {
        ChatProperties properties = defaultProperties();
        properties.setMaxImageBytes(2);
        ConnectionLimiter limiter = new ConnectionLimiter(properties);
        ChatWebSocketHandler handler = newHandler(properties, limiter);
        WebSocketSession session = session("s1");

        handler.afterConnectionEstablished(session);
        handler.handleTextMessage(session, new TextMessage("""
            {"type":"join","roomId":"live001","nickname":"alice","accessKey":"test-key"}
            """));
        handler.handleTextMessage(session, new TextMessage("""
            {
              "type":"chat",
              "messageType":"image",
              "content":"",
              "image":{
                "mimeType":"image/png",
                "dataUrl":"data:image/png;base64,AQID",
                "width":1,
                "height":1,
                "size":1
              }
            }
            """));

        boolean hasTooLargeError = sentMessages(session).stream()
            .anyMatch(body -> "error".equals(body.path("type").asText())
                && "image is too large".equals(body.path("message").asText()));

        assertThat(hasTooLargeError).isTrue();
    }

    /**
     * 不允许发送 GIF 或其他非白名单图片类型。
     */
    @Test
    void rejectsUnsupportedImageMimeType() throws Exception {
        ChatProperties properties = defaultProperties();
        ConnectionLimiter limiter = new ConnectionLimiter(properties);
        ChatWebSocketHandler handler = newHandler(properties, limiter);
        WebSocketSession session = session("s1");

        handler.afterConnectionEstablished(session);
        handler.handleTextMessage(session, new TextMessage("""
            {"type":"join","roomId":"live001","nickname":"alice","accessKey":"test-key"}
            """));
        handler.handleTextMessage(session, new TextMessage("""
            {
              "type":"chat",
              "messageType":"image",
              "content":"",
              "image":{
                "mimeType":"image/gif",
                "dataUrl":"data:image/gif;base64,AQID",
                "width":1,
                "height":1,
                "size":3
              }
            }
            """));

        boolean hasUnsupportedTypeError = sentMessages(session).stream()
            .anyMatch(body -> "error".equals(body.path("type").asText())
                && "unsupported image type".equals(body.path("message").asText()));

        assertThat(hasUnsupportedTypeError).isTrue();
    }

    /**
     * 旧客户端不传 messageType 时，服务端仍按文本消息处理。
     */
    @Test
    void keepsLegacyTextMessageCompatible() throws Exception {
        ChatProperties properties = defaultProperties();
        ConnectionLimiter limiter = new ConnectionLimiter(properties);
        ChatWebSocketHandler handler = newHandler(properties, limiter);
        WebSocketSession session = session("s1");

        handler.afterConnectionEstablished(session);
        handler.handleTextMessage(session, new TextMessage("""
            {"type":"join","roomId":"live001","nickname":"alice","accessKey":"test-key"}
            """));
        handler.handleTextMessage(session, new TextMessage("""
            {"type":"chat","content":"hello"}
            """));

        boolean hasTextMessage = sentMessages(session).stream()
            .anyMatch(body -> "chat".equals(body.path("type").asText())
                && "text".equals(body.path("messageType").asText())
                && "hello".equals(body.path("content").asText()));

        assertThat(hasTextMessage).isTrue();
    }

    /**
     * 创建带真实依赖的 WebSocket handler，便于验证连接清理逻辑。
     */
    @Test
    void includesAiVirtualMemberInPresenceWithoutConsumingRoomLimit() throws Exception {
        ChatProperties properties = defaultProperties();
        properties.setMaxUsersPerRoom(1);
        ConnectionLimiter limiter = new ConnectionLimiter(properties);
        ChatWebSocketHandler handler = newHandler(
            properties,
            limiter,
            FakeAiResponder.virtualMember("CircleBot")
        );
        WebSocketSession alice = session("s1");
        WebSocketSession bob = session("s2");

        handler.afterConnectionEstablished(alice);
        handler.handleTextMessage(alice, new TextMessage("""
            {"type":"join","roomId":"live001","nickname":"alice","accessKey":"test-key"}
            """));

        JsonNode joined = sentMessages(alice).stream()
            .filter(body -> "joined".equals(body.path("type").asText()))
            .findFirst()
            .orElseThrow();
        JsonNode presence = sentMessages(alice).stream()
            .filter(body -> "presence".equals(body.path("type").asText()))
            .findFirst()
            .orElseThrow();

        assertThat(joined.path("online").asInt()).isEqualTo(2);
        assertThat(presence.path("online").asInt()).isEqualTo(2);
        assertThat(presence.path("members").path(0).asText()).isEqualTo("CircleBot");
        assertThat(presence.path("members").toString()).contains("alice", "CircleBot");

        handler.afterConnectionEstablished(bob);
        handler.handleTextMessage(bob, new TextMessage("""
            {"type":"join","roomId":"live001","nickname":"bob","accessKey":"test-key"}
            """));

        boolean roomFull = sentMessages(bob).stream()
            .anyMatch(body -> "error".equals(body.path("type").asText())
                && "room is full".equals(body.path("message").asText()));
        assertThat(roomFull).isTrue();
    }

    @Test
    void rejectsNicknameThatConflictsWithAiVirtualMember() throws Exception {
        ChatProperties properties = defaultProperties();
        ConnectionLimiter limiter = new ConnectionLimiter(properties);
        ChatWebSocketHandler handler = newHandler(
            properties,
            limiter,
            FakeAiResponder.virtualMember("CircleBot")
        );
        WebSocketSession session = session("s1");

        handler.afterConnectionEstablished(session);
        handler.handleTextMessage(session, new TextMessage("""
            {"type":"join","roomId":"live001","nickname":"CircleBot","accessKey":"test-key"}
            """));

        boolean nicknameExists = sentMessages(session).stream()
            .anyMatch(body -> "error".equals(body.path("type").asText())
                && "nickname already exists".equals(body.path("message").asText()));
        assertThat(nicknameExists).isTrue();
    }

    @Test
    void broadcastsAiReplyWhenMentioned() throws Exception {
        ChatProperties properties = defaultProperties();
        ConnectionLimiter limiter = new ConnectionLimiter(properties);
        ChatWebSocketHandler handler = newHandler(
            properties,
            limiter,
            FakeAiResponder.replying("CircleBot", message -> message.content().contains("@AI"), "ok")
        );
        WebSocketSession session = session("s1");

        handler.afterConnectionEstablished(session);
        handler.handleTextMessage(session, new TextMessage("""
            {"type":"join","roomId":"live001","nickname":"alice","accessKey":"test-key"}
            """));
        handler.handleTextMessage(session, new TextMessage("""
            {"type":"chat","messageType":"text","content":"@AI help"}
            """));

        boolean hasAiReply = sentMessages(session).stream()
            .anyMatch(body -> "chat".equals(body.path("type").asText())
                && "CircleBot".equals(body.path("sender").asText())
                && "ok".equals(body.path("content").asText())
                && "text".equals(body.path("messageType").asText()));
        assertThat(hasAiReply).isTrue();
    }

    @Test
    void broadcastsBusySystemMessageWhenAiReplyIsAlreadyRunning() throws Exception {
        ChatProperties properties = defaultProperties();
        ConnectionLimiter limiter = new ConnectionLimiter(properties);
        ChatWebSocketHandler handler = newHandler(
            properties,
            limiter,
            FakeAiResponder.pending("CircleBot", message -> message.content().contains("@AI"))
        );
        WebSocketSession session = session("s1");

        handler.afterConnectionEstablished(session);
        handler.handleTextMessage(session, new TextMessage("""
            {"type":"join","roomId":"live001","nickname":"alice","accessKey":"test-key"}
            """));
        handler.handleTextMessage(session, new TextMessage("""
            {"type":"chat","messageType":"text","content":"@AI first"}
            """));
        handler.handleTextMessage(session, new TextMessage("""
            {"type":"chat","messageType":"text","content":"@AI second"}
            """));

        boolean hasBusyMessage = sentMessages(session).stream()
            .anyMatch(body -> "chat".equals(body.path("type").asText())
                && "".equals(body.path("sender").asText())
                && body.path("content").asText().contains("CircleBot"));
        assertThat(hasBusyMessage).isTrue();
    }

    private ChatWebSocketHandler newHandler(ChatProperties properties, ConnectionLimiter limiter) {
        return newHandler(properties, limiter, FakeAiResponder.disabled());
    }

    private ChatWebSocketHandler newHandler(
        ChatProperties properties,
        ConnectionLimiter limiter,
        AiResponder aiResponder
    ) {
        return new ChatWebSocketHandler(
            new ObjectMapper(),
            properties,
            new RoomRegistry(properties),
            new MessageHistoryStore(properties),
            limiter,
            aiResponder
        );
    }

    /**
     * 创建测试用默认配置。
     */
    private ChatProperties defaultProperties() {
        ChatProperties properties = new ChatProperties();
        properties.setAccessKey("test-key");
        properties.setMaxConnections(300);
        properties.setMaxRooms(50);
        properties.setMaxUsersPerRoom(10);
        properties.setHistoryLimit(200);
        properties.setMaxMessageLength(500);
        properties.setMaxImageBytes(665_600);
        properties.setWebsocketMessageBufferBytes(950_000);
        properties.setWebsocketIdleTimeoutMs(90_000);
        return properties;
    }

    /**
     * 创建指定 ID 且处于打开状态的 WebSocket 会话 mock。
     */
    private WebSocketSession session(String id) {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn(id);
        when(session.isOpen()).thenReturn(true);
        return session;
    }

    /**
     * 读取 mock 会话已经发送过的所有 JSON 消息。
     */
    private java.util.List<JsonNode> sentMessages(WebSocketSession session) throws Exception {
        ArgumentCaptor<TextMessage> captor = ArgumentCaptor.forClass(TextMessage.class);
        verify(session, atLeastOnce()).sendMessage(captor.capture());
        return captor.getAllValues().stream()
            .map(TextMessage::getPayload)
            .map(payload -> {
                try {
                    return objectMapper.readTree(payload);
                } catch (IOException ex) {
                    throw new IllegalStateException(ex);
                }
            })
            .toList();
    }

    private static class FakeAiResponder implements AiResponder {
        private final String displayName;
        private final boolean hasVirtualMember;
        private final Predicate<ChatMessage> trigger;
        private final CompletableFuture<String> reply;

        private FakeAiResponder(
            String displayName,
            boolean hasVirtualMember,
            Predicate<ChatMessage> trigger,
            CompletableFuture<String> reply
        ) {
            this.displayName = displayName;
            this.hasVirtualMember = hasVirtualMember;
            this.trigger = trigger;
            this.reply = reply;
        }

        static FakeAiResponder disabled() {
            return new FakeAiResponder("", false, ignored -> false, CompletableFuture.completedFuture(""));
        }

        static FakeAiResponder virtualMember(String displayName) {
            return new FakeAiResponder(displayName, true, ignored -> false, CompletableFuture.completedFuture(""));
        }

        static FakeAiResponder replying(String displayName, Predicate<ChatMessage> trigger, String reply) {
            return new FakeAiResponder(displayName, true, trigger, CompletableFuture.completedFuture(reply));
        }

        static FakeAiResponder pending(String displayName, Predicate<ChatMessage> trigger) {
            return new FakeAiResponder(displayName, true, trigger, new CompletableFuture<>());
        }

        @Override
        public String displayName() {
            return displayName;
        }

        @Override
        public boolean hasVirtualMember() {
            return hasVirtualMember;
        }

        @Override
        public boolean isVirtualMember(String nickname) {
            return hasVirtualMember && displayName.equals(nickname);
        }

        @Override
        public boolean shouldReply(ChatMessage message) {
            return trigger.test(message);
        }

        @Override
        public CompletableFuture<String> reply(List<ChatMessage> history) {
            return reply;
        }
    }
}
