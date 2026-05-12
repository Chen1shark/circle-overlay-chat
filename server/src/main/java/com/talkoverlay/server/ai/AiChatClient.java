package com.talkoverlay.server.ai;

import java.util.List;
import java.util.concurrent.CompletableFuture;

/**
 * AI 聊天补全客户端抽象。
 *
 * <p>WebSocket 聊天流程只依赖这个接口，方便测试时替换成假实现，
 * 也方便后续替换成别的 OpenAI 兼容服务。</p>
 */
public interface AiChatClient {

    /**
     * 根据上下文生成 AI 回复。
     *
     * @param messages 已整理好的模型上下文
     * @return 异步回复文本
     */
    CompletableFuture<String> complete(List<AiChatMessage> messages);
}
