package com.talkoverlay.server.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.talkoverlay.server.config.ChatProperties;
import com.talkoverlay.server.config.ChatProperties.Ai;
import com.talkoverlay.server.model.ChatMessage;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

class AiChatServiceTest {

    @Test
    void matchesMentionsOnlyWithValidBoundary() {
        AiChatService service = new AiChatService(defaultProperties(), messages -> CompletableFuture.completedFuture("ok"));

        assertThat(service.shouldReply(text("alice", "@AI help"))).isTrue();
        assertThat(service.shouldReply(text("alice", "@AI, help"))).isTrue();
        assertThat(service.shouldReply(text("alice", "@CircleBot\uFF0Chelp"))).isTrue();
        assertThat(service.shouldReply(text("alice", "@AIGroup help"))).isFalse();
        assertThat(service.shouldReply(text("alice", "@AI123 help"))).isFalse();
        assertThat(service.shouldReply(text("CircleBot", "@AI help"))).isFalse();
    }

    @Test
    void buildsContextFromTextHistoryOnly() {
        CapturingAiClient client = new CapturingAiClient();
        AiChatService service = new AiChatService(defaultProperties(), client);

        String reply = service.reply(List.of(
            text("", "alice joined"),
            text("alice", "hello"),
            new ChatMessage("m3", "alice", "", 3, "image", null),
            text("CircleBot", "answer")
        )).join();

        assertThat(reply).isEqualTo("ok");
        assertThat(client.messages).containsExactly(
            new AiChatMessage("system", "You are CircleBot."),
            new AiChatMessage("user", "alice: hello"),
            new AiChatMessage("assistant", "answer")
        );
    }

    @Test
    void clampsAiReplyToConfiguredMessageLengthEvenWhenLimitIsInvalid() {
        ChatProperties properties = defaultProperties();
        properties.setMaxMessageLength(0);
        AiChatService service = new AiChatService(
            properties,
            messages -> CompletableFuture.completedFuture("abcdef")
        );

        assertThat(service.reply(List.of(text("alice", "@AI help"))).join()).isEqualTo(".");
    }

    @Test
    void truncatesAiReplyWithoutExceedingConfiguredMessageLength() {
        ChatProperties properties = defaultProperties();
        properties.setMaxMessageLength(5);
        AiChatService service = new AiChatService(
            properties,
            messages -> CompletableFuture.completedFuture("abcdef")
        );

        String reply = service.reply(List.of(text("alice", "@AI help"))).join();

        assertThat(reply).isEqualTo("ab...");
        assertThat(reply.codePointCount(0, reply.length())).isEqualTo(5);
    }

    private ChatProperties defaultProperties() {
        ChatProperties properties = new ChatProperties();
        properties.setMaxMessageLength(500);
        Ai ai = properties.getAi();
        ai.setEnabled(true);
        ai.setName("CircleBot");
        ai.setPrompt("You are CircleBot.");
        ai.setBaseUrl("https://api.example.com/v1");
        ai.setApiKey("test-key");
        ai.setModel("test-model");
        return properties;
    }

    private ChatMessage text(String sender, String content) {
        return new ChatMessage("id-" + sender + "-" + content, sender, content, 1, "text", null);
    }

    private static class CapturingAiClient implements AiChatClient {
        private List<AiChatMessage> messages = List.of();

        @Override
        public CompletableFuture<String> complete(List<AiChatMessage> messages) {
            this.messages = List.copyOf(messages);
            return CompletableFuture.completedFuture("ok");
        }
    }
}
