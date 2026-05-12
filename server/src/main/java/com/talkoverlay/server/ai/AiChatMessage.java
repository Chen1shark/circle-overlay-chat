package com.talkoverlay.server.ai;

/**
 * 发送给 AI 模型的单条上下文消息。
 *
 * @param role OpenAI 兼容接口使用的角色，通常是 system、user 或 assistant
 * @param content 消息正文
 */
public record AiChatMessage(String role, String content) {
}
