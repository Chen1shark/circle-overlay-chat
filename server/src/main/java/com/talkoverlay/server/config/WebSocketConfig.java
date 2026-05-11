package com.talkoverlay.server.config;

import com.talkoverlay.server.websocket.ChatWebSocketHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

/**
 * WebSocket 服务配置。
 *
 * <p>这里注册聊天 WebSocket 入口 {@code /ws}，并设置底层容器的消息缓冲区和空闲超时。</p>
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final ChatWebSocketHandler chatWebSocketHandler;
    private final ChatProperties properties;

    public WebSocketConfig(ChatWebSocketHandler chatWebSocketHandler, ChatProperties properties) {
        this.chatWebSocketHandler = chatWebSocketHandler;
        this.properties = properties;
    }

    /**
     * 注册客户端连接使用的 WebSocket 端点。
     *
     * @param registry Spring WebSocket handler 注册器
     */
    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(chatWebSocketHandler, "/ws")
            .setAllowedOrigins("*");
    }

    /**
     * 配置底层 WebSocket 容器参数。
     *
     * <p>空闲超时用于清理客户端断网后遗留的僵尸连接；正常客户端会每 20 秒发送一次心跳。</p>
     *
     * @return WebSocket 容器工厂
     */
    @Bean
    public ServletServerContainerFactoryBean webSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(properties.getWebsocketMessageBufferBytes());
        container.setMaxBinaryMessageBufferSize(properties.getWebsocketMessageBufferBytes());
        container.setMaxSessionIdleTimeout(properties.getWebsocketIdleTimeoutMs());
        return container;
    }
}
