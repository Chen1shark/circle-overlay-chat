package com.talkoverlay.server.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.talkoverlay.server.config.ChatProperties;
import com.talkoverlay.server.room.ConnectionLimiter;
import com.talkoverlay.server.room.MessageHistoryStore;
import com.talkoverlay.server.room.RoomRegistry;
import java.io.IOException;
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
     * 创建带真实依赖的 WebSocket handler，便于验证连接清理逻辑。
     */
    private ChatWebSocketHandler newHandler(ChatProperties properties, ConnectionLimiter limiter) {
        return new ChatWebSocketHandler(
            new ObjectMapper(),
            properties,
            new RoomRegistry(properties),
            new MessageHistoryStore(properties),
            limiter
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
}
