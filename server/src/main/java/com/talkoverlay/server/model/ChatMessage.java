package com.talkoverlay.server.model;

/**
 * 聊天消息数据模型。
 *
 * @param messageId 服务端生成的消息唯一 ID
 * @param sender 发送者昵称
 * @param content 消息正文
 * @param serverTime 服务端接收并广播消息的时间戳，单位毫秒
 */
public record ChatMessage(
    String messageId,
    String sender,
    String content,
    long serverTime
) {
}
