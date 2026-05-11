package com.talkoverlay.server.room;

import com.talkoverlay.server.config.ChatProperties;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

/**
 * 房间与在线成员注册表。
 *
 * <p>该类只维护当前进程内的在线状态：房间、成员、WebSocketSession 的映射关系。
 * 所有公开方法使用 {@code synchronized}，保证 WebSocket 多线程回调下状态一致。</p>
 */
@Component
public class RoomRegistry {

    private final ChatProperties properties;
    private final Map<String, Room> rooms = new HashMap<>();
    private final Map<String, String> sessionRooms = new HashMap<>();

    public RoomRegistry(ChatProperties properties) {
        this.properties = properties;
    }

    /**
     * 将一个 WebSocket 会话加入指定房间。
     *
     * <p>加入前会检查：同一个会话不能重复加入、房间总数不能超限、房间人数不能超限、
     * 同房间昵称不能重复。</p>
     *
     * @param sessionId WebSocket 会话 ID
     * @param session WebSocket 会话对象
     * @param roomId 房间 ID
     * @param nickname 用户昵称
     * @return 加入结果，包含成功状态或失败原因
     */
    public synchronized JoinResult join(String sessionId, WebSocketSession session, String roomId, String nickname) {
        if (sessionRooms.containsKey(sessionId)) {
            return JoinResult.failed(JoinStatus.ALREADY_JOINED);
        }
        if (!rooms.containsKey(roomId) && rooms.size() >= properties.getMaxRooms()) {
            return JoinResult.failed(JoinStatus.MAX_ROOMS_REACHED);
        }

        Room room = rooms.computeIfAbsent(roomId, Room::new);
        if (room.members.size() >= properties.getMaxUsersPerRoom()) {
            return JoinResult.failed(JoinStatus.ROOM_FULL);
        }
        if (room.hasNickname(nickname)) {
            return JoinResult.failed(JoinStatus.NICKNAME_EXISTS);
        }

        room.members.put(sessionId, new Participant(session, nickname));
        sessionRooms.put(sessionId, roomId);
        return JoinResult.ok(roomId, nickname, snapshot(room));
    }

    /**
     * 将指定会话从房间移除。
     *
     * <p>如果该会话是房间最后一个成员，会同时删除房间。</p>
     *
     * @param sessionId WebSocket 会话 ID
     * @return 离开结果，包含是否曾经加入、房间是否被删除、剩余成员快照
     */
    public synchronized LeaveResult leave(String sessionId) {
        String roomId = sessionRooms.remove(sessionId);
        if (roomId == null) {
            return LeaveResult.notJoined();
        }

        Room room = rooms.get(roomId);
        if (room == null) {
            return LeaveResult.notJoined();
        }

        room.members.remove(sessionId);
        if (room.members.isEmpty()) {
            rooms.remove(roomId);
            return LeaveResult.roomRemoved(roomId);
        }

        return LeaveResult.remaining(roomId, snapshot(room));
    }

    /**
     * 查询指定会话对应的房间与昵称。
     *
     * @param sessionId WebSocket 会话 ID
     * @return 在线成员信息；会话未加入房间时返回空
     */
    public synchronized Optional<ParticipantInfo> participant(String sessionId) {
        String roomId = sessionRooms.get(sessionId);
        if (roomId == null) {
            return Optional.empty();
        }
        Room room = rooms.get(roomId);
        if (room == null) {
            return Optional.empty();
        }
        Participant participant = room.members.get(sessionId);
        if (participant == null) {
            return Optional.empty();
        }
        return Optional.of(new ParticipantInfo(roomId, participant.nickname()));
    }

    /**
     * 获取房间内所有在线成员的 WebSocket 会话。
     *
     * @param roomId 房间 ID
     * @return 会话列表；房间不存在时返回空列表
     */
    public synchronized List<WebSocketSession> roomSessions(String roomId) {
        Room room = rooms.get(roomId);
        if (room == null) {
            return List.of();
        }
        return room.members.values().stream()
            .map(Participant::session)
            .toList();
    }

    /**
     * 返回当前房间数量。
     *
     * @return 当前仍存在的房间数
     */
    public synchronized int roomCount() {
        return rooms.size();
    }

