package com.talkoverlay.server.ai;

/**
 * AI 调用或配置异常。
 */
public class AiChatException extends RuntimeException {

    public AiChatException(String message) {
        super(message);
    }

    public AiChatException(String message, Throwable cause) {
        super(message, cause);
    }
}
