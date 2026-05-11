package com.talkoverlay.server.http;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 健康检查接口。
 *
 * <p>用于部署后快速确认 HTTP 服务已经启动并可访问。</p>
 */
@RestController
public class HealthController {

    /**
     * 返回服务存活状态。
     *
     * @return 简单的健康状态响应
     */
    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }
}
