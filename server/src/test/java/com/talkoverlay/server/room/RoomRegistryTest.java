package com.talkoverlay.server.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.talkoverlay.server.config.ChatProperties;
import com.talkoverlay.server.room.RoomRegistry.JoinStatus;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.WebSocketSession;

/**
 * {@link RoomRegistry} 的核心房间规则测试。
 */
class RoomRegistryTest {

    /**
     * 同一个房间内不能出现重复昵称。
     */
    @Test
    void rejectsDuplicateNicknameInSameRoom() {
        RoomRegistry registry = new RoomRegistry(defaultProperties());

        assertThat(registry.join("s1", session(), "live001", "alice").status())
            .isEqualTo(JoinStatus.OK);
        assertThat(registry.join("s2", session(), "live001", "alice").status())
            .isEqualTo(JoinStatus.NICKNAME_EXISTS);
    }

    /**
     * 房间人数达到上限后，后续用户不能继续加入。
     */
    @Test
    void rejectsRoomWhenUserLimitReached() {
        ChatProperties properties = defaultProperties();
        properties.setMaxUsersPerRoom(1);
        RoomRegistry registry = new RoomRegistry(properties);

        assertThat(registry.join("s1", session(), "live001", "alice").status())
            .isEqualTo(JoinStatus.OK);
        assertThat(registry.join("s2", session(), "live001", "bob").status())
            .isEqualTo(JoinStatus.ROOM_FULL);
    }

    /**
     * 最后一名成员离开后，房间应从注册表中删除。
     */
    @Test
    void removesRoomWhenLastUserLeaves() {
        RoomRegistry registry = new RoomRegistry(defaultProperties());

        registry.join("s1", session(), "live001", "alice");
        assertThat(registry.roomCount()).isEqualTo(1);

        RoomRegistry.LeaveResult result = registry.leave("s1");

        assertThat(result.roomRemoved()).isTrue();
        assertThat(registry.roomCount()).isZero();
    }

    /**
     * 创建测试用默认配置。
     */
    private ChatProperties defaultProperties() {
        ChatProperties properties = new ChatProperties();
        properties.setMaxConnections(300);
        properties.setMaxRooms(50);
        properties.setMaxUsersPerRoom(10);
        properties.setHistoryLimit(200);
        properties.setMaxMessageLength(500);
        return properties;
    }

    /**
     * 创建只用于占位的 WebSocket 会话 mock。
     */
    private WebSocketSession session() {
        return mock(WebSocketSession.class);
    }
}
