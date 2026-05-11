package com.talkoverlay.server.room;

import com.talkoverlay.server.config.ChatProperties;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.stereotype.Component;

/**
 * 全局 WebSocket 连接数限制器。
 *
 * <p>连接建立时调用 {@link #tryAcquire()} 占用一个名额，连接关闭或异常时调用
 * {@link #release()} 释放名额。内部使用 CAS 保证并发连接下计数准确。</p>
 */
@Component
public class ConnectionLimiter {

    private final ChatProperties properties;
    private final AtomicInteger activeConnections = new AtomicInteger();

    public ConnectionLimiter(ChatProperties properties) {
        this.properties = properties;
    }

    /**
     * 尝试占用一个连接名额。
     *
     * @return {@code true} 表示占用成功；{@code false} 表示已经达到最大连接数
     */
    public boolean tryAcquire() {
        while (true) {
            int current = activeConnections.get();
            if (current >= properties.getMaxConnections()) {
                return false;
            }
            if (activeConnections.compareAndSet(current, current + 1)) {
                return true;
            }
        }
    }

    /**
     * 释放一个连接名额。
     *
     * <p>计数最低保持为 0，避免重复清理导致负数。</p>
     */
    public void release() {
        activeConnections.updateAndGet(value -> Math.max(0, value - 1));
    }

    /**
     * 返回当前记录的活跃连接数量。
     *
     * @return 活跃连接数
     */
    public int activeConnections() {
        return activeConnections.get();
    }
}
