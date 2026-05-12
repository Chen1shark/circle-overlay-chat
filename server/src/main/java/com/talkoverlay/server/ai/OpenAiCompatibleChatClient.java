package com.talkoverlay.server.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.talkoverlay.server.config.ChatProperties;
import com.talkoverlay.server.config.ChatProperties.Ai;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 基于 Java HttpClient 的 OpenAI 兼容聊天补全客户端。
 */
@Component
public class OpenAiCompatibleChatClient implements AiChatClient {

    private final ObjectMapper objectMapper;
    private final ChatProperties properties;
    private final HttpClient httpClient;

    @Autowired
    public OpenAiCompatibleChatClient(ObjectMapper objectMapper, ChatProperties properties) {
        this(objectMapper, properties, HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build());
    }

    OpenAiCompatibleChatClient(ObjectMapper objectMapper, ChatProperties properties, HttpClient httpClient) {
        this.objectMapper = objectMapper;
        this.properties = properties;
        this.httpClient = httpClient;
    }

    @Override
    public CompletableFuture<String> complete(List<AiChatMessage> messages) {
        return CompletableFuture.supplyAsync(() -> requestCompletion(messages));
    }

    private String requestCompletion(List<AiChatMessage> messages) {
        Ai ai = properties.getAi();
        try {
            String requestBody = objectMapper.writeValueAsString(requestPayload(ai, messages));
            HttpRequest request = HttpRequest.newBuilder(endpoint(ai.getBaseUrl()))
                .timeout(Duration.ofMillis(Math.max(1_000, ai.getTimeoutMs())))
                .header("Authorization", "Bearer " + ai.getApiKey())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(requestBody, StandardCharsets.UTF_8))
                .build();

            HttpResponse<String> response = httpClient.send(
                request,
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)
            );
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new AiChatException("AI 服务返回 HTTP " + response.statusCode());
            }
            return responseContent(response.body());
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new AiChatException("AI 请求被中断", ex);
        } catch (IOException ex) {
            throw new AiChatException("AI 请求失败", ex);
        } catch (IllegalArgumentException ex) {
            throw new AiChatException("AI 接口地址无效", ex);
        }
    }

    private ObjectNode requestPayload(Ai ai, List<AiChatMessage> messages) {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("model", ai.getModel());
        root.put("temperature", ai.getTemperature());
        root.put("max_tokens", ai.getMaxOutputTokens());

        ArrayNode messageNodes = root.putArray("messages");
        for (AiChatMessage message : messages) {
            ObjectNode messageNode = messageNodes.addObject();
            messageNode.put("role", message.role());
            messageNode.put("content", message.content());
        }

        if (ai.isThinkingDisabled()) {
            ObjectNode thinking = root.putObject("thinking");
            thinking.put("type", "disabled");
        }
        return root;
    }

    private String responseContent(String responseBody) throws IOException {
        JsonNode root = objectMapper.readTree(responseBody);
        String content = root.path("choices")
            .path(0)
            .path("message")
            .path("content")
            .asText("");
        if (content.isBlank()) {
            throw new AiChatException("AI 返回格式异常");
        }
        return content;
    }

    private URI endpoint(String baseUrl) {
        String normalized = baseUrl.strip();
        if (normalized.endsWith("/chat/completions")) {
            return URI.create(normalized);
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return URI.create(normalized + "/chat/completions");
    }
}
