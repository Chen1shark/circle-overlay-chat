package com.talkoverlay.server.ai;

import com.talkoverlay.server.model.ChatMessage;
import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * 聊天房间里的 AI 虚拟成员行为。
 */
public interface AiResponder {

    /**
     * @return AI 在房间内展示和发言使用的名称
     */
    String displayName();

    /**
     * @return 当前配置是否应该把 AI 展示为虚拟成员
     */
    boolean hasVirtualMember();

    /**
     * 判断昵称是否等于 AI 虚拟成员名称。
     *
     * @param nickname 用户昵称
     * @return 相同则返回 true
     */
    boolean isVirtualMember(String nickname);

    /**
     * 判断用户消息是否应该触发 AI 回复。
     *
     * @param message 已广播并写入历史的用户消息
     * @return 需要触发则返回 true
     */
    boolean shouldReply(ChatMessage message);

    /**
     * 根据当前房间历史生成 AI 回复。
     *
     * @param history 当前房间内存历史
     * @return 异步回复文本
     */
    CompletableFuture<String> reply(List<ChatMessage> history);
}
