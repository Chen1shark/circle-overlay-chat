package com.talkoverlay.server.model;

/**
 * 聊天消息数据模型。
 *
 * @param messageId 服务端生成的消息唯一 ID
 * @param sender 发送者昵称
 * @param content 文本消息正文；图片消息为空字符串
 * @param serverTime 服务端接收并广播消息的时间戳，单位毫秒
 * @param messageType 消息类型，当前支持 {@code text} 与 {@code image}
 * @param image 图片消息元数据；文本消息为 {@code null}
 */
public record ChatMessage(
    String messageId,
    String sender,
    String content,
    long serverTime,
    String messageType,
    ImagePayload image
) {
    /**
     * 图片消息负载。
     *
     * @param mimeType 图片 MIME 类型
     * @param dataUrl 可直接展示的 base64 data URL
     * @param width 压缩后图片宽度
     * @param height 压缩后图片高度
     * @param size 压缩后图片字节数
     */
    public record ImagePayload(
        String mimeType,
        String dataUrl,
        int width,
        int height,
        long size
    ) {
    }
}