    /**
     * 构造房间状态快照。
     *
     * <p>快照用于广播在线人数和成员昵称，避免调用方直接读取内部 Map。</p>
     */
    private RoomSnapshot snapshot(Room room) {
        List<String> members = new ArrayList<>();
        List<WebSocketSession> sessions = new ArrayList<>();
        for (Participant participant : room.members.values()) {
            members.add(participant.nickname());
            sessions.add(participant.session());
        }
        return new RoomSnapshot(room.roomId, members.size(), properties.getMaxUsersPerRoom(), members, sessions);
    }

    /**
     * 房间内部状态。
     *
     * @param roomId 房间 ID
     * @param members 房间成员，key 为 WebSocket 会话 ID
     */
    private record Room(String roomId, Map<String, Participant> members) {
        Room(String roomId) {
            this(roomId, new LinkedHashMap<>());
        }

        /**
         * 判断房间内是否已经存在指定昵称。
         */
        boolean hasNickname(String nickname) {
            return members.values().stream()
                .anyMatch(participant -> participant.nickname().equals(nickname));
        }
    }

    /**
     * 房间成员内部状态。
     *
     * @param session 成员对应的 WebSocket 会话
     * @param nickname 成员昵称
     */
    private record Participant(WebSocketSession session, String nickname) {
    }

    /**
     * 已加入房间的成员信息。
     *
     * @param roomId 房间 ID
     * @param nickname 成员昵称
     */
    public record ParticipantInfo(String roomId, String nickname) {
    }

    /**
     * 房间状态快照。
     *
     * @param roomId 房间 ID
     * @param online 当前在线人数
     * @param maxUsers 房间最大人数
     * @param members 成员昵称列表
     * @param sessions 成员 WebSocket 会话列表
     */
    public record RoomSnapshot(
        String roomId,
        int online,
        int maxUsers,
        List<String> members,
        List<WebSocketSession> sessions
    ) {
    }

    /**
     * 加入房间的结果状态。
     */
    public enum JoinStatus {
        /** 加入成功。 */
        OK,

        /** 当前 WebSocket 会话已经加入过房间。 */
        ALREADY_JOINED,

        /** 服务端房间总数已达到上限。 */
        MAX_ROOMS_REACHED,

        /** 目标房间人数已满。 */
        ROOM_FULL,

        /** 目标房间中已经存在相同昵称。 */
        NICKNAME_EXISTS
    }

    /**
     * 加入房间的返回结果。
     *
     * @param status 加入状态
     * @param roomId 成功加入的房间 ID
     * @param nickname 成功加入的昵称
     * @param snapshot 加入后的房间快照
     */
    public record JoinResult(
        JoinStatus status,
        String roomId,
        String nickname,
        RoomSnapshot snapshot
    ) {
        /**
         * 创建加入成功结果。
         */
        static JoinResult ok(String roomId, String nickname, RoomSnapshot snapshot) {
            return new JoinResult(JoinStatus.OK, roomId, nickname, snapshot);
        }

        /**
         * 创建加入失败结果。
         */
        static JoinResult failed(JoinStatus status) {
            return new JoinResult(status, null, null, null);
        }
    }

    /**
     * 离开房间的返回结果。
     *
     * @param joined 指定会话此前是否已经加入房间
     * @param roomRemoved 离开后房间是否被删除
     * @param roomId 受影响的房间 ID
     * @param snapshot 离开后的房间快照；房间被删除时为空
     */
    public record LeaveResult(
        boolean joined,
        boolean roomRemoved,
        String roomId,
        RoomSnapshot snapshot
    ) {
        /**
         * 创建“会话未加入房间”的结果。
         */
        static LeaveResult notJoined() {
            return new LeaveResult(false, false, null, null);
        }

        /**
         * 创建“最后一名成员离开，房间已删除”的结果。
         */
        static LeaveResult roomRemoved(String roomId) {
            return new LeaveResult(true, true, roomId, null);
        }

        /**
         * 创建“房间仍有其他成员”的结果。
         */
        static LeaveResult remaining(String roomId, RoomSnapshot snapshot) {
            return new LeaveResult(true, false, roomId, snapshot);
        }
    }
}
