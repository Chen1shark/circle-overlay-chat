package com.talkoverlay.server.room;

import com.talkoverlay.server.config.ChatProperties;
import com.talkoverlay.server.model.ChatMessage;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * 房间消息历史存储。
 *
 * <p>历史消息只保存在内存中，用于新用户加入房间后快速补发最近消息。
 * 方法使用 {@code synchronized} 保证同一进程内并发读写安全。</p>
 */
@Component
public class MessageHistoryStore {

    private final ChatProperties properties;
    private final Map<String, Deque<ChatMessage>> histories = new HashMap<>();

    public MessageHistoryStore(ChatProperties properties) {
        this.properties = properties;
    }

    /**
     * 向指定房间追加一条历史消息。
     *
     * <p>超过 {@code chat.history-limit} 后会从最旧消息开始淘汰。</p>
     *
     * @param roomId 房间 ID
     * @param message 要保存的消息
     */
    public synchronized void add(String roomId, ChatMessage message) {
        Deque<ChatMessage> roomHistory = histories.computeIfAbsent(roomId, ignored -> new ArrayDeque<>());
        roomHistory.addLast(message);
        while (roomHistory.size() > properties.getHistoryLimit()) {
            roomHistory.removeFirst();
        }
    }

    /**
     * 获取指定房间当前保留的历史消息副本。
     *
     * @param roomId 房间 ID
     * @return 历史消息列表；房间没有历史时返回空列表
     */
    public synchronized List<ChatMessage> get(String roomId) {
        Deque<ChatMessage> roomHistory = histories.get(roomId);
        if (roomHistory == null) {
            return List.of();
        }
        return new ArrayList<>(roomHistory);
    }

    /**
     * 清理指定房间的历史消息。
     *
     * <p>通常在房间最后一名成员离开、房间被移除时调用。</p>
     *
     * @param roomId 房间 ID
     */
    public synchronized void clearRoom(String roomId) {
        histories.remove(roomId);
    }
}
