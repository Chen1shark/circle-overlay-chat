package com.talkoverlay.server.ai;

import com.talkoverlay.server.config.ChatProperties;
import com.talkoverlay.server.config.ChatProperties.Ai;
import com.talkoverlay.server.model.ChatMessage;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.springframework.stereotype.Component;

/**
 * AI 虚拟成员的触发、上下文整理和回复裁剪逻辑。
 */
@Component
public class AiChatService implements AiResponder {

    private static final String FALLBACK_MENTION_NAME = "AI";
    private static final String MESSAGE_TYPE_TEXT = "text";
    private static final String ROLE_SYSTEM = "system";
    private static final String ROLE_USER = "user";
    private static final String ROLE_ASSISTANT = "assistant";
    private static final String SYSTEM_SENDER = "";

    private final ChatProperties properties;
    private final AiChatClient client;

    public AiChatService(ChatProperties properties, AiChatClient client) {
        this.properties = properties;
        this.client = client;
    }

    @Override
    public String displayName() {
        return strip(ai().getName());
    }

    @Override
    public boolean hasVirtualMember() {
        return ai().isEnabled() && !displayName().isBlank();
    }

    @Override
    public boolean isVirtualMember(String nickname) {
        return hasVirtualMember() && displayName().equals(strip(nickname));
    }

    @Override
    public boolean shouldReply(ChatMessage message) {
        if (!ai().isEnabled() || message == null || !isTextMessage(message)) {
            return false;
        }
        if (isVirtualMember(message.sender())) {
            return false;
        }
        String content = strip(message.content());
        return containsMention(content, FALLBACK_MENTION_NAME)
            || containsMention(content, displayName());
    }

    @Override
    public CompletableFuture<String> reply(List<ChatMessage> history) {
        try {
            validateConfig();
            List<AiChatMessage> context = buildContext(history);
            return client.complete(context).thenApply(this::normalizeReply);
        } catch (RuntimeException ex) {
            return CompletableFuture.failedFuture(ex);
        }
    }

    private List<AiChatMessage> buildContext(List<ChatMessage> history) {
        List<AiChatMessage> context = new ArrayList<>();
        context.add(new AiChatMessage(ROLE_SYSTEM, strip(ai().getPrompt())));
        for (ChatMessage message : history) {
            if (!shouldIncludeInContext(message)) {
                continue;
            }
            String sender = strip(message.sender());
            String content = strip(message.content());
            if (isVirtualMember(sender)) {
                context.add(new AiChatMessage(ROLE_ASSISTANT, content));
            } else {
                context.add(new AiChatMessage(ROLE_USER, sender + ": " + content));
            }
        }
        return List.copyOf(context);
    }

    private boolean shouldIncludeInContext(ChatMessage message) {
        return message != null
            && isTextMessage(message)
            && !SYSTEM_SENDER.equals(message.sender())
            && !strip(message.content()).isBlank();
    }

    private boolean isTextMessage(ChatMessage message) {
        String messageType = strip(message.messageType());
        return messageType.isBlank() || MESSAGE_TYPE_TEXT.equals(messageType);
    }

    private String normalizeReply(String reply) {
        String normalized = strip(reply);
        if (normalized.isBlank()) {
            throw new AiChatException("AI 返回了空回复");
        }

        int maxLength = Math.max(1, properties.getMaxMessageLength());
        if (normalized.codePointCount(0, normalized.length()) <= maxLength) {
            return normalized;
        }

        String suffix = "...";
        if (maxLength <= suffix.length()) {
            return suffix.substring(0, maxLength);
        }

        int contentLimit = maxLength - suffix.length();
        int endIndex = normalized.offsetByCodePoints(0, contentLimit);
        return normalized.substring(0, endIndex) + suffix;
    }

    private void validateConfig() {
        List<String> missing = new ArrayList<>();
        if (displayName().isBlank()) {
            missing.add("name");
        }
        if (strip(ai().getPrompt()).isBlank()) {
            missing.add("prompt");
        }
        if (strip(ai().getBaseUrl()).isBlank()) {
            missing.add("base-url");
        }
        if (strip(ai().getApiKey()).isBlank()) {
            missing.add("api-key");
        }
        if (strip(ai().getModel()).isBlank()) {
            missing.add("model");
        }
        if (!missing.isEmpty()) {
            throw new AiChatException("AI 配置不完整：" + String.join(", ", missing));
        }
    }

    static boolean containsMention(String content, String name) {
        String targetName = strip(name);
        if (content == null || targetName.isBlank()) {
            return false;
        }

        String mention = "@" + targetName;
        int index = content.indexOf(mention);
        while (index >= 0) {
            int end = index + mention.length();
            if (hasMentionBoundary(content, end)) {
                return true;
            }
            index = content.indexOf(mention, index + 1);
        }
        return false;
    }

    private static boolean hasMentionBoundary(String content, int end) {
        if (end >= content.length()) {
            return true;
        }
        int codePoint = content.codePointAt(end);
        return Character.isWhitespace(codePoint) || isMentionPunctuation(codePoint);
    }

    private static boolean isMentionPunctuation(int codePoint) {
        int type = Character.getType(codePoint);
        return type == Character.DASH_PUNCTUATION
            || type == Character.START_PUNCTUATION
            || type == Character.END_PUNCTUATION
            || type == Character.INITIAL_QUOTE_PUNCTUATION
            || type == Character.FINAL_QUOTE_PUNCTUATION
            || type == Character.OTHER_PUNCTUATION;
    }

    private Ai ai() {
        return properties.getAi();
    }

    private static String strip(String value) {
        return value == null ? "" : value.strip();
    }
}
